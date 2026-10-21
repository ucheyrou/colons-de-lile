// Salon sur un courtier MQTT public (WebSocket), pour un site hors artefact.
// Même interface que la capacité `room` des artefacts : emit, on, presence, peers, onPeers, leave.
// Les courtiers publics ne sont pas fiables pour le secret : tout ce qui circule est déjà chiffré par net.js.
//
//  colons-v1/<code>/e/<sujet>   événements   {p: pair, d: données}
//  colons-v1/<code>/p/<pair>    présence     {t: horloge, v: objet}, retenue ; effacée par le testament à la déconnexion
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MqttRoom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081',
  ];
  const PREFIX = 'colons-v1';
  const KEEPALIVE = 30;
  const STALE_MS = 60000;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------- Paquets MQTT 3.1.1 ----------
  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }
  function str(s) {
    const b = enc.encode(s);
    return concat(Uint8Array.of(b.length >> 8, b.length & 255), b);
  }
  function varint(n) {
    const out = [];
    do {
      let d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 128;
      out.push(d);
    } while (n > 0);
    return Uint8Array.from(out);
  }
  const packet = (header, body) => concat(Uint8Array.of(header), varint(body.length), body);
  const connectPacket = (clientId, willTopic) => packet(0x10, concat(
    str('MQTT'), Uint8Array.of(4, 0x02 | 0x04 | 0x20, KEEPALIVE >> 8, KEEPALIVE & 255),
    str(clientId), str(willTopic), Uint8Array.of(0, 0)));
  const subscribePacket = (id, filter) => packet(0x82, concat(Uint8Array.of(id >> 8, id & 255), str(filter), Uint8Array.of(0)));
  const publishPacket = (topic, payload, retain) => packet(0x30 | (retain ? 1 : 0), concat(str(topic), payload));
  const PING = Uint8Array.of(0xc0, 0);

  // Lecteur de flux : les paquets peuvent arriver coupés ou groupés.
  class Reader {
    constructor() { this.buf = new Uint8Array(0); }
    push(bytes) {
      this.buf = concat(this.buf, bytes);
      const out = [];
      for (;;) {
        if (this.buf.length < 2) break;
        let len = 0, mult = 1, i = 1, b;
        do {
          if (i >= this.buf.length) return out;
          b = this.buf[i++];
          len += (b & 127) * mult;
          mult *= 128;
        } while (b & 128);
        if (this.buf.length < i + len) break;
        out.push({ type: this.buf[0] >> 4, flags: this.buf[0] & 15, body: this.buf.slice(i, i + len) });
        this.buf = this.buf.slice(i + len);
      }
      return out;
    }
  }
  function parsePublish(p) {
    const tl = (p.body[0] << 8) | p.body[1];
    const topic = dec.decode(p.body.slice(2, 2 + tl));
    const qos = (p.flags >> 1) & 3;
    const start = 2 + tl + (qos ? 2 : 0);
    return { topic, retain: !!(p.flags & 1), payload: p.body.slice(start) };
  }

  // ---------- Connexion à un courtier ----------
  function openSocket(url, clientId, willTopic, WS) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WS(url, 'mqtt'); } catch (e) { reject(e); return; }
      ws.binaryType = 'arraybuffer';
      const reader = new Reader();
      let done = false;
      const timer = setTimeout(() => fail(new Error('délai dépassé')), 7000);
      function fail(e) { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch (x) { /* ignore */ } reject(e); }
      ws.onopen = () => ws.send(connectPacket(clientId, willTopic));
      ws.onerror = () => fail(new Error('connexion refusée'));
      ws.onclose = () => fail(new Error('connexion fermée'));
      ws.onmessage = (ev) => {
        const pk = reader.push(new Uint8Array(ev.data));
        for (const p of pk) {
          if (p.type === 2 && !done) {
            if (p.body[1] !== 0) { fail(new Error('refusé par le courtier')); return; }
            done = true;
            clearTimeout(timer);
            ws.onerror = ws.onclose = ws.onmessage = null;
            resolve({ ws, reader, pending: pk.slice(pk.indexOf(p) + 1) });
            return;
          }
        }
      };
    });
  }

  // ---------- Salon ----------
  async function join(code, opts) {
    const o = opts || {};
    const WS = o.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) throw new Error('WebSocket indisponible');
    const brokers = o.brokers || BROKERS;
    const room = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
    const base = PREFIX + '/' + room;
    const peerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
    const willTopic = base + '/p/' + peerId;

    let ws = null, up = false, closed = false, brokerIndex = 0, subId = 1, retry = 0;
    let presence = {}, presenceTimer = 0, pingTimer = 0, beatTimer = 0, sweepTimer = 0;
    const topics = new Map();
    const peerHandlers = new Set();
    const connHandlers = new Set();
    const seen = new Map(); // id -> {presence, updatedAt, seenAt}
    let pending = { joined: new Set(), updated: new Set(), left: new Set() };
    let flushing = false;

    const now = () => Date.now();
    const send = (bytes) => { if (up && ws && ws.readyState === 1) ws.send(bytes); };

    const snapshot = () => {
      const t = now();
      const list = [{ peer: peerId, isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null, presence: Object.freeze(Object.assign({}, presence)), updatedAt: selfUpdated }];
      seen.forEach((e, id) => {
        if (t - e.seenAt < STALE_MS) list.push({ peer: id, isMe: false, sameTab: false, kind: 'viewer', guest: false, by: null, presence: e.presence, updatedAt: e.updatedAt });
      });
      return list;
    };
    let selfUpdated = now();

    function flush() {
      if (flushing) return;
      flushing = true;
      Promise.resolve().then(() => {
        flushing = false;
        const snap = snapshot();
        const pick = (set) => snap.filter((p) => set.has(p.peer));
        const change = { peers: snap, joined: pick(pending.joined), updated: pick(pending.updated), left: [...pending.left].map((id) => ({ peer: id })) };
        pending = { joined: new Set(), updated: new Set(), left: new Set() };
        peerHandlers.forEach((h) => h(change));
      });
    }

    function onPresence(id, payload) {
      if (id === peerId) return;
      if (!payload.length) {
        if (seen.delete(id)) { pending.left.add(id); flush(); }
        return;
      }
      let obj;
      try { obj = JSON.parse(dec.decode(payload)); } catch (e) { return; }
      if (!obj || typeof obj.v !== 'object' || obj.v === null) return;
      const prev = seen.get(id);
      const changed = !prev || JSON.stringify(prev.presence) !== JSON.stringify(obj.v);
      seen.set(id, { presence: Object.freeze(obj.v), updatedAt: changed ? now() : prev.updatedAt, seenAt: now() });
      if (!prev) pending.joined.add(id);
      else if (changed) pending.updated.add(id);
      else return;
      flush();
    }
    function onEvent(topic, payload) {
      let obj;
      try { obj = JSON.parse(dec.decode(payload)); } catch (e) { return; }
      if (!obj || typeof obj.p !== 'string') return;
      const hs = topics.get(topic);
      if (!hs) return;
      const msg = { topic, data: obj.d, peer: obj.p, by: null, isMe: obj.p === peerId, sameTab: obj.p === peerId, kind: 'viewer', guest: false };
      hs.forEach((h) => h(msg));
    }
    function onPacket(p) {
      if (p.type !== 3) return;
      const m = parsePublish(p);
      if (!m.topic.startsWith(base + '/')) return;
      const rel = m.topic.slice(base.length + 1);
      if (rel.startsWith('p/')) onPresence(rel.slice(2), m.payload);
      else if (rel.startsWith('e/')) onEvent(rel.slice(2), m.payload);
    }

    function publishPresence() {
      send(publishPacket(willTopic, enc.encode(JSON.stringify({ t: now(), v: presence })), true));
    }

    async function connect() {
      let lastErr = null;
      for (let k = 0; k < brokers.length; k++) {
        const i = (brokerIndex + k) % brokers.length;
        try {
          const c = await openSocket(brokers[i], peerId, willTopic, WS);
          brokerIndex = i;
          ws = c.ws;
          up = true;
          retry = 0;
          const reader = c.reader;
          ws.onmessage = (ev) => reader.push(new Uint8Array(ev.data)).forEach(onPacket);
          c.pending.forEach(onPacket);
          ws.onclose = () => { up = false; connHandlers.forEach((h) => h(false)); if (!closed) reconnect(); };
          ws.onerror = () => {};
          send(subscribePacket(subId++, base + '/#'));
          publishPresence();
          clearInterval(pingTimer);
          pingTimer = setInterval(() => send(PING), (KEEPALIVE * 1000) / 2);
          connHandlers.forEach((h) => h(true));
          return;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('aucun courtier joignable');
    }
    function reconnect() {
      if (closed) return;
      const wait = Math.min(10000, 800 * 2 ** retry++);
      setTimeout(() => { if (!closed) connect().catch(reconnect); }, wait);
    }

    await connect();

    beatTimer = setInterval(() => publishPresence(), 15000);
    sweepTimer = setInterval(() => {
      const t = now();
      seen.forEach((e, id) => { if (t - e.seenAt >= STALE_MS) { seen.delete(id); pending.left.add(id); } });
      if (pending.left.size) flush();
    }, 10000);

    return {
      name: room,
      peerId,
      broker: () => brokers[brokerIndex],
      connected: () => up,
      onConnection(h) { connHandlers.add(h); Promise.resolve().then(() => h(up)); return () => connHandlers.delete(h); },
      async emit(topic, data) {
        if (!up) return;
        send(publishPacket(base + '/e/' + topic, enc.encode(JSON.stringify({ p: peerId, d: data })), false));
      },
      on(topic, handler) {
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic).add(handler);
        return () => topics.get(topic).delete(handler);
      },
      async presence(patch) {
        Object.keys(patch).forEach((k) => { if (patch[k] === null) delete presence[k]; else presence[k] = patch[k]; });
        selfUpdated = now();
        clearTimeout(presenceTimer);
        presenceTimer = setTimeout(publishPresence, 40);
        pending.updated.add(peerId);
        flush();
      },
      peers: snapshot,
      onPeers(h) {
        peerHandlers.add(h);
        Promise.resolve().then(() => h({ peers: snapshot(), joined: snapshot(), updated: [], left: [] }));
        return () => peerHandlers.delete(h);
      },
      async leave() {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer); clearInterval(beatTimer); clearInterval(sweepTimer); clearTimeout(presenceTimer);
        send(publishPacket(willTopic, new Uint8Array(0), true));
        try { send(Uint8Array.of(0xe0, 0)); ws.close(); } catch (e) { /* ignore */ }
      },
      // Pour les tests : coupe la liaison sans prévenir, comme un onglet fermé.
      _drop() { closed = true; clearInterval(pingTimer); clearInterval(beatTimer); clearInterval(sweepTimer); try { ws.close(); } catch (e) { /* ignore */ } },
    };
  }

  return { join, BROKERS, _internal: { Reader, connectPacket, subscribePacket, publishPacket, parsePublish } };
});
