// Simule N parties aléatoires et vérifie les invariants après chaque action.
import E from '../src/engine.js';
import { botStep } from './bot.mjs';

function seededRandom(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function checkInvariants(s) {
  for (const r of E.RES) {
    let n = s.bank[r];
    for (const p of s.players) {
      if (p.hand[r] < 0) throw new Error('main négative ' + r);
      n += p.hand[r];
    }
    if (n !== 19) throw new Error('ressource non conservée ' + r + ' = ' + n);
    if (s.bank[r] < 0) throw new Error('banque négative ' + r);
  }
  for (const p of s.players) {
    const c = (t) => Object.values(s.buildings).filter((b) => b.owner === p.id && b.type === t).length;
    const roads = Object.values(s.roads).filter((o) => o === p.id).length;
    const ships = Object.values(s.ships).filter((o) => o === p.id).length;
    if (c('settlement') > 5 || c('city') > 4 || roads > 15 || ships > 15) throw new Error('trop de pièces pour ' + p.name);
  }
  const ids = Object.keys(s.buildings).map(Number);
  for (const v of ids) {
    if (s.board.vertices[v].nbrs.some((n) => s.buildings[n])) throw new Error('règle de distance violée');
    if (!s.board.vertices[v].land) throw new Error('construction en pleine mer');
  }
  for (const e of Object.keys(s.roads)) if (!s.board.edges[+e].land) throw new Error('route sur la mer');
  for (const e of Object.keys(s.ships)) {
    if (!s.board.edges[+e].sea) throw new Error('bateau à terre');
    if (s.roads[e] !== undefined) throw new Error('route et bateau sur la même arête');
  }
  if (s.board.hexes[s.robber].terrain === 'sea') throw new Error('voleur en mer');
  const cards = s.devDeck.length + s.players.reduce((n, p) => n + p.dev.length + p.knights, 0);
  const vp = s.players.reduce((n, p) => n + p.dev.filter((c) => c.k === 'vp').length, 0);
  void cards; void vp;
}

export function playGame(seed, maxSteps = 6000, variant = 'classic') {
  const rnd = seededRandom(seed * 7919 + 13);
  const n = 3 + (seed % 2);
  let s = E.newGame({ names: ['A', 'B', 'C', 'D'].slice(0, n), seed, variant });
  let steps = 0;
  while (s.phase !== 'ended' && steps++ < maxSteps) {
    const acts = botStep(s, rnd);
    if (!acts.length) throw new Error('le bot ne trouve aucune action, étape ' + s.phase + '/' + s.step);
    for (const a of acts) {
      const r = E.apply(s, a);
      if (!r.ok) throw new Error('action refusée ' + JSON.stringify(a) + ' : ' + r.error + ' (' + s.phase + '/' + s.step + ')');
      s = r.state;
      checkInvariants(s);
      JSON.parse(JSON.stringify({ ...s, board: null }));
    }
  }
  return { s, steps };
}

if (process.argv[1] && process.argv[1].endsWith('simulate.mjs')) {
  const count = Number(process.argv[2] || 100);
  const variant = process.argv[3] || 'classic';
  let ended = 0, turns = 0, maxPts = 0;
  for (let i = 1; i <= count; i++) {
    const { s } = playGame(i, 6000, variant);
    if (s.phase === 'ended') {
      ended++;
      turns += s.turnNo;
      maxPts = Math.max(maxPts, E.points(s, s.winner, true));
    }
  }
  console.log(variant + ' : ' + count + ' parties, ' + ended + ' terminées, ' + (ended ? Math.round(turns / ended) : 0) + ' tours en moyenne, max ' + maxPts + ' pts');
  if (ended < count * 0.9) { console.error('Trop de parties inachevées'); process.exit(1); }
}
