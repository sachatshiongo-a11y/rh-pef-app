# Module Fiches techniques — recettes & coût de revient (plats)

- **Date** : 2026-08-14
- **Statut** : Design validé (à implémenter)
- **Périmètre v1** : fiches techniques des **plats** (+ sous-recettes) et leur coût de revient. Le **bar** est un second temps (même modèle).

---

## 1. Contexte & objectif

La Direction tient ses recettes et leur coût de revient dans deux classeurs Excel
(`Fiche technique plats crash test.xlsx`, `PEF Fiches techniques du bar.xlsx`). Chaque **fiche** décrit
un plat : ingrédients, quantités, coût de revient, marge, prix de vente. Objectif : intégrer ce
fonctionnement dans l'app PEF, dans l'**espace Stock**, en réutilisant le **catalogue d'articles
existant** comme source de prix.

**Structure d'une fiche (Excel)** : catégorie, nom, **nombre de portions**, **prix de vente TTC**,
**TVA 16 %**, un tableau d'ingrédients `Article | Unité | Unités nécessaires | Coût d'achat HT à
l'unité | Prix de revient HT`, puis **total prix de revient HT**, **revient par portion**
(produite/vendue), **coefficient de marge**, **taux de marge**, **prix de vente HT**, **marge
brute**, et la **recette** (préparation).

**Deux faits structurants** :
- **Sous-recettes** : « Sauce bolognaise 4,6 kg » est une fiche (23 portions) consommée **comme
  ingrédient** dans plusieurs plats, au **cl** → graphe de recettes + **conversions d'unités**.
- La « Liste des articles » du classeur (~1000 lignes) **recoupe le catalogue Stock**
  (`ArticleStock`, déjà présent avec prix + fournisseurs).

## 2. Décisions cadrantes (validées avec la Direction)

1. **Source des prix d'ingrédients** — *Réutiliser le catalogue Stock* (`ArticleStock`). Un ingrédient
   pointe sur un article du Stock (ou sur une sous-recette) ; le coût unitaire n'est jamais saisi, il
   est **dérivé** du prix Stock → le coût de revient se met à jour quand le prix change.
2. **Emplacement** — dans l'**espace Stock** (schéma Prisma `stock`), près d'`ArticleStock`.
3. **Périmètre** — *plats d'abord* (avec sous-recettes), *bar ensuite* (même modèle, champ `type`).
4. **Prix & marge** — *les deux* : on peut saisir un **prix de vente** ET/OU un **coefficient de
   marge cible** ; l'app calcule le coût de revient, la marge réelle, le prix conseillé, la marge brute.

## 3. Architecture & intégration

Suit les patterns existants du dépôt (aucune réinvention) : schéma `stock`, gabarit CRUD des écrans
Stock (`stock/fournisseurs/` : page Server Component → `actions.ts` `actionLisible` + garde
`requireModule(user,"stock")` + `journaliser` + `revalidatePath`), `bulk-bar` (actions groupées),
helper `montant.ts`, formatage devise `usd()`/`qte()` de `stock.ts`, RLS + hardening pour chaque
nouvelle table (patron `rls_tables_restantes`), tests Vitest + Postgres éphémère.

## 4. Modèle de données (schéma `stock`)

### 4.1 `FicheTechnique`
- `id`, `nom`, `categorie` (texte ou réf. `CategorieStock` ? — texte libre en v1, ex. « Pâtes
  classiques »), `type` (enum `TypeFiche { PLAT }` ; `BAR` ajouté au module suivant), `actif`.
