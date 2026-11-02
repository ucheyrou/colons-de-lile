// Variante « Archipel » : plateau marin, bateaux, découvertes des îlots.
import test from 'node:test';
import assert from 'node:assert/strict';
import E from '../src/engine.js';
import { playGame } from './simulate.mjs';

const names = ['Alice', 'Bruno', 'Chloé'];
const sea = (seed = 42, n = names) => E.newGame({ names: n, seed, variant: 'sea' });
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
function finishSetup(s) {
  while (s.phase === 'color') {
    const p = E.actors(s)[0];
    s = ok(s, { type: 'pickColor', player: p, color: E.available(s, p).pickColor[0] });
  }
  while (s.phase === 'order') s = ok(s, { type: 'rollOrder', player: E.actors(s)[0] });
  while (s.phase === 'setup') {
    const av = E.available(s, s.turn);
    s = av.setupSettlement
      ? ok(s, { type: 'placeSettlement', player: s.turn, vertex: av.targets.vertices[0] })
      : ok(s, { type: 'placeRoad', player: s.turn, edge: av.targets.edges[0] });
  }
  return s;
}
// Copie modifiable, en pleine phase d'actions, sans aucune pièce posée.
function blank(s) {
  const c = JSON.parse(JSON.stringify({ ...s, board: null }));
  c.board = s.board;
  c.phase = 'main';
  c.step = 'actions';
  c.dice = [3, 4];
  c.turnNo = 3;
  c.buildings = {};
  c.roads = {};
  c.ships = {};
  c.discover = {};
  return c;
}
const give = (s, pid, hand) => {
  E.RES.forEach((r) => { s.players[pid].hand[r] += hand[r] || 0; s.bank[r] -= hand[r] || 0; });
  return s;
};
const other = (e, v) => (e.a === v ? e.b : e.a);
// Chemin simple de n arêtes depuis v, chaque arête vérifiant ok(e), sans repasser par un sommet interdit.
function walk(b, v, n, okEdge, banned = new Set()) {
  if (n === 0) return [];
  for (const id of b.vertices[v].edges) {
    const e = b.edges[id], w = other(e, v);
    if (!okEdge(e) || banned.has(w)) continue;
    const rest = walk(b, w, n - 1, okEdge, new Set([...banned, v, w]));
    if (rest) return [id, ...rest];
  }
  return null;
}

test('archipel : une île principale, trois îlots de deux cases, la mer entre eux', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = sea(seed).board;
    const count = (f) => b.hexes.filter(f).length;
    assert.equal(b.hexes.length, 37);
    assert.equal(count((h) => h.island === 0), 16);
    [1, 2, 3].forEach((i) => assert.equal(count((h) => h.island === i), 2, 'îlot ' + i));
    assert.equal(count((h) => h.terrain === 'sea'), 15);
    assert.ok(b.hexes.every((h) => (h.terrain === 'sea') === (h.island === null)));
    b.vertices.forEach((v) => {
      const islands = new Set(v.hexes.map((id) => b.hexes[id].island).filter((x) => x !== null));
      assert.ok(islands.size <= 1, 'un sommet touche deux îles, graine ' + seed);
    });
    const desert = b.hexes.find((h) => h.terrain === 'desert');
    assert.equal(desert.island, 0);
    assert.equal(desert.number, null);
    assert.equal(sea(seed).robber, desert.id);
    const nums = b.hexes.map((h) => h.number).filter(Boolean).sort((x, y) => x - y);
    assert.equal(nums.length, 21);
    const hot = b.hexes.filter((h) => h.number === 6 || h.number === 8);
    hot.forEach((h) => hot.forEach((o) => {
      if (h !== o) assert.notEqual(Math.max(Math.abs(h.q - o.q), Math.abs(h.r - o.r), Math.abs(h.q + h.r - o.q - o.r)), 1);
    }));
  }
});

