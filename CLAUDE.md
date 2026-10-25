# CLAUDE.md — Au temps béni des colonies

Jeu de plateau en ligne (inspiré des règles de base de Catan). Plateau sur ordinateur, main privée de chaque joueur sur téléphone. Lis `PLAN.md` avant toute modification structurante et `RULES.md` avant de toucher aux règles.

## Langue
- Interface, journal de partie, messages d'erreur et commentaires de règles : **français**.
- Identifiants de code : anglais (`placeRoad`, `wood`, `brick`…).

## Propriété intellectuelle
- Ne jamais écrire « Catan » dans l'interface, le `<title>` ou les visuels. Nom du jeu : **Au temps béni des colonies**.
- Tous les visuels sont dessinés ici (SVG inline). Ne pas copier d'illustrations, de polices ou de textes d'un jeu du commerce.

## Architecture (ne pas casser)
```
src/engine.js      Règles. Pur, sans DOM, sans date, sans Math.random. Testable sous Node.
src/mqtt-room.js   Salon MQTT public (WebSocket) avec l'interface de `room`, pour le site hors artefact.
src/net.js         Transport écran <-> téléphones (chiffrement ECDH/AES-GCM, découpage, resynchronisation). Sans DOM ni règles.
src/ui.js          Interface, 3 modes (local, host, client). Aucune règle : appelle E.available / E.legal* / E.apply.
src/art.svg        Scènes illustrées des tuiles et motifs (injectées dans le template).
src/style.css      Styles, thème clair/sombre par jetons.
src/template.html  Squelette ; build.mjs y injecte engine.js, ui.js, style.css.
test/*.test.mjs    Tests moteur (node --test).
build.mjs          Produit dist/index.html (un seul fichier, c'est lui qu'on publie).
```
Règles d'or :
1. **Le moteur est l'unique source de vérité.** Si l'UI a besoin d'une info de règle, on l'ajoute au moteur (`available`, `legal*`, `viewFor`), on ne la recalcule pas dans l'UI.
2. **`apply(état, action)` ne modifie jamais son entrée** et renvoie `{ok, state, error}`. Une action illégale renvoie `ok:false` avec un message français, jamais une exception.
3. **Tout hasard passe par `state.rng`.** Jamais `Math.random()` dans le moteur.
4. **L'état est du JSON pur** (pas de classes, pas de Map/Set, pas de fonctions) : il doit survivre à `JSON.parse(JSON.stringify(s))` et traverser le réseau.
5. **Les mains privées** n'existent que dans l'état hôte. Tout ce qui sort vers un client passe par `viewFor(état, joueur)`.
6. Une action = un objet `{type, player, ...}`. Le champ `player` est vérifié par le moteur (on ne joue que quand c'est son tour, sauf défausse et réponse d'échange).

## Commandes
```
node --test test/*.test.mjs           # tests moteur
node build.mjs               # génère dist/index.html
node test/simulate.mjs 200   # 200 parties aléatoires, vérifie les invariants
node test/e2e.mjs            # écran + 3 téléphones en jsdom (jsdom requis : npm i --no-save jsdom) ; ajouter --site pour un vrai courtier
node test/mqtt-live.mjs      # client MQTT contre les courtiers publics (réseau)
node test/net-live.mjs       # hôte + 2 téléphones chiffrés par Internet
node test/fx.mjs             # animation du lancer (jsdom)
```
Ne publie l'artefact qu'après `node --test` et `node build.mjs` verts.

