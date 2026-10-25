---
name: catan-rules
description: Règles de référence du jeu « Au temps béni des colonies » (jeu de base inspiré de Catan) et contrat du moteur src/engine.js. À consulter pour toute question de règle, de coût, de cas limite (voleur, ports, plus longue route, cartes de développement) ou avant d'ajouter une action au moteur.
---

# Au temps béni des colonies — règles et contrat moteur

1. Lis `RULES.md` à la racine du projet : c'est la référence des règles implémentées.
2. Lis `CLAUDE.md` pour l'architecture et les interdits.
3. Pour un cas limite, écris d'abord le test dans `test/engine.test.mjs`, puis corrige `src/engine.js`.

## Machine à états (`state.phase` / `state.step`)
- `color`: `pickColor` (chacun une couleur libre parmi `COLORS`, `player.color` vaut `null` avant).
- `order`: `rollOrder` (un dé chacun, `state.order.pending`). `state.order.groups` range les joueurs du plus grand dé au plus petit ; un groupe de plusieurs = égalité, ses membres relancent entre eux.
- `setup`: `settlement` → `road`, du plus grand dé au plus petit puis en sens inverse (`state.setup.order`).
- `main`: `roll` → (`discard`) → (`robber` → `steal`) → `actions` ; `roadBuilding` pendant la carte du même nom.
- `ended`: `state.winner` renseigné.

## Actions (champ `player` obligatoire)
`pickColor{color}`, `rollOrder`, `roll`, `discard{cards}`, `moveRobber{hex}`, `steal{victim}`, `placeSettlement{vertex}`, `placeCity{vertex}`, `placeRoad{edge}`, `buyDev`, `playKnight`, `playRoadBuilding`, `playYearOfPlenty{a,b}`, `playMonopoly{res}`, `bankTrade{give,get}`, `offerTrade{give,want}`, `respondTrade{accept}`, `confirmTrade{with}`, `cancelTrade`, `endTurn`.

## Cas limites à toujours tester
- 7 avec plusieurs joueurs à défausser, puis vol sans victime possible.
- Banque à court d'une ressource (un seul bénéficiaire / plusieurs).
- Route coupée par une colonie adverse ; égalité pour la plus longue route.
- Carte de développement achetée et jouée le même tour (refusée) ; point de victoire (accepté, caché).
- Port 2:1 vs 3:1 vs 4:1 sur la même partie.