- `nbPortions` (int > 0), `tauxTVA` (Decimal, défaut 0,16).
- **Prix & marge** (au moins l'un, les deux permis) : `prixVenteTTC?` (Decimal), `coefficientMargeCible?`
  (Decimal). Voir §6 pour ce qu'on calcule dans chaque cas.
- **Rendement (pour servir de sous-recette)** : `rendementQuantite?` (Decimal) + `rendementUnite?`
  (texte). Une fiche consommée dans une autre l'est au **rendement** (ex. Sauce bolognaise :
  4,6 kg → **stockée `rendementQuantite = 4600`, `rendementUnite = "g"`**). Une fiche « plat final »
  n'a pas besoin de rendement (elle se vend à la portion) ; une sous-recette en a un.
  > ⚠️ **Le rendement se saisit dans une UNITÉ DE BASE** (cf. §12.1 et le moteur) : `g` pour une
  > masse, `ml` pour un volume. Le coût d'une sous-recette se calcule **sans aucune conversion** :
  > un rendement en **« kg » ou « L » sera refusé comme incohérent** (motif
  > `UNITE_RENDEMENT_INCOHERENTE`, coût indéterminé annoncé) dès que la consommation est écrite en
  > g/cl — c'est voulu, c'est le garde-fou contre un coût 1000 fois trop élevé.
  > Une unité de **comptage** (« portion », « pièce ») reste possible, mais la consommation doit
  > alors être écrite **dans la même unité** (« 12 portions » se consomme en portions, jamais en
  > grammes : on ne divise pas des grammes par des portions).
- `recette` (texte, préparation), timestamps, audit.

### 4.2 `IngredientFiche` (ligne d'une fiche)
- `id`, `ficheId` (FK), `ordre`.
- **Exactement l'un** : `articleStockId?` (FK `ArticleStock`) **ou** `sousFicheId?` (FK
  `FicheTechnique`). Contrainte applicative : l'un XOR l'autre, non nul.
- `unite` (unité de **consommation** dans la recette, ex. « g », « cl », « pièce »).
- `quantite` (Decimal, « unités nécessaires »).
- Le **coût unitaire n'est pas stocké** : dérivé (prix Stock de l'article converti à l'unité de
  consommation, ou coût de la sous-recette / son rendement).

> Toutes les tables : `@@schema("stock")`, RLS activée + hardening, audit via `journaliser`.

## 5. ⚠️ Conversions d'unités (`src/lib/fiches/conversion.ts`)

Le Stock price à l'**unité d'achat** (kg, L, pièce…), la recette consomme en **g, cl, ml, pièce…**.
Utilitaire pur de conversion :
- **Masse** : kg ↔ g (×1000). **Volume** : L ↔ cl (×100) ↔ ml (×1000). **Pièce/unité** : telle quelle.
- Coût d'un ingrédient-article = `quantité × (prixUnitaireArticle × facteur(unitéConso → unitéAchat))`.
  Ex. article à 8 $/kg consommé en 200 g → `200 g × (8 × 0,001) = 1,60 $`.
  > ⚠️ **Sens du facteur — corrigé le 2026-08-14 (Task 3).** Le prix est exprimé **par unité
  > d'achat** : c'est la quantité consommée qu'on convertit vers l'unité d'achat, jamais l'inverse.
  > 3 000 g d'un article à 2,99 $/kg = **8,97 $** ; le sens inverse donnerait **8 970 000 $**.
- La **« quantité par paquet »** du catalogue sert quand un article est vendu au carton (prix carton
  → prix pièce). Le prix de vérité reste le prix unitaire de `ArticleStock`.
- **Incompatibilité** (ex. consommer un article « pièce » en « g ») → **signalée**, coût de cet
  ingrédient marqué **indéterminé** (jamais 0 — cf. §6).

## 6. Coût de revient (moteur pur `src/lib/fiches/cout.ts`, calculé, jamais stocké)

Fonction **récursive** `calculerCout(fiche, contexte)` (implémentée dans `src/lib/fiches/cout.ts`) :
- Coût d'un ingrédient **article** = `quantité × prixConverti` (§5), prix HT depuis `ArticleStock`.
- Coût d'un ingrédient **sous-fiche** = `quantité × (coûtTotalSousFiche / rendementQuantite)`.
  > ⚠️ **AUCUNE conversion d'unité — corrigé le 2026-08-14 (Task 3).** Cette ligne disait
  > « rendement converti à l'unité de conso » : **c'est faux**, et c'est très exactement la phrase
  > qui a produit le défaut d'origine (le « cl » d'une sous-recette est un **gramme**, cf. §12.1 —
  > convertir multiplie le coût par 10). Le rendement et la consommation sont déjà dans la même
  > unité de base ; le moteur ne convertit rien ici et **refuse** (coût indéterminé annoncé, motif
  > `UNITE_RENDEMENT_INCOHERENTE`) les cas où les deux unités ne désignent manifestement pas la
  > même chose : « g » contre « kg », « cl » contre « kg », « g » contre « portion ».
