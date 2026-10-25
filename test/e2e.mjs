// Test de bout en bout : un écran hôte + 3 téléphones (fenêtres jsdom) reliés par un faux salon, chiffrement réel.
// Option --site : pas de capacité `room`, vrai courtier MQTT public (réseau requis).
// Nécessite jsdom (npm i --no-save jsdom) et dist/index.html (node build.mjs). Lancer : node test/e2e.mjs
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hub } from './fake-room.mjs';

const html = readFileSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)), 'utf8').replace(/<script src="[^"]*"><\/script>/g, '');
const errors = [];
const site = process.argv.includes('--site');
const hub = new Hub();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, what = '') {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return; await wait(10); }
  throw new Error('délai dépassé : ' + what);
}
function openWindow(name, url) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(name + ' ' + String(e.stack || e).slice(0, 400)));
  vc.on('error', (e) => errors.push(name + ' console.error ' + String(e).slice(0, 300)));
  const doc = hub.open();
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', {
    runScripts: 'dangerously', url, virtualConsole: vc, pretendToBeVisual: true,
    beforeParse(w) {
      if (site) w.WebSocket = WebSocket; else w.claude = doc.claude;
      Object.defineProperty(w, 'crypto', { value: globalThis.crypto });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    },
  });
  const w = dom.window, d = w.document;
  return { w, d, name, click: (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })), q: (s) => d.querySelector(s), qa: (s) => [...d.querySelectorAll(s)] };
}

const host = openWindow('HOTE', 'https://example.test/');
host.click(host.q('[data-act=goto][data-s=host]'));
await until(() => host.q('.code') && host.q('.code').textContent.length === 4, 3000, 'code de salle');
const code = host.q('.code').textContent;
console.log('mode', site ? 'site (MQTT réel)' : 'artefact (faux salon)', '| salle', code, '| QR présent:', !!host.q('.qr') ? 'oui' : 'non (bibliothèque externe retirée du test)');

const names = ['Alice', 'Bruno', 'Chloé'];
const phones = [];
for (const n of names) {
  const p = openWindow('TEL-' + n, 'https://example.test/' + (site ? '#j=' + code : '#joueur'));
  await until(() => p.q('#joinCode'), 2000, 'écran de jonction');
  if (site && p.q('#joinCode').value !== code) throw new Error('le code devrait être prérempli par le lien du QR : ' + p.q('#joinCode').value);
  p.q('#joinCode').value = code.toLowerCase();
  p.q('#joinCode').dispatchEvent(new p.w.Event('input', { bubbles: true }));
  p.q('#joinName').value = n;
  p.q('#joinName').dispatchEvent(new p.w.Event('input', { bubbles: true }));
  p.click(p.q('[data-act=join]'));
  phones.push(p);
}
await until(() => host.qa('#welcome .pl:not(.empty)').length === 3, 5000, 'joueurs dans le salon');
console.log('salon hôte :', host.qa('#welcome .pl b').map((e) => e.textContent).join(', '));
await until(() => phones.every((p) => /Tu es dans la salle/.test(p.d.getElementById('welcome').textContent)), 5000, 'attente côté téléphone');
console.log('téléphones en attente : ok');

const tStart = Date.now();
host.click(host.q('[data-act=host-start]'));
await until(() => !host.q('#game').hidden, 3000, 'hôte lance');
try { await until(() => phones.every((p) => !p.q('#game').hidden && p.q('.layout.client')), 20000, 'vues téléphone'); } catch (e) { console.log('ÉTAT', phones.map((p) => p.d.getElementById('welcome').textContent.slice(0, 120) + ' | game hidden=' + p.q('#game').hidden).join('\n')); console.log(errors); throw e; }
console.log('vues reçues par les 3 téléphones en', Date.now() - tStart, 'ms');
console.log('partie lancée. joueurs hôte :', host.qa('#scores .pl b').map((e) => e.textContent).join(', '));
console.log('main cachée sur l\'écran hôte :', host.q('.layout').classList.contains('host'));

// Confidentialité : le DOM d'un téléphone ne montre que sa propre main
const tiles = (p) => p.qa('#hand .tile b').map((e) => e.textContent).join(',');

let steps = 0, ended = false;
const stat = {};
while (steps < Number(process.argv.find((a) => /^\d+$/.test(a)) || 2500) && !ended) {
  steps++;
  const p = phones[Math.floor(Math.random() * phones.length)];
  const targets = p.qa('#board [data-v], #board [data-e], #board [data-h]');
  const btns = p.qa('#hand button[data-act]:not(:disabled)').filter((b) => !['tab', 'trade-toggle', 'pick-cancel'].includes(b.dataset.act));
  const prio = btns.find((b) => ['roll-order', 'roll', 'discard', 'steal'].includes(b.dataset.act));
  const pool = [...targets, ...targets, ...btns];
  if (pool.length) {
    let el = prio || pool[Math.floor(Math.random() * pool.length)];
    if (el.dataset.act === 'end' && Math.random() < 0.5) el = btns.find((b) => b.dataset.act !== 'end') || el;
    const k = el.dataset.act || 'cell';
    stat[k] = (stat[k] || 0) + 1;
    p.click(el);
  }
  if (steps % 5 === 0) await wait(4);
  if (host.q('#over .over')) ended = true;
  if (errors.length) break;
  if (steps % 1500 === 0) console.log('… étape', steps, '| tour', JSON.parse(host.w.localStorage.getItem('colons-de-lile-host-v1')).game.turnNo);
}
const converge = () => phones.every((p) => p.qa('#board .piece').length === host.qa('#board .piece').length && p.qa('#board .tgt').length >= 0);
try { await until(converge, 10000, 'convergence'); } catch (e) { /* signalé par la comparaison finale */ }
await wait(200);
const saved = JSON.parse(host.w.localStorage.getItem('colons-de-lile-host-v1') || 'null');
console.log('étapes', steps, '| fini', ended, '| actions', JSON.stringify(stat));
if (saved) console.log('hôte : phase', saved.game.phase, '| tour', saved.game.turnNo, '| bâtiments', Object.keys(saved.game.buildings).length, '| routes', Object.keys(saved.game.roads).length);
// Cohérence : les téléphones affichent les mêmes bâtiments que l'hôte
const count = (x, sel) => x.qa(sel).length;
console.log('pièces plateau hôte/tél :', count(host, '#board .piece'), phones.map((p) => count(p, '#board .piece')).join('/'));
console.log('mains tél :', phones.map(tiles).join(' | '));
const leak = phones.some((p) => p.qa('#hand .tile').length !== 5);
console.log('chaque téléphone affiche une seule main (5 tuiles) :', !leak);
console.log('erreurs :', errors.length); errors.slice(0, 4).forEach((e) => console.log(e));
process.exit(errors.length || leak || count(host, '#board .piece') !== count(phones[0], '#board .piece') ? 1 : 0);
