# Fiches techniques (plats) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à l'espace Stock un module « Fiches techniques » (plats) : recettes → coût de revient récursif (ingrédients = articles Stock ou sous-recettes), marges, prix conseillé, + import du classeur.

**Architecture:** Nouveaux modèles `FicheTechnique` + `IngredientFiche` dans le schéma Prisma `stock` (FK réelle vers `ArticleStock`, self-relation pour sous-recette). Moteur de coût PUR récursif en `Decimal.js` (arrondi unique en sortie). Écrans clonés du gabarit `stock/fournisseurs/`. Import idempotent du classeur.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 (`@@schema("stock")`), Vitest + embedded-postgres, helpers `usd()`/`qte()` (`src/lib/stock.ts`), `dec`/`decOptionnel` (`src/lib/nombre.ts`).

## Global Constraints

- **Devise** : coût de revient en **USD HT** ; prix article = `ArticleStock.prixUnitaireUSD` (peut être `null`). Afficher via `usd()` de `src/lib/stock.ts` (PAS `montant.ts`). Lire les saisies via `dec`/`decOptionnel` de `src/lib/nombre.ts`.
- **Précision** : calculs en **`Decimal` pleine précision** (biblio `decimal.js`, déjà dépendance Prisma), **arrondi UNIQUE au centime en sortie**. Tests golden en **égalité exacte** (pas de tolérance ±0,01).
- **« cl » d'une sous-recette = GRAMME** (densité 1). JAMAIS de conversion volume sur un `sousFicheId`. Rendement stocké en `g`.
- **`PRIX à l'unité` = vérité** ; le prix carton est dérivé ; `uniteParCarton` ne sert qu'aux unités-emballage.
- **Coût incomplet ANNONCÉ** : un ingrédient sans prix (article `prixUnitaireUSD = null`) ou d'unité inconvertible rend la fiche « coût partiel » avec la liste des ingrédients en cause — **jamais** compté 0.
- **Un nom = une formule** : `tauxMarque` = margeBrute/prixVenteHT ; `ratioMatiere` = coût/prixVenteHT ; `coefficient` = prixVenteHT/coût. Mode de saisie par défaut = **coefficient-driven**.
- **Cloisonnement** : chaque action `verifySession()` + `requireModule(user,"stock")` + `actionLisible` + `journaliser` + `revalidatePath`.
- **RLS** : `ALTER TABLE "stock"."<T>" ENABLE ROW LEVEL SECURITY;` (sans policy) **dans la migration de création** (jamais en rattrapage).

---

## Task 1 : Schéma `FicheTechnique` + `IngredientFiche` + migration + RLS

**Files:**
- Modify: `prisma/schema.prisma` (schéma `stock` ; nouveaux modèles + enum ; réverses sur `ArticleStock`)
- Create: `prisma/migrations/<ts>_fiches_techniques/migration.sql`
- Test: `src/lib/fiches/schema.integration.test.ts`

**Interfaces:**
- Produces : modèles `FicheTechnique`, `IngredientFiche` ; enum `TypeFiche { PLAT, BAR }`.

Modèles (patron self-relation calqué sur `EchangeCreneau`, cf. recon Stock) :
```prisma
enum TypeFiche { PLAT BAR  @@schema("stock") }

model FicheTechnique {
  id            String  @id @default(uuid())
  nom           String
  categorie     String?
  type          TypeFiche @default(PLAT)
  nbPortions    Int       @default(1)
  tauxTVA       Decimal   @default(0.16) @db.Decimal(5,4)
  prixVenteTTC        Decimal? @db.Decimal(12,4)
  coefficientMargeCible Decimal? @db.Decimal(8,4)
  estSousRecette Boolean  @default(false)
  rendementQuantite Decimal? @db.Decimal(14,3) // en unité de base (g pour une sauce)
  rendementUnite    String?  // "g", "L", "portion"…
  recette       String?  @db.Text
  actif         Boolean  @default(true)
  creeLe        DateTime @default(now())
  majLe         DateTime @updatedAt
  ingredients   IngredientFiche[] @relation("FicheIngredients")
  utiliseeDans  IngredientFiche[] @relation("SousRecette")
  @@schema("stock")
}

model IngredientFiche {
  id          String @id @default(uuid())
  ficheId     String
  fiche       FicheTechnique @relation("FicheIngredients", fields: [ficheId], references: [id], onDelete: Cascade)
  articleId   String?
  article     ArticleStock?  @relation(fields: [articleId], references: [id], onDelete: Restrict)
  sousFicheId String?
  sousFiche   FicheTechnique? @relation("SousRecette", fields: [sousFicheId], references: [id], onDelete: Restrict)
  unite       String   // unité de consommation
  quantite    Decimal  @db.Decimal(14,3)
  ordre       Int      @default(0)
  @@index([ficheId]) @@index([articleId]) @@index([sousFicheId])
  @@schema("stock")
}
```
Ajouter le réverse `fichesIngredient IngredientFiche[]` sur `ArticleStock`.

