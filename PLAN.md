# Plan de raisonnement — « Au temps béni des colonies »

Jeu de plateau multijoueur inspiré des règles de base de Catan, jouable en ligne :
**le plateau sur un ordinateur (ou une TV), chaque joueur avec sa main privée sur son téléphone.**

> Nom et visuels originaux (on n'utilise ni le nom « Catan », ni ses illustrations, ni sa charte). Les règles de jeu en elles-mêmes ne sont pas protégées ; l'habillage l'est.

---

## 1. Ce qu'on construit, en une phrase

Un moteur de règles pur (sans interface) piloté par des **actions** ; une interface plateau SVG ; une interface « main du joueur » pensée mobile ; et, en dernier, un transport réseau qui relie les téléphones à l'écran.

## 2. Décision d'architecture clé : un hôte autoritaire

```
 téléphone A ──action──┐                       ┌── vue privée A ──► téléphone A
 téléphone B ──action──┼──►  PLATEAU (hôte)  ──┼── vue privée B ──► téléphone B
 téléphone C ──action──┘   moteur + état réel  └── vue publique ──► écran
```

- **Un seul endroit détient l'état réel** : l'écran du plateau. Il valide chaque action avec le moteur.
- Les téléphones n'envoient que des **intentions** (`{type:'placeRoad', player:2, edge:41}`), jamais un état.
- Le moteur est une fonction pure : `apply(état, action) → {ok, état, erreur}`. Même code côté hôte et côté tests.
- Le hasard (dés, mélange, vol de carte) vient d'un **générateur à graine stocké dans l'état** : une partie est rejouable à partir de `graine + liste d'actions`.
- `viewFor(état, joueur)` fabrique ce qu'un téléphone a le droit de voir (sa main, pas celle des autres).

Cette séparation est la raison pour laquelle on commence par l'artefact en mode « une seule page » : l'interface appelle déjà `dispatch(action)` et lit `viewFor(...)`. La phase réseau n'aura qu'à remplacer l'appel local par un envoi.

## 3. Phases

| Phase | Contenu | Livrable | Critère de sortie |
|---|---|---|---|
| **P0** Cadrage | Plan, CLAUDE.md, règles de référence, skills | ce dossier | validé par l'utilisateur |
| **P1** Moteur ✅ | Plateau (hex, sommets, arêtes, ports), jetons en spirale comme au jeu réel, mise en place en serpentin, production, voleur, défausse, construction, routes/armée, cartes de développement, échanges banque/ports/joueurs, victoire | `src/engine.js` + `test/engine.test.mjs` | 300 parties aléatoires terminent sans erreur, ressources conservées (95), 0 règle violée |
| **P2** Artefact un écran ✅ | Plateau SVG cliquable, tableau des scores, journal, panneau « main du joueur » (déjà au format téléphone), sauvegarde locale | `dist/index.html` publié en artefact | une partie complète jouable à 3–4 sur un seul écran |
| **P3** Écran + téléphones ✅ (à éprouver en vrai) | Rôles par ancre `#plateau` / `#joueur`, salon avec code et QR, messages `room` chiffrés, vues privées, reconnexion, resynchronisation par présence, sauvegarde locale de l'hôte | `src/net.js`, même artefact, rôle choisi à l'ouverture | simulation 1 écran + 3 téléphones sans désynchronisation ; essai réel à faire |
| **P4** Finition | Animations dés/ressources, sons, chat/émotes, joueurs automatiques (bots), thème, accessibilité | — | confort de jeu |
| **P5** Audit | Relecture des règles contre `RULES.md`, revue de code, tests de charge réseau | rapport | zéro écart connu |

## 4. Ordre de travail de la P1 (le plus risqué en premier)

1. **Géométrie** : hexagones en coordonnées axiales → sommets/arêtes dédupliqués par position arrondie. Tout le reste en dépend.
2. **Ports** : 30 arêtes côtières triées par angle, 9 ports espacés 3-3-4.
3. **Plateau équilibré** : 6 et 8 jamais adjacents (tirage répété).
4. **Machine à états** (`phase` + `step`) : `color:pickColor → order:rollOrder → setup:settlement → setup:road → main:roll → discard → robber → steal → actions → roadBuilding`.
5. **Règles de pose** : distance de 2, connexion à ses routes, route bloquée par une colonie adverse.
6. **Plus longue route** : parcours en profondeur, colonies adverses coupent, égalité = le détenteur garde.
7. **Banque limitée** (19 par ressource) : si la banque ne peut pas servir tout le monde, personne n'est servi (sauf un seul joueur concerné).
8. **Tests simulés** avec un bot aléatoire + invariants.

## 5. Interface (P2) — principes

- **Même page, deux lectures.** Écran large : plateau à gauche, colonne de droite avec scores, main, journal. Écran étroit : la main du joueur en premier, plateau en dessous. C'est ce qui deviendra la vue téléphone.
- L'interface ne contient **aucune règle** : elle demande au moteur `available()` et `legal*()` pour savoir quoi activer et quoi surligner.
- Interaction de pose : on choisit « Route » dans la main, les emplacements légaux s'illuminent sur le plateau, on touche l'un d'eux.
- Pas de bibliothèque : SVG et JS natif, un seul fichier publié, léger, qui s'ouvre vite sur téléphone.

## 6. Réseau (P3) — ce qu'on sait déjà, et les risques

Capacités de l'artefact retenues : `room` (messages en direct, une salle par partie via `join(code)`), `db` (copie de secours de l'état), `user` (identité).

