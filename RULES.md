# Règles implémentées (référence moteur)

Jeu de base, 3 à 4 joueurs. Premier à **10 points de victoire**, vérifié pendant son propre tour.

## Matériel
- 19 hexagones : 4 forêt (bois), 4 pâturage (laine), 4 champs (blé), 3 collines (argile), 3 montagnes (minerai), 1 désert.
- 18 jetons numérotés : 2, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12. Le désert n'a pas de jeton, le voleur y commence.
- **Pose du plateau comme au jeu réel** : les 19 tuiles sont mélangées, puis les jetons A à R (5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11) sont posés en spirale depuis un coin de la côte tiré au hasard, dans un sens tiré au hasard, vers l'intérieur, en sautant le désert. Si deux 6/8 se touchaient malgré tout, le tirage est refait.
- Les ports occupent un cadre fixe (espacement 3-3-4 sur les 30 arêtes de la côte) ; seuls leurs types sont mélangés.
- 9 ports : 4 génériques (3 contre 1), 5 spécialisés (2 contre 1 pour une ressource).
- Banque : 19 cartes de chaque ressource.
- Pièces par joueur : 15 routes, 5 colonies, 4 villes.
- Cartes de développement (25) : 14 chevaliers, 5 points de victoire, 2 construction de routes, 2 invention, 2 monopole.

## Coûts
| Pièce | Coût | Points |
|---|---|---|
| Route | 1 bois, 1 argile | 0 |
| Colonie | 1 bois, 1 argile, 1 laine, 1 blé | 1 |
| Ville (remplace une colonie) | 2 blé, 3 minerai | 2 |
| Carte de développement | 1 laine, 1 blé, 1 minerai | — |

## Mise en place
Chacun choisit d'abord sa couleur parmi six (rouge, bleu, orange, blanc, vert, violet) ; une couleur prise n'est plus disponible.
Chacun lance ensuite un dé, dans n'importe quel ordre. On classe les joueurs du plus grand dé au plus petit ; les ex aequo, à n'importe quel rang, relancent entre eux jusqu'à être départagés.
Chacun pose ensuite colonie puis route, dans l'ordre de ce classement, puis en sens inverse (le premier pose donc aussi la dernière colonie). La route touche la colonie qui vient d'être posée. La seconde colonie rapporte une carte par hexagone voisin. Le premier à avoir posé joue le premier tour.

## Tour de jeu
1. **Dés.** Avant de les lancer, on peut jouer une carte de développement (un chevalier par exemple).
2. **Production.** Chaque colonie voisine d'un hexagone portant le numéro tiré rapporte 1 carte, chaque ville 2. Un hexagone occupé par le voleur ne produit pas. Si la banque n'a pas assez d'une ressource : s'il y a un seul bénéficiaire il reçoit ce qui reste, sinon personne ne reçoit cette ressource.
3. **Sur un 7.** Pas de production. Chacun avec plus de 7 cartes en défausse la moitié (arrondie en bas). Le joueur actif déplace le voleur sur un autre hexagone et vole une carte au hasard à un joueur ayant une construction voisine.
4. **Actions**, dans n'importe quel ordre : échanger, construire, acheter ou jouer une carte.
5. **Fin du tour.**

## Pose
- Colonie : sommet libre, aucune construction sur les sommets voisins (règle de distance), reliée à une de ses routes.
- Route : arête libre, reliée à une de ses routes ou constructions. Une colonie ou ville adverse sur un sommet coupe la continuité.
- Ville : sur une de ses colonies.

## Échanges
- Banque : 4 contre 1, 3 contre 1 avec un port générique, 2 contre 1 avec le port de la ressource.
- Joueurs : le joueur actif propose (il donne X, veut Y), les autres acceptent ou refusent, il conclut avec l'un des acceptants. Seul le joueur actif peut proposer ; les échanges se font toujours avec lui.

## Cartes de développement
- Achetée un tour, jouée au plus tôt le suivant. Une seule carte jouée par tour (les points de victoire ne comptent pas comme « jouées »).
- **Chevalier** : déplace le voleur et vole. Le nombre de chevaliers joués compte pour l'armée.
- **Construction de routes** : 2 routes gratuites.
- **Invention** : prendre 2 cartes de son choix à la banque.
- **Monopole** : nommer une ressource, tous les autres joueurs en donnent toutes leurs cartes.
- **Point de victoire** : reste caché, compte pour la victoire.

## Bonus
- **Plus longue route** (2 pts) : chaîne continue d'au moins 5 routes. Pour la prendre il faut en avoir strictement plus que le détenteur. Si un joueur la perd par coupure et que plusieurs sont à égalité sans détenteur, personne ne l'a.
- **Plus grande armée** (2 pts) : au moins 3 chevaliers joués, strictement plus que le détenteur.

## Simplifications V1
- Pas de limite de temps ni de règle de « jeu rapide ».
- Pas de retour en arrière (annuler).
- Échanges entre deux joueurs non actifs interdits (règle officielle).