- **Coût total HT** = Σ ingrédients. **Coût par portion** = total / `nbPortions`.
- **Marge** : `prixVenteHT = prixVenteTTC / (1 + tauxTVA)` ; `coefficient = prixVenteHT / coûtParPortion` ;
  `tauxMarque = (prixVenteHT − coûtParPortion) / prixVenteHT` (cf. §12.3) ;
  `margeBrute = prixVenteHT − coûtParPortion`.
- **Prix conseillé** (depuis `coefficientMargeCible`) = `coûtParPortion × coefficientMargeCible` (HT),
  puis ×(1+TVA) pour le TTC conseillé.
- ⚠️ **Détection de cycle** : une fiche ne peut pas se contenir (directement ou via ses sous-recettes)
  → erreur explicite, jamais de boucle infinie.
- ⚠️ **Coût incomplet ANNONCÉ** : si un article n'a pas de prix, ou une unité est inconvertible, le
  coût est marqué **incomplet** (liste des ingrédients en cause) et **jamais complété par un zéro**
  (doctrine Nakiri / mémoire coût de revient Bolimo). L'UI affiche « coût partiel » plutôt qu'un
  chiffre faussement précis.

## 7. Écrans (espace Stock, gabarit `fournisseurs/` + bulk-bar)

- **Liste des fiches** (`stock/fiches/`) : nom, catégorie, coût de revient/portion, marge — filtres
  (catégorie, type), **cases à cocher + barre d'actions groupées** (supprimer, dupliquer, exporter).
- **Fiche** (détail/édition) : entête (catégorie, portions, TVA, prix de vente et/ou coefficient
  cible), **tableau d'ingrédients** (ajouter *un article du Stock* via recherche, ou *une sous-fiche*
  ; unité de conso ; quantité), **coût de revient recalculé en direct**, coefficient/taux de marge,
  **prix conseillé**, marge brute, mention « coût partiel » si incomplet, zone **recette** (texte).
  Noms d'articles **cliquables** → fiche article Stock (harmonie). Montants via `montant.ts`/`usd()`.
- Actions serveur : `actionLisible` + `requireModule(user,"stock")` + `journaliser` + `revalidatePath`.

## 8. Amorçage (import du classeur)

Script d'import idempotent (comme l'import finance) :
1. Importer la **« Liste des articles »** plats dans `ArticleStock` (créer les articles manquants avec
   prix/fournisseur/unité/quantité-par-paquet) — pour que les ingrédients existent.
2. Importer les **29 plats + 5 sous-recettes** en `FicheTechnique` + `IngredientFiche`, en rattachant
   chaque ligne d'ingrédient à l'article Stock (par désignation normalisée) ou à la sous-fiche.
   Signaler tout ingrédient non rattaché (jamais deviner).
- Cible passée en argument (jamais de défaut prod) ; démo sandbox puis prod avec feu vert.

## 9. Tests

- **Unitaires** : conversions (masse/volume/pièce, incompatibilités), coût de revient (article +
  sous-recette + conversion), marge/coefficient/prix conseillé, coût incomplet annoncé, détection de
  cycle.
- **Intégration** (Postgres éphémère) : création fiche → ingrédients (article + sous-fiche) → coût ;
  cloisonnement Stock ; RLS.
- **Golden** : reproduire un coût connu du classeur, ex. **Bolognaise = 2,53 $ HT** (Sauce bolognaise
  au cl + penne), et **Sauce bolognaise = 2,47 $/portion** (23 portions, total 56,82 $).

## 10. Hors périmètre v1 (YAGNI)

Bar (module suivant, même modèle) ; intégration à la **production** (décrémenter le stock à la
fabrication) ; recette en texte riche / photos ; menus/combinaisons ; historique de prix.

## 11. Risques & points ouverts

- **Rattachement article ↔ ingrédient** : les désignations du classeur peuvent différer de
  `ArticleStock` → normalisation + rapport des non-rattachés (Direction tranche, cf. mémoire
  « faire relire »).
- **Unités & rendements** : bien saisir le rendement des sous-recettes (sinon coût au cl/g faux) —
  point à faire valider par Yukihira (grammages) et Nakiri (coût de revient).
- **Devise** : `ArticleStock` pivote en USD ; le coût de revient est en USD HT (comme le classeur).
  Rester cohérent, pas d'aller-retour de pivot.
