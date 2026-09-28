# Livraisons du dépôt au restaurant — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** les sorties « Livraison restaurant » alimentent, À L'AFFICHAGE, le stock théorique et la consommation réelle du restaurant, sans jamais écrire un comptage ni `Stock.quantite`.

**Architecture :** un module pur `src/lib/stock-restaurant.ts` (attribution des livraisons, stock théorique, consommation réelle, part du restaurant pour la disponibilité) ; un chargeur groupé `src/lib/stock-restaurant-charger.ts` (server-only, 4 requêtes au plus, jamais par article) ; les écrans (Restaurant, Conso. journalière et ses exports, Mouvements) et la disponibilité des plats ne font que lire ces résultats.

**Tech Stack :** Next.js App Router, React 19, Prisma 7, decimal.js, vitest (+ happy-dom, Postgres embarqué pour l'intégration).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-09-28-livraisons-restaurant-design.md` (source de vérité).
- Aucune écriture de comptage ou de stock déduite automatiquement : tout est dérivé à l'affichage.
- Rien n'est deviné : ni rattachement, ni conversion d'unité (`facteur()` + emballages, comme la disponibilité), ni répartition.
- Le jour du comptage, le comptage fait foi (supposé fait après les livraisons du jour).
- « — » pour une valeur inconnue, jamais 0. Messages renvoyés comme une valeur, jamais levés.
- Chargements groupés, jamais une requête par article. Aucune nouvelle `route.ts` (sinon garde `requireModule(user, "stock")`).
- Harmonie des composants (`CelluleNombre` reste la seule saisie), aucun débordement horizontal de page à 375 px (les grilles défilent dans leur cadre).
- Chaque garde-fou est falsifié : casse, rouge, restauration depuis une copie, `cmp`.
- Tests : `DIRECT_URL=… DATABASE_URL=… npx vitest run <fichier> --maxWorkers=2`.

**Lecture retenue de la spec (à signaler) :** « rattaché à PLUSIEURS articles du restaurant → à répartir » s'applique tous espaces confondus : un article du catalogue rattaché à une ligne Cuisine ET à une ligne Bar est « à répartir » (on ne choisit pas l'espace d'après le domaine de l'article).

---

### Task 1 : stock théorique du restaurant (fonction pure)

**Files :**
- Create : `src/lib/stock-restaurant.ts`, `src/lib/stock-restaurant.test.ts`
- Modify : `src/lib/fiches/disponibilite.ts` (export `convertirDepuisUniteArticle`, inverse EXACT de `versUniteArticle`)

**Interfaces — Produces :**
```ts
export type ArticleRestoSR = { id: string; designation: string; espace: "CUISINE" | "BAR"; unite: string | null; articleStockId: string | null };
export type ComptageSR = { articleRestoId: string; date: string; quantite: string };
export type LivraisonSR = { id: string; articleStockId: string; designation: string; uniteCatalogue: string | null; date: string; quantite: string; categorieSortie: string | null };
export type EntreesStockResto = { articles: ArticleRestoSR[]; comptages: ComptageSR[]; livraisons: LivraisonSR[] };
export type EtatRattachement = { etat: "OK"; articleRestoId: string } | { etat: "NON_RATTACHE" } | { etat: "A_REPARTIR"; articleRestoIds: string[] } | { etat: "UNITE_INCOMPATIBLE"; articleRestoId: string };
export function etatRattachementLivraison(articleStockId: string, uniteCatalogue: string | null, articles: ArticleRestoSR[]): EtatRattachement;
export function stockRestaurantTheorique(e: EntreesStockResto, jour: string): { parArticle: Map<string, StockTheorique>; nonRattachees: LivraisonSR[] };
export function recuDuDepot(e: EntreesStockResto, articleRestoId: string, jour: string): { quantite: string | null; signalements: SignalementLivraison[] };
```

- [ ] Tests rouges : comptage seul ; comptage + livraisons ; livraison le jour du comptage (le comptage fait foi) ; aucune livraison ; aucun comptage (somme des livraisons + mention) ; g/kg et emballage « 500 GR » ; unité incompatible (non additionnée, signalée) ; plusieurs rattachements (« à répartir ») ; sortie Perte ignorée ; article non rattaché ignoré et listé.
- [ ] Implémentation minimale, tests verts, falsification de la règle « le comptage fait foi le jour même » et de l'exclusion des pertes.
- [ ] Commit `feat(stock-resto): stock théorique du restaurant dérivé des livraisons du dépôt`.

### Task 2 : consommation réelle (fonction pure)

**Files :** Modify `src/lib/stock-restaurant.ts`, `src/lib/stock-restaurant.test.ts`

