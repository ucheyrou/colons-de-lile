// Test réseau réel (hors `npm test`) : le client MQTT contre chaque courtier public.
// Lancer : node test/mqtt-live.mjs
import MqttRoom from '../src/mqtt-room.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, what = '') {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(25); }
  throw new Error('délai dépassé : ' + what);
}
const code = () => 'T' + Math.random().toString(36).slice(2, 5);

let failed = 0;
for (const broker of MqttRoom.BROKERS) {
  const name = new URL(broker).host;
  try {
    const c = code();
    const t0 = Date.now();
    const a = await MqttRoom.join(c, { brokers: [broker] });
    const b = await MqttRoom.join(c, { brokers: [broker] });
    const connectMs = Date.now() - t0;
    const heard = [];
    b.on('x', (m) => heard.push(m));
    await a.presence({ r: 'h', pub: 'AAAA', n: 1 });
    await b.presence({ r: 'p', name: 'Bruno' });
    await until(() => a.peers().some((p) => !p.isMe && p.presence.name === 'Bruno'), 6000, 'présence de B vue par A');
    await until(() => b.peers().some((p) => !p.isMe && p.presence.r === 'h'), 6000, 'présence de A vue par B');
    // message avec accents et plus de 4 Kio
    const big = 'é'.repeat(6000);
    await a.emit('x', { hello: 'monde', big });
    await until(() => heard.length === 1, 6000, 'événement reçu');
    if (heard[0].data.big !== big || heard[0].isMe || heard[0].peer !== a.peerId) throw new Error('contenu ou expéditeur faux');
    // un nouveau venu reçoit la présence existante (messages retenus)
    const c3 = await MqttRoom.join(c, { brokers: [broker] });
    await until(() => c3.peers().filter((p) => !p.isMe).length === 2, 6000, 'retenus pour un nouveau venu');
    // mise à jour de présence
    await b.presence({ v: 7 });
    await until(() => a.peers().some((p) => p.presence.v === 7), 6000, 'mise à jour de présence');
    // fermeture brutale : le testament efface la présence
    b._drop();
    await until(() => !a.peers().some((p) => p.presence.name === 'Bruno'), 8000, 'testament après coupure');
    // départ propre
    await c3.leave();
    await until(() => a.peers().length === 1, 6000, 'départ propre');
    await a.leave();
    console.log('OK   ', name, '| connexion', connectMs, 'ms');
  } catch (e) {
    failed++;
    console.log('ÉCHEC', name, '|', e.message);
  }
}
process.exit(failed === MqttRoom.BROKERS.length ? 1 : 0);