test('archipel : 9 ports sur la côte de l\'île principale, jamais deux sur un sommet', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const b = sea(seed).board;
    assert.equal(b.ports.length, 9);
    assert.equal(b.ports.filter((p) => p.type === 'any').length, 4);
    const seen = new Set();
    b.ports.forEach((p) => {
      const e = b.edges[p.edge];
      assert.ok(e.land && e.sea, 'port sur la côte');
      assert.ok(e.hexes.some((id) => b.hexes[id].island === 0));
      [p.a, p.b].forEach((v) => { assert.ok(!seen.has(v)); seen.add(v); });
    });
  }
});

test('archipel : le plateau varie et se reconstruit depuis la graine et la variante', () => {
  const shapes = new Set();
  for (let seed = 1; seed <= 40; seed++) shapes.add(sea(seed).board.hexes.map((h) => (h.island === null ? '~' : h.island)).join(''));
  assert.ok(shapes.size >= 6, 'rotations et symétries : ' + shapes.size);
  const s = sea(77);
  assert.deepEqual(JSON.parse(JSON.stringify(E.boardFromSeed(77, 'sea'))), JSON.parse(JSON.stringify(s.board)));
  const v = E.viewFor(s, 0, { board: false });
  assert.equal(v.variant, 'sea');
  assert.deepEqual(v.ships, {});
  assert.equal(E.boardFromSeed(77).hexes.length, 19, 'sans variante : plateau classique');
  assert.equal(E.newGame({ names, seed: 77 }).variant, 'classic');
  assert.throws(() => E.newGame({ names, seed: 1, variant: 'lune' }), /Variante inconnue/);
});

test('archipel : la mise en place se fait sur l\'île principale, en routes', () => {
  let s = sea(5);
  while (s.phase !== 'setup') {
    const p = E.actors(s)[0];
    s = s.phase === 'color' ? ok(s, { type: 'pickColor', player: p, color: E.available(s, p).pickColor[0] }) : ok(s, { type: 'rollOrder', player: p });
  }
  const targets = E.available(s, s.turn).targets.vertices;
  assert.ok(targets.length > 20);
  assert.ok(targets.every((v) => s.board.vertices[v].island === 0));
  const islet = s.board.vertices.find((v) => v.island === 2);
  refused(s, { type: 'placeSettlement', player: s.turn, vertex: islet.id });
  s = finishSetup(s);
  assert.equal(Object.keys(s.buildings).length, 6);
  assert.deepEqual(s.ships, {});
});

test('bateaux : en mer, depuis une colonie ou un bateau, coût bois + laine', () => {
  const s0 = blank(sea(8));
  const b = s0.board;
  const coast = b.vertices.find((v) => v.island === 0 && v.edges.some((id) => !b.edges[id].land));
  let s = blank(s0);
  s.buildings[coast.id] = { owner: 0, type: 'settlement' };
  s.turn = 0;
  const inland = b.edges.find((e) => !e.sea);
  refused(s, { type: 'placeShip', player: 0, edge: E.legalShips(s, 0)[0] });
  give(s, 0, { wood: 3, sheep: 3, brick: 1 });
  const ships = E.legalShips(s, 0);
  assert.ok(ships.length > 0);
  assert.ok(ships.every((id) => b.edges[id].sea && (b.edges[id].a === coast.id || b.edges[id].b === coast.id)));
  assert.match(refused(s, { type: 'placeShip', player: 0, edge: inland.id }), /en mer/);
  const openSea = coast.edges.find((id) => !b.edges[id].land);
  s = ok(s, { type: 'placeShip', player: 0, edge: openSea });
  assert.equal(s.ships[openSea], 0);
  assert.equal(s.players[0].hand.wood, 2);
  assert.equal(s.players[0].hand.sheep, 2);
  assert.ok(E.available(s, 0).ship);
  // Le bateau se prolonge par un bateau, jamais par une route.
  const tip = other(b.edges[openSea], coast.id);
  const next = E.legalShips(s, 0).filter((id) => b.edges[id].a === tip || b.edges[id].b === tip);
  assert.ok(next.length > 0);
  assert.ok(!E.legalRoads(s, 0).some((id) => b.edges[id].a === tip || b.edges[id].b === tip));
  // Une route et un bateau ne partagent pas une arête.
  const shore = coast.edges.find((id) => b.edges[id].land && b.edges[id].sea);
  s = ok(s, { type: 'placeRoad', player: 0, edge: shore });
  assert.ok(!E.legalShips(s, 0).includes(shore));
  assert.match(refused(E.newGame({ names, seed: 1 }), { type: 'placeShip', player: 0, edge: 0 }), /couleur|Pas de bateaux/);
});