| Risque | Conséquence | Réponse prévue |
|---|---|---|
| Les messages `room` sont entendus par tous les participants de la salle | Un joueur pourrait lire la main d'un autre | **Résolu** : chaque appareil a une identité ECDH P-256 dont la clé publique voyage dans sa présence (estampillée par la plateforme, donc infalsifiable) ; hôte et téléphone en dérivent une clé AES-GCM, tout message de jeu est chiffré |
| Les sujets `room` sont réservés aux éditeurs par défaut | Les téléphones ne pourraient pas envoyer d'actions | Déclarer `topics: {action: "interact"}` et partager l'artefact avec droit « contributeur » |
| L'écran hôte est fermé ou recharge | Partie perdue | Sauvegarde locale de l'hôte à chaque action (état + sièges) ; « Reprendre la partie en ligne » ; les téléphones se resynchronisent seuls. Pas de `db` : le navigateur de l'hôte suffit |
| Les messages peuvent se perdre ; un message est limité à 4 Kio | Désynchronisation, vues tronquées | Vue absolue + numéro de version ; chaque téléphone publie la version reçue dans sa présence, l'hôte renvoie la vue s'il y a un écart ; messages découpés en morceaux de 2,8 Ko |
| Deux actions simultanées | Conflit | L'hôte les traite en file, une par une, et rejette celle devenue illégale |

## 6 bis. Contraintes de la plateforme à ne pas oublier
- Republier l'artefact recharge toutes les vues et vide la salle : ne jamais publier pendant une partie.
- Les téléphones doivent avoir accès à l'artefact (invités ou membres) avec le droit « contributeur », sinon ils ne peuvent pas émettre sur le sujet `a`.
- Le plateau est reconstruit sur chaque téléphone à partir de la graine (`E.boardFromSeed`) : jamais envoyé.

## 6 ter. Hébergement et canal hors artefact
- Site statique gratuit sur GitHub Pages (`docs/`). Aucun serveur à payer ni compte joueur.
- Canal : courtiers MQTT publics (EMQX, HiveMQ, Mosquitto) via WebSocket ; un message perdu est rattrapé par une resynchronisation périodique de l'hôte et une relance du téléphone. Latence mesurée : environ 0,2 à 0,5 s par action.
- Le courtier est public : tout est chiffré de bout en bout, mais n'importe qui connaissant un code de salle (4 caractères) peut rejoindre le salon avant le lancement. Une fois la partie lancée, seuls les sièges attribués jouent.

## 7. Ce qui est volontairement hors périmètre V1

Extensions (Marins, Villes & Chevaliers), plateau personnalisé, parties à plus de 4 joueurs, spectateurs, classements en ligne.

## 8. Définition de « terminé » pour chaque fonctionnalité

1. Le moteur la gère avec un test qui échoue sans elle.
2. L'interface l'expose via `available()`, jamais par un `if` de règle dupliqué.
3. Elle est décrite dans `RULES.md` si elle touche aux règles.
4. `npm test` et `node build.mjs` passent, et la page publiée a été relue une fois.
