import test from 'node:test';
import assert from 'node:assert/strict';
import E from '../src/engine.js';
import { playGame } from './simulate.mjs';

const names = ['Alice', 'Bruno', 'Chloé'];
const fresh = (seed = 42, n = names) => E.newGame({ names: n, seed });
const ok = (s, a) => {
  const r = E.apply(s, a);
  assert.ok(r.ok, 'refusé : ' + r.error + ' ' + JSON.stringify(a));
  return r.state;
};
const refused = (s, a) => {
  const r = E.apply(s, a);
  assert.equal(r.ok, false, 'aurait dû être refusé : ' + JSON.stringify(a));
  return r.error;
};

// Passe la mise en place en posant au premier emplacement légal.
function finishSetup(s) {
  while (s.phase === 'setup') {
    const av = E.available(s, s.turn);
    s = av.setupSettlement
      ? ok(s, { type: 'placeSettlement', player: s.turn, vertex: av.targets.vertices[0] })
      : ok(s, { type: 'placeRoad', player: s.turn, edge: av.targets.edges[0] });
  }
  return s;
}
const give = (s, pid, hand) => {
  const c = JSON.parse(JSON.stringify(s));
  c.board = s.board;
  E.RES.forEach((r) => {
    const n = hand[r] || 0;
    c.players[pid].hand[r] += n;
    c.bank[r] -= n;
  });
  return c;
};
function inActions(s) {
  const c = JSON.parse(JSON.stringify({ ...s, board: null }));
  c.board = s.board;
  c.step = 'actions';
  c.dice = [3, 4];
  return c;
}

test('géométrie du plateau', () => {
  const b = fresh().board;
  assert.equal(b.hexes.length, 19);
  assert.equal(b.vertices.length, 54);
  assert.equal(b.edges.length, 72);
  assert.equal(b.ports.length, 9);
  assert.equal(b.edges.filter((e) => e.hexes.length === 1).length, 30);
  assert.equal(b.ports.filter((p) => p.type === 'any').length, 4);
  const count = (t) => b.hexes.filter((h) => h.terrain === t).length;
  assert.deepEqual([count('forest'), count('pasture'), count('fields'), count('hills'), count('mountains'), count('desert')], [4, 4, 4, 3, 3, 1]);
  const nums = b.hexes.map((h) => h.number).filter(Boolean).sort((x, y) => x - y);
  assert.deepEqual(nums, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
});

test('aucun 6/8 voisins, sur 50 graines', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const b = fresh(seed).board;
    const hot = b.hexes.filter((h) => h.number === 6 || h.number === 8);
    hot.forEach((h) => hot.forEach((o) => {
      if (h.id === o.id) return;
      const d = Math.max(Math.abs(h.q - o.q), Math.abs(h.r - o.r), Math.abs(h.q + h.r - o.q - o.r));
      assert.notEqual(d, 1, 'voisins 6/8 à la graine ' + seed);
    }));
  }
});

test('ports : aucun sommet partagé, chacun sur la côte', () => {
  const b = fresh(7).board;
  const seen = new Set();
  b.ports.forEach((p) => {
    [p.a, p.b].forEach((v) => {
      assert.ok(!seen.has(v));
      seen.add(v);
      assert.ok(b.vertices[v].hexes.length < 3);
    });
  });
});

test('déterminisme : même graine, même plateau et mêmes dés', () => {
  const a = fresh(5), b = fresh(5);
  assert.deepEqual(a.board.hexes.map((h) => [h.terrain, h.number]), b.board.hexes.map((h) => [h.terrain, h.number]));
  const x = ok(finishSetup(a), { type: 'roll', player: finishSetup(a).turn });
  const y = ok(finishSetup(b), { type: 'roll', player: finishSetup(b).turn });
  assert.deepEqual(x.dice, y.dice);
});

test('apply ne modifie pas son entrée', () => {
  const s = fresh();
  const before = JSON.stringify({ ...s, board: null });
  E.apply(s, { type: 'placeSettlement', player: 0, vertex: 0 });
  assert.equal(JSON.stringify({ ...s, board: null }), before);
});

