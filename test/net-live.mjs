// Parcours complet par Internet : hôte + 2 téléphones via un courtier MQTT public, chiffrement réel.
// Lancer : node test/net-live.mjs
import Net from '../src/net.js';
import E from '../src/engine.js';
import MqttRoom from '../src/mqtt-room.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, what = '') {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(25); }
  throw new Error('délai dépassé : ' + what);
}
const code = 'T' + Math.random().toString(36).slice(2, 5);

const roomH = await MqttRoom.join(code);
console.log('courtier :', roomH.broker());
let game = E.newGame({ names: ['Alice', 'Bruno'], seed: 11 });
const host = Net.createHost({
  room: roomH, identity: await Net.newIdentity(),
  viewOf: (seat) => E.viewFor(game, seat, { board: false, log: 14 }),
  onAct: (seat, action) => {
    const r = E.apply(game, { ...action, player: seat });
    if (!r.ok) return r.error;
    game = r.state;
    host.publish();
    return null;
  },
});
const phones = [];
for (const name of ['Alice', 'Bruno']) {
  const room = await MqttRoom.join(code);
  const got = { views: [], status: [], errors: [] };
  const client = Net.createClient({ room, identity: await Net.newIdentity(), name, onView: (p) => got.views.push(p), onStatus: (s) => got.status.push(s), onError: (e) => got.errors.push(e) });
  phones.push({ room, client, got });
}
await until(() => host.lobby().length === 2, 10000, 'salon à 2');
console.log('salon :', host.lobby().map((p) => p.name).join(', '));
const seats = {};
host.lobby().forEach((p, i) => { seats[p.pub] = i; });
host.setSeats(seats);
const t0 = Date.now();
host.setStatus('play');
await until(() => phones.every((p) => p.got.views.length), 10000, 'vues initiales');
console.log('vues initiales reçues en', Date.now() - t0, 'ms');
const seat0 = phones.find((p) => p.got.views[0].seat === 0);
const v = E.available(game, 0).targets.vertices[0];
const t1 = Date.now();
await seat0.client.send({ type: 'placeSettlement', vertex: v });
await until(() => phones.every((p) => p.got.views.at(-1).view.buildings[v]), 10000, 'action propagée');
console.log('action → vue mise à jour chez tous en', Date.now() - t1, 'ms');
const mine = seat0.got.views.at(-1).view.players[0];
const other = seat0.got.views.at(-1).view.players[1];
console.log('main visible chez le joueur 0 :', !!mine.hand, '| main de l\'autre visible :', !!other.hand);
await seat0.client.send({ type: 'roll' });
await until(() => seat0.got.errors.length > 0, 10000, 'erreur légale renvoyée');
console.log('erreur de règle renvoyée au téléphone :', seat0.got.errors[0]);
await Promise.all([roomH, ...phones.map((p) => p.room)].map((r) => r.leave()));
process.exit(0);
