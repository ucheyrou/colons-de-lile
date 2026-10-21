# Colons de l'Île

Jeu de plateau de colonisation en ligne, inspiré des règles de base de Catan (nom et visuels originaux).
Le plateau s'affiche sur un ordinateur ou une télé, chaque joueur voit sa main privée sur son téléphone.
Aucun compte, aucun serveur à payer : une page statique et un courtier MQTT public.

## Jouer

Site : https://ucheyrou.github.io/colons-de-lile/

1. Ouvre le site sur l'ordinateur et choisis « Plateau sur cet écran ».
2. Les joueurs scannent le QR code avec leur téléphone, entrent leur prénom, et c'est parti.
3. Sans téléphones : « Un seul écran pour tous ».

Les échanges entre appareils sont chiffrés de bout en bout (ECDH P-256 + AES-GCM) : le courtier public ne voit passer que des messages illisibles.

## Développer

```
node build.mjs                  # produit docs/index.html (site) et dist/index.html (artefact Claude)
node --test test/*.test.mjs     # tests du moteur et du réseau
node test/simulate.mjs 200      # parties aléatoires, invariants
node test/mqtt-live.mjs         # client MQTT contre les courtiers publics (réseau)
```

Voir `PLAN.md` (architecture et phases), `CLAUDE.md` (consignes pour les agents) et `RULES.md` (règles implémentées).