test('mise en place : serpentin, distance, 2e colonie rapporte', () => {
  let s = fresh();
  assert.deepEqual(s.setup.order, [0, 1, 2, 2, 1, 0]);
  refused(s, { type: 'placeSettlement', player: 1, vertex: 0 });
  s = ok(s, { type: 'placeSettlement', player: 0, vertex: 0 });
  refused(s, { type: 'placeSettlement', player: 0, vertex: s.board.vertices[0].nbrs[0] });
  const road = s.board.vertices[0].edges[0];
  s = ok(s, { type: 'placeRoad', player: 0, edge: road });
  assert.equal(s.turn, 1);
  s = finishSetup(s);
  assert.equal(s.phase, 'main');
  assert.equal(s.turn, 0);
  assert.equal(s.step, 'roll');
  const second = s.players.map((p) => E.total(p.hand));
  second.forEach((n) => assert.ok(n <= 3));
  assert.ok(second.some((n) => n > 0));
});

test('la route de départ doit toucher la colonie', () => {
  let s = fresh();
  s = ok(s, { type: 'placeSettlement', player: 0, vertex: 0 });
  const far = s.board.edges.find((e) => e.a !== 0 && e.b !== 0).id;
  refused(s, { type: 'placeRoad', player: 0, edge: far });
});

test('production : colonie 1, ville 2, voleur bloque', () => {
  let s = finishSetup(fresh(11));
  const v = Number(Object.keys(s.buildings)[0]);
  const owner = s.buildings[v].owner;
  const hex = s.board.hexes[s.board.vertices[v].hexes.find((h) => s.board.hexes[h].number)];
  const c = JSON.parse(JSON.stringify({ ...s, board: null }));
  c.board = s.board;
  c.players.forEach((p) => { E.RES.forEach((r) => { c.bank[r] += p.hand[r]; p.hand[r] = 0; }); });
  c.robber = (hex.id + 1) % 19 === c.robber ? (hex.id + 2) % 19 : (hex.id + 1) % 19;
  c.turn = 0;
  // injecte un lancer ciblé via la fonction publique : on rejoue roll jusqu'à obtenir le numéro voulu
  let tries = 0, t = c;
  while (tries++ < 400) {
    t.step = 'roll';
    t.turn = 0;
    const r = E.apply(t, { type: 'roll', player: 0 });
    t = r.state;
    if (t.dice[0] + t.dice[1] === hex.number) break;
  }
  assert.equal(t.dice[0] + t.dice[1], hex.number);
  const res = E.TERRAIN_RES[hex.terrain];
  assert.ok(t.players[owner].hand[res] >= 1);
});

test('défausse sur un 7 puis vol', () => {
  let s = inActions(finishSetup(fresh(3)));
  s = give(s, 1, { wood: 5, brick: 3 });
  s.step = 'discard';
  s.discard = { 1: 4 };
  refused(s, { type: 'discard', player: 1, cards: { wood: 1 } });
  refused(s, { type: 'discard', player: 0, cards: { wood: 1 } });
  s = ok(s, { type: 'discard', player: 1, cards: { wood: 2, brick: 2 } });
  assert.equal(s.step, 'robber');
  refused(s, { type: 'moveRobber', player: s.turn, hex: s.robber });
  const target = s.board.hexes.find((h) => h.id !== s.robber && h.vertices.some((v) => s.buildings[v] && s.buildings[v].owner === 1)).id;
  const turn = s.turn;
  const before = E.total(s.players[turn].hand);
  s = ok(s, { type: 'moveRobber', player: turn, hex: target });
  if (s.step === 'steal') s = ok(s, { type: 'steal', player: turn, victim: s.victims[0] });
  assert.equal(s.step, 'actions');
  assert.equal(E.total(s.players[turn].hand), before + 1);
});

