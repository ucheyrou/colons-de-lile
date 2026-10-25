// Joueur aléatoire pour les tests : ne choisit que parmi ce que le moteur déclare disponible.
import E from '../src/engine.js';

const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];

export function botStep(s, rnd) {
  const out = [];
  const go = (a) => out.push(a);
  if (s.phase === 'order') return E.actors(s).map((pid) => ({ type: 'rollOrder', player: pid }));
  if (s.phase === 'main' && s.step === 'discard') {
    return E.actors(s).map((pid) => {
      const av = E.available(s, pid);
      const pool = [];
      E.RES.forEach((r) => { for (let i = 0; i < s.players[pid].hand[r]; i++) pool.push(r); });
      const cards = {};
      for (let i = 0; i < av.discard; i++) {
        const k = Math.floor(rnd() * pool.length);
        const r = pool.splice(k, 1)[0];
        cards[r] = (cards[r] || 0) + 1;
      }
      return { type: 'discard', player: pid, cards };
    });
  }
  const pid = s.turn;
  const av = E.available(s, pid);
  const p = s.players[pid];
  if (av.setupSettlement) go({ type: 'placeSettlement', player: pid, vertex: pick(av.targets.vertices, rnd) });
  else if (av.setupRoad) go({ type: 'placeRoad', player: pid, edge: pick(av.targets.edges, rnd) });
  else if (av.moveRobber) go({ type: 'moveRobber', player: pid, hex: pick(av.targets.hexes, rnd) });
  else if (av.steal) go({ type: 'steal', player: pid, victim: pick(av.steal, rnd) });
  else if (av.freeRoad) go({ type: 'placeRoad', player: pid, edge: pick(av.targets.edges, rnd) });
  else if (av.roll) {
    if (av.dev.knight && rnd() < 0.3) go({ type: 'playKnight', player: pid });
    else go({ type: 'roll', player: pid });
  } else if (av.myTurn) {
    if (av.city) go({ type: 'placeCity', player: pid, vertex: pick(E.targetsFor(s, pid, 'city').vertices, rnd) });
    else if (av.settlement) go({ type: 'placeSettlement', player: pid, vertex: pick(E.targetsFor(s, pid, 'settlement').vertices, rnd) });
    else if (av.buyDev && rnd() < 0.6) go({ type: 'buyDev', player: pid });
    else if (av.dev.knight && rnd() < 0.5) go({ type: 'playKnight', player: pid });
    else if (av.dev.roadBuilding && rnd() < 0.5) go({ type: 'playRoadBuilding', player: pid });
    else if (av.dev.yearOfPlenty && rnd() < 0.5) {
      const left = { ...s.bank };
      const a = pick(E.RES.filter((r) => left[r] > 0), rnd);
      left[a]--;
      go({ type: 'playYearOfPlenty', player: pid, a, b: pick(E.RES.filter((r) => left[r] > 0), rnd) });
    }
    else if (av.dev.monopoly && rnd() < 0.5) go({ type: 'playMonopoly', player: pid, res: pick(E.RES, rnd) });
    else if (av.road && rnd() < 0.5) go({ type: 'placeRoad', player: pid, edge: pick(E.targetsFor(s, pid, 'road').edges, rnd) });
    else {
      const giveable = E.RES.filter((r) => p.hand[r] >= av.ratios[r]);
      if (giveable.length && rnd() < 0.4) {
        const give = pick(giveable, rnd);
        const gets = E.RES.filter((r) => r !== give && s.bank[r] > 0);
        if (!gets.length) return [{ type: 'endTurn', player: pid }];
        const get = pick(gets, rnd);
        go({ type: 'bankTrade', player: pid, give, get });
      } else if (rnd() < 0.15 && E.total(p.hand) > 0) {
        const give = pick(E.RES.filter((r) => p.hand[r] > 0), rnd);
        const want = pick(E.RES.filter((r) => r !== give), rnd);
        go({ type: 'offerTrade', player: pid, give: { [give]: 1 }, want: { [want]: 1 } });
      } else if (s.trade) {
        const acc = s.players.find((o) => o.id !== pid && o.hand[E.RES.find((r) => s.trade.want[r] > 0)] >= 1);
        if (acc && rnd() < 0.7) {
          go({ type: 'respondTrade', player: acc.id, accept: true });
          go({ type: 'confirmTrade', player: pid, with: acc.id });
        } else go({ type: 'cancelTrade', player: pid });
      } else go({ type: 'endTurn', player: pid });
    }
  }
  return out;
}
