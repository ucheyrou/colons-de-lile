import test from 'node:test';
import assert from 'node:assert/strict';
import Net from '../src/net.js';
import E from '../src/engine.js';
import { Hub } from './fake-room.mjs';

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(10); }
  throw new Error('délai dépassé');
}

async function setup(n = 3, seed = 5) {
  const hub = new Hub();
  const docH = hub.open();
  const roomH = await docH.join('colons-test');
  const hostId = await Net.newIdentity();
  let game = E.newGame({ names: ['Alice', 'Bruno', 'Chloé'].slice(0, n), seed });
  const acts = [];
  const host = Net.createHost({
    room: roomH, identity: hostId,
    viewOf: (seat) => E.viewFor(game, seat, { board: false, log: 14 }),
    onAct: (seat, action) => {
      acts.push([seat, action]);
      const r = E.apply(game, { ...action, player: seat });
      if (!r.ok) return r.error;
      game = r.state;
      host.publish();
      return null;
    },
  });
  const phones = [];
  for (let i = 0; i < n; i++) {
    const doc = hub.open();
    const room = await doc.join('colons-test');
    const identity = await Net.newIdentity();
    const got = { views: [], status: [], errors: [] };
    const client = Net.createClient({
      room, identity, name: ['Alice', 'Bruno', 'Chloé'][i],
      onView: (p) => got.views.push(p), onStatus: (s) => got.status.push(s), onError: (e) => got.errors.push(e),
    });
    phones.push({ doc, room, identity, client, got });
  }
  return { hub, host, hostId, phones, getGame: () => game, setGame: (g) => { game = g; }, acts };
}

async function start(ctx) {
  await until(() => ctx.host.lobby().length === ctx.phones.length);
  const lobby = ctx.host.lobby();
  const seats = {};
  lobby.forEach((p, i) => { seats[p.pub] = i; });
  ctx.host.setSeats(seats);
  ctx.host.setStatus('play');
  await until(() => ctx.phones.every((p) => p.got.views.length > 0));
  return seats;
}