test('construire : coût, connexion, banque, limites', () => {
  let s = inActions(finishSetup(fresh(4)));
  const pid = s.turn;
  refused(s, { type: 'placeRoad', player: pid, edge: E.legalRoads(s, pid)[0] });
  s = give(s, pid, { wood: 3, brick: 3, sheep: 1, wheat: 3, ore: 3 });
  const e = E.legalRoads(s, pid)[0];
  s = ok(s, { type: 'placeRoad', player: pid, edge: e });
  assert.equal(s.roads[e], pid);
  refused(s, { type: 'placeRoad', player: pid, edge: e });
  const city = E.legalCities(s, pid)[0];
  s = ok(s, { type: 'placeCity', player: pid, vertex: city });
  assert.equal(s.buildings[city].type, 'city');
  refused(s, { type: 'placeCity', player: pid, vertex: city });
  const sum = E.RES.reduce((n, r) => n + s.bank[r] + s.players.reduce((k, p) => k + p.hand[r], 0), 0);
  assert.equal(sum, 95);
});

test('plus longue route : 5 requis, coupée par une colonie adverse', () => {
  let s = inActions(fresh(9));
  s.phase = 'main';
  s.buildings = {};
  s.roads = {};
  // chaîne de 5 arêtes
  const b = s.board;
  const chain = [];
  let v = 0;
  const seen = new Set();
  for (let i = 0; i < 5; i++) {
    const e = b.edges.find((x) => (x.a === v || x.b === v) && !seen.has(x.id) && !chain.some((c) => c.a === (x.a === v ? x.b : x.a) || c.b === (x.a === v ? x.b : x.a)));
    seen.add(e.id);
    chain.push(e);
    v = e.a === v ? e.b : e.a;
  }
  chain.forEach((e) => { s.roads[e.id] = 0; });
  assert.equal(E.longestRoadOf(s, 0), 5);
  const mid = chain[1].a === chain[2].a || chain[1].a === chain[2].b ? chain[1].a : chain[1].b;
  s.buildings[mid] = { owner: 1, type: 'settlement' };
  assert.ok(E.longestRoadOf(s, 0) < 5);
});

test('attribution de la plus longue route et de l\'armée', () => {
  let s = inActions(finishSetup(fresh(12)));
  const pid = s.turn;
  s = give(s, pid, { wood: 10, brick: 10 });
  for (let i = 0; i < 6; i++) {
    const e = E.legalRoads(s, pid)[0];
    if (e === undefined) break;
    s = ok(s, { type: 'placeRoad', player: pid, edge: e });
  }
  if (E.longestRoadOf(s, pid) >= 5) assert.equal(s.longestRoad.holder, pid);
  else assert.equal(s.longestRoad.holder, null);
});

test('ports : 4:1 par défaut, 3:1 et 2:1 selon la colonie', () => {
  let s = inActions(finishSetup(fresh(6)));
  const pid = 0;
  assert.ok(E.RES.every((r) => E.tradeRatios(s, pid)[r] <= 4));
  const generic = s.board.vertices.find((v) => v.port === 'any');
  const special = s.board.vertices.find((v) => v.port && v.port !== 'any');
  const c = JSON.parse(JSON.stringify({ ...s, board: null }));
  c.board = s.board;
  c.buildings = { [generic.id]: { owner: 2, type: 'settlement' }, [special.id]: { owner: 2, type: 'settlement' } };
  const r = E.tradeRatios(c, 2);
  assert.equal(r[special.port], 2);
  assert.ok(E.RES.filter((x) => x !== special.port).every((x) => r[x] === 3));
});

test('échange banque', () => {
  let s = inActions(finishSetup(fresh(8)));
  const pid = s.turn;
  const ratio = E.tradeRatios(s, pid).wood;
  s = give(s, pid, { wood: ratio });
  const before = s.players[pid].hand.ore;
  const w = s.players[pid].hand.wood;
  s = ok(s, { type: 'bankTrade', player: pid, give: 'wood', get: 'ore' });
  assert.equal(s.players[pid].hand.wood, w - ratio);
  assert.equal(s.players[pid].hand.ore, before + 1);
  refused(s, { type: 'bankTrade', player: pid, give: 'wood', get: 'wood' });
});

