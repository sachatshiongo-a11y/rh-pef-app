# Le salaire net ne contient pas le transport

- **Date** : 2026-09-22
- **Statut** : Design validé (à implémenter) — décision de la Direction : « le transport ne doit
  pas rentrer dans le net ».
- **Périmètre** : la PRÉSENTATION du net — bulletin PDF, écrans, exports, attestation de paie,
  plafond d'acompte. Le moteur de paie, les colonnes stockées et les bulletins déjà émis ne
  bougent pas.

---

## 1. Ce qui a été constaté (paie de septembre 2026, 22 bulletins)

Pour 20 salariés sur 22, au centime près :

**net du bulletin = net saisi sur la fiche + indemnité de transport + allocations familiales**

Le moteur reconstitue correctement le brut à partir du net saisi : la part *salaire* du bulletin
est juste. Ce qui décale le « SALAIRE NET À PAYER », c'est ce qu'on ajoute par-dessus — et
d'abord le transport (de 25 à 136 $ par personne), mis « dans le brut, versé au net » par la
décision du 2026-07-22 (commit `c65ff73`). La Direction revient sur cette décision.

Les deux autres écarts ne sont pas des défauts et ne sont pas traités ici :
- **Martine Mutombo (−30,77 $) et Rachel Lunda (+30,77 $)** : paie aux heures (décision du
  2026-07-04). Martine a travaillé 216 h sur 234 contractuelles ; Rachel 180 h sur 156 — ses 24 h
  au-delà du contrat sont payées au tarif normal, le seuil des heures supplémentaires étant le seuil
  légal (48 h/semaine), pas ses 36 h de contrat. **Signalé à la Direction**, qui tranchera.
- **Allocations familiales** (1,50 $ par enfant) : légalement partie de la paie, elles restent dans
  le net. La Direction n'a nommé que le transport.

L'attestation de paie (`lib/pdf/attestation-paie.tsx`) fait DÉJÀ la distinction depuis le
2026-07-22 (« un salaire net de X, ainsi qu'une indemnité de transport de Y, soit un montant net
total de Z ») — localement, avec sa propre soustraction. Le bulletin, lui, n'a jamais suivi. Ce lot
en fait une règle unique.

## 2. Décisions cadrantes

1. **Deux notions, deux noms, partout** :
   - **Salaire net** = ce que le salarié gagne, hors transport. C'est le nombre qui se compare à la
     fiche. Il inclut les allocations familiales et les frais médicaux remboursés, et il est
     diminué de l'acompte et de l'échéance de prêt.
   - **Total versé** = salaire net + indemnité de transport = la somme remise en main propre.
2. **Rien n'est réécrit en base.** `PayrollLine.salNetUSD` / `salNetCDF` continuent de porter le
   *total versé*, comme depuis juillet : c'est le montant réellement payé sur des mois clos, et les
   bulletins émis (`VersionBulletin`) l'ont imprimé. Le **salaire net se DÉRIVE** :
   `salNetUSD − transportUSD`. Aucune migration, aucun script — l'historique reste vrai.
3. **Un seul endroit sait faire cette soustraction** : `src/lib/paie-net.ts`. Plus aucun écran,
   export ou document ne la refait à la main (l'attestation de paie y renonce).
4. **Le moteur ne change pas.** Le brut continue d'inclure le transport (ligne de gain visible, hors
   base cotisable et imposable), les cotisations et l'IPR sont calculés comme avant. Ce lot ne
   modifie AUCUN montant calculé — seulement lesquels s'affichent sous quel nom.

## 3. Le module `lib/paie-net.ts`

```ts
type LigneNet = { salNetUSD: Decimal | number; transportUSD: Decimal | number };

/** Salaire net = total versé − transport. Ce que le salarié gagne, hors remboursement de frais. */
export function salaireNetUSD(l: LigneNet): number;
/** Le même, en CDF, au taux du bulletin (run.tauxChangeUtilise). */
export function salaireNetCDF(l: LigneNet, tauxChangeCDF: number): number;
/** Total versé = ce qui est remis au salarié : salaire net + transport. */
export function totalVerseUSD(l: LigneNet): number;
```

Sans dépendance (importable par les composants client — `simulation-salaire.tsx` en a besoin).
`salaireNetCDF` reçoit le taux plutôt que de le déduire de `salNetCDF / salNetUSD` : une division
par un net nul (salarié sans paie) donnerait `NaN`, et le taux du run est toujours disponible là où
le CDF s'affiche.

## 4. Le bulletin PDF (`lib/pdf/bulletin.tsx`)

Le bloc du bas remplace « SALAIRE NET À PAYER » + la mention « dont frais de transport … versé au
net » par trois lignes, dans cet ordre :

```
SALAIRE NET                       253,72 $      ← salaireNetUSD, en gros (le style actuel de totalBox)
Indemnité de transport            114,78 $      ← transportUSD, ligne simple (absente si 0)
TOTAL VERSÉ                       368,50 $      ← totalVerseUSD, gras, un cran sous le titre
```

puis « Coût total employeur » comme aujourd'hui. Le tableau des gains ne change pas : le transport
y reste une ligne (« Frais de transport (non imposable) »), le « Salaire brut imposable (hors
transport) » aussi. La case de signature « Signature du salarié » reste en place (lot 2).

En CDF (`devise === "CDF"`), les trois montants sont convertis au taux du bulletin, comme le reste.