test('bateaux : pas de bateau sans variante marine', () => {
  const c = blank(E.newGame({ names, seed: 3 }));
  c.turn = 0;
  c.buildings[0] = { owner: 0, type: 'settlement' };
  give(c, 0, { wood: 1, sheep: 1 });
  assert.match(refused(c, { type: 'placeShip', player: 0, edge: c.board.vertices[0].edges[0] }), /Pas de bateaux/);
  assert.equal(E.available(c, 0).ship, false);
  assert.deepEqual(E.legalShips(c, 0), []);
});

test('découverte : le premier colon d\'un îlot marque 2 points, le suivant rien', () => {
  let s = blank(sea(11));
  const b = s.board;
  s.turn = 0;
  const spots = b.vertices.filter((v) => v.island === 1);
  const a = spots[0];
  const shipAt = (v) => v.edges.find((id) => b.edges[id].sea);
  s.ships[shipAt(a)] = 0;
  give(s, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  assert.ok(E.legalSettlements(s, 0, false).includes(a.id), 'un bateau suffit pour fonder une colonie');
  const before = E.points(s, 0, false);
  s = ok(s, { type: 'placeSettlement', player: 0, vertex: a.id });
  assert.equal(s.discover[1], 0);
  assert.equal(E.points(s, 0, false), before + 1 + E.DISCOVERY_POINTS);
  assert.match(s.log[s.log.length - 1].t, /découvre un îlot/);
  // Bruno arrive second sur le même îlot : colonie normale, pas de découverte.
  s.turn = 1;
  const far = spots.find((v) => !s.buildings[v.id] && v.nbrs.every((n) => !s.buildings[n]) && v.edges.some((id) => b.edges[id].sea && s.ships[id] === undefined));
  assert.ok(far, 'une autre place libre sur l\'îlot');
  s.ships[far.edges.find((id) => b.edges[id].sea && s.ships[id] === undefined)] = 1;
  give(s, 1, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  s = ok(s, { type: 'placeSettlement', player: 1, vertex: far.id });
  assert.equal(s.discover[1], 0);
  assert.equal(E.points(s, 1, false), 1);
  assert.equal(E.discoveriesOf(s, 0), 1);
});

test('plus longue route : routes et bateaux s\'enchaînent seulement sur une de ses constructions', () => {
  const s0 = blank(sea(13));
  const b = s0.board;
  let found = null;
  for (const v of b.vertices) {
    if (v.island !== 0) continue;
    const roads = walk(b, v.id, 2, (e) => e.land);
    if (!roads) continue;
    const used = new Set([v.id]);
    roads.forEach((id) => { used.add(b.edges[id].a); used.add(b.edges[id].b); });
    used.delete(v.id);
    const ships = walk(b, v.id, 3, (e) => e.sea && !e.land, used);
    if (ships) { found = { v, roads, ships }; break; }
  }
  assert.ok(found, 'un sommet côtier avec 2 routes vers l\'intérieur et 3 bateaux vers le large');
  const s = blank(s0);
  found.roads.forEach((id) => { s.roads[id] = 0; });
  found.ships.forEach((id) => { s.ships[id] = 0; });
  assert.equal(E.longestRoadOf(s, 0), 3, 'sans construction au raccord, pas de chaîne commune');
  s.buildings[found.v.id] = { owner: 0, type: 'settlement' };
  assert.equal(E.longestRoadOf(s, 0), 5);
  s.buildings[found.v.id] = { owner: 1, type: 'settlement' };
  assert.equal(E.longestRoadOf(s, 0), 3, 'une colonie adverse coupe la chaîne');
});

test('construction de routes : routes ou bateaux gratuits', () => {
  let s = blank(sea(21));
  const b = s.board;
  s.turn = 0;
  const coast = b.vertices.find((v) => v.island === 0 && v.edges.some((id) => !b.edges[id].land));
  s.buildings[coast.id] = { owner: 0, type: 'settlement' };
  s.players[0].dev = [{ k: 'roadBuilding', t: 0 }];
  assert.ok(E.available(s, 0).dev.roadBuilding);
  s = ok(s, { type: 'playRoadBuilding', player: 0 });
  const av = E.available(s, 0);
  assert.ok(av.freeRoad && av.freeShip);
  assert.equal(av.targets.edgeKind, 'road');
  s = ok(s, { type: 'placeShip', player: 0, edge: E.legalShips(s, 0)[0] });
  assert.equal(s.step, 'roadBuilding');
  s = ok(s, { type: 'placeRoad', player: 0, edge: E.legalRoads(s, 0)[0] });
  assert.equal(s.step, 'actions');
  assert.equal(E.total(s.players[0].hand), 0, 'rien n\'a été payé');
  assert.equal(Object.keys(s.ships).length + Object.keys(s.roads).length, 2);
});

test('construction de routes : bateaux seuls quand aucune route n\'est possible', () => {
  let s = blank(sea(22));
  const b = s.board;
  s.turn = 0;
  const coast = b.vertices.find((v) => v.island === 0 && v.edges.some((id) => !b.edges[id].land));
  s.buildings[coast.id] = { owner: 0, type: 'settlement' };
  // Les routes possibles sont prises par un adversaire.
  coast.edges.filter((id) => b.edges[id].land).forEach((id) => { s.roads[id] = 1; });
  s.players[0].dev = [{ k: 'roadBuilding', t: 0 }];
  s = ok(s, { type: 'playRoadBuilding', player: 0 });
  const av = E.available(s, 0);
  assert.equal(av.targets.edgeKind, 'ship');
  assert.deepEqual(av.targets.edges, E.legalShips(s, 0));
});

test('le voleur ne va pas en mer', () => {
  const s = blank(sea(30));
  s.turn = 0;
  s.step = 'robber';
  s.returnStep = 'actions';
  const targets = E.available(s, 0).targets.hexes;
  assert.ok(targets.length > 0);
  assert.ok(targets.every((id) => s.board.hexes[id].terrain !== 'sea'));
  const water = s.board.hexes.find((h) => h.terrain === 'sea');
  refused(s, { type: 'moveRobber', player: 0, hex: water.id });
});

test('archipel : victoire à 12 points, pas à 10', () => {
  let s = finishSetup(sea(16));
  s = blank(s);
  const pid = s.turn;
  assert.equal(E.goalOf(s), 12);
  assert.equal(E.goalOf(E.newGame({ names, seed: 1 })), 10);
  s.players[pid].dev = Array.from({ length: 9 }, () => ({ k: 'vp', t: 0 }));
  give(s, pid, { sheep: 2, wheat: 2, ore: 2 });
  s.devDeck[s.devDeck.length - 1] = 'vp';
  s = ok(s, { type: 'buyDev', player: pid });
  assert.equal(E.points(s, pid, true), 10);
  assert.equal(s.phase, 'main');
  s.devDeck[s.devDeck.length - 1] = 'vp';
  s.discover = { 1: pid };
  s = ok(s, { type: 'buyDev', player: pid });
  assert.equal(E.points(s, pid, true), 13);
  assert.equal(s.phase, 'ended');
});

test('archipel : 40 parties aléatoires complètes respectent les invariants', () => {
  let ended = 0, ships = 0, found = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { s } = playGame(seed, 8000, 'sea');
    if (s.phase === 'ended') ended++;
    ships += Object.keys(s.ships).length;
    found += Object.keys(s.discover).length;
  }
  assert.ok(ended >= 36, 'seulement ' + ended + ' parties terminées sur 40');
  assert.ok(ships > 0 && found > 0, 'les bots naviguent et découvrent');
});