- **Catégorie** : texte libre en v1 (les catégories du classeur, ex. « Pâtes classiques ») ; un
  rattachement à `CategorieStock` est possible plus tard.

---

## 12. Corrections brigade cuisine (Yukihira + Nakiri, 2026-08-14) — PRIORITAIRES

Ces points corrigent/précisent les sections ci-dessus après vérification cellule par cellule du classeur. **Ils priment.**

1. **« cl » d'une sous-recette = GRAMME (densité 1), pas du volume.** Rendement Sauce bolognaise = 4,6 kg = **4600 g** ; coût/unité = 56,82/4600 = 0,0123 $/g ; la Bolognaise en consomme **200 g** (écrit « 200 cl »). **INTERDIT** de convertir le « cl » d'une sous-recette en volume (×100) → sinon coût ×10. À l'import, stocker `rendementUnite = "g"` (jamais « cl »), consommation en g. Le garde-fou conversion volume ne s'applique **jamais** à un `sousFicheId`.
2. **Golden Bolognaise = 2,54 $** (pas 2,53). Le 2,53 vient d'un coût de sauce tronqué à 0,0123 ; en Decimal plein (0,012353 × 200 + 0,07) = **2,54 $**. Règle : **Decimal pleine précision, arrondi UNIQUE au centime en sortie**, test golden en **égalité exacte (tolérance 0)** — ne pas reproduire le bug d'arrondi du tableur.
3. **`tauxMarge` (spec §6) → renommer `tauxMarque`** = margeBrute/prixVenteHT (= 87,5 % ex.). Ajouter le **`ratioMatiere`** = coût/prixVenteHT (= 12,5 %). Réserver l'expression « taux de marge » au ratio marge/coût (= coefficient − 1, 700 % dans le classeur) si on l'affiche. **Un nom = une formule** partout.
4. **Mode par défaut = COEFFICIENT-driven** : la Direction saisit le **coefficient** → PV HT = coût × coef → PV TTC = PV HT × (1+TVA). Le sens « saisir TTC → dériver coef » reste offert (les deux, décision 4), mais le coefficient est le mode réel de saisie.
5. **`PRIX à l'unité` (col V) = source de vérité.** Le prix carton (col W) est **dérivé** (`=V×U` sur 48 lignes) — NE PAS dériver l'unitaire depuis le carton. `uniteParCarton` (U) ne sert qu'à parser les **unités-emballage** (« 500 GR », « 1 KG » → le prixU est le prix du paquet, l'unité porte le poids → parser 0,5 kg/pièce).
6. **Rendement dans le NOM d'onglet** (« Sauce bolognaise 4.6 kg »), aucune cellule dédiée → parser depuis le nom. `nbPortions` (23) est décoratif ; c'est le **rendement en grammes** qui pilote la consommation.
7. **Import** : ancrer sur les **libellés col B** (le bloc bas glisse selon le nb d'ingrédients), rattacher sur **désignation normalisée col S** (NFKD, minuscule, trim ; espaces parasites), **jamais** sur coordonnée fixe ni plage de formule. Signaler à la Direction les **3 lignes** où `prixU × uniteParCarton ≠ prixCarton` (erreurs de saisie, ex. penne 0,35 vs 3,50) — sans corriger d'office.
8. **Comptes corrigés** : **24 plats + 5 sous-recettes = 29 fiches** (pas « 29 plats ») ; **114 lignes d'articles remplies, 109 vrais articles** (pas ~1000).
9. **Sous-recette** = pas de prix de vente/marge exigé (`estSousRecette` : la marge n'a de sens que sur un plat final).

**Cas de test golden (précision pleine, arrondi centime final)** : T1 article+conversion `0,2 kg × 8,07 = 1,614 $` ; T2 sous-recette au gramme `56,8237 $ / 4600 g × 200 g = 2,4706 $` ; T3 golden plat `Bolognaise = 2,54 $` (exact) ; T4 marge `revient 2,53, coef 8, TVA 0,16 → PV HT 20,24 ; marge brute 17,71 ; PV TTC 23,48 ; taux marque 87,5 % ; ratio matière 12,5 %`.

---

*Module suivant : fiches du bar (cocktails/boissons) — même modèle, `type = BAR`.*