**Interfaces — Produces :**
```ts
export type ConsommationReelle =
  | { etat: "CONNUE"; quantite: string; negative: boolean; veilleEstimee: boolean }
  | { etat: "INCONNUE"; raison: "PAS_DE_COMPTAGE" | "STOCK_VEILLE_INCONNU" | "LIVRAISON_NON_COMPTEE" };
export function consommationReelle(e: EntreesStockResto, articleRestoId: string, jour: string): ConsommationReelle;
export const ECART_NEGATIF = "écart : plus compté que reçu";
```
- [ ] Tests rouges : cas nominal (veille comptée) ; veille théorique ; jour sans comptage → INCONNUE ; consommation négative signalée ; livraison incompatible le jour J → INCONNUE.
- [ ] Implémentation, verts, falsification (signe de la formule, « — » au lieu de 0), commit `feat(stock-resto): consommation réelle du restaurant`.

### Task 3 : disponibilité des plats = dépôt + stock théorique, chargeur groupé

**Files :**
- Create : `src/lib/stock-restaurant-charger.ts` (+ `.integration.test.ts`)
- Modify : `src/lib/fiches/disponibilite.ts` (état `A_REPARTIR`, motif `LIVRAISON_A_REPARTIR`), `src/lib/stock-restaurant.ts` (`stockRestaurantPourDisponibilite`), `src/app/(stock)/stock/fiches/_data/charger-fiche.ts`, son test d'intégration, `disponibilite-fiche.tsx` (libellé).

**Interfaces — Produces :**
```ts
export function stockRestaurantPourDisponibilite(e: EntreesStockResto, unitesCatalogue: Map<string, string>, jour: string): Map<string, StockRestaurant>;
export async function chargerEntreesStockResto(o: { depuis: string; jusquA: string }): Promise<EntreesStockResto>;
export async function chargerStocksDesFiches(aujourdhui?: string): Promise<Record<string, StockArticle>>;
```
- [ ] Test rouge « pas de double compte » : dépôt 10 kg + resto 2 kg avant ; livraison 3 kg (dépôt 7) → total 12 avant et après.
- [ ] Test rouge : date de référence (règle des 7 jours) = plus récente du comptage et de la dernière livraison ; livraison à répartir → À vérifier.
- [ ] Chargeur : comptages (max par article avant `depuis` + ceux de la période), livraisons (une requête), articles (une requête) ; test d'intégration qui compte les requêtes.
- [ ] Falsifications, commit `feat(fiches): la part du restaurant devient le stock théorique (livraisons comprises)`.

### Task 4 : écran Stock → Restaurant

**Files :** Modify `src/app/(stock)/stock/restaurant/page.tsx`, `restaurant-client.tsx` ; Create `restaurant-client.rendus.test.tsx`.

- [ ] Test rouge (happy-dom) : dans chaque case jour, « Reçu du dépôt » s'affiche en LECTURE SEULE (aucun `input` supplémentaire, `CelluleNombre` reste la seule saisie) ; colonne « Stock théorique » avec « — » si inconnu et mention « aucun comptage » ; signalements visibles.
- [ ] Page : bandeau des signalements (non rattachées avec lien, à répartir, unité incompatible) ; falsification ; commit `feat(stock-resto): reçu du dépôt et stock théorique dans la grille du restaurant`.

### Task 5 : Conso. journalière — onglet Consommation et ses exports

**Files :** Create `src/app/(stock)/stock/journalier/donnees-restaurant.ts` (server-only), `src/lib/journalier-sorties.ts` (+ test) ; Modify `page.tsx`, `export-data.ts`.

**Interfaces — Produces :**
```ts
export type LigneJours = { id: string; designation: string; jours: number[]; total: number };
export function sortiesParMotif(sorties: { articleId: string; designation: string; date: string; quantite: number; categorieSortie: string | null }[], jours: string[]): { livraisons: LigneJours[]; pertes: LigneJours[]; sansMotif: LigneJours[] };
```
- [ ] Test rouge : livrés, pertes et sorties sans motif séparés ; consommation réelle « — » sans comptage, négative signalée.
- [ ] Page + export PDF/Excel ; falsification ; commit `feat(journalier): consommation sépare livré au restaurant et pertes, ajoute la consommation réelle`.

### Task 6 : Conso. journalière — onglet Comparaison et ses exports

**Files :** Modify `page.tsx`, `export-data.ts`, `src/lib/journalier-sorties.ts` (+ test).

- [ ] Test rouge : écarts « livré non consommé » / « consommé plus que livré » ; consommé inconnu → « — », pas d'écart.
- [ ] C / L / Conso par jour, L = livraisons restaurant seulement (sorties sans motif annoncées à part) ; commit `feat(journalier): comparaison commandé / livré / consommé avec écarts`.

### Task 7 : Mouvements — avertissement non bloquant

**Files :** Modify `src/app/(stock)/stock/mouvements/page.tsx`, `mouvements-client.tsx` ; Create `mouvements-client.rendus.test.tsx`.

- [ ] Test rouge : motif « Livraison restaurant » + article non rattaché (ou unité incompatible, ou plusieurs rattachements) → avertissement ; motif Perte → rien ; le bouton reste actif.
- [ ] Falsification ; commit `feat(mouvements): avertit qu'une livraison n'alimentera pas le restaurant`.

### Task 8 : vérification finale

- [ ] Suite complète `npx vitest run --maxWorkers=2`, `npx tsc --noEmit`, `npm run build`.