## Déploiement du site (GitHub Pages, gratuit)
- Site : https://ucheyrou.github.io/colons-de-lile/ (dépôt public `ucheyrou/colons-de-lile`, Pages sur `main` dossier `/docs`).
- Mise à jour : `node build.mjs`, puis commit de `docs/` et `git push`. Le site se reconstruit en une minute.
- Les commits utilisent l'e-mail noreply GitHub (jamais l'adresse d'école de la config globale).
- Sur le site, les téléphones passent par des courtiers MQTT publics (`src/mqtt-room.js`, liste `BROKERS`) : connexion simultanée à tous (shiftr.io et itdata.nu sur le port 443, HiveMQ et EMQX en secours), chaque message envoyé sur tous, le premier arrivé gagne, doublons ignorés. Ne pas revenir à « un seul courtier au choix » : écran et téléphone pourraient se retrouver sur deux courtiers différents.
- Les courtiers gratuits tombent sans prévenir (HiveMQ et EMQX en octobre 2026). Si « Impossible de joindre le serveur de salle » : `node test/mqtt-live.mjs` (hors bac à sable : le bac à sable de Claude Code fausse les connexions MQTT) pour voir lesquels répondent, et remplacer les morts. Le QR code ouvre `site#j=CODE` : code déjà rempli.
- Le canal est choisi automatiquement : capacité `room` si on est dans un artefact, MQTT sinon. Les deux mondes ne communiquent pas entre eux.

## Publication (artefact)
- Publier `dist/index.html` avec l'outil Artifact, même chemin à chaque fois pour garder le même lien, avec `capabilities: {room: {topics: {a: "interact"}}}`.
- Le lien de l'artefact est écrit en dur dans `src/ui.js` (`ARTIFACT_URL`, pour le QR) : à mettre à jour si l'artefact change d'adresse.
- Le fichier publié ne contient ni `<html>`, ni `<head>`, ni `<body>` (le squelette est ajouté à la publication). `<title>` en tête : « Au temps béni des colonies ».
- Bibliothèques externes : à éviter. Si indispensable, cdnjs, version exacte vieille d'au moins 2 semaines.
- `alert/confirm/prompt` sont inertes : toute confirmation est une interface dans la page.
- Thème : jetons de couleur sur `:root`, redéfinis pour `prefers-color-scheme: dark` (avec `:root:not([data-theme="light"])`) et `:root[data-theme="dark"]`. Les couleurs de terrain et de joueurs sont sémantiques et restent fixes.
- Mobile : largeur 400 px sans défilement horizontal, cibles tactiles ≥ 44 px, marges latérales `max(16px, env(safe-area-inset-*))`.

## Conventions de code
- JS sans dépendance, sans transpilation, ES2020. Pas de framework. Fonctions courtes, noms explicites.
- Un commentaire n'explique que le *pourquoi* ou une règle de jeu non évidente.
- Pas de `console.log` oublié. Pas de code mort.
- CSS : classes en minuscules-tirets, tout via les jetons `--*`.

## Répartition pour sous-agents
Chaque agent ne touche qu'à ses fichiers ; les interfaces entre eux sont les noms exportés du moteur.

| Rôle | Fichiers | Mission |
|---|---|---|
| Moteur | `src/engine.js`, `test/` | Règles, vues privées, invariants |
| Interface | `src/ui.js`, `src/style.css`, `src/template.html` | Plateau SVG, main du joueur, accessibilité |
| Réseau (P3) | `src/net.js` | Salon, messages `room`, reconnexion, sauvegarde `db` |
| QA règles | `RULES.md`, `test/` | Compare le comportement aux règles, écrit les cas limites |
| Revue | lecture seule | `/code-review`, `/simplify` avant chaque publication |

Un agent qui découvre un bug dans le fichier d'un autre le signale (message ou test qui échoue) au lieu de le corriger en douce.

## Skills utiles
- `artifact-design`, `artifact-capabilities` : à charger avant toute publication ou tout code `window.claude.*`.
- `catan-rules` (projet, `.claude/skills/catan-rules`) : règles de référence, à consulter pour toute question de règle.
- `run`, `code-review`, `simplify` : vérification et nettoyage.

## Environnement
- Node n'est pas installé sur la machine du projet. Pour lancer les tests, télécharger un binaire Node officiel dans un dossier temporaire (jamais d'installation système sans demander) et l'ajouter au `PATH` le temps de la session.
- Test d'interface sans navigateur : `jsdom` installé dans un dossier temporaire, page `dist/index.html` chargée avec `runScripts: 'dangerously'`, clics simulés sur `[data-act]`, `[data-v]`, `[data-e]`, `[data-h]`.
- L'extension Chrome peut être absente : ne pas compter dessus pour relire le rendu.

