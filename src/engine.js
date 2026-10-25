// Moteur de règles de « Colons de l'Île ». Pur : pas de DOM, pas de Math.random, état = JSON.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
  const RES_FR = { wood: 'bois', brick: 'argile', sheep: 'laine', wheat: 'blé', ore: 'minerai' };
  const TERRAIN_RES = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore', desert: null };
  const COLORS = ['red', 'blue', 'orange', 'white'];
  const COST = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    dev: { sheep: 1, wheat: 1, ore: 1 },
  };
  const LIMITS = { road: 15, settlement: 5, city: 4 };
  const DEV_FR = { knight: 'Chevalier', vp: 'Point de victoire', roadBuilding: 'Construction de routes', yearOfPlenty: 'Invention', monopoly: 'Monopole' };
  const WIN_POINTS = 10;

  class RuleError extends Error {}
  const need = (cond, msg) => { if (!cond) throw new RuleError(msg); };

  // ---------- Hasard à graine (mulberry32), stocké dans l'état ----------
  function rngNext(s) {
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rint = (s, n) => Math.floor(rngNext(s) * n);
  function shuffle(s, a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rint(s, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Utilitaires ----------
  const zero = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
  const total = (h) => RES.reduce((n, r) => n + h[r], 0);
  const has = (h, c) => RES.every((r) => h[r] >= (c[r] || 0));
  const repeat = (x, n) => Array.from({ length: n }, () => x);
  function clone(s) {
    const board = s.board;
    s.board = null;
    const c = JSON.parse(JSON.stringify(s));
    s.board = board;
    c.board = board;
    return c;
  }
  function log(s, text) {
    s.log.push(text);
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  }
  const nameOf = (s, p) => s.players[p].name;

  // ---------- Plateau ----------
  const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  const SPIRAL_TOKENS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

  function ringCoords(radius) {
    if (radius === 0) return [[0, 0]];
    const out = [];
    let q = HEX_DIRS[4][0] * radius, r = HEX_DIRS[4][1] * radius;
    for (let side = 0; side < 6; side++) {
      for (let j = 0; j < radius; j++) {
        out.push([q, r]);
        q += HEX_DIRS[side][0];
        r += HEX_DIRS[side][1];
      }
    }
    return out;
  }

  // Ordre de pose des jetons : couronne extérieure depuis un coin tiré au hasard,
  // dans un sens tiré au hasard, puis couronne intérieure, puis le centre.
  function spiralOrder(s) {
    const corner = rint(s, 6);
    const reversed = rint(s, 2) === 1;
    let outer = ringCoords(2);
    outer = outer.slice(corner * 2).concat(outer.slice(0, corner * 2));
    const [oq, or] = outer[0];
    let inner = ringCoords(1);
    const at = inner.findIndex(([q, r]) => q === oq / 2 && r === or / 2);
    inner = inner.slice(at).concat(inner.slice(0, at));
    if (reversed) {
      outer = [outer[0], ...outer.slice(1).reverse()];
      inner = [inner[0], ...inner.slice(1).reverse()];
    }
    return outer.concat(inner, [[0, 0]]);
  }

  function buildBoard(s) {
    const coords = [];
    for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) if (Math.abs(q + r) <= 2) coords.push([q, r]);

    const hexes = coords.map(([q, r], id) => ({
      id, q, r,
      x: Math.sqrt(3) * (q + r / 2),
      y: 1.5 * r,
      terrain: null,
      number: null,
      vertices: [],
    }));
    const hexAt = (q, r) => hexes.find((h) => h.q === q && h.r === r);
    const hexNbrs = (h) => HEX_DIRS.map(([dq, dr]) => hexAt(h.q + dq, h.r + dr)).filter(Boolean);
    const hot = (h) => h.number === 6 || h.number === 8;

    // Comme le vrai jeu : tuiles mélangées, puis jetons A à R posés en spirale
    // depuis un coin de la côte, vers l'intérieur, en sautant le désert.
    let spiral = [];
    for (let tries = 0; tries < 200; tries++) {
      const terrains = shuffle(s, [
        ...repeat('forest', 4), ...repeat('pasture', 4), ...repeat('fields', 4),
        ...repeat('hills', 3), ...repeat('mountains', 3), 'desert',
      ]);
      hexes.forEach((h, i) => { h.terrain = terrains[i]; h.number = null; });
      spiral = spiralOrder(s).map(([q, r]) => hexAt(q, r).id);
      let k = 0;
      spiral.forEach((id) => {
        if (hexes[id].terrain !== 'desert') hexes[id].number = SPIRAL_TOKENS[k++];
      });
      if (!hexes.some((h) => hot(h) && hexNbrs(h).some((n) => hot(n)))) break;
    }

    // Sommets et arêtes dédupliqués par position.
    const vertices = [];
    const vIndex = new Map();
    const edges = [];
    const eIndex = new Map();
    const vertexId = (x, y) => {
      const key = Math.round(x * 1000) + ',' + Math.round(y * 1000);
      if (!vIndex.has(key)) {
        vIndex.set(key, vertices.length);
        vertices.push({ id: vertices.length, x, y, hexes: [], nbrs: [], edges: [], port: null });
      }
      return vIndex.get(key);
    };
    hexes.forEach((h) => {
      for (let i = 0; i < 6; i++) {
        const a = ((60 * i - 30) * Math.PI) / 180;
        const id = vertexId(h.x + Math.cos(a), h.y + Math.sin(a));
        h.vertices.push(id);
        vertices[id].hexes.push(h.id);
      }
      for (let i = 0; i < 6; i++) {
        const a = h.vertices[i];
        const b = h.vertices[(i + 1) % 6];
        const key = Math.min(a, b) + '-' + Math.max(a, b);
        if (!eIndex.has(key)) {
          eIndex.set(key, edges.length);
          edges.push({ id: edges.length, a, b, hexes: [] });
        }
        edges[eIndex.get(key)].hexes.push(h.id);
      }
    });
    edges.forEach((e) => {
      vertices[e.a].edges.push(e.id);
      vertices[e.b].edges.push(e.id);
      vertices[e.a].nbrs.push(e.b);
      vertices[e.b].nbrs.push(e.a);
    });

    // Ports : 9 sur les 30 arêtes côtières, espacés 3-3-4.
    const coast = edges
      .filter((e) => e.hexes.length === 1)
      .map((e) => {
        const A = vertices[e.a], B = vertices[e.b];
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        return { e, mx, my, ang: Math.atan2(my, mx) };
      })
      .sort((p, q) => p.ang - q.ang);
    const types = shuffle(s, ['any', 'any', 'any', 'any', 'wood', 'brick', 'sheep', 'wheat', 'ore']);
    const gaps = [0, 3, 6, 10, 13, 16, 20, 23, 26];
    const ports = gaps.map((g, i) => {
      const c = coast[g % coast.length];
      const h = hexes[c.e.hexes[0]];
      const dx = c.mx - h.x, dy = c.my - h.y;
      const len = Math.hypot(dx, dy);
      vertices[c.e.a].port = types[i];
      vertices[c.e.b].port = types[i];
      return { edge: c.e.id, a: c.e.a, b: c.e.b, type: types[i], x: c.mx, y: c.my, nx: dx / len, ny: dy / len };
    });

    return { hexes, vertices, edges, ports, spiral };
  }

  // Le plateau ne dépend que de la graine : un téléphone le reconstruit sans le recevoir.
  function boardFromSeed(seed) {
    return buildBoard({ rng: seed | 0 });
  }

  // ---------- Création de partie ----------
  function newGame(opts) {
    const names = opts.names;
    need(names.length >= 2 && names.length <= 4, 'Entre 2 et 4 joueurs.');
    const seed = (opts.seed == null ? 1 : opts.seed) | 0;
    const s = { rng: seed, seed };
    s.board = buildBoard(s);
    s.players = names.map((name, id) => ({
      id, name, color: COLORS[id],
      hand: zero(), dev: [], knights: 0,
    }));
    s.bank = { wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 };
    s.devDeck = shuffle(s, [
      ...repeat('knight', 14), ...repeat('vp', 5), ...repeat('roadBuilding', 2),
      ...repeat('yearOfPlenty', 2), ...repeat('monopoly', 2),
    ]);
    s.buildings = {};
    s.roads = {};
    s.robber = s.board.hexes.find((h) => h.terrain === 'desert').id;
    s.order = { contenders: names.map((_, i) => i), pending: names.map((_, i) => i), rolls: names.map(() => []) };
    s.setup = { idx: 0, order: [], last: null };
    s.phase = 'order';
    s.step = 'rollOrder';
    s.turn = 0;
    s.turnNo = 0;
    s.dice = null;
    s.discard = {};
    s.victims = [];
    s.returnStep = 'actions';
    s.freeRoads = 0;
    s.devPlayed = false;
    s.trade = null;
    s.longestRoad = { holder: null, len: 0 };
    s.largestArmy = { holder: null, size: 0 };
    s.winner = null;
    s.log = [];
    log(s, 'La partie commence. Chacun lance un dé : le plus grand pose sa colonie en premier.');
    return s;
  }

  // ---------- Requêtes de règles ----------
  const buildingsOf = (s, pid, type) => Object.keys(s.buildings).filter((v) => s.buildings[v].owner === pid && (!type || s.buildings[v].type === type)).length;
  const roadsOf = (s, pid) => Object.keys(s.roads).filter((e) => s.roads[e] === pid).length;

  function legalSettlements(s, pid, free) {
    return s.board.vertices.filter((v) => {
      if (s.buildings[v.id]) return false;
      if (v.nbrs.some((n) => s.buildings[n])) return false;
      return free || v.edges.some((e) => s.roads[e] === pid);
    }).map((v) => v.id);
  }
  function legalCities(s, pid) {
    return Object.keys(s.buildings).filter((v) => s.buildings[v].owner === pid && s.buildings[v].type === 'settlement').map(Number);
  }
  function legalRoads(s, pid, fromVertex) {
    return s.board.edges.filter((e) => {
      if (s.roads[e.id] !== undefined) return false;
      if (fromVertex != null) return e.a === fromVertex || e.b === fromVertex;
      return [e.a, e.b].some((v) => {
        const b = s.buildings[v];
        if (b) return b.owner === pid;
        return s.board.vertices[v].edges.some((x) => x !== e.id && s.roads[x] === pid);
      });
    }).map((e) => e.id);
  }
  function legalRobberHexes(s) {
    return s.board.hexes.filter((h) => h.id !== s.robber).map((h) => h.id);
  }

  function tradeRatios(s, pid) {
    const r = { wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4 };
    s.board.vertices.forEach((v) => {
      const b = s.buildings[v.id];
      if (!b || b.owner !== pid || !v.port) return;
      if (v.port === 'any') RES.forEach((k) => { r[k] = Math.min(r[k], 3); });
      else r[v.port] = Math.min(r[v.port], 2);
    });
    return r;
  }

  const devPlayable = (s, p, kind) => p.dev.some((c) => c.k === kind && c.t < s.turnNo);

  // Plus longue route d'un joueur : parcours en profondeur, les colonies adverses coupent la chaîne.
  function longestRoadOf(s, pid) {
    const verts = s.board.vertices;
    const mine = (e) => s.roads[e] === pid;
    const blocked = (v) => s.buildings[v] && s.buildings[v].owner !== pid;
    const used = new Set();
    const other = (e, v) => (s.board.edges[e].a === v ? s.board.edges[e].b : s.board.edges[e].a);
    function dfs(v) {
      let best = 0;
      for (const e of verts[v].edges) {
        if (!mine(e) || used.has(e)) continue;
        used.add(e);
        const w = other(e, v);
        best = Math.max(best, 1 + (blocked(w) ? 0 : dfs(w)));
        used.delete(e);
      }
      return best;
    }
    let best = 0;
    verts.forEach((v) => { if (v.edges.some(mine)) best = Math.max(best, dfs(v.id)); });
    return best;
  }

  function points(s, pid, withHidden) {
    let n = buildingsOf(s, pid, 'settlement') + 2 * buildingsOf(s, pid, 'city');
    if (s.longestRoad.holder === pid) n += 2;
    if (s.largestArmy.holder === pid) n += 2;
    if (withHidden) n += (s.players[pid].dev || []).filter((c) => c.k === 'vp').length;
    return n;
  }

  // ---------- Effets ----------
  function pay(s, p, cost) {
    RES.forEach((r) => { p.hand[r] -= cost[r] || 0; s.bank[r] += cost[r] || 0; });
  }
  function grant(s, p, r, n) {
    p.hand[r] += n;
    s.bank[r] -= n;
  }

  function produce(s, n) {
    const want = {};
    s.board.hexes.forEach((h) => {
      if (h.number !== n || h.id === s.robber) return;
      const res = TERRAIN_RES[h.terrain];
      h.vertices.forEach((v) => {
        const b = s.buildings[v];
        if (!b) return;
        want[res] = want[res] || {};
        want[res][b.owner] = (want[res][b.owner] || 0) + (b.type === 'city' ? 2 : 1);
      });
    });
    const gains = [];
    Object.keys(want).forEach((res) => {
      const owners = Object.keys(want[res]).map(Number);
      const sum = owners.reduce((a, o) => a + want[res][o], 0);
      if (sum <= s.bank[res]) {
        owners.forEach((o) => { grant(s, s.players[o], res, want[res][o]); gains.push([o, res, want[res][o]]); });
      } else if (owners.length === 1) {
        const n2 = s.bank[res];
        if (n2 > 0) { grant(s, s.players[owners[0]], res, n2); gains.push([owners[0], res, n2]); }
      } else {
        log(s, 'La banque n\'a pas assez de ' + RES_FR[res] + ' : personne n\'en reçoit.');
      }
    });
    const byPlayer = {};
    gains.forEach(([o, res, k]) => { (byPlayer[o] = byPlayer[o] || []).push(k + ' ' + RES_FR[res]); });
    const parts = Object.keys(byPlayer).map((o) => nameOf(s, +o) + ' reçoit ' + byPlayer[o].join(', '));
    log(s, parts.length ? parts.join(' ; ') + '.' : 'Personne ne produit.');
  }

  function startRobber(s, returnStep) {
    s.returnStep = returnStep;
    s.step = 'robber';
  }

  function stealFrom(s, thief, victim) {
    const v = s.players[victim];
    const pool = [];
    RES.forEach((r) => pool.push(...repeat(r, v.hand[r])));
    if (!pool.length) return;
    const r = pool[rint(s, pool.length)];
    v.hand[r]--;
    s.players[thief].hand[r]++;
    log(s, nameOf(s, thief) + ' vole une carte à ' + nameOf(s, victim) + '.');
  }

  function checkRoadAndArmy(s) {
    const lens = s.players.map((p) => longestRoadOf(s, p.id));
    const max = Math.max(...lens);
    const prev = s.longestRoad.holder;
    let holder = null;
    if (max >= 5) {
      const top = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
      if (prev !== null && top.includes(prev)) holder = prev;
      else if (top.length === 1) holder = top[0];
    }
    if (holder !== prev && holder !== null) log(s, nameOf(s, holder) + ' obtient la plus longue route (' + max + ').');
    if (holder !== prev && holder === null) log(s, 'Plus personne n\'a la plus longue route.');
    s.longestRoad = { holder, len: holder === null ? 0 : max };
    s.players.forEach((p, i) => { p.roadLen = lens[i]; });

    let ah = s.largestArmy.holder;
    let best = s.largestArmy.size;
    s.players.forEach((p) => {
      if (p.knights >= 3 && p.knights > best) {
        ah = p.id;
        best = p.knights;
      }
    });
    if (ah !== s.largestArmy.holder) log(s, nameOf(s, ah) + ' obtient la plus grande armée (' + best + ').');
    s.largestArmy = { holder: ah, size: best };
  }

  function afterAction(s) {
    checkRoadAndArmy(s);
    if (s.phase === 'main' && points(s, s.turn, true) >= WIN_POINTS) {
      s.phase = 'ended';
      s.step = 'ended';
      s.winner = s.turn;
      s.trade = null;
      log(s, nameOf(s, s.turn) + ' remporte la partie avec ' + points(s, s.turn, true) + ' points !');
    }
  }

  // ---------- Actions ----------
  const handlers = {};

  function turnOnly(s, a) {
    need(s.phase !== 'ended', 'La partie est terminée.');
    need(s.phase !== 'order', 'Lance d\'abord le dé pour savoir qui commence.');
    need(a.player === s.turn, 'Ce n\'est pas ton tour.');
  }
  function mainActions(s, a) {
    turnOnly(s, a);
    need(s.phase === 'main' && s.step === 'actions', 'Tu ne peux pas faire ça maintenant.');
  }
  function clearTrade(s) { s.trade = null; }

  // Tirage de l'ordre : un dé chacun, les ex aequo au plus haut relancent entre eux.
  handlers.rollOrder = (s, a) => {
    need(s.phase === 'order', 'L\'ordre de jeu est déjà décidé.');
    need(s.order.pending.includes(a.player), 'Tu as déjà lancé ton dé.');
    const d = rint(s, 6) + 1;
    s.order.rolls[a.player].push(d);
    s.order.pending = s.order.pending.filter((p) => p !== a.player);
    log(s, nameOf(s, a.player) + ' lance le dé : ' + d + '.');
    if (!s.order.pending.length) settleOrder(s);
  };

  function settleOrder(s) {
    const o = s.order;
    const last = (p) => o.rolls[p][o.rolls[p].length - 1];
    const best = Math.max(...o.contenders.map(last));
    const top = o.contenders.filter((p) => last(p) === best);
    if (top.length > 1) {
      o.contenders = top;
      o.pending = top.slice();
      log(s, 'Égalité à ' + best + ' : ' + top.map((p) => nameOf(s, p)).join(' et ') + ' relancent.');
      return;
    }
    // Le premier pose, puis on tourne dans l'ordre des sièges, puis retour en sens inverse.
    const n = s.players.length;
    const ring = Array.from({ length: n }, (_, i) => (top[0] + i) % n);
    s.setup.order = ring.concat(ring.slice().reverse());
    s.phase = 'setup';
    s.step = 'settlement';
    s.turn = top[0];
    log(s, nameOf(s, top[0]) + ' a le plus grand dé (' + best + ') et pose sa colonie en premier.');
  }

  handlers.placeSettlement = (s, a) => {
    turnOnly(s, a);
    const p = s.players[a.player];
    if (s.phase === 'setup') {
      need(s.step === 'settlement', 'Pose d\'abord ta route.');
      need(legalSettlements(s, a.player, true).includes(a.vertex), 'Emplacement interdit.');
      s.buildings[a.vertex] = { owner: a.player, type: 'settlement' };
      s.setup.last = a.vertex;
      if (s.setup.idx >= s.players.length) {
        const got = [];
        s.board.vertices[a.vertex].hexes.forEach((hid) => {
          const res = TERRAIN_RES[s.board.hexes[hid].terrain];
          if (res && s.bank[res] > 0) { grant(s, p, res, 1); got.push(RES_FR[res]); }
        });
        if (got.length) log(s, p.name + ' reçoit ' + got.join(', ') + '.');
      }
      s.step = 'road';
      log(s, p.name + ' pose une colonie.');
      return;
    }
    mainActions(s, a);
    need(buildingsOf(s, a.player, 'settlement') < LIMITS.settlement, 'Plus de colonies disponibles.');
    need(has(p.hand, COST.settlement), 'Pas assez de ressources.');
    need(legalSettlements(s, a.player, false).includes(a.vertex), 'Emplacement interdit.');
    pay(s, p, COST.settlement);
    s.buildings[a.vertex] = { owner: a.player, type: 'settlement' };
    clearTrade(s);
    log(s, p.name + ' construit une colonie.');
  };

  handlers.placeCity = (s, a) => {
    mainActions(s, a);
    const p = s.players[a.player];
    need(buildingsOf(s, a.player, 'city') < LIMITS.city, 'Plus de villes disponibles.');
    need(has(p.hand, COST.city), 'Pas assez de ressources.');
    need(legalCities(s, a.player).includes(a.vertex), 'Il faut une de tes colonies.');
    pay(s, p, COST.city);
    s.buildings[a.vertex].type = 'city';
    clearTrade(s);
    log(s, p.name + ' transforme une colonie en ville.');
  };

  handlers.placeRoad = (s, a) => {
    turnOnly(s, a);
    const p = s.players[a.player];
    if (s.phase === 'setup') {
      need(s.step === 'road', 'Pose d\'abord ta colonie.');
      need(legalRoads(s, a.player, s.setup.last).includes(a.edge), 'La route doit toucher ta nouvelle colonie.');
      s.roads[a.edge] = a.player;
      log(s, p.name + ' pose une route.');
      s.setup.idx++;
      if (s.setup.idx >= s.setup.order.length) {
        s.phase = 'main';
        s.step = 'roll';
        s.turn = s.setup.order[s.setup.order.length - 1];
        s.turnNo = 1;
        log(s, 'Mise en place terminée. ' + nameOf(s, s.turn) + ' commence.');
      } else {
        s.turn = s.setup.order[s.setup.idx];
        s.step = 'settlement';
      }
      return;
    }
    need(s.phase === 'main', 'Tu ne peux pas faire ça maintenant.');
    need(roadsOf(s, a.player) < LIMITS.road, 'Plus de routes disponibles.');
    need(legalRoads(s, a.player).includes(a.edge), 'Emplacement interdit.');
    if (s.step === 'roadBuilding') {
      s.roads[a.edge] = a.player;
      s.freeRoads--;
      log(s, p.name + ' pose une route gratuite.');
      if (s.freeRoads <= 0 || roadsOf(s, a.player) >= LIMITS.road || !legalRoads(s, a.player).length) {
        s.freeRoads = 0;
        s.step = s.returnStep;
      }
      return;
    }
    need(s.step === 'actions', 'Tu ne peux pas faire ça maintenant.');
    need(has(p.hand, COST.road), 'Pas assez de ressources.');
    pay(s, p, COST.road);
    s.roads[a.edge] = a.player;
    clearTrade(s);
    log(s, p.name + ' construit une route.');
  };

  handlers.roll = (s, a) => {
    turnOnly(s, a);
    need(s.phase === 'main' && s.step === 'roll', 'Les dés sont déjà lancés.');
    const d1 = rint(s, 6) + 1, d2 = rint(s, 6) + 1;
    s.dice = [d1, d2];
    const sum = d1 + d2;
    log(s, nameOf(s, a.player) + ' lance les dés : ' + d1 + ' + ' + d2 + ' = ' + sum + '.');
    if (sum !== 7) {
      produce(s, sum);
      s.step = 'actions';
      return;
    }
    s.discard = {};
    s.players.forEach((p) => {
      const n = total(p.hand);
      if (n > 7) s.discard[p.id] = Math.floor(n / 2);
    });
    if (Object.keys(s.discard).length) {
      s.returnStep = 'actions';
      s.step = 'discard';
      log(s, 'Un 7 ! Les joueurs avec plus de 7 cartes en défaussent la moitié.');
    } else {
      log(s, 'Un 7 ! Le voleur se déplace.');
      startRobber(s, 'actions');
    }
  };

  handlers.discard = (s, a) => {
    need(s.phase === 'main' && s.step === 'discard', 'Pas de défausse en cours.');
    const owed = s.discard[a.player];
    need(owed, 'Tu n\'as rien à défausser.');
    const cards = a.cards || {};
    const n = RES.reduce((k, r) => k + (cards[r] || 0), 0);
    need(n === owed, 'Il faut défausser exactement ' + owed + ' cartes.');
    need(RES.every((r) => (cards[r] || 0) >= 0 && Number.isInteger(cards[r] || 0)), 'Quantité invalide.');
    const p = s.players[a.player];
    need(has(p.hand, cards), 'Tu n\'as pas ces cartes.');
    pay(s, p, cards);
    delete s.discard[a.player];
    log(s, p.name + ' défausse ' + n + ' cartes.');
    if (!Object.keys(s.discard).length) startRobber(s, 'actions');
  };

  handlers.moveRobber = (s, a) => {
    turnOnly(s, a);
    need(s.step === 'robber', 'Le voleur ne bouge pas maintenant.');
    need(legalRobberHexes(s).includes(a.hex), 'Choisis un autre hexagone.');
    s.robber = a.hex;
    const h = s.board.hexes[a.hex];
    const victims = [];
    h.vertices.forEach((v) => {
      const b = s.buildings[v];
      if (b && b.owner !== a.player && total(s.players[b.owner].hand) > 0 && !victims.includes(b.owner)) victims.push(b.owner);
    });
    log(s, nameOf(s, a.player) + ' déplace le voleur.');
    if (victims.length === 0) s.step = s.returnStep;
    else if (victims.length === 1) { stealFrom(s, a.player, victims[0]); s.step = s.returnStep; }
    else { s.victims = victims; s.step = 'steal'; }
  };

  handlers.steal = (s, a) => {
    turnOnly(s, a);
    need(s.step === 'steal', 'Pas de vol en cours.');
    need(s.victims.includes(a.victim), 'Joueur non éligible.');
    stealFrom(s, a.player, a.victim);
    s.victims = [];
    s.step = s.returnStep;
  };

  handlers.buyDev = (s, a) => {
    mainActions(s, a);
    const p = s.players[a.player];
    need(s.devDeck.length > 0, 'Plus de cartes de développement.');
    need(has(p.hand, COST.dev), 'Pas assez de ressources.');
    pay(s, p, COST.dev);
    const k = s.devDeck.pop();
    p.dev.push({ k, t: s.turnNo });
    clearTrade(s);
    log(s, p.name + ' achète une carte de développement.');
  };

  function useDev(s, a, kind) {
    turnOnly(s, a);
    need(s.phase === 'main' && (s.step === 'roll' || s.step === 'actions'), 'Tu ne peux pas jouer de carte maintenant.');
    need(!s.devPlayed, 'Une seule carte de développement par tour.');
    const p = s.players[a.player];
    need(devPlayable(s, p, kind), 'Tu n\'as pas cette carte, ou elle vient d\'être achetée.');
    const i = p.dev.findIndex((c) => c.k === kind && c.t < s.turnNo);
    p.dev.splice(i, 1);
    s.devPlayed = true;
    clearTrade(s);
    return p;
  }

  handlers.playKnight = (s, a) => {
    const prev = s.step;
    const p = useDev(s, a, 'knight');
    p.knights++;
    log(s, p.name + ' joue un chevalier.');
    startRobber(s, prev);
  };

  handlers.playRoadBuilding = (s, a) => {
    need(roadsOf(s, a.player) < LIMITS.road && legalRoads(s, a.player).length > 0, 'Aucune route possible.');
    const prev = s.step;
    const p = useDev(s, a, 'roadBuilding');
    s.freeRoads = Math.min(2, LIMITS.road - roadsOf(s, a.player));
    s.returnStep = prev;
    s.step = 'roadBuilding';
    log(s, p.name + ' joue Construction de routes.');
  };

  handlers.playYearOfPlenty = (s, a) => {
    need(RES.includes(a.a) && RES.includes(a.b), 'Choisis deux ressources.');
    const want = zero();
    want[a.a]++;
    want[a.b]++;
    need(has(s.bank, want), 'La banque n\'a pas assez de cartes.');
    const p = useDev(s, a, 'yearOfPlenty');
    grant(s, p, a.a, 1);
    grant(s, p, a.b, 1);
    log(s, p.name + ' joue Invention et prend ' + RES_FR[a.a] + ' et ' + RES_FR[a.b] + '.');
  };

  handlers.playMonopoly = (s, a) => {
    need(RES.includes(a.res), 'Choisis une ressource.');
    const p = useDev(s, a, 'monopoly');
    let n = 0;
    s.players.forEach((o) => {
      if (o.id === p.id) return;
      n += o.hand[a.res];
      p.hand[a.res] += o.hand[a.res];
      o.hand[a.res] = 0;
    });
    log(s, p.name + ' joue Monopole sur ' + RES_FR[a.res] + ' et récupère ' + n + ' carte(s).');
  };

  handlers.bankTrade = (s, a) => {
    mainActions(s, a);
    need(RES.includes(a.give) && RES.includes(a.get) && a.give !== a.get, 'Échange invalide.');
    const p = s.players[a.player];
    const ratio = tradeRatios(s, a.player)[a.give];
    need(p.hand[a.give] >= ratio, 'Il te faut ' + ratio + ' ' + RES_FR[a.give] + '.');
    need(s.bank[a.get] > 0, 'La banque n\'a plus de ' + RES_FR[a.get] + '.');
    p.hand[a.give] -= ratio;
    s.bank[a.give] += ratio;
    grant(s, p, a.get, 1);
    clearTrade(s);
    log(s, p.name + ' échange ' + ratio + ' ' + RES_FR[a.give] + ' contre 1 ' + RES_FR[a.get] + ' à la banque.');
  };

  function cleanBundle(b) {
    const out = zero();
    RES.forEach((r) => {
      const n = (b && b[r]) || 0;
      need(Number.isInteger(n) && n >= 0, 'Quantité invalide.');
      out[r] = n;
    });
    return out;
  }

  handlers.offerTrade = (s, a) => {
    mainActions(s, a);
    const give = cleanBundle(a.give), want = cleanBundle(a.want);
    need(total(give) > 0 && total(want) > 0, 'Propose au moins une carte de chaque côté.');
    need(!RES.some((r) => give[r] > 0 && want[r] > 0), 'Ne demande pas la ressource que tu donnes.');
    need(has(s.players[a.player].hand, give), 'Tu n\'as pas ces cartes.');
    s.trade = { from: a.player, give, want, responses: {} };
    log(s, nameOf(s, a.player) + ' propose un échange.');
  };

  handlers.respondTrade = (s, a) => {
    need(s.trade, 'Aucune offre en cours.');
    need(a.player !== s.trade.from, 'C\'est ton offre.');
    if (a.accept) need(has(s.players[a.player].hand, s.trade.want), 'Tu n\'as pas les cartes demandées.');
    s.trade.responses[a.player] = !!a.accept;
  };

  handlers.confirmTrade = (s, a) => {
    mainActions(s, a);
    const t = s.trade;
    need(t && t.from === a.player, 'Aucune offre en cours.');
    need(t.responses[a.with] === true, 'Ce joueur n\'a pas accepté.');
    const me = s.players[a.player], they = s.players[a.with];
    need(has(me.hand, t.give) && has(they.hand, t.want), 'Les mains ont changé, échange impossible.');
    RES.forEach((r) => {
      me.hand[r] += t.want[r] - t.give[r];
      they.hand[r] += t.give[r] - t.want[r];
    });
    s.trade = null;
    log(s, me.name + ' et ' + they.name + ' concluent un échange.');
  };

  handlers.cancelTrade = (s, a) => {
    turnOnly(s, a);
    need(s.trade, 'Aucune offre en cours.');
    s.trade = null;
  };

  handlers.endTurn = (s, a) => {
    mainActions(s, a);
    s.trade = null;
    s.turn = (s.turn + 1) % s.players.length;
    s.turnNo++;
    s.step = 'roll';
    s.dice = null;
    s.devPlayed = false;
    log(s, 'Au tour de ' + nameOf(s, s.turn) + '.');
  };

  function apply(state, action) {
    const s = clone(state);
    try {
      const h = handlers[action && action.type];
      need(h, 'Action inconnue.');
      need(Number.isInteger(action.player) && action.player >= 0 && action.player < s.players.length, 'Joueur inconnu.');
      h(s, action);
      afterAction(s);
      return { ok: true, state: s };
    } catch (e) {
      if (e instanceof RuleError) return { ok: false, error: e.message, state };
      throw e;
    }
  }

  // ---------- Ce que l'interface a le droit de proposer ----------
  function available(s, pid) {
    const p = s.players[pid];
    const mine = (s.phase === 'setup' || s.phase === 'main') && s.turn === pid;
    const main = s.phase === 'main';
    const acts = mine && main && s.step === 'actions';
    const canDevNow = mine && main && (s.step === 'roll' || s.step === 'actions') && !s.devPlayed;
    const afford = (c) => has(p.hand, c);
    const out = {
      myTurn: mine,
      rollOrder: s.phase === 'order' && s.order.pending.includes(pid),
      roll: mine && main && s.step === 'roll',
      endTurn: acts,
      discard: s.phase === 'main' && s.step === 'discard' ? s.discard[pid] || 0 : 0,
      moveRobber: mine && s.step === 'robber',
      steal: mine && s.step === 'steal' ? s.victims.slice() : null,
      setupSettlement: mine && s.phase === 'setup' && s.step === 'settlement',
      setupRoad: mine && s.phase === 'setup' && s.step === 'road',
      freeRoad: mine && s.step === 'roadBuilding',
      road: acts && afford(COST.road) && roadsOf(s, pid) < LIMITS.road && legalRoads(s, pid).length > 0,
      settlement: acts && afford(COST.settlement) && buildingsOf(s, pid, 'settlement') < LIMITS.settlement && legalSettlements(s, pid, false).length > 0,
      city: acts && afford(COST.city) && buildingsOf(s, pid, 'city') < LIMITS.city && legalCities(s, pid).length > 0,
      buyDev: acts && afford(COST.dev) && (s.devDeck ? s.devDeck.length : s.devDeckCount) > 0,
      trade: acts,
      ratios: tradeRatios(s, pid),
      dev: {
        knight: canDevNow && devPlayable(s, p, 'knight'),
        roadBuilding: canDevNow && devPlayable(s, p, 'roadBuilding') && legalRoads(s, pid).length > 0 && roadsOf(s, pid) < LIMITS.road,
        yearOfPlenty: canDevNow && devPlayable(s, p, 'yearOfPlenty') && total(s.bank) >= 2,
        monopoly: canDevNow && devPlayable(s, p, 'monopoly'),
      },
      respondTrade: !!(s.trade && s.trade.from !== pid && s.phase === 'main'),
    };
    // Surlignage de plateau selon l'étape.
    out.targets = { vertices: [], edges: [], hexes: [] };
    if (out.setupSettlement) out.targets.vertices = legalSettlements(s, pid, true);
    if (out.setupRoad) out.targets.edges = legalRoads(s, pid, s.setup.last);
    if (out.moveRobber) out.targets.hexes = legalRobberHexes(s);
    if (out.freeRoad) out.targets.edges = legalRoads(s, pid);
    return out;
  }

  // Emplacements pour un mode de construction demandé depuis la main.
  function targetsFor(s, pid, kind) {
    if (kind === 'road') return { edges: legalRoads(s, pid) };
    if (kind === 'settlement') return { vertices: legalSettlements(s, pid, false) };
    if (kind === 'city') return { vertices: legalCities(s, pid) };
    return {};
  }

  // Qui doit agir maintenant (utile à l'interface et au réseau).
  function actors(s) {
    if (s.phase === 'ended') return [];
    if (s.phase === 'order') return s.order.pending.slice();
    if (s.phase === 'main' && s.step === 'discard') return Object.keys(s.discard).map(Number);
    return [s.turn];
  }

  // Vue sûre à envoyer à un client : ses cartes en clair, celles des autres en nombre seulement.
  // opts.board:false retire le plateau (le client le reconstruit depuis la graine), opts.log limite le journal.
  function viewFor(s, pid, opts) {
    const o = opts || {};
    const v = clone(s);
    v.seed = s.seed;
    delete v.rng;
    v.devDeckCount = v.devDeck.length;
    delete v.devDeck;
    if (o.board === false) delete v.board;
    if (o.log) v.log = v.log.slice(-o.log);
    v.players.forEach((p) => {
      p.handCount = total(p.hand);
      p.devCount = p.dev.length;
      p.vp = points(s, p.id, p.id === pid);
      if (p.id !== pid) {
        delete p.hand;
        delete p.dev;
      }
    });
    if (v.phase === 'ended') {
      v.players.forEach((p, i) => { p.vp = points(s, i, true); });
    }
    return v;
  }

  return {
    RES, RES_FR, DEV_FR, TERRAIN_RES, COST, LIMITS, WIN_POINTS,
    newGame, boardFromSeed, apply, available, targetsFor, actors, viewFor,
    points, total, longestRoadOf, tradeRatios,
    legalSettlements, legalCities, legalRoads,
  };
});