test('crypto : chiffrer, déchiffrer, mauvaise clé refusée', async () => {
  const a = await Net.newIdentity(), b = await Net.newIdentity(), c = await Net.newIdentity();
  const kab = await Net.deriveKey(a.priv, b.pub), kba = await Net.deriveKey(b.priv, a.pub), kca = await Net.deriveKey(c.priv, a.pub);
  const text = await Net.seal(kab, { x: 'é', n: [1, 2, 3] });
  assert.deepEqual(await Net.open(kba, text), { x: 'é', n: [1, 2, 3] });
  await assert.rejects(Net.open(kca, text));
  const tampered = text.slice(0, -4) + (text.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  await assert.rejects(Net.open(kba, tampered));
});

test('identité sauvegardée puis restaurée : même clé publique, mêmes secrets', async () => {
  const a = await Net.newIdentity(), b = await Net.newIdentity();
  const saved = JSON.parse(JSON.stringify({ pub: a.pub, jwk: a.jwk }));
  const back = await Net.restoreIdentity(saved);
  const k1 = await Net.deriveKey(a.priv, b.pub), k2 = await Net.deriveKey(back.priv, b.pub);
  assert.deepEqual(await Net.open(k2, await Net.seal(k1, { ok: 1 })), { ok: 1 });
});

test('découpage : une vue de plus de 4 Kio traverse en plusieurs morceaux', async () => {
  const ctx = await setup(3);
  const g = ctx.getGame();
  g.log = Array.from({ length: 300 }, (_, i) => 'ligne ' + i + ' ' + 'x'.repeat(60));
  ctx.setGame(g);
  await start(ctx);
  const sizes = ctx.hub.log.filter((m) => m.topic === 'v').map((m) => m.size);
  assert.ok(sizes.length > 3);
  assert.ok(sizes.every((s) => s < 4096));
  ctx.phones.forEach((p) => assert.equal(p.got.views[0].view.log.length, 14));
});

test('chaque téléphone reçoit sa main, jamais celle des autres', async () => {
  const ctx = await setup(3);
  await start(ctx);
  ctx.phones.forEach((p, i) => {
    const v = p.got.views.at(-1);
    assert.equal(v.seat, i);
    assert.ok(v.view.players[i].hand);
    v.view.players.forEach((q, j) => { if (j !== i) assert.equal(q.hand, undefined); });
    assert.equal(v.view.board, undefined);
    assert.equal(v.view.devDeck, undefined);
    assert.equal(typeof v.view.seed, 'number');
  });
});

test('un espion dans la salle ne peut lire aucune vue', async () => {
  const ctx = await setup(3);
  const spyDoc = ctx.hub.open();
  const spyRoom = await spyDoc.join('colons-test');
  const heard = [];
  spyRoom.on('v', (m) => heard.push(m));
  const spyId = await Net.newIdentity();
  const host = ctx.hub.rooms.get('colons-test');
  void host;
  await start(ctx);
  ctx.phones[0].room.emit('v', { m: 'x', i: 0, n: 1, to: 'zzz', d: 'junk' }).catch(() => {});
  await wait(50);
  assert.ok(heard.length > 0, 'l\'espion entend le trafic');
  const text = heard.filter((m) => m.data && m.data.n >= 1).map((m) => m.data.d).join('');
  const hostPub = ctx.hostId.pub;
  const key = await Net.deriveKey(spyId.priv, hostPub);
  await assert.rejects(Net.open(key, heard[0].data.d));
  assert.ok(!JSON.stringify(heard.map((m) => m.data)).includes('wood'), 'aucun nom de ressource en clair');
  void text;
});

test('une action de téléphone est validée par l\'hôte et republiée à tous', async () => {
  const ctx = await setup(3);
  await start(ctx);
  await ctx.phones[0].client.send({ type: 'rollOrder', player: 2 });
  await until(() => ctx.getGame().order.rolls[0].length);
  assert.equal(ctx.getGame().order.rolls[2].length, 0, 'le siège est imposé par l\'hôte, pas par le téléphone');
  await until(() => ctx.phones.every((p) => p.got.views.at(-1).view.order.rolls[0].length));
});

test('une action illégale revient en erreur au bon téléphone seulement', async () => {
  const ctx = await setup(3);
  await start(ctx);
  await ctx.phones[1].client.send({ type: 'roll' });
  await until(() => ctx.phones[1].got.errors.length > 0);
  assert.match(ctx.phones[1].got.errors[0], /tour|maintenant|dé/i);
  assert.equal(ctx.phones[0].got.errors.length, 0);
});

test('une action rejouée (même numéro) est ignorée', async () => {
  const ctx = await setup(3);
  await start(ctx);
  const key = await Net.deriveKey(ctx.phones[0].identity.priv, ctx.hostId.pub);
  const msg = { n: 5000, action: { type: 'rollOrder' } };
  for (let i = 0; i < 2; i++) await Net.emitSealed(ctx.phones[0].room, 'a', key, msg, 'x');
  await wait(100);
  assert.equal(ctx.acts.length, 1);
});

test('un inconnu ne peut pas jouer ni voir : il reçoit « partie complète »', async () => {
  const ctx = await setup(2);
  await start(ctx);
  const doc = ctx.hub.open();
  const room = await doc.join('colons-test');
  const got = { views: [], status: [] };
  const client = Net.createClient({ room, identity: await Net.newIdentity(), name: 'Intrus', onView: (p) => got.views.push(p), onStatus: (s) => got.status.push(s), onError: () => {} });
  await until(() => got.status.includes('full'));
  assert.equal(got.views.length, 0);
  await client.send({ type: 'placeSettlement', vertex: 0 });
  await wait(100);
  assert.equal(ctx.acts.length, 0);
});

test('reconnexion : même identité depuis un nouvel onglet = même place et même main', async () => {
  const ctx = await setup(3);
  await start(ctx);
  const old = ctx.phones[1];
  const saved = JSON.parse(JSON.stringify({ pub: old.identity.pub, jwk: old.identity.jwk }));
  old.client.close();
  await old.room.leave();
  const doc = ctx.hub.open();
  const room = await doc.join('colons-test');
  const identity = await Net.restoreIdentity(saved);
  const got = { views: [], status: [] };
  Net.createClient({ room, identity, name: 'Bruno', onView: (p) => got.views.push(p), onStatus: (s) => got.status.push(s), onError: () => {} });
  await until(() => got.views.length > 0);
  assert.equal(got.views[0].seat, 1);
  assert.ok(got.views[0].view.players[1].hand);
});

test('redémarrage de l\'hôte : les téléphones se resynchronisent sur la nouvelle clé', async () => {
  const ctx = await setup(2);
  const seats = await start(ctx);
  ctx.host.close();
  const roomH2 = await ctx.hub.open().join('colons-test');
  const id2 = await Net.newIdentity();
  const host2 = Net.createHost({
    room: roomH2, identity: id2, seats, version: 0,
    viewOf: (seat) => E.viewFor(ctx.getGame(), seat, { board: false }), onAct: () => null,
  });
  host2.setStatus('play');
  const before = ctx.phones.map((p) => p.got.views.length);
  await until(() => ctx.phones.every((p, i) => p.got.views.length > before[i]));
});

test('perte de messages : le téléphone se resynchronise par sa présence', async () => {
  const ctx = await setup(2);
  await start(ctx);
  ctx.hub.drop = 1;
  ctx.phones[0].client.send({ type: 'rollOrder' }).catch(() => {});
  ctx.hub.drop = 0;
  await wait(50);
  // un nouvel envoi passe ; l'hôte republie, et la présence de chaque téléphone rattrape la version
  await ctx.phones[0].client.send({ type: 'rollOrder' });
  await until(() => ctx.phones.every((p) => p.got.views.at(-1).view.order.rolls[0].length));
});

test('vues perdues au lancement : l\'hôte rattrape tout seul en quelques secondes', async () => {
  const ctx = await setup(3);
  await until(() => ctx.host.lobby().length === 3);
  const seats = {};
  ctx.host.lobby().forEach((p, i) => { seats[p.pub] = i; });
  ctx.host.setSeats(seats);
  ctx.hub.drop = 1;                       // le réseau avale tout pendant le lancement
  ctx.host.setStatus('play');
  await wait(100);
  ctx.hub.drop = 0;
  assert.ok(ctx.phones.every((p) => p.got.views.length === 0));
  await until(() => ctx.phones.every((p) => p.got.views.length > 0), 8000);
});

test('téléphone resté en salle d\'attente après la perte d\'un message « attente » : rattrapé', async () => {
  const ctx = await setup(2);
  ctx.hub.drop = 1;
  await wait(50);
  ctx.hub.drop = 0;
  await until(() => ctx.phones.every((p) => p.got.status.includes('lobby')), 8000);
});

test('après une erreur, l\'hôte renvoie la vue : l\'affichage anticipé du téléphone est annulé', async () => {
  const ctx = await setup(3);
  await start(ctx);
  const n = ctx.phones[1].got.views.length;
  await ctx.phones[1].client.send({ type: 'roll' }); // pas son tour
  await until(() => ctx.phones[1].got.errors.length > 0 && ctx.phones[1].got.views.length > n);
});

test('resync() : le téléphone redemande sa vue', async () => {
  const ctx = await setup(2);
  await start(ctx);
  await wait(1700); // dépasse l'anti-rafale de l'hôte
  const n = ctx.phones[0].got.views.length;
  ctx.phones[0].client.resync();
  await until(() => ctx.phones[0].got.views.length > n);
});

test('celui qui vient d\'agir reçoit sa vue en premier', async () => {
  const ctx = await setup(3);
  await start(ctx);
  const order = [];
  ctx.hub.rooms.get('colons-test').members.forEach((m) => {
    m.topics.set('v', new Set([() => {}]));
  });
  const stamp = [];
  ctx.phones.forEach((p, i) => p.room.on('v', (msg) => { if (msg.data.to === Net.fp(p.identity.pub)) stamp.push(i); }));
  await ctx.phones[0].client.send({ type: 'rollOrder' });
  await until(() => stamp.length >= 3);
  assert.equal(stamp[0], 0);
  void order;
});

test('points() ne plante pas sur une vue sans les cartes cachées des autres', () => {
  const s = E.newGame({ names: ['A', 'B', 'C'], seed: 3 });
  const v = E.viewFor(s, 0, { board: false });
  assert.doesNotThrow(() => E.points(v, 1, true));
  assert.equal(E.points(v, 0, true), 0);
});