## Rapidité ressentie
- Le téléphone affiche tout de suite les actions sans secret (`ANTICIPATED` dans `src/ui.js` : poser, fin de tour, échange banque, défausse…). Ne jamais y mettre les dés, la pioche, le vol ni une confirmation d'échange : ils dépendent de cartes cachées.
- L'hôte répond aux téléphones avant de redessiner son écran, et sert d'abord celui qui vient d'agir.
- Après une erreur de règle, l'hôte renvoie la vue pour annuler l'affichage anticipé.
- Zones de toucher : disques invisibles (`.hit`) bien plus larges que le point affiché + aimant sur l'emplacement valide le plus proche (`snapTap`). Sur téléphone le plateau est réduit à ~0,3 px par unité : toute cible de moins de ~130 unités est trop petite pour un doigt.

## Début de partie (src/ui.js)
- Couleurs choisies en jeu (phase `color`), pas sur l'écran d'accueil : `pcolor(i)` lit `game.players[i].color`, gris (`--p-none`) tant qu'elle n'est pas choisie.
- Choix des couleurs et tirage au dé s'affichent au centre du plateau (`#stage`, `.roll-stage`) ; sur téléphone, dans la main (`stageHTML(s, true)`). Le classement reste ~2,6 s après le dernier dé (`STAGE_LINGER`).
- Dés en 3D (`cubeHTML`, `.cube-box`) : cube CSS orienté par `data-v`, lancer de `ROLL_MS` recalé par `--el` (`trackDice`, `trackOrder`).

## Animation du lancer (src/ui.js, src/style.css)
- À chaque nouveau lancer (`trackRoll`) : les tuiles qui produisent sont redessinées au premier plan (`.fx-hex`), le reste s'estompe (`#board.fx-on`), des « +n » montent au-dessus des colonies (`.fx-gain`), la tuile bloquée par le voleur est cerclée de rouge (`.fx-block`). Durée `FX_MS` = 4,2 s.
- Les animations CSS sont recalées par `--el` (temps écoulé) : un nouveau rendu en cours d'animation ne la relance pas. Ne pas la déclencher depuis `render()` sans passer par `trackRoll`.
- Une partie chargée, reprise ou rejointe en cours de route n'anime rien (`ui.fxKey === null` au départ, `resetFx`).
- Main du joueur : `trackGain` compare la main au rendu précédent et anime les cartes reçues (`.tile.gain`, `.plus`).
- Test : `node test/fx.mjs` (jsdom).

## Réseau (src/net.js)
- Hôte autoritaire : seul l'écran du plateau détient l'état réel. Les téléphones envoient `{type, ...}` chiffré sur le sujet `a` ; l'hôte impose le siège (`player` n'est jamais cru) et répond sur `v`.
- Tout message de jeu est chiffré (AES-GCM, clé dérivée ECDH). Ne jamais mettre de main ou de carte en clair dans une présence ou un message.
- Message plateforme ≤ 4 Kio : toujours passer par `emitSealed` (découpage).
- Le plateau n'est jamais transmis : `E.boardFromSeed(seed)`. Une vue = `E.viewFor(état, siège, {board:false, log:14})`.
- Tester avec `test/fake-room.mjs` (salon en mémoire) : `node --test test/net.test.mjs`.
- Capacité à déclarer à la publication : `room` avec `topics: {a: "interact"}`.

## Pièges connus
- Sommets/arêtes : identifiés par position arrondie à 1e-3 sur un hexagone de rayon 1 ; ne pas changer la formule des coins sans relancer les tests.
- Les clés d'objets (`buildings`, `roads`) deviennent des chaînes après JSON ; comparer les identifiants avec `===` seulement après les avoir lus comme nombres.
- Une carte de développement achetée ce tour-ci ne se joue qu'au tour suivant (sauf point de victoire, qui compte tout de suite) ; une seule carte de développement jouée par tour.
- La victoire n'est vérifiée que pour le joueur dont c'est le tour.
