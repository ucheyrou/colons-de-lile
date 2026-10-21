// Transport entre l'écran (hôte) et les téléphones. Aucun accès au DOM ni aux règles.
//
// Le canal `room` est entendu par tous les participants. Pour que les mains restent privées :
//  - chaque appareil a une identité ECDH (P-256) ; sa clé publique voyage dans sa présence,
//    que la plateforme estampille : personne ne peut la publier à la place d'un autre ;
//  - hôte et téléphone en dérivent une clé AES-GCM commune ; tout message de jeu est chiffré ;
//  - la plateforme limite un message à 4 Kio : les messages sont découpés en morceaux.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Net = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOPIC_ACT = 'a';   // téléphone -> hôte
  const TOPIC_VIEW = 'v';  // hôte -> téléphone
  const CHUNK = 2800;
  const EC = { name: 'ECDH', namedCurve: 'P-256' };

  const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle) || null;
  const available = () => !!subtle();

  function b64(buf) {
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const fp = (pub) => pub.slice(6, 14);
  const randomId = () => b64(crypto.getRandomValues(new Uint8Array(6))).replace(/[^A-Za-z0-9]/g, 'x');

  // ---------- Cryptographie ----------
  async function newIdentity() {
    const kp = await subtle().generateKey(EC, true, ['deriveKey']);
    return {
      pub: b64(await subtle().exportKey('raw', kp.publicKey)),
      jwk: await subtle().exportKey('jwk', kp.privateKey),
      priv: kp.privateKey,
    };
  }
  async function restoreIdentity(saved) {
    const priv = await subtle().importKey('jwk', saved.jwk, EC, false, ['deriveKey']);
    return { pub: saved.pub, jwk: saved.jwk, priv };
  }
  async function deriveKey(priv, theirPub) {
    const pub = await subtle().importKey('raw', unb64(theirPub), EC, false, []);
    return subtle().deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return b64(out);
  }
  async function open(key, text) {
    const u = unb64(text);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---------- Découpage ----------
  async function emitSealed(room, topic, key, obj, to) {
    const str = await seal(key, obj);
    const m = randomId();
    const n = Math.max(1, Math.ceil(str.length / CHUNK));
    for (let i = 0; i < n; i++) await room.emit(topic, { m, i, n, to, d: str.slice(i * CHUNK, (i + 1) * CHUNK) });
  }

  class Assembler {
    constructor() { this.parts = new Map(); }
    push(peer, data) {
      if (!data || typeof data.d !== 'string' || !Number.isInteger(data.i) || !Number.isInteger(data.n) || data.n < 1 || data.n > 64 || data.i < 0 || data.i >= data.n) return null;
      const now = Date.now();
      for (const [k, v] of this.parts) if (now - v.t > 30000) this.parts.delete(k);
      const k = peer + ':' + data.m;
      let e = this.parts.get(k);
      if (!e) { e = { t: now, n: data.n, got: new Map() }; this.parts.set(k, e); }
      e.got.set(data.i, data.d);
      if (e.got.size < e.n) return null;
      this.parts.delete(k);
      let s = '';
      for (let i = 0; i < e.n; i++) s += e.got.get(i);
      return s;
    }
  }

  const playersOf = (room) => room.peers().filter((p) => !p.isMe && p.presence && p.presence.r === 'p' && typeof p.presence.pub === 'string');

  // ---------- Hôte (l'écran du plateau) ----------
  // opts : room, identity, viewOf(seat) -> JSON, onAct(seat, action) -> message d'erreur | null, onLobby()
  function createHost(opts) {
    const room = opts.room;
    const keys = new Map();
    const lastN = new Map();
    const lastSent = new Map();
    const asm = new Assembler();
    let seats = Object.assign({}, opts.seats || {});
    let version = opts.version || 0;
    let status = 'lobby';
    let actorPub = null;
    const seen = [];
    const noteSeen = () => playersOf(room).forEach((p) => { if (!seen.includes(p.presence.pub)) seen.push(p.presence.pub); });
    let chain = Promise.resolve();
    const q = (fn) => { chain = chain.then(fn).catch(() => {}); return chain; };

    room.presence({ r: 'h', pub: opts.identity.pub, v: version, st: status });

    const keyFor = (pub) => {
      if (!keys.has(pub)) keys.set(pub, deriveKey(opts.identity.priv, pub));
      return keys.get(pub);
    };
    async function toPeer(peer, payload) {
      const pub = peer.presence.pub;
      await emitSealed(room, TOPIC_VIEW, await keyFor(pub), payload, fp(pub));
    }
    async function sendView(peer) {
      const seat = seats[peer.presence.pub];
      lastSent.set(peer.peer, Date.now());
      if (seat === undefined) {
        if (status === 'play') await toPeer(peer, { k: 'full' });
        else await toPeer(peer, { k: 'wait', n: playersOf(room).length });
        return;
      }
      await toPeer(peer, { k: 'view', v: version, seat, view: opts.viewOf(seat) });
    }

    const offPeers = room.onPeers((ch) => {
      noteSeen();
      if (opts.onLobby) opts.onLobby();
      const fresh = new Set(ch.joined.map((p) => p.peer));
      [...ch.joined, ...ch.updated].forEach((p) => {
        if (p.isMe || !p.presence || p.presence.r !== 'p' || typeof p.presence.pub !== 'string') return;
        const stale = p.presence.v !== version && Date.now() - (lastSent.get(p.peer) || 0) > 1500;
        if (fresh.has(p.peer) || stale) q(() => sendView(p));
      });
    });

    // Filet de sécurité : un message perdu n'est pas rejoué. Tout téléphone en retard sur la version reçoit sa vue à nouveau.
    const resync = setInterval(() => {
      playersOf(room).forEach((p) => {
        if (Date.now() - (lastSent.get(p.peer) || 0) < 2500) return;
        const behind = seats[p.presence.pub] !== undefined ? p.presence.v !== version : status === 'play' || p.presence.v !== -1;
        if (behind) q(() => sendView(p));
      });
    }, 3000);
    if (resync.unref) resync.unref();

    const offAct = room.on(TOPIC_ACT, (msg) => {
      if (msg.isMe) return;
      const peer = room.peers().find((p) => p.peer === msg.peer);
      if (!peer || !peer.presence || peer.presence.r !== 'p' || typeof peer.presence.pub !== 'string') return;
      const pub = peer.presence.pub;
      if (seats[pub] === undefined) return;
      const text = asm.push(msg.peer, msg.data);
      if (!text) return;
      q(async () => {
        let payload;
        try { payload = await open(await keyFor(pub), text); } catch (e) { return; }
        if (!payload || !(payload.n > (lastN.get(pub) || 0)) || !payload.action) return;
        lastN.set(pub, payload.n);
        actorPub = pub;
        const err = opts.onAct(seats[pub], payload.action);
        actorPub = null;
        if (err) {
          await toPeer(peer, { k: 'err', n: payload.n, error: err });
          await sendView(peer); // annule l'affichage anticipé du téléphone
        }
      });
    });

    return {
      setSeats(map) { seats = Object.assign({}, map); },
      seats: () => Object.assign({}, seats),
      // Ceux qui sont là maintenant, dans l'ordre d'arrivée.
      lobby: () => (noteSeen(), playersOf(room)
        .slice()
        .sort((a, b) => seen.indexOf(a.presence.pub) - seen.indexOf(b.presence.pub))
        .map((p) => ({ peer: p.peer, pub: p.presence.pub, name: String(p.presence.name || 'Joueur').slice(0, 14), seat: seats[p.presence.pub] }))),
      setStatus(st) {
        status = st;
        room.presence({ st });
        playersOf(room).forEach((p) => q(() => sendView(p)));
      },
      publish() {
        version++;
        room.presence({ v: version });
        const first = actorPub; // celui qui vient d'agir est servi en premier
        playersOf(room)
          .filter((p) => seats[p.presence.pub] !== undefined)
          .sort((a, b) => (b.presence.pub === first) - (a.presence.pub === first))
          .forEach((p) => q(() => sendView(p)));
      },
      version: () => version,
      close() { clearInterval(resync); offPeers(); offAct(); room.presence({ r: null, pub: null, v: null, st: null }); },
    };
  }

  // ---------- Client (le téléphone) ----------
  // opts : room, identity, name, onView(payload), onStatus(status, info), onError(text)
  function createClient(opts) {
    const room = opts.room;
    const asm = new Assembler();
    let hostKey = null, hostPeer = null, hostPub = null, lastV = -1, counter = Date.now();
    let status = '';
    const set = (s, info) => { if (s !== status || info) { status = s; opts.onStatus(s, info || {}); } };

    room.presence({ r: 'p', name: opts.name, pub: opts.identity.pub, v: -1 });
    set('searching');

    function scan() {
      const host = room.peers().find((p) => !p.isMe && p.presence && p.presence.r === 'h' && typeof p.presence.pub === 'string');
      if (!host) {
        if (hostPeer) { hostPeer = null; hostKey = null; hostPub = null; }
        set('searching');
        return;
      }
      if (host.peer !== hostPeer || host.presence.pub !== hostPub) {
        hostPeer = host.peer;
        if (host.presence.pub !== hostPub) { hostPub = host.presence.pub; lastV = -1; hostKey = null; }
        deriveKey(opts.identity.priv, hostPub).then((k) => { hostKey = k; }).catch(() => {});
        room.presence({ v: -1 });
        set('found');
      }
    }
    // Écran trouvé mais rien reçu : on relance la demande (un changement de présence réveille l'hôte).
    let nudge = 0;
    const nudger = setInterval(() => { if (status === 'found') room.presence({ n: ++nudge }); }, 3000);
    if (nudger.unref) nudger.unref();

    const offPeers = room.onPeers(() => { scan(); if (opts.onLobby) opts.onLobby(playersOf(room).concat(room.peers().filter((p) => p.isMe)).map((p) => String(p.presence.name || 'Joueur').slice(0, 14))); });
    scan();

    const offView = room.on(TOPIC_VIEW, (msg) => {
      if (msg.isMe || msg.peer !== hostPeer || !msg.data || msg.data.to !== fp(opts.identity.pub)) return;
      const text = asm.push(msg.peer, msg.data);
      if (!text) return;
      const tryOpen = async () => {
        for (let i = 0; i < 20 && !hostKey; i++) await new Promise((r) => setTimeout(r, 50));
        if (!hostKey) return;
        let p;
        try { p = await open(hostKey, text); } catch (e) { return; }
        if (!p) return;
        if (p.k === 'view') {
          if (p.v < lastV) return;
          lastV = p.v;
          room.presence({ v: p.v });
          set('playing');
          opts.onView(p);
        } else if (p.k === 'wait') set('lobby', { count: p.n });
        else if (p.k === 'full') set('full');
        else if (p.k === 'err') opts.onError(p.error, p.n);
      };
      tryOpen();
    });

    return {
      async send(action) {
        if (!hostKey) throw new Error('hors ligne');
        const n = ++counter;
        await emitSealed(room, TOPIC_ACT, hostKey, { n, action }, fp(hostPub || ''));
        return n;
      },
      status: () => status,
      // Redemande la vue à l'hôte (l'affichage anticipé n'a pas été confirmé).
      resync() { room.presence({ v: -1, n: ++nudge }); },
      close() { clearInterval(nudger); offPeers(); offView(); room.presence({ r: null, pub: null, name: null, v: null, n: null }); },
    };
  }

  return { available, newIdentity, restoreIdentity, createHost, createClient, seal, open, deriveKey, emitSealed, Assembler, fp };
});
