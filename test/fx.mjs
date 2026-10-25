// Animation du lancer (jsdom) : les tuiles mises en avant sont exactement celles qui produisent ; rien à la reprise d'une partie.
// Nécessite jsdom et dist/index.html. Lancer : node test/fx.mjs
import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)), 'utf8').replace(/<script src="[^"]*"><\/script>/g, '');
const errors = [];
function open(store) {
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', {
    runScripts: 'dangerously', url: 'https://example.test/', pretendToBeVisual: true,
    beforeParse(w) { if (store) Object.entries(store).forEach(([k, v]) => w.localStorage.setItem(k, v)); },
  });
  dom.window.addEventListener('error', (e) => errors.push(String(e.message)));
  return dom.window;
}
const w = open();
const d = w.document;
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const q = (s) => d.querySelector(s), qa = (s) => [...d.querySelectorAll(s)];
let fail = 0;
const check = (ok, msg) => { console.log(ok ? 'OK    ' : 'ÉCHEC ', msg); if (!ok) fail++; };

click(q('[data-act=goto][data-s=setup]'));
click(q('[data-act=start]'));
check(/couleur/.test(q('#banner').textContent) && qa('#hand [data-act=pick-color]').length === 6, 'la partie s\'ouvre sur le choix des couleurs');
for (let i = 0; i < 10 && q('#hand [data-act=pick-color]:not(:disabled)'); i++) click(q('#hand [data-act=pick-color]:not(:disabled)'));
check(/Qui commence/.test(q('#banner').textContent) && /Qui commence/.test(q('#stage').textContent), 'puis le tirage au dé');
for (let i = 0; i < 30 && q('[data-act=roll-order]'); i++) click(q('[data-act=roll-order]'));
check(!q('[data-act=roll-order]') && qa('#board [data-v]').length > 0, 'ordre décidé, le premier pose sa colonie');
for (let i = 0; i < 40 && q('#board [data-v], #board [data-e]'); i++) click(q('#board [data-v], #board [data-e]'));
check(!!q('[data-act=roll]'), 'mise en place terminée, prêt à lancer');
check(qa('.fx-hex').length === 0, 'rien n\'est animé avant le premier lancer');

// On joue jusqu'à voir un lancer qui produit quelque chose chez quelqu'un.
let seenGain = null, rolls = 0, snapshot = false, checked = '';
for (let i = 0; i < 400 && !seenGain; i++) {
  const prio = ['roll', 'discard', 'steal'].map((a) => q('#hand [data-act=' + a + ']:not(:disabled)')).find(Boolean);
  const cell = q('#board [data-h], #board [data-v]');
  if (prio) { click(prio); if (prio.dataset.act === 'roll') rolls++; }
  else if (qa('#hand [data-act=step]:not(:disabled)').length) click(q('#hand [data-act=step][data-d="1"]:not(:disabled)'));
  else if (cell) click(cell);
  else if (q('#hand [data-act=end]')) click(q('#hand [data-act=end]'));
  const g = JSON.parse(w.localStorage.getItem('colons-de-lile-v1'));
  // l'animation survit à la fin du tour : on ne vérifie qu'une fois par lancer, tant que les dés sont là
  const key = g.dice && g.turnNo + ':' + g.dice;
  if ((qa('.fx-hex').length || qa('.fx-block').length) && key && key !== checked) {
    checked = key;
    const E = w.Engine, board = E.boardFromSeed(g.seed);
    const sum = g.dice[0] + g.dice[1];
    const expected = board.hexes.filter((h) => h.number === sum && h.id !== g.robber).length;
    check(qa('.fx-hex').length === expected, 'lancer ' + sum + ' : ' + qa('.fx-hex').length + ' tuile(s) au premier plan, attendu ' + expected);
    check(q('#board').classList.contains('fx-on'), 'le reste du plateau est estompé (fx-on)');
    check(qa('.fx-hex .fx-ring').length === expected, 'chaque tuile a son halo');
    check(!!q('.fxcap'), 'légende des ressources qui produisent : « ' + q('.fxcap').textContent.trim() + ' »');
    // les gains annoncés correspondent aux colonies voisines
    let want = 0;
    board.hexes.filter((h) => h.number === sum && h.id !== g.robber).forEach((h) => h.vertices.forEach((v) => { if (g.buildings[v]) want += g.buildings[v].type === 'city' ? 2 : 1; }));
    const shown = qa('.fx-gain text').reduce((n, t) => n + Number(t.textContent.replace('+', '')), 0);
    check(shown === want, 'cartes annoncées au-dessus des colonies : ' + shown + ', attendu ' + want);
    if (want > 0) seenGain = { sum, want };
    if (!snapshot && want > 0) { snapshot = true; writeFileSync(process.env.FX_SNAPSHOT || '/dev/null', d.documentElement.outerHTML); }
  }
}
check(!!seenGain, 'un lancer productif a été observé après ' + rolls + ' lancers');

// Reprise : un jeu rechargé n'anime rien
const saved = w.localStorage.getItem('colons-de-lile-v1');
const w2 = open({ 'colons-de-lile-v1': saved });
const c2 = (el) => el.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
c2(w2.document.querySelector('[data-act=resume]'));
check(w2.document.querySelectorAll('.fx-hex').length === 0 && !w2.document.getElementById('board').classList.contains('fx-on'), 'une partie reprise après rechargement n\'anime rien');

// L'animation s'éteint toute seule
await new Promise((r) => setTimeout(r, 4400));
check(qa('.fx-hex').length === 0 && !q('#board').classList.contains('fx-on'), 'l\'animation disparaît après ~4 s');
check(errors.length === 0, 'aucune erreur de script (' + errors.length + ')');
process.exit(fail ? 1 : 0);