## 5. Partout ailleurs : « net » veut dire salaire net

Chaque endroit qui lit `salNetUSD` pour l'afficher ou le totaliser passe par le module. Inventaire,
avec le libellé cible :

| Endroit | Aujourd'hui | Après |
|---|---|---|
| Fiche employé, tableau des paies (`employes/[id]/page.tsx`) | « Salaire net $ / CDF » = total versé | mêmes colonnes = salaire net ; colonne « Total versé $ » ajoutée |
| Export PDF de la fiche (`employes/[id]/fiche/route.ts`) | « netUSD » = versé | salaire net, + « Total versé » |
| Aperçu bulletin (`employes/[id]/apercu-bulletin.tsx`) | « Salaire net à payer » | « Salaire net » + ligne « Total versé » |
| Simulation de salaire (`employes/simulation-salaire.tsx`, `nouveau`, `modifier`) | « Net à payer (transport compris) » ; impact sur `net` | « Salaire net » + « Total versé » ; l'impact compare des salaires nets |
| Onglet Paie (`paie/page.tsx`, `paie-bulk.tsx`, `bulletins-validation.tsx`) | colonne « Net », « Net total » | « Salaire net » ; pied « Salaire net total » ET « Total versé » |
| Livre de paie Excel (`paie/export/route.ts`) | « Salaire net $ / CDF » | mêmes colonnes = salaire net ; colonnes « Total versé $ / CDF » ajoutées après |
| Livre de paie PDF (`paie/export-pdf/route.ts`) | « Net $ / Net CDF » | « Net $ / Net CDF » = salaire net ; colonne « Versé $ » ajoutée, largeurs rééquilibrées |
| Historique d'un run (`historique/[id]/page.tsx`) | « Salaire net $ / CDF » | idem fiche employé |
| À valider (`a-valider/page.tsx`) | `montant` = versé | salaire net (c'est le salaire qu'on valide) |
| Documents (`documents/page.tsx`, `espace/documents/page.tsx`) | « Net $ » / « Net : » | salaire net |
| Accueil, Historique paie, rapport mensuel (masse salariale nette) | somme des versés | somme des **salaires nets** ; le rapport mensuel ajoute une ligne « Transport versé » |
| Attestation de paie (`lib/pdf/attestation-paie.tsx`) | soustraction locale | le module ; texte inchangé |
| Plafond d'acompte (`lib/acompte-plafond.ts`) | plafond sur le net versé du mois précédent | sur le **salaire net** — une avance se prend sur le salaire, pas sur un remboursement de frais |

Règle de nommage des libellés : **« Salaire net »** (jamais « Net à payer », jamais « Net » seul dans
un en-tête de colonne qui a la place) et **« Total versé »**. Les totaux de masse s'appellent
« Masse salariale nette » et restent hors transport.

## 6. Ce qui ne change pas

- `salBrutUSD`, `salNetUSD`, `salNetCDF`, `coutEmployeurUSD` : ni le calcul, ni les valeurs
  stockées, ni les lignes existantes.
- Les bulletins déjà émis : leur `VersionBulletin` garde ce qui a été imprimé. Un bulletin ancien
  ré-ouvert se rend avec la nouvelle mise en page, à partir des mêmes nombres.
- Le régime « paie aux heures » et les cas Martine/Rachel.
- Les allocations familiales restent dans le salaire net.

## 7. Tests

- **`lib/paie-net.test.ts`** : `salaireNetUSD` sur la ligne réelle d'Aimée Mutita (368,50 versés,
  114,78 de transport → 253,72) ; transport nul → net = versé ; CDF au taux ; `Decimal` et `number`
  acceptés.
- **`lib/pdf/bulletin.render.test.ts`** (nouveau, sur le patron de `glyphes-manquants.test.ts`) :
  rend un bulletin avec la même ligne et vérifie dans le texte extrait la présence de
  « SALAIRE NET » suivi de « 253,72 $ », « Indemnité de transport » « 114,78 $ », « TOTAL VERSÉ »
  « 368,50 $ » — et l'ABSENCE de « versé au net » et de « NET À PAYER ». Avec transport nul : pas de
  ligne transport, salaire net = total versé.
- **`lib/acompte-plafond.test.ts`** (existant) : le plafond se calcule sur le salaire net du mois
  précédent — un cas où transport > 0 fait baisser le plafond par rapport à avant.
- **Garde-fou de source** (dans `paie-net.test.ts`) : hors `lib/payroll.ts`, `lib/paie-batch.ts`,
  `lib/paie-net.ts` et les tests, tout fichier de `src/` qui lit `salNetUSD` importe
  `@/lib/paie-net`. Une lecture directe est un affichage qui a échappé à la règle.
- Suite complète verte ; aucune modification de `payroll.test.ts` (le moteur ne change pas — si un
  test moteur devait changer, c'est que le lot a débordé).

## 8. Ce que la Direction doit savoir avant déploiement

- **Les totaux de masse salariale baissent** du montant du transport (≈ 1 710 $ en septembre) —
  le coût employeur, lui, ne bouge pas. Ce n'est pas une économie, c'est un changement de définition.
- **Le plafond d'acompte baisse** pour tout salarié qui a du transport : il se calcule désormais sur
  le salaire seul.
- Le net d'un parent reste supérieur à sa fiche des allocations familiales (1,50 $/enfant).
- Rachel Lunda : 24 h au-delà de son contrat payées sans majoration — à trancher séparément.