- [ ] **Step 1 : Test** — écrire `schema.integration.test.ts` (via `creerBaseTest`, `await ctx.fermer()`) : créer un `ArticleStock`, une `FicheTechnique`, un `IngredientFiche` article + un `IngredientFiche` sousFiche ; asserter `prisma.ficheTechnique.count()===2`, l'ingrédient article a `articleId` non null / `sousFicheId` null, et l'inverse pour le sous-fiche.
- [ ] **Step 2 : Lancer — échoue** (`npm test -- fiches/schema`).
- [ ] **Step 3 : Schéma** — ajouter enum + modèles + réverse `ArticleStock`, `npx prisma generate`.
- [ ] **Step 4 : Migration** — écrire à la main `<ts>_fiches_techniques/migration.sql` : `CREATE TABLE` des 2 tables + FK (`articleId`→`ArticleStock` ON DELETE RESTRICT ; `ficheId`→`FicheTechnique` ON DELETE CASCADE ; `sousFicheId`→`FicheTechnique` ON DELETE RESTRICT) + index, PUIS `ALTER TABLE "stock"."FicheTechnique" ENABLE ROW LEVEL SECURITY;` et idem `"stock"."IngredientFiche"`. Générer le DDL via `prisma migrate diff` sur un Postgres jetable (jamais la prod) ; ne jamais lancer `migrate dev/deploy` contre Supabase.
- [ ] **Step 5 : PASS + commit** (`npm test -- fiches/schema` ; `git add prisma/ src/lib/fiches/schema.integration.test.ts`).

---

## Task 2 : Utilitaire de conversion d'unités `src/lib/fiches/conversion.ts`

**Files:** Create `src/lib/fiches/conversion.ts` ; Test `src/lib/fiches/conversion.test.ts`.

**Interfaces:**
- Produces : `normaliserUnite(u): string` ; `poidsEmballage(unite): Decimal | null` (parse « 500 GR »→0.5 kg, « 1 KG »→1) ; `facteur(uniteSource, uniteCible): Decimal | null` (`null` = incompatible). Masse kg↔g ×1000 ; volume L↔cl ×100, L↔ml ×1000, cl↔ml ×10 ; comptage (pièce/unité/bouteille/boîte/paquet) = match exact, facteur 1 sinon `null`.

