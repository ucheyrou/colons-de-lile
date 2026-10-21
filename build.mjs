// Assemble src/ en un seul fichier publiable : dist/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');
const inject = (tpl, key, code) => tpl.replace(`/*${key}*/`, () => code);

let html = read('template.html');
html = inject(html, 'CSS', read('style.css'));
html = inject(html, 'ART', read('art.svg'));
html = inject(html, 'ENGINE', read('engine.js').replace(/<\/script/gi, '<\\/script'));
html = inject(html, 'MQTT', read('mqtt-room.js').replace(/<\/script/gi, '<\\/script'));
html = inject(html, 'NET', read('net.js').replace(/<\/script/gi, '<\\/script'));
html = inject(html, 'UI', read('ui.js').replace(/<\/script/gi, '<\\/script'));

// Version artefact : fragment, le squelette est ajouté à la publication.
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
console.log('dist/index.html (artefact)', Math.round(html.length / 1024) + ' Ko');

// Version site (GitHub Pages, dossier docs/) : document complet, même contenu.
const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 2l12 7v14l-12 7-12-7V9z' fill='%230e6b7b'/%3E%3Ccircle cx='16' cy='16' r='5' fill='%23fffaf0'/%3E%3C/svg%3E";
const site = '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#0e6b7b">\n' +
  '<meta name="description" content="Jeu de plateau de colonisation en ligne : le plateau sur l\'écran, chaque joueur avec sa main sur son téléphone.">\n' +
  '<link rel="icon" href="' + icon + '">\n' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n' +
  '</head>\n<body>\n' + html + '\n</body>\n</html>\n';
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'index.html'), site);
writeFileSync(join(root, 'docs', '.nojekyll'), '');
console.log('docs/index.html (site)', Math.round(site.length / 1024) + ' Ko');