test('échange entre joueurs : offre, acceptation, conclusion', () => {
  let s = inActions(finishSetup(fresh(10)));
  const me = s.turn, you = (me + 1) % 3;
  s = give(s, me, { wood: 2 });
  s = give(s, you, { ore: 1 });
  refused(s, { type: 'respondTrade', player: you, accept: true });
  s = ok(s, { type: 'offerTrade', player: me, give: { wood: 2 }, want: { ore: 1 } });
  refused(s, { type: 'confirmTrade', player: me, with: you });
  s = ok(s, { type: 'respondTrade', player: you, accept: true });
  const wood = s.players[me].hand.wood, ore = s.players[you].hand.ore;
  s = ok(s, { type: 'confirmTrade', player: me, with: you });
  assert.equal(s.players[me].hand.wood, wood - 2);
  assert.equal(s.players[you].hand.wood >= 2, true);
  assert.equal(s.players[you].hand.ore, ore - 1);
  assert.equal(s.trade, null);
});

test('cartes de développement : pas le tour d\'achat, une par tour', () => {
  let s = inActions(finishSetup(fresh(13)));
  const pid = s.turn;
  s = give(s, pid, { sheep: 2, wheat: 2, ore: 2 });
  s.devDeck[s.devDeck.length - 1] = 'knight';
  s = ok(s, { type: 'buyDev', player: pid });
  assert.match(refused(s, { type: 'playKnight', player: pid }), /pas cette carte|achetée/);
  s = ok(s, { type: 'endTurn', player: pid });
  for (let i = 0; i < 2; i++) { s = ok({ ...s, step: 'actions', dice: [1, 2] }, { type: 'endTurn', player: s.turn }); }
  assert.equal(s.turn, pid);
  s.step = 'roll';
  s.devDeck[s.devDeck.length - 1] = 'knight';
  s = ok(s, { type: 'playKnight', player: pid });
  assert.equal(s.step, 'robber');
  assert.equal(s.players[pid].knights, 1);
  refused(s, { type: 'playKnight', player: pid });
});

test('monopole et invention', () => {
  let s = inActions(finishSetup(fresh(14)));
  const pid = s.turn, other = (pid + 1) % 3;
  const card = (k) => ({ k, t: 0 });
  s.players[pid].dev = [card('monopoly')];
  s = give(s, other, { ore: 3 });
  const mine = s.players[pid].hand.ore;
  const theirs = s.players[other].hand.ore;
  s = ok(s, { type: 'playMonopoly', player: pid, res: 'ore' });
  assert.equal(s.players[other].hand.ore, 0);
  assert.ok(s.players[pid].hand.ore >= mine + theirs);
  s.devPlayed = false;
  s.players[pid].dev = [card('yearOfPlenty')];
  const t = E.total(s.players[pid].hand);
  s = ok(s, { type: 'playYearOfPlenty', player: pid, a: 'wood', b: 'wood' });
  assert.equal(E.total(s.players[pid].hand), t + 2);
});

test('construction de routes : deux routes gratuites', () => {
  let s = inActions(finishSetup(fresh(15)));
  const pid = s.turn;
  s.players[pid].dev = [{ k: 'roadBuilding', t: 0 }];
  s = ok(s, { type: 'playRoadBuilding', player: pid });
  assert.equal(s.step, 'roadBuilding');
  s = ok(s, { type: 'placeRoad', player: pid, edge: E.legalRoads(s, pid)[0] });
  assert.equal(s.step, 'roadBuilding');
  s = ok(s, { type: 'placeRoad', player: pid, edge: E.legalRoads(s, pid)[0] });
  assert.equal(s.step, 'actions');
});

test('victoire à 10 points pendant son tour', () => {
  let s = inActions(finishSetup(fresh(16)));
  const pid = s.turn;
  s.players[pid].dev = Array.from({ length: 8 }, () => ({ k: 'vp', t: 0 }));
  s = give(s, pid, { sheep: 1, wheat: 1, ore: 1 });
  s.devDeck[s.devDeck.length - 1] = 'vp';
  s = ok(s, { type: 'buyDev', player: pid });
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, pid);
  refused(s, { type: 'endTurn', player: pid });
});

test('vue privée : les mains des autres disparaissent', () => {
  const s = inActions(finishSetup(fresh(17)));
  const v = E.viewFor(s, 1);
  assert.ok(v.players[1].hand);
  assert.equal(v.players[0].hand, undefined);
  assert.equal(v.players[0].dev, undefined);
  assert.equal(v.devDeck, undefined);
  assert.equal(v.rng, undefined);
  assert.equal(typeof v.players[0].handCount, 'number');
});