- [ ] **Step 1 : Tests (échouent)**
```ts
import Decimal from "decimal.js";
import { facteur, poidsEmballage, normaliserUnite } from "@/lib/fiches/conversion";
it("kg → g = 1000", () => expect(facteur("Kg","g")!.toString()).toBe("1000"));
it("Kg == kg (casse)", () => expect(normaliserUnite("Kg")).toBe("kg"));
it("volume L → cl = 100", () => expect(facteur("L","cl")!.toString()).toBe("100"));
it("pièce → g incompatible = null", () => expect(facteur("Pièce","g")).toBeNull());
it("unité-emballage 500 GR = 0,5 kg", () => expect(poidsEmballage("500 GR")!.toString()).toBe("0.5"));
```
- [ ] **Step 2 : Lancer — échoue.**
- [ ] **Step 3 : Implémenter** (tables de facteurs masse/volume + parse regex `(\d+)\s*(GR|KG|G)` pour l'emballage ; normalisation trim/minuscule).
- [ ] **Step 4 : PASS + commit** (`npm test -- fiches/conversion`).

---

## Task 3 : Moteur de coût de revient `src/lib/fiches/cout.ts` (PUR, récursif, Decimal)

**Files:** Create `src/lib/fiches/cout.ts` ; Test `src/lib/fiches/cout.test.ts`.

**Interfaces:**
- Consomme des données dénormalisées (aucun accès Prisma) : `FicheCalc = { id, nbPortions, tauxTVA, prixVenteTTC?, coefficientMargeCible?, estSousRecette, rendementQuantite?, rendementUnite?, ingredients: IngredientCalc[] }` ; `IngredientCalc = { unite, quantite, article?: { prixUnitaireUSD: number|null, unite: string, uniteParCarton?: number|null }, sousFiche?: FicheCalc }`.
- Produces : `calculerCout(fiche, { fiches: Map<id,FicheCalc> }): ResultatCout` = `{ coutTotal: Decimal, coutParPortion: Decimal, incomplet: boolean, ingredientsSansPrix: string[], coefficient: number|null, prixVenteHT: number|null, prixVenteTTC: number|null, tauxMarque: number|null, ratioMatiere: number|null, margeBrute: number|null, prixConseille: {ht,ttc}|null, cycle: boolean }`. Tous les montants monétaires **arrondis au centime en sortie** ; les calculs internes en `Decimal`.

**Règles (spec §6 + §12) :**
- Coût ingrédient **article** = `quantite × prixConverti`, où `prixConverti = prixUnitaireUSD × facteur(unite consommée → article.unite)` — si `prixUnitaireUSD` null → ingrédient **sans prix** (ajouté à `ingredientsSansPrix`, non compté) ; si `facteur` null (unité-emballage : diviser par `poidsEmballage`; sinon incompatible) → sans prix.
  > ⚠️ **Sens du facteur — corrigé après la Task 3 (la première rédaction était fausse).** `facteur` de `conversion.ts` convertit des **quantités** (1 kg = 1000 g). Le prix étant exprimé **par unité d'achat**, il faut convertir la quantité consommée **vers l'unité d'achat**, donc `facteur(unite consommée → article.unite)`. Exemple : 3 000 g d'un article à **2,99 $/kg** = `3000 × (2,99 × facteur(g→kg) = 0,00299)` = **8,97 $**. Le sens inverse donnerait `3000 × 2 990` = **8 970 000 $**. Le cas T1 (kg→kg, facteur 1) ne distingue pas les deux : ne pas s'y fier.
- Coût ingrédient **sous-fiche** = `quantite × (coûtTotalSousFiche / rendementQuantite)` — **AUCUNE conversion d'unité** (rendement et conso dans la même unité de base, densité 1). Récursif via `fiches` map. **Détection de cycle** : passer un `Set<id>` en cours de calcul ; si `fiche.id` déjà dedans → `cycle=true`, coût indéterminé.
  > Corollaire (ajouté après relecture) : puisqu'on ne convertit rien, `rendementUnite` et l'unité de consommation **doivent** désigner la même unité de base. `rendementQuantite: 4,6` + `rendementUnite: "kg"` consommé en « g » est un ×1000 silencieux → ligne indéterminée (`UNITE_RENDEMENT_INCOHERENTE`), jamais un chiffre. La règle « cl = gramme » n'est pas touchée (`facteur("cl","g")` vaut `null`).
- `coutTotal = Σ ingrédients` ; `coutParPortion = coutTotal / nbPortions`.
- Si `prixVenteTTC` fourni : `prixVenteHT = prixVenteTTC/(1+tauxTVA)` ; `coefficient = prixVenteHT/coutParPortion` ; `tauxMarque = (prixVenteHT−coutParPortion)/prixVenteHT` ; `ratioMatiere = coutParPortion/prixVenteHT` ; `margeBrute = prixVenteHT−coutParPortion`.
- Si `coefficientMargeCible` fourni : `prixConseille.ht = coutParPortion × coefficient` ; `.ttc = ×(1+tauxTVA)`.
- `incomplet = ingredientsSansPrix.length>0 || cycle`.

- [ ] **Step 1 : Tests (échouent)** — les 4 cas Yukihira, **égalité exacte** :
```ts
// T1 : article + conversion masse
it("coût ingrédient article", () => {
  const r = calculerCout(fiche([{ quantite: 0.2, unite: "kg", article: { prixUnitaireUSD: 8.07, unite: "kg" } }]), CTX_VIDE);
  expect(r.coutTotal.toFixed(2)).toBe("1.61"); // 1,614 → 1,61
});
// T2 : sous-recette au gramme
it("sous-recette au gramme (pas de conversion volume)", () => {
  const sauce = ficheSousRecette({ rendementQuantite: 4600, ingredients: INGREDIENTS_SAUCE }); // total 56,8237, rendement 4600 g
  const plat = fiche([{ quantite: 200, unite: "g", sousFiche: sauce }]);
  expect(calculerCout(plat, mapAvec(sauce)).coutTotal.toFixed(4)).toBe("2.4706");
});
// T3 : golden Bolognaise = 2,54 exact
it("golden Bolognaise", () => {
  const r = calculerCout(BOLOGNAISE, MAP_AVEC_SAUCE); // sauce 200 g + penne 0,2 kg × 0,35
  expect(r.coutParPortion.toFixed(2)).toBe("2.54");
});
// T4 : marge / taux de marque
it("marge et taux de marque", () => {
  const r = calculerCout(ficheAvecPrix({ coutParPortion: 2.53, coefficient: 8, tauxTVA: 0.16 }), CTX_VIDE);
  expect(r.prixVenteHT).toBe(20.24); expect(r.margeBrute).toBe(17.71);
  expect(r.prixVenteTTC).toBe(23.48); expect(r.tauxMarque).toBeCloseTo(0.875, 3);
  expect(r.ratioMatiere).toBeCloseTo(0.125, 3);
});
it("coût incomplet annoncé si prix null", () => {
  const r = calculerCout(fiche([{ quantite: 1, unite: "kg", article: { prixUnitaireUSD: null, unite: "kg" } }]), CTX_VIDE);
  expect(r.incomplet).toBe(true); expect(r.ingredientsSansPrix.length).toBe(1); expect(r.coutTotal.toNumber()).toBe(0);
});
it("détecte un cycle", () => { /* A contient B contient A → r.cycle === true */ });
```
- [ ] **Step 2 : Lancer — échoue.**
- [ ] **Step 3 : Implémenter** en `Decimal`, récursif + Set anti-cycle, arrondi centime en sortie.
- [ ] **Step 4 : PASS + commit** (`npm test -- fiches/cout`).

---

## Task 4 : Écrans `stock/fiches/` (liste + fiche + ingrédients) + nav

**Files:**
- Create: `src/app/(stock)/stock/fiches/page.tsx` + `fiches-client.tsx` + `actions.ts` + `[id]/page.tsx` + `[id]/editer-fiche.tsx`
- Create: `src/app/(stock)/stock/fiches/_data/charger-fiche.ts` (Prisma → `FicheCalc` pour le moteur, résout récursivement les sous-fiches)
- Modify: `src/app/(stock)/stock-shell.tsx` (NAV_GROUPS, groupe « Restaurant », icône `document`)

**Interfaces:**
- Consomme : `calculerCout` (Task 3), `ArticleStock` (recon Stock), gabarit `stock/fournisseurs/`.
- Produces : actions `creerFiche`, `modifierFiche`, `supprimerFiches(ids)`, `dupliquerFiche(id)`, `ajouterIngredient`, `modifierIngredient`, `supprimerIngredient`.

- [ ] **Step 1 : Nav + liste** — ajouter `{ href: "/stock/fiches", label: "Fiches techniques", icone: "document" }` au groupe « Restaurant » ; `page.tsx` (Server, `verifySession`+`requireModule(user,"stock")`) charge les fiches, calcule le coût/portion via `charger-fiche.ts` + `calculerCout`, `fiches-client.tsx` liste (nom, catégorie, coût/portion via `usd()`, badge « coût partiel » si `incomplet`) avec **`useBulkSelection` + `BulkBar`** (supprimer / dupliquer / exporter).
- [ ] **Step 2 : Fiche détail/édition** (`[id]/page.tsx` + `editer-fiche.tsx`) : entête (catégorie, portions, TVA, **coefficient cible** — mode par défaut — et/ou prix de vente), tableau d'ingrédients avec un **`<select>` d'`ArticleStock` actifs** (patron `commandes/nouveau/nouveau-client.tsx`) OU un `<select>` de sous-fiches, `unite` + `quantite` (`dec`), **coût recalculé en direct** (article cliquable → `/stock/catalogue/...`), coefficient/`tauxMarque`/`ratioMatiere`/prix conseillé/marge brute, mention « coût partiel — N ingrédient(s) sans prix », zone `recette`.
- [ ] **Step 3 : Actions** (`actions.ts`) : `garde()` = `verifySession`+`requireModule(user,"stock")` ; chaque action `actionLisible` + `journaliser` + `revalidatePath("/stock/fiches")`. Validation : ingrédient = article XOR sous-fiche ; sous-fiche ≠ la fiche elle-même (anti-cycle direct) ; une `estSousRecette` n'exige pas de prix de vente.
- [ ] **Step 4 : Vérif** `npm run typecheck` && `npm run build` && `npm test -- fiches`.
- [ ] **Step 5 : Commit.**

---

## Task 5 : Import du classeur `scripts/import-fiches-plats.ts`

**Files:** Create `scripts/import-fiches-plats.ts` + `scripts/import-fiches-plats.test.ts`.

Idempotent (marqueur), cible `DATABASE_URL` en argument (jamais de défaut prod). Lit `/Users/sachatshiongo/Downloads/Tableurs/Fiche technique plats crash test.xlsx`.

- [ ] **Step 1** : Parser l'onglet « Liste des articles » (entête ligne 13, données 14+ ; cols R=barcode, S=désignation, T=unité, U=qté/paquet, V=prix unitaire, W=carton, X=fournisseur ; **109 vrais articles**, ignorer les 5 fausses lignes = sous-recettes). Upsert dans `ArticleStock` (par désignation normalisée) : `designation, unite, uniteParCarton, prixUnitaireUSD = V, prixCartonUSD = W, domaine = NOURRITURE`. **Signaler** les lignes où `V×U ≠ W` (erreurs de saisie, ne pas corriger).
- [ ] **Step 2** : Parser les 29 onglets fiches (ancrer sur **libellés col B**, pas coordonnées) : entête (B11 catégorie, B13 nom, C15 portions, C18 TVA, C17 prixVenteTTC, F37 coefficient) + tableau ingrédients (26+ : B article, C unité conso, D quantité). Pour les 5 sous-recettes : `estSousRecette=true`, **rendement parsé du nom d'onglet** (« Sauce bolognaise 4.6 kg » → 4600 g), `rendementUnite="g"`.
- [ ] **Step 3** : Rattacher chaque ingrédient : par désignation normalisée (NFKD, minuscule, trim) à `ArticleStock`, OU à une sous-fiche (les 5). **Signaler** tout ingrédient non rattaché (jamais deviner). Créer fiches + ingrédients (sous-recettes d'abord).
- [ ] **Step 4** : Rapport (nb fiches, nb ingrédients, non-rattachés, écarts prix). Test du parseur (dry-run) : Bolognaise a 2 ingrédients (Sauce bolognaise + Penne), Sauce bolognaise a 7 ingrédients, rendement 4600 g.
- [ ] **Step 5 : Commit.**

---

## Task 6 : Test golden — reproduire le classeur

**Files:** Create `src/lib/fiches/golden.integration.test.ts` + fixture `__fixtures__/fiches-plats.json`.

- [ ] **Step 1** : Fixture depuis le parseur (Task 5) exportée en JSON (fiches + ingrédients + articles nécessaires).
- [ ] **Step 2** : Seeder (`ArticleStock` + fiches) en Postgres éphémère, `chargerFiche("Bolognaise")` → `calculerCout` → asserter **coutParPortion = 2,54 $ exact** ; `chargerFiche("Sauce bolognaise")` → `coutTotal = 56,82 $`, `coutParPortion (23) = 2,47 $`. Vérifier qu'aucune fiche n'est `incomplet` (hors pennes si l'on garde le prix erroné — documenter).
- [ ] **Step 3 : PASS + commit.**

---

## Self-Review (couverture spec)

- Modèle FicheTechnique/IngredientFiche (article XOR sous-fiche, rendement) → Task 1. ✓
- Conversions (masse/volume/comptage, unité-emballage, cl=gram géré au moteur) → Task 2 + Task 3. ✓
- Coût récursif + Decimal + incomplet annoncé + cycle + tauxMarque/ratioMatiere/coefficient/prix conseillé → Task 3. ✓
- Écrans Stock (liste + fiche + bulk-bar + sélecteur article) + nav → Task 4. ✓
- Import du classeur (articles + 29 fiches, rendement du nom, matching normalisé, écarts signalés) → Task 5. ✓
- Golden 2,54 exact → Task 6. ✓
- RLS + migration → Task 1. ✓

**Contrôle qualité différé** : faire relire par Yukihira (recettes/conversions) + Nakiri (coût/marges) après implémentation ; puis mode bar (`type=BAR`, même modèle) en module suivant.
