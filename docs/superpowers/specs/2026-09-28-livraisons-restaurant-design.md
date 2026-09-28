# Livraisons du dépôt au restaurant : stock et consommation du restaurant

- **Date** : 2026-09-28
- **Demande de la Direction** : « j'aimerais que les sorties de stock notées dans l'onglet Mouvements aillent directement dans le stock du restaurant » ; « et dans consommation aussi ».
- **Décision de la Direction (2026-09-28)** : seules les sorties dont le motif est **Livraison restaurant** (`MouvementStock.categorieSortie = "LIVRAISON_RESTAURANT"`) alimentent le stock et la consommation du restaurant. Les sorties **Perte** restent au dépôt et s'affichent à part.
- **Dépend de** : le rattachement `ArticleResto.articleStockId` (déployé le 2026-09-24, 26 propositions à accepter, aucun rattachement en production aujourd'hui). La grille du restaurant (`ComptageResto`) n'a jamais été remplie. Aucune sortie n'a été saisie au dépôt depuis juillet.

## Principe : le comptage reste la vérité du terrain

On n'écrit JAMAIS de comptage à partir d'une sortie. Un comptage, c'est ce qu'une personne a compté sur place. Le stock du restaurant devient une **valeur dérivée**, recalculée à l'affichage :

> **stock théorique du restaurant (article R, jour J)** = dernier comptage de R à une date C ≤ J + Σ des livraisons du dépôt vers R datées de (C, J], converties dans l'unité de R.

Précisions :
- Le jour du comptage lui-même, le comptage fait foi (on suppose qu'il est fait après les livraisons du jour). Documente ce choix.
- Sans aucun comptage, le stock théorique vaut la somme de toutes les livraisons, avec la mention « aucun comptage : stock estimé à partir des seules livraisons ».
- Une livraison d'un article du catalogue rattaché à PLUSIEURS articles du restaurant n'est pas répartie au hasard. Elle est signalée « à répartir », et la Direction choisit le rattachement unique. Un article du catalogue ne doit mener qu'à un seul article du restaurant par espace (CUISINE / BAR) pour recevoir des livraisons.
- Une unité impossible à convertir (`facteur()`, emballages compris, comme pour la disponibilité) n'est pas additionnée. La livraison est signalée « unité incompatible », jamais convertie au hasard.
- Une sortie « Livraison restaurant » d'un article du catalogue non rattaché reste signalée « non rattaché : n'alimente pas le restaurant », avec un lien vers le rattachement.

## 1. Fonction pure `src/lib/stock-restaurant.ts`

`stockRestaurantTheorique(entrees, jour)` reçoit les comptages et les livraisons déjà converties, et rend, par article du restaurant :
- le stock théorique ;
- la date du dernier comptage ;
- les livraisons depuis ce comptage ;
- les signalements (unité incompatible, à répartir, aucun comptage).

`consommationReelle(article, jour)` = stock de la veille (compté, sinon théorique) + livré le jour J − stock compté le jour J. Le résultat n'existe que si un comptage existe le jour J ; sinon il vaut « — », jamais 0. Une consommation négative est signalée (« écart : plus compté que reçu »), jamais masquée.

Chargement groupé : une requête pour les comptages, une pour les livraisons de la période, une pour les rattachements. Aucune requête par article.

## 2. Écrans

- **Stock → Restaurant (grille)** : par jour, une ligne ou colonne « Reçu du dépôt » en lecture seule, à côté du comptage saisi. Une colonne « Stock théorique » affiche l'état courant. Les signalements sont visibles. Le comptage reste la seule saisie (case partagée `CelluleNombre`).
- **Conso. journalière** :
  - Onglet **Consommation** : il montre déjà les sorties datées. Il distingue désormais « Livré au restaurant » (motif Livraison restaurant) et « Pertes » (motif Perte), et ajoute la **consommation réelle** quand un comptage existe.
  - Onglet **Comparaison** : il met côte à côte commandé, livré et consommé, avec les écarts (livré non consommé, consommé plus que livré).
  - Les exports PDF et Excel de ces onglets suivent.
- **Stock → Mouvements** : à la saisie d'une sortie « Livraison restaurant » d'un article non rattaché, ou à l'unité incompatible, un avertissement non bloquant s'affiche : « cette livraison n'alimentera pas le stock du restaurant : rattachez l'article ».

## 3. Disponibilité des plats

Le stock qui fait foi reste **dépôt + restaurant** (décision du 2026-09-24). La part du restaurant devient le **stock théorique**. Une livraison retire donc la quantité du dépôt et l'ajoute au restaurant : le total est inchangé, sans double compte. Un test le prouve.

La règle des 7 jours (« stock non mis à jour ») s'applique ainsi à la part du restaurant : la date prise en compte est le plus récent du dernier comptage ou de la dernière livraison.

## Tests exigés (chaque garde-fou falsifié : casse, rouge, restauration depuis une copie, `cmp`)

- **Stock théorique** : comptage seul ; comptage suivi de livraisons ; livraison le jour du comptage (le comptage fait foi) ; aucune livraison ; aucun comptage ; conversion g/kg et emballage ; unité incompatible ; plusieurs rattachements (à répartir) ; sortie Perte ignorée ; article non rattaché ignoré et signalé.
- **Consommation réelle** : cas nominal ; jour sans comptage (« — ») ; consommation négative signalée.
- **Pas de double compte** : dépôt + restaurant avant et après une livraison, total égal.
- **Écrans** : colonne « Reçu du dépôt » en lecture seule ; onglet Consommation qui sépare livrés et pertes ; avertissement dans Mouvements.

## Hors périmètre

- Réservation ou déduction automatique des portions vendues (pas de caisse par plat).
- Réécriture des comptages ou de `Stock.quantite`.
- Rattachement automatique : il reste un geste de la Direction.