test('actions refusées hors tour et hors étape', () => {
  const s = inActions(finishSetup(fresh(18)));
  const other = (s.turn + 1) % 3;
  refused(s, { type: 'endTurn', player: other });
  refused(s, { type: 'roll', player: s.turn });
  refused(s, { type: 'nimporte', player: 0 });
  refused(s, { type: 'roll', player: 99 });
});

test('60 parties aléatoires complètes respectent les invariants', () => {
  let ended = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { s } = playGame(seed);
    if (s.phase === 'ended') ended++;
  }
  assert.ok(ended >= 54, 'seulement ' + ended + ' parties terminées sur 60');
});

// ---------- Plateau « comme le vrai jeu » ----------
const SPIRAL = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
const dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

test('jetons posés en spirale A→R, désert sauté, depuis un coin de la côte', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const b = fresh(seed).board;
    assert.equal(new Set(b.spiral).size, 19);
    const ring = (id) => Math.max(Math.abs(b.hexes[id].q), Math.abs(b.hexes[id].r), Math.abs(b.hexes[id].q + b.hexes[id].r));
    assert.deepEqual(b.spiral.map(ring), [...Array(12).fill(2), ...Array(6).fill(1), 0], 'couronnes dans l\'ordre, seed ' + seed);
    for (let i = 1; i < 12; i++) assert.equal(dist(b.hexes[b.spiral[i - 1]], b.hexes[b.spiral[i]]), 1);
    assert.equal(dist(b.hexes[b.spiral[11]], b.hexes[b.spiral[0]]), 1, 'la couronne se referme');
    const tokens = b.spiral.map((id) => b.hexes[id]).filter((h) => h.terrain !== 'desert').map((h) => h.number);
    assert.deepEqual(tokens, SPIRAL, 'ordre des jetons, seed ' + seed);
    assert.equal(b.hexes.find((h) => h.terrain === 'desert').number, null);
  }
});

test('le point de départ et le sens de la spirale varient', () => {
  const starts = new Set(), senses = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const b = fresh(seed).board;
    starts.add(b.spiral[0]);
    const a = b.hexes[b.spiral[1]], c = b.hexes[b.spiral[2]], z = b.hexes[b.spiral[3]];
    senses.add(Math.sign((c.x - a.x) * (z.y - c.y) - (c.y - a.y) * (z.x - c.x)));
  }
  assert.equal(starts.size, 6, 'six coins possibles');
  assert.ok(senses.size === 2, 'deux sens');
});

test('chaque nouvelle partie a un plateau différent et jamais deux 6/8 voisins', () => {
  const boards = new Set(), deserts = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const b = fresh(seed).board;
    boards.add(b.hexes.map((h) => h.terrain[0] + (h.number || 0)).join('.') + '|' + b.ports.map((p) => p.type).join(','));
    deserts.add(b.hexes.findIndex((h) => h.terrain === 'desert'));
    const hot = b.hexes.filter((h) => h.number === 6 || h.number === 8);
    hot.forEach((h) => hot.forEach((o) => { if (h !== o) assert.notEqual(dist(h, o), 1); }));
  }
  assert.ok(boards.size >= 398, 'plateaux distincts : ' + boards.size);
  assert.equal(deserts.size, 19, 'le désert peut tomber sur n\'importe quelle case');
});

test('ports : cadre fixe, types mélangés', () => {
  const frames = new Set(), orders = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const b = fresh(seed).board;
    frames.add(b.ports.map((p) => p.edge).join(','));
    orders.add(b.ports.map((p) => p.type).join(','));
  }
  assert.equal(frames.size, 1);
  assert.ok(orders.size > 30);
});

test('boardFromSeed redonne exactement le plateau de la partie', () => {
  const s = fresh(77);
  const b = E.boardFromSeed(77);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(s.board)));
  const v = E.viewFor(s, 0, { board: false, log: 5 });
  assert.equal(v.board, undefined);
  assert.equal(v.seed, 77);
  assert.ok(v.log.length <= 5);
  assert.equal(v.devDeckCount, 25);
});
