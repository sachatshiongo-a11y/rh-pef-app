# Paie brigade sur heures planifiées — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Pour la brigade en CDD/CDI, à partir de septembre 2026, le salaire mensuel paie les heures PLANIFIÉES du mois : « qui fait tout son planning touche exactement son net ». Heures planifiées non faites → retenue au taux du mois ; heures faites en plus → payées ; HS au taux du contrat. Le planning d'un mois validé est verrouillé, chaque modification de créneau est tracée, et la validation de la paie affiche (sans bloquer) les avertissements de saisie.

**Architecture :** Une fonction PURE `calculerReferenceMois` (`src/lib/paie-reference.ts`) reçoit les jours du mois d'un salarié (créneau, modèle, code, heures) et rend la source de référence (`PLANNING` | `CONTRAT` | `CONTRAT_REPLI`), la référence R, le taux du mois, les entrées de `calculerPaieBrigade` et les avertissements de calcul. Elle contient aussi l'ANCIENNE règle, à l'identique, pour les mois antérieurs et les replis. Un chargeur serveur (`src/lib/paie-reference-donnees.ts`) construit ces jours depuis Prisma. `paie-batch.ts` et `bulletin-live.ts` appellent tous deux ce chargeur et cette fonction : un seul calcul. Une fonction pure `detecterAvertissementsSaisie` (`src/lib/paie-avertissements.ts`) ajoute les avertissements de saisie. Le planning ne s'écrit plus que par `ecrireCreneaux` (`src/lib/planning-ecriture.ts`), qui vérifie le verrou et journalise.

**Tech Stack :** Next.js 16 App Router (server actions), Prisma 7 + `@prisma/adapter-pg` (colonnes `Decimal`, `Json`), PostgreSQL embarqué (`embedded-postgres`) pour les tests d'intégration, vitest 4, @react-pdf/renderer + pdf-parse (tests de rendu), TypeScript strict.

**Spec :** `docs/superpowers/specs/2026-09-23-paie-heures-planifiees-design.md` — annexe qui fait foi pour le détail : `docs/superpowers/specs/2026-09-23-paie-heures-planifiees-note-nagi.md` (§ cités « note §n »).

## Global Constraints

- Arbre de travail `~/Projects/rh-pef-app/.claude/worktrees/paie-planning`, branche `feat/paie-heures-planifiees`. Ne jamais changer de branche. Toutes les commandes se lancent depuis la racine de cet arbre, après `export PATH="$HOME/.local/node/bin:$PATH"`.
- ⚠️ `.env` = base de **PRODUCTION** (Supabase, `DIRECT_URL` lu par `prisma.config.ts`). INTERDIT : `prisma migrate deploy|dev|reset`, `prisma db push` sans `--url` explicite vers une base locale, `prisma db execute` sans `--config` local, tout script qui écrit. Lecture de la production : uniquement en transaction `SET default_transaction_read_only = on`, et seulement si une tâche le demande (aucune ne le demande).
- `node_modules` de cet arbre : **installation propre** (`npm ci`, tâche 0), jamais le lien symbolique vers le dépôt principal. Un `prisma generate` ici modifierait sinon le client Prisma d'un autre agent (branche `feat/rls-partout`).
- Les tests d'intégration créent leur base par `prisma db push` (`src/lib/test/db.ts`) : ils ne prouvent RIEN sur les migrations. Toute migration se vérifie à part, en rejouant `prisma/migrations` sur un Postgres embarqué (`scripts/_verifier-migrations.mjs`, tâche 4). Le garde-fou `src/lib/migrations.integration.test.ts` arrive d'une autre branche : ne pas compter dessus.
- Mois VALIDÉS/PAYÉS jamais recalculés : `rafraichirPaieDuMois` saute déjà `STATUTS_FIGES = ["VALIDE", "PAYE"]`. Ne pas y toucher ; la tâche 6 le vérifie.
- Date d'effet : paramètre `paie_reference_planning_depuis` = `202609` (AAAAMM), dans `ParametreLegal`. Absent ou `null` → ancienne règle partout. Juin et juillet 2026 (lignes `PAS_VALIDE` en production) restent calculés comme avant.
- Heures supplémentaires : `calculerHeuresSupp` n'est PAS modifié ; il est appelé avec `salaireHoraire: t0` (taux du contrat `S / (heuresHebdo × 52/12)`).
- Périmètre de la nouvelle règle : `categorie === "BRIGADE"` ET contrat ∉ {`STAGE`, `JOURNALIER`, `INTERIM`}. Back-office, stagiaires, journaliers : aucun montant ne change.
- `payroll.ts` (`calculerPaieBrigade`, `calculerHeuresSupp`, `reconstituerBrutDepuisNet`) : logique inchangée. Seul ajout permis : le champ optionnel `referencePlanningDepuis?: number | null` de `ParametresPaie`. Si un test existant de `payroll.test.ts`, `payroll-reference.test.ts`, `paie-batch.integration.test.ts`, `bulletin-live.integration.test.ts` ou `avantage-nature.integration.test.ts` devient rouge : STOP, le lot a changé un montant du mois de juillet.
- **Falsification obligatoire** : chaque test ou garde-fou nouveau est vu ROUGE sur une mutation ciblée du code (étape « Falsifier » de chaque tâche), puis VERT une fois le code rétabli. Un test jamais vu rouge ne compte pas.
- Montants : jamais de valeur légale écrite en dur (pas de `0.3`, `1.3`, `26` dans le code) : tout vient de `ParametresPaie`. Libellés à l'écran et sur le bulletin : en français, « Heures planifiées », « Heures contrat (repli) », « Heures / mois » (mois antérieurs).
- Commits : messages en français, à l'impératif, préfixés (`feat(paie): …`, `test(paie): …`, `feat(planning): …`), terminés par la ligne vide puis `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Un commit par tâche (sauf tâche 0). Commentaires de code en français.
- Commandes de test : `npx vitest run <fichier>` pour un fichier ; suite complète `npx vitest run --maxWorkers=2` (tâche 13 seulement ; les échecs `shmmni`/timeout de setup se relancent seuls, fichier par fichier, avant de conclure).

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| **Créer** `src/lib/duree-shift.ts` | `dureeShift` déplacée ici (module pur). |
| **Créer** `src/lib/duree-shift.test.ts` | Tests de `dureeShift`. |
| Modifier `src/app/(app)/planning/creneaux.ts` | Ré-exporte `dureeShift` depuis `@/lib/duree-shift`. |
| Modifier `src/lib/conges-couverture.ts` | Importe `dureeShift` depuis `@/lib/duree-shift` (plus de `src/app/` dans `src/lib/`). |
| **Créer** `src/lib/paie-reference.ts` | `calculerReferenceMois` : référence R, taux du mois, entrées moteur, ancienne règle, avertissements de calcul. Pur. |
| **Créer** `src/lib/paie-reference.test.ts` | 24 tests purs, dont les salariés réels de septembre 2026. |
| **Créer** `src/lib/paie-avertissements.ts` | `detecterAvertissementsSaisie`, `lireAvertissements`. Pur. |
| **Créer** `src/lib/paie-avertissements.test.ts` | Tests purs. |
| Modifier `prisma/schema.prisma` | Enum `SourceReferencePaie` ; 4 colonnes sur `PayrollLine`. |
| **Créer** `prisma/migrations/20260924090000_paie_reference_planning/migration.sql` | Enum + colonnes (additif). |
| **Créer** `prisma/migrations/20260924090100_param_reference_planning/migration.sql` | Paramètre `paie_reference_planning_depuis = 202609` pour chaque exercice (idempotent). |
| **Créer** `scripts/_verifier-migrations.mjs` | Rejoue toutes les migrations sur un Postgres embarqué, compare au schéma, vérifie l'insertion du paramètre. |
| Modifier `src/lib/payroll.ts` | Champ optionnel `referencePlanningDepuis?: number | null` dans `ParametresPaie` (type seul). |
| Modifier `src/lib/config.ts` | Charge `paie_reference_planning_depuis`. |
| Modifier `src/lib/test/db.ts` | `seedParametresLegaux(prisma, annee, { referencePlanningDepuis })`. |
| Modifier `scripts/seed-legal-2026.ts` | Ajoute le paramètre (À VALIDER). |
| **Créer** `src/lib/config-reference-planning.integration.test.ts` | Le paramètre est lu (présent → 202609, absent → null). |
| **Créer** `src/lib/paie-reference-donnees.ts` | `chargerJoursMois` : jours de référence + jours de saisie depuis Prisma. `server-only`. |
| **Créer** `src/lib/paie-reference-donnees.integration.test.ts` | Assemblage des jours (créneau système, modèle A/B, taux de rôle, horodatages). |
| Modifier `src/lib/paie-batch.ts` | Branche la référence ; 4 nouveaux champs de ligne. |
| **Créer** `src/lib/paie-heures-planifiees.integration.test.ts` | Bout en bout septembre : Martine 400,00, Syntyche 200,00, Marie 200,00 ; repli ; persistance ; figé non recalculé ; `bulletin-live` égal au centime. |
| Modifier `src/lib/bulletin-live.ts` | Même branchement ; champ `reference` dans `ApercuBulletin`. |
| Modifier `src/app/(app)/employes/[id]/apercu-bulletin.tsx` | Affiche la référence et les avertissements de l'aperçu. |
| Modifier `src/lib/pdf/bulletin.tsx` | Libellé de la case heures selon la source ; ligne « jours payés » en heures. |
| Modifier `src/lib/pdf/bulletin.render.test.ts` | Libellés, heures, une seule page. |
| **Créer** `src/app/(app)/paie/avertissements-validation.ts` | `avertissementsAConfirmer` (pur). |
| **Créer** `src/app/(app)/paie/avertissements-validation.test.ts` | Tests purs. |
| **Créer** `src/app/(app)/paie/avertissements-paie.tsx` | `BadgeReference`, `ListeAvertissements`, `ConfirmationAvertissements` (client). |
| Modifier `src/app/(app)/paie/paie-bulk.tsx`, `status-actions.tsx`, `bulletins-validation.tsx`, `page.tsx` | Badge, avertissements, confirmation avant validation. |
| Modifier `src/lib/audit.ts` | `journaliserPlusieurs`. |
| **Créer** `src/lib/planning-ecriture.ts` | `ecrireCreneaux`, `PlanningVerrouilleError`, `moisVerrouilles`. `server-only`. |
| **Créer** `src/lib/planning-ecriture.integration.test.ts` | Trace, verrou, idempotence. |
| Modifier `src/app/(app)/planning/actions.ts`, `planning-semaine.tsx`, `auto-planning-form.tsx`, `src/lib/echange-creneau.ts`, `src/app/espace/actions.ts`, `src/app/(app)/a-valider/page.tsx` | Tous les points d'écriture du planning passent par `ecrireCreneaux`. |
| **Créer** `src/app/(app)/planning/planning-verrou.integration.test.ts` | `saisirCreneau` refuse un mois validé, trace sinon. |
| Modifier `src/app/(app)/employes/employee-form.tsx`, `simulation-salaire.tsx`, `employes/[id]/page.tsx`, `planning/modele-grid.tsx`, `planning/page.tsx` | Mention « la paie de la brigade suit le planning du mois ». |
| **Créer** `src/lib/mention-reference-planning.ts` + `.test.ts` | Texte unique de la mention + garde-fou de présence. |

---
### Task 0 : préparer l'arbre de travail (aucun commit)

**Files :** aucun fichier suivi.

- [ ] **Step 1 : dépendances propres à l'arbre**

```bash
cd ~/Projects/rh-pef-app/.claude/worktrees/paie-planning
export PATH="$HOME/.local/node/bin:$PATH"
git branch --show-current            # attendu : feat/paie-heures-planifiees
test -L node_modules && echo "LIEN SYMBOLIQUE : le supprimer (rm node_modules) avant npm ci"
npm ci
npx prisma generate                  # client généré DANS cet arbre uniquement
```

- [ ] **Step 2 : ligne de base verte des tests touchés par le lot**

```bash
npx vitest run src/lib/payroll.test.ts src/lib/payroll-reference.test.ts src/lib/paie-batch.integration.test.ts src/lib/bulletin-live.integration.test.ts src/lib/avantage-nature.integration.test.ts src/lib/pdf/bulletin.render.test.ts "src/app/(app)/planning/generation-feries.integration.test.ts"
```
Attendu : tout vert. Si un fichier est rouge AVANT toute modification, le noter dans le rapport de la tâche et ne pas l'imputer au lot.

---

### Task 1 : `dureeShift` déménage dans `src/lib`

**Files :**
- Create : `src/lib/duree-shift.ts`, `src/lib/duree-shift.test.ts`
- Modify : `src/app/(app)/planning/creneaux.ts`, `src/lib/conges-couverture.ts`

**Interfaces :**
- Produces : `export function dureeShift(s: { heureDebut: string | null; heureFin: string | null; dureeHeures: number | null }): number` (même comportement qu'aujourd'hui), importable depuis `@/lib/duree-shift` et toujours depuis `src/app/(app)/planning/creneaux.ts` (ré-export).

- [ ] **Step 1 : le test qui échoue** — `src/lib/duree-shift.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { dureeShift } from "./duree-shift";

describe("dureeShift — durée d'un shift, source des heures planifiées de la paie", () => {
  it("durée explicite prioritaire (Admin 09:30–13:00 réglé à 3,5 h)", () => {
    expect(dureeShift({ heureDebut: "09:30", heureFin: "13:00", dureeHeures: 3.5 })).toBe(3.5);
  });
  it("durée explicite à 0 respectée", () => {
    expect(dureeShift({ heureDebut: "08:00", heureFin: "17:00", dureeHeures: 0 })).toBe(0);
  });
  it("sinon fin − début : Journée 08:00–22:30 = 14,5 h ; Caisse 10:30–22:30 = 12 h", () => {
    expect(dureeShift({ heureDebut: "08:00", heureFin: "22:30", dureeHeures: null })).toBe(14.5);
    expect(dureeShift({ heureDebut: "10:30", heureFin: "22:30", dureeHeures: null })).toBe(12);
  });
  it("shift de nuit : 23:00–06:00 = 7 h", () => {
    expect(dureeShift({ heureDebut: "23:00", heureFin: "06:00", dureeHeures: null })).toBe(7);
  });
  it("créneau système sans horaires (Repos/Congé/Férié) = 0 h", () => {
    expect(dureeShift({ heureDebut: null, heureFin: null, dureeHeures: null })).toBe(0);
  });
});
```

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/duree-shift.test.ts`
Attendu : FAIL, `Failed to resolve import "./duree-shift"`.

- [ ] **Step 3 : implémentation**

`src/lib/duree-shift.ts` :
```ts
// Durée d'un shift — module PUR (ni base, ni `server-only`). Déplacé de
// src/app/(app)/planning/creneaux.ts : la paie (src/lib/paie-reference-donnees.ts) en a besoin et
// `src/lib/` ne doit rien importer de `src/app/`. Même règle partout : planning, écart prévu/réalisé,
// pré-remplissage des heures et référence de paie — ce qui est posé au planning est ce qui est payé.

/** Durée d'un shift en heures : `dureeHeures` explicite, sinon calculée depuis les horaires (gère la nuit). */
export function dureeShift(s: { heureDebut: string | null; heureFin: string | null; dureeHeures: number | null }): number {
  if (s.dureeHeures != null) return s.dureeHeures;
  if (!s.heureDebut || !s.heureFin) return 0;
  const [hd, md] = s.heureDebut.split(":").map(Number);
  const [hf, mf] = s.heureFin.split(":").map(Number);
  let minutes = hf * 60 + mf - (hd * 60 + md);
  if (minutes < 0) minutes += 24 * 60; // shift de nuit (fin le lendemain)
  return Math.round((minutes / 60) * 100) / 100;
}
```
Dans `src/app/(app)/planning/creneaux.ts` : supprimer le corps de `dureeShift` (lignes « /** Durée d'un shift … » jusqu'à l'accolade fermante) et ajouter, à côté du ré-export de `pariteSemaine` en fin de fichier :
```ts
// `dureeShift` vit désormais dans src/lib/duree-shift.ts (la paie en a besoin). Ré-exporté ici pour
// les appelants existants.
export { dureeShift } from "@/lib/duree-shift";
```
Dans `src/lib/conges-couverture.ts`, remplacer
`import { pariteSemaine, dureeShift } from "@/app/(app)/planning/creneaux";`
par
```ts
import { pariteSemaine } from "@/lib/dates-fr";
import { dureeShift } from "@/lib/duree-shift";
```

- [ ] **Step 4 : le voir passer, et rien casser**

Run : `npx vitest run src/lib/duree-shift.test.ts "src/app/(app)/planning" src/lib/conges-couverture.integration.test.ts && npm run typecheck`
Attendu : PASS ; typecheck sans erreur.

- [ ] **Step 5 : falsifier**

Dans `src/lib/duree-shift.ts`, supprimer la ligne `if (minutes < 0) minutes += 24 * 60;` → `npx vitest run src/lib/duree-shift.test.ts` doit être ROUGE (cas nuit). Rétablir → VERT.

- [ ] **Step 6 : commit**

```bash
git add src/lib/duree-shift.ts src/lib/duree-shift.test.ts "src/app/(app)/planning/creneaux.ts" src/lib/conges-couverture.ts
git commit -m "refactor(planning): déplacer dureeShift dans src/lib pour la paie

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2 : la fonction pure de référence (`src/lib/paie-reference.ts`)

**Files :**
- Create : `src/lib/paie-reference.ts`, `src/lib/paie-reference.test.ts`

**Interfaces :**
- Consumes : `calculerHeuresSupp`, `type CodePresence`, `type HeuresSuppResultat`, `type ParametresPaie` de `@/lib/payroll` ; `lundiDe` de `@/lib/dates-fr`.
- Produces (noms exacts, repris par les tâches 3, 5, 6, 7, 8, 10) :
  - `export const SEMAINES_PAR_MOIS = 52 / 12`
  - `export type SourceReference = "PLANNING" | "CONTRAT" | "CONTRAT_REPLI"`
  - `export type CodeAvertissementPaie = "REPLI_CONTRAT" | "TAUX_ROLE_IGNORE" | "TAUX_MOIS_SUPERIEUR_HS" | "SAISIE_ANTICIPEE" | "PRESENCE_SANS_CRENEAU" | "PLANNING_MODIFIE_APRES_HEURES"`
  - `export type AvertissementPaie = { code: CodeAvertissementPaie; message: string }`
  - `export type JourReference`, `export type EntreesReference`, `export type EntreesMoteurBrigade`, `export type ResultatReference` (définitions ci-dessous)
  - `export function calculerReferenceMois(e: EntreesReference): ResultatReference`

Règles (spec §2-§3, note §1-§4) résumées pour le relecteur :
- Hors vigueur (`referencePlanningDepuis` null ou mois antérieur) → `CONTRAT`, ancienne règle À L'IDENTIQUE (taux de rôle pondérés, jours payés à la journée).
- Mois d'embauche, semaine (lun→dim ∩ mois) sans aucun créneau et pas entièrement en absence PAYÉE (C, A, M, O, F), ou R ≤ 0 → `CONTRAT_REPLI` + motif + avertissement `REPLI_CONTRAT`. Une semaine en congé sans solde (S) ou en absence injustifiée (N) sans créneau fait replier : l'exclure de R paierait le mois entier.
- R = heures planifiées passées dans `calculerHeuresSupp` (même seuil) moins HS30/HS60/HS100 planifiées, plus `hdu` des jours payés non travaillés sans créneau de travail (C, A, O, F à 100 %, M aux ⅔) et des fériés dus (hors dimanche, codés ou non). `hdu` = créneau de travail, sinon modèle (0 si le modèle ne prévoit rien), sinon `heuresParJour` si aucun modèle.
- t = S / R. Base = t × (heures normales faites + heures payées non travaillées) + t × ⅔ × heures de maladie. HS faites au taux du contrat t0. Férié dû travaillé : la base reste au forfait et on retire `t0 × min(heures faites, hdu)` de la valorisation HS (prime seule → payé double, pas triple).
- En mode PLANNING, `moteur.salaireJournalier = t` et `moteur.joursPayesNonTravailles` / `joursPayes2_3` sont des HEURES : `calculerPaieBrigade` n'est pas modifié et le produit reste exact.

- [ ] **Step 1 : les tests qui échouent** — `src/lib/paie-reference.test.ts` (fichier complet)

```ts
import { describe, it, expect } from "vitest";
import { calculerPaieBrigade, type CodePresence, type ParametresPaie } from "@/lib/payroll";
import { calculerReferenceMois, type EntreesReference, type JourReference, type ResultatReference } from "./paie-reference";

// Paramètres = ceux de l'exercice 2026 en production (mêmes valeurs que payroll-reference.test.ts),
// salaires saisis en NET (interrupteur actif en production depuis 2026-07-22).
const PARAMS: ParametresPaie = {
  tauxChangeCDF: 2300, cnssSalarie: 0.05, cnssPatronalPensions: 0.05, cnssPatronalRisques: 0.015,
  cnssPatronalFamille: 0.065, plafondCnssMensuelCDF: null,
  iprTranchesAnnuellesCDF: [
    { ordre: 1, plafondAnnuelCDF: 1_944_000, taux: 0.03 },
    { ordre: 2, plafondAnnuelCDF: 21_600_000, taux: 0.15 },
    { ordre: 3, plafondAnnuelCDF: 43_200_000, taux: 0.3 },
    { ordre: 4, plafondAnnuelCDF: null, taux: 0.4 },
  ],
  iprPlancherMensuelCDF: 2000, iprPlafondTaux: 0.3, iprReductionFamilleTaux: 0.02, iprReductionFamilleMax: 9,
  iprBase: 2, inppTaux: 0.03, onemTaux: 0.002, hsSeuilHebdoH: 6, hsMajTranche1: 0.3, hsMajTranche2: 0.6,
  hsMajDimancheFerie: 1.0, allocFamilialeParEnfantUSD: 1.5, joursOuvrablesMois: 26, droitsCongesAnnuel: 18,
  salairesSaisisEnNet: true,
};

type Gabarit = {
  heures?: (d: Date) => number; // durée du créneau de TRAVAIL
  creneau?: (d: Date) => boolean; // créneau quelconque (système compris) ; défaut = heures > 0
  modele?: (d: Date) => number; // absent = salarié sans modèle (heuresModele null)
  code?: (d: Date) => CodePresence | null;
  faites?: (d: Date) => number;
  tauxRole?: (d: Date) => number | null;
};
function joursDuMois(annee: number, mois: number, g: Gabarit): JourReference[] {
  const n = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(annee, mois - 1, i + 1));
    const hp = g.heures?.(date) ?? 0;
    return {
      date,
      heuresPlanifiees: hp,
      aUnCreneau: g.creneau ? g.creneau(date) : hp > 0,
      heuresModele: g.modele ? g.modele(date) : null,
      code: g.code?.(date) ?? null,
      heuresFaites: g.faites?.(date) ?? 0,
      tauxRole: g.tauxRole?.(date) ?? null,
    };
  });
}
const jour = (d: Date) => d.getUTCDate();
const dow = (d: Date) => d.getUTCDay(); // 0 = dimanche
const lunSam = (d: Date) => dow(d) !== 0;

function entrees(e: Partial<EntreesReference> & Pick<EntreesReference, "jours" | "salaireMensuel" | "heuresHebdomadaires" | "heuresParJour">): EntreesReference {
  return {
    annee: 2026, mois: 9, dateEmbauche: new Date("2025-01-06T00:00:00Z"), joursFeries: new Set(),
    joursCongePris: 0, referencePlanningDepuis: 202609, params: PARAMS, ...e,
  };
}
/** Base NETTE (avant reconstitution du brut) que le moteur va payer. */
const baseNette = (r: ResultatReference) =>
  r.moteur.salaireHoraire * r.moteur.heuresNormales +
  r.moteur.salaireJournalier * r.moteur.joursPayesNonTravailles +
  r.moteur.salaireJournalier * r.moteur.joursPayes2_3 * (2 / 3);
/** Net hors transport et hors allocation familiale, calculé par le VRAI moteur (brut reconstitué). */
const netSalaire = (r: ResultatReference, enfants: number) => {
  const l = calculerPaieBrigade({ ...r.moteur, transportMoisUSD: 0, enfants }, PARAMS);
  return l.salNetUSD - l.allocFamilialeUSD;
};

// ── Salariés réels, septembre 2026 (production, lecture seule) ─────────────────────────────────
const martine = () => {
  const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5) || jour(d) === 12 || jour(d) === 26 ? 9 : 0;
  return entrees({ salaireMensuel: 400, heuresHebdomadaires: 54, heuresParJour: 9,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null) }) });
};
const esther = () => {
  const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5) || jour(d) === 5 || jour(d) === 19 ? 9 : jour(d) === 12 || jour(d) === 26 ? 3.5 : 0;
  return entrees({ salaireMensuel: 300, heuresHebdomadaires: 51.92, heuresParJour: 9,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null) }) });
};
const rachel = () => {
  const h = (d: Date) => ([2, 4, 6].includes(dow(d)) ? 12 : 0);
  const f = (d: Date) => (h(d) > 0 || jour(d) === 28 || jour(d) === 30 ? 12 : 0); // 28 et 30 : hors planning
  return entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 12,
    jours: joursDuMois(2026, 9, { heures: h, faites: f, code: (d) => (f(d) > 0 ? "P" : null) }) });
};
const syntyche = () => {
  const h = (d: Date) => (lunSam(d) && jour(d) <= 19 ? 6 : 0); // congé du 21 au 30, SANS créneau
  return entrees({ salaireMensuel: 200, heuresHebdomadaires: 36, heuresParJour: 6,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (!lunSam(d) ? null : jour(d) <= 19 ? "P" : "C") }) });
};
const marie = () => {
  const h = (d: Date) => (lunSam(d) ? 8 : 0); // congé du 1er au 14 sur des créneaux de TRAVAIL laissés en place
  return entrees({ salaireMensuel: 200, heuresHebdomadaires: 48, heuresParJour: 8,
    jours: joursDuMois(2026, 9, { heures: h, faites: (d) => (jour(d) >= 15 ? h(d) : 0), code: (d) => (!lunSam(d) ? null : jour(d) <= 14 ? "C" : "P") }) });
};

describe("paie sur heures planifiées — salariés réels de septembre 2026", () => {
  it("Martine : 216 h planifiées toutes faites → 400,00 $ (au lieu de 369,23 $)", () => {
    const r = calculerReferenceMois(martine());
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(216);
    expect(r.tauxMois).toBeCloseTo(400 / 216, 10);
    expect(r.tauxContrat).toBeCloseTo(400 / 234, 10);
    expect(baseNette(r)).toBeCloseTo(400, 10);
    expect(netSalaire(r, 2)).toBeCloseTo(400, 2);
    const avant = calculerReferenceMois({ ...martine(), referencePlanningDepuis: null });
    expect(avant.source).toBe("CONTRAT");
    expect(baseNette(avant)).toBeCloseTo((216 * 400) / 234, 10); // 369,23 : le défaut mesuré
  });

  it("Esther : base 300,00 $, plus 2,08 h sup. imposées par son planning, au taux du CONTRAT", () => {
    const r = calculerReferenceMois(esther());
    expect(r.hs.hs30).toBeCloseTo(2.08, 10); // semaine du 14/09 : 54 h contre 51,92 h au contrat
    expect(r.heuresReference).toBe(220.92);
    expect(baseNette(r)).toBeCloseTo(300, 10);
    const t0 = 300 / (51.92 * 52 / 12);
    expect(r.moteur.hsValorisee).toBeCloseTo(2.08 * 1.3 * t0, 10);
    expect(netSalaire(r, 2)).toBeCloseTo(303.51, 2);
  });

  it("Rachel : 156 h planifiées, 180 h faites → les 24 h hors planning sont payées au taux du mois", () => {
    const r = calculerReferenceMois(rachel());
    expect(r.heuresReference).toBe(156);
    expect(r.moteur.heuresNormales).toBe(180);
    expect(baseNette(r)).toBeCloseTo((180 * 200) / 156, 10);
    expect(netSalaire(r, 0)).toBeCloseTo(230.77, 2);
  });

  it("Syntyche : congé hors planning entré dans la référence → 200,00 $, jamais 305,88 $", () => {
    const r = calculerReferenceMois(syntyche());
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(156); // 102 h planifiées + 9 j × 6 h de congé
    expect(r.affichage.joursPayesNonTravailles).toBe(9);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(54);
    expect(r.affichage.indemniteCongesNet).toBeCloseTo((54 * 200) / 156, 10);
    expect(baseNette(r)).toBeCloseTo(200, 10);
    expect(baseNette(r)).not.toBeCloseTo(305.88, 1);
  });

  it("Marie : congé posé sur des créneaux de travail → payé une fois, 200,00 $", () => {
    const r = calculerReferenceMois(marie());
    expect(r.heuresReference).toBe(208);
    expect(r.affichage.joursPayesNonTravailles).toBe(12);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(96);
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });
});

// ── Propriétés (salarié type : 208 $, 48 h, 8 h du lundi au samedi → t = t0 = 1 $/h) ──────────
const type6j = (g: Partial<Gabarit> = {}, e: Partial<EntreesReference> = {}) => {
  const h = (d: Date) => (lunSam(d) ? 8 : 0);
  return entrees({ salaireMensuel: 208, heuresHebdomadaires: 48, heuresParJour: 8,
    jours: joursDuMois(2026, 9, { heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null), ...g }), ...e });
};

describe("paie sur heures planifiées — propriétés", () => {
  it("absence injustifiée un jour planifié → retenue de ses 8 h au taux du mois", () => {
    const r = calculerReferenceMois(type6j({ faites: (d) => (lunSam(d) && jour(d) !== 17 ? 8 : 0), code: (d) => (!lunSam(d) ? null : jour(d) === 17 ? "N" : "P") }));
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });

  it("échange de jour (jeudi 17 manqué, samedi 19 non planifié travaillé) → neutre", () => {
    const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0); // 5 j × 8 h = 40 h, sous le seuil de 48 h
    const f = (d: Date) => (jour(d) === 17 ? 0 : jour(d) === 19 ? 8 : h(d));
    const r = calculerReferenceMois(entrees({ salaireMensuel: 200, heuresHebdomadaires: 48, heuresParJour: 8,
      jours: joursDuMois(2026, 9, { heures: h, faites: f, code: (d) => (f(d) > 0 ? "P" : jour(d) === 17 ? "N" : null) }) }));
    expect(r.heuresReference).toBe(176);
    expect(baseNette(r)).toBeCloseTo(200, 10);
  });

  it("mois entier en congé, créneaux de travail laissés → le salaire", () => {
    const r = calculerReferenceMois(type6j({ faites: () => 0, code: (d) => (lunSam(d) ? "C" : null) }));
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("mois entier en congé SANS aucun créneau → semaines couvertes, le salaire", () => {
    const r = calculerReferenceMois(type6j({ heures: () => 0, faites: () => 0, code: (d) => (lunSam(d) ? "C" : null) }));
    expect(r.source).toBe("PLANNING");
    expect(r.heuresReference).toBe(208); // 26 j × heuresParJour (pas de modèle)
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("mois entier en absence injustifiée → 0", () => {
    const r = calculerReferenceMois(type6j({ faites: () => 0, code: (d) => (lunSam(d) ? "N" : null) }));
    expect(baseNette(r)).toBe(0);
  });

  it("une semaine sans créneau, même en congé SANS SOLDE → repli sur le contrat", () => {
    const r = calculerReferenceMois(type6j({
      heures: (d) => (lunSam(d) && (jour(d) < 21 || jour(d) > 27) ? 8 : 0),
      faites: (d) => (lunSam(d) && (jour(d) < 21 || jour(d) > 27) ? 8 : 0),
      code: (d) => (!lunSam(d) ? null : jour(d) >= 21 && jour(d) <= 27 ? "S" : "P"),
    }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Planning incomplet : semaine du 21/09 sans créneau");
    expect(r.avertissements).toEqual([{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Planning incomplet : semaine du 21/09 sans créneau" }]);
    expect(r.heuresReference).toBe(208);
  });

  it("maladie deux jours planifiés → payés aux deux tiers", () => {
    const r = calculerReferenceMois(type6j({ faites: (d) => (lunSam(d) && jour(d) !== 16 && jour(d) !== 17 ? 8 : 0), code: (d) => (!lunSam(d) ? null : jour(d) === 16 || jour(d) === 17 ? "M" : "P") }));
    expect(baseNette(r)).toBeCloseTo(192 + (16 * 2) / 3, 10);
  });

  it("absence un jour NON planifié → sans effet", () => {
    const r = calculerReferenceMois(type6j({ heures: (d) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0), faites: (d) => (dow(d) >= 1 && dow(d) <= 5 ? 8 : 0), code: (d) => (dow(d) === 6 ? "N" : dow(d) === 0 ? null : "P") }));
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("mois d'embauche → repli, motif daté", () => {
    const r = calculerReferenceMois(type6j({}, { dateEmbauche: new Date("2026-09-15T00:00:00Z") }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Embauche le 15/09/2026 : mois incomplet");
  });

  it("avant la date d'effet (août 2026) ou sans date d'effet → ancienne règle, sans avertissement", () => {
    const aout = calculerReferenceMois({ ...type6j(), mois: 8, jours: joursDuMois(2026, 8, { heures: (d) => (lunSam(d) ? 8 : 0), faites: (d) => (lunSam(d) ? 8 : 0), code: (d) => (lunSam(d) ? "P" : null) }) });
    expect(aout.source).toBe("CONTRAT");
    expect(aout.avertissements).toEqual([]);
    expect(calculerReferenceMois(type6j({}, { referencePlanningDepuis: null })).source).toBe("CONTRAT");
  });

  it("semaine réduite à un dimanche (novembre 2026 commence un dimanche) → pas de repli", () => {
    const r = calculerReferenceMois({ ...type6j(), mois: 11, jours: joursDuMois(2026, 11, { heures: (d) => (lunSam(d) ? 8 : 0), faites: (d) => (lunSam(d) ? 8 : 0), code: (d) => (lunSam(d) ? "P" : null) }) });
    expect(r.source).toBe("PLANNING");
    expect(baseNette(r)).toBeCloseTo(208, 10);
  });

  it("uniquement des créneaux Repos → repli « Aucune heure planifiée ce mois »", () => {
    const r = calculerReferenceMois(type6j({ heures: () => 0, creneau: (d) => lunSam(d), faites: () => 0, code: () => null }));
    expect(r.source).toBe("CONTRAT_REPLI");
    expect(r.motif).toBe("Aucune heure planifiée ce mois");
  });
});

describe("paie sur heures planifiées — fériés et dimanches (règle B1 : double, jamais triple)", () => {
  const FERIE = new Set(["2026-09-15"]); // mardi (férié fictif pour le test)
  it("férié dû non travaillé, NON codé F, créneau système Férié → payé par le forfait : le salaire", () => {
    const r = calculerReferenceMois(type6j({
      heures: (d) => (lunSam(d) && jour(d) !== 15 ? 8 : 0), creneau: (d) => lunSam(d), modele: (d) => (lunSam(d) ? 8 : 0),
      faites: (d) => (lunSam(d) && jour(d) !== 15 ? 8 : 0), code: (d) => (lunSam(d) && jour(d) !== 15 ? "P" : null),
    }, { joursFeries: FERIE }));
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.moteur.hsValorisee).toBe(0);
  });
  it("férié dû travaillé 8 h → le salaire + la prime seule (8 × 1 × t0)", () => {
    const r = calculerReferenceMois(type6j({}, { joursFeries: FERIE }));
    expect(r.hs.hs100).toBe(8);
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.moteur.hsValorisee).toBeCloseTo(8, 10);
  });
  it("férié un jour de repos du modèle, travaillé 8 h → base + prime (16)", () => {
    const h = (d: Date) => (dow(d) >= 1 && dow(d) <= 5 && jour(d) !== 15 ? 8 : 0);
    const f = (d: Date) => (h(d) > 0 || jour(d) === 15 ? 8 : 0);
    const r = calculerReferenceMois(entrees({ salaireMensuel: 176, heuresHebdomadaires: 48, heuresParJour: 8, joursFeries: new Set(["2026-09-15"]),
      jours: joursDuMois(2026, 9, { heures: h, creneau: (d) => h(d) > 0 || jour(d) === 15, modele: (d) => (dow(d) >= 1 && dow(d) <= 5 && jour(d) !== 15 ? 8 : 0), faites: f, code: (d) => (f(d) > 0 ? "P" : null) }) }));
    expect(r.heuresReference).toBe(168);
    expect(baseNette(r)).toBeCloseTo(176, 10);
    expect(r.moteur.hsValorisee).toBeCloseTo(16 * (176 / (48 * 52 / 12)), 10);
  });
  it("dimanche travaillé hors planning → base + prime au taux du contrat, référence inchangée", () => {
    const r = calculerReferenceMois(type6j({ faites: (d) => (lunSam(d) || jour(d) === 20 ? 8 : 0), code: (d) => (lunSam(d) || jour(d) === 20 ? "P" : null) }));
    expect(r.heuresReference).toBe(208);
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.moteur.hsValorisee).toBeCloseTo(16, 10);
  });
});

describe("paie sur heures planifiées — avertissements", () => {
  it("taux de rôle sur un créneau → ignoré et signalé", () => {
    const r = calculerReferenceMois(type6j({ tauxRole: (d) => (jour(d) === 3 ? 5 : null) }));
    expect(baseNette(r)).toBeCloseTo(208, 10);
    expect(r.avertissements).toEqual([{ code: "TAUX_ROLE_IGNORE", message: "Taux de rôle ignoré (paie sur le planning) : 03/09" }]);
  });
  it("planning très inférieur au contrat (t > 1,3 × t0) → signalé", () => {
    const h = (d: Date) => ([1, 3, 5].includes(dow(d)) ? 8 : 0); // 13 j × 8 h = 104 h → t = 2
    const r = calculerReferenceMois(type6j({ heures: h, faites: h, code: (d) => (h(d) > 0 ? "P" : null) }));
    expect(r.tauxMois).toBeCloseTo(2, 10);
    expect(r.avertissements.map((a) => a.code)).toEqual(["TAUX_MOIS_SUPERIEUR_HS"]);
    expect(r.avertissements[0].message).toBe("Taux du mois 2,0000 $/h au-dessus d'une heure supplémentaire à +30 % (1,3000 $/h) : planning très inférieur au contrat");
  });
});

describe("ancienne règle (mode contrat) — reproduite à l'identique", () => {
  it("taux de rôle pondéré, jours payés à la journée, heures contrat arrondies", () => {
    const r = calculerReferenceMois(type6j({ tauxRole: (d) => (jour(d) === 3 ? 2 : null), faites: (d) => (lunSam(d) && jour(d) !== 4 ? 8 : 0), code: (d) => (!lunSam(d) ? null : jour(d) === 4 ? "O" : "P") }, { referencePlanningDepuis: null, joursCongePris: 0 }));
    expect(r.source).toBe("CONTRAT");
    expect(r.heuresReference).toBe(208);
    expect(r.moteur.salaireHoraire).toBeCloseTo((192 * 1 + 8 * 2) / 200, 10);
    expect(r.moteur.salaireJournalier).toBeCloseTo(8 * ((192 + 16) / 200), 10);
    expect(r.moteur.joursPayesNonTravailles).toBe(1);
    expect(r.affichage.heuresPayeesNonTravaillees).toBe(8);
  });
});
```

- [ ] **Step 2 : les voir échouer**

Run : `npx vitest run src/lib/paie-reference.test.ts`
Attendu : FAIL, `Failed to resolve import "./paie-reference"`.

- [ ] **Step 3 : implémentation** — `src/lib/paie-reference.ts` (fichier complet ; prototypé et rejoué sur les 17 salariés brigade de septembre 2026 : ancienne règle = lignes stockées à ±0,01 $, nouvelle règle = tableau de la note §10)

```ts
// Référence d'heures du mois et base de paie BRIGADE — module PUR (ni base, ni `server-only`).
// Spec : docs/superpowers/specs/2026-09-23-paie-heures-planifiees-design.md (+ annexe note Nagi).
import { calculerHeuresSupp, type CodePresence, type HeuresSuppResultat, type ParametresPaie } from "@/lib/payroll";
import { lundiDe } from "@/lib/dates-fr";

/** 52 semaines ÷ 12 mois : référence CONTRAT (ancienne règle, repli). */
export const SEMAINES_PAR_MOIS = 52 / 12;

export type SourceReference = "PLANNING" | "CONTRAT" | "CONTRAT_REPLI";

export type CodeAvertissementPaie =
  | "REPLI_CONTRAT"
  | "TAUX_ROLE_IGNORE"
  | "TAUX_MOIS_SUPERIEUR_HS"
  | "SAISIE_ANTICIPEE"
  | "PRESENCE_SANS_CRENEAU"
  | "PLANNING_MODIFIE_APRES_HEURES";

export type AvertissementPaie = { code: CodeAvertissementPaie; message: string };

/** Un jour du mois pour un salarié. Toutes les dates sont des dates PURES (minuit UTC). */
export type JourReference = {
  date: Date;
  /** Durée du créneau de TRAVAIL du jour (`dureeShift`) ; 0 si aucun créneau ou créneau système. */
  heuresPlanifiees: number;
  /** Un créneau existe ce jour-là, système compris (Repos/Congé/Férié) — sert à la complétude. */
  aUnCreneau: boolean;
  /** Durée prévue par le modèle ce jour-là (couche A/B puis « chaque semaine ») ; 0 si le modèle
   *  ne prévoit rien ce jour ; `null` si le salarié n'a AUCUN modèle. */
  heuresModele: number | null;
  code: CodePresence | null;
  /** Heures saisies (`OvertimeEntry`) ; 0 si aucune. */
  heuresFaites: number;
  /** `Shift.tauxHoraireUSD` du créneau du jour, `null` sinon. */
  tauxRole: number | null;
};

export type EntreesReference = {
  annee: number;
  mois: number; // 1..12
  /** Exactement un élément par jour du mois, dans l'ordre. */
  jours: JourReference[];
  salaireMensuel: number;
  /** Valeur BRUTE de la fiche (`Employee.heuresHebdomadaires`) : seuil des HS, comme aujourd'hui. */
  heuresHebdomadaires: number;
  heuresParJour: number;
  dateEmbauche: Date;
  joursFeries: Set<string>; // "AAAA-MM-JJ"
  /** Décompte d'aujourd'hui (max(codes C, congés approuvés)) — sert au seul affichage en mode contrat. */
  joursCongePris: number;
  /** AAAAMM à partir duquel la règle s'applique ; `null` = jamais (ancienne règle partout). */
  referencePlanningDepuis: number | null;
  params: ParametresPaie;
};

/** Entrées de `calculerPaieBrigade` produites par la référence. En mode PLANNING, l'unité des
 *  « jours » est l'HEURE : `salaireJournalier` vaut le taux horaire du mois et
 *  `joursPayesNonTravailles` / `joursPayes2_3` des heures — le produit reste exact. */
export type EntreesMoteurBrigade = {
  salaireHoraire: number;
  salaireJournalier: number;
  heuresNormales: number;
  joursPayesNonTravailles: number;
  joursPayes2_3: number;
  hsValorisee: number;
};

export type ResultatReference = {
  source: SourceReference;
  motif: string | null;
  /** R (mode PLANNING) ou heures/sem × 52/12 arrondi au centième (modes contrat). */
  heuresReference: number;
  /** t = S / R en mode PLANNING ; taux de l'ancienne règle sinon. */
  tauxMois: number;
  /** t0 = S / (H × 52/12). */
  tauxContrat: number;
  hs: HeuresSuppResultat;
  moteur: EntreesMoteurBrigade;
  affichage: {
    /** Nombre de JOURS payés non travaillés (colonne Int `joursPayesNonTravailles`). */
    joursPayesNonTravailles: number;
    /** Heures correspondantes (nouvelle colonne `heuresPayeesNonTravaillees`). */
    heuresPayeesNonTravaillees: number;
    /** Montant NET de ces jours, avant facteur de reconstitution ρ. */
    montantJoursPayesNet: number;
    /** Indemnité de congé NETTE, avant ρ. */
    indemniteCongesNet: number;
  };
  avertissements: AvertissementPaie[];
};

const PAYES_100: ReadonlySet<string> = new Set(["C", "A", "O", "F"]);
const CODES_SEMAINE_COUVERTE: ReadonlySet<string> = new Set(["C", "A", "M", "O", "F"]);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const jjmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const virgule = (n: number, dec: number) => n.toFixed(dec).replace(".", ",");

export function calculerReferenceMois(e: EntreesReference): ResultatReference {
  const hebdo = e.heuresHebdomadaires || e.heuresParJour * 6;
  const heuresContrat = hebdo * SEMAINES_PAR_MOIS;
  const t0 = e.salaireMensuel / heuresContrat;
  const joursFaits = e.jours
    .filter((j) => j.heuresFaites > 0)
    .map((j) => ({ date: j.date, heuresTravaillees: j.heuresFaites }));

  const debutMois = new Date(Date.UTC(e.annee, e.mois - 1, 1));
  const enVigueur = e.referencePlanningDepuis != null && e.annee * 100 + e.mois >= e.referencePlanningDepuis;
  if (!enVigueur) return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT", null);

  // ── Repli : mois d'embauche ─────────────────────────────────────────────────────────────────
  if (e.dateEmbauche.getTime() > debutMois.getTime()) {
    const d = e.dateEmbauche;
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI",
      `Embauche le ${jjmm(d)}/${d.getUTCFullYear()} : mois incomplet`);
  }

  // ── Repli : une semaine sans aucun créneau ──────────────────────────────────────────────────
  const semaines = new Map<string, JourReference[]>();
  for (const j of e.jours) {
    const cle = iso(lundiDe(j.date));
    (semaines.get(cle) ?? semaines.set(cle, []).get(cle)!).push(j);
  }
  const vides: string[] = [];
  for (const [lundi, js] of semaines) {
    if (js.some((j) => j.aUnCreneau)) continue;
    const ouvrables = js.filter((j) => j.date.getUTCDay() !== 0 && !e.joursFeries.has(iso(j.date)));
    if (ouvrables.every((j) => j.code != null && CODES_SEMAINE_COUVERTE.has(j.code))) continue; // vide = rien à planifier
    vides.push(`semaine du ${jjmm(new Date(lundi + "T00:00:00Z"))} sans créneau`);
  }
  if (vides.length > 0) {
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI", `Planning incomplet : ${vides.join(", ")}`);
  }

  // ── Référence R ─────────────────────────────────────────────────────────────────────────────
  const hdu = (j: JourReference) =>
    j.heuresPlanifiees > 0 ? j.heuresPlanifiees : j.heuresModele !== null ? j.heuresModele : e.heuresParJour;

  const hsPlan = calculerHeuresSupp({
    jours: e.jours.filter((j) => j.heuresPlanifiees > 0).map((j) => ({ date: j.date, heuresTravaillees: j.heuresPlanifiees })),
    heuresParJourContrat: e.heuresParJour,
    heuresHebdoContrat: e.heuresHebdomadaires,
    salaireHoraire: 1,
    joursFeries: e.joursFeries,
    params: e.params,
  });
  let R = hsPlan.heuresTotalesMois - hsPlan.hs30 - hsPlan.hs60 - hsPlan.hs100;

  let heuresPayees100 = 0;
  let heuresMaladie = 0;
  let heuresConge = 0;
  let joursPayes = 0;
  let heuresBaseFerieTravaille = 0; // base d'un férié dû travaillé : déjà payée par le forfait
  for (const j of e.jours) {
    if (j.date.getUTCDay() === 0) continue; // dimanche : jamais dans la référence
    if (e.joursFeries.has(iso(j.date))) {
      const h = hdu(j);
      if (h <= 0) continue; // férié tombant un jour de repos : rien à payer au forfait
      R += h;
      heuresPayees100 += h; // chômé et payé, codé F ou non
      if (j.heuresFaites > 0) heuresBaseFerieTravaille += Math.min(j.heuresFaites, h);
      else joursPayes++;
      continue;
    }
    if (j.heuresFaites > 0 || j.code == null) continue;
    const payeCent = PAYES_100.has(j.code);
    if (!payeCent && j.code !== "M") continue;
    const h = j.heuresPlanifiees > 0 ? j.heuresPlanifiees : hdu(j);
    if (j.heuresPlanifiees <= 0) R += h; // sinon déjà dans les heures planifiées
    if (payeCent) { heuresPayees100 += h; joursPayes++; if (j.code === "C") heuresConge += h; }
    else heuresMaladie += h;
  }

  if (R <= 0) {
    return ancienneRegle(e, t0, heuresContrat, joursFaits, "CONTRAT_REPLI", "Aucune heure planifiée ce mois");
  }

  const t = e.salaireMensuel / R;
  const hs = calculerHeuresSupp({
    jours: joursFaits,
    heuresParJourContrat: e.heuresParJour,
    heuresHebdoContrat: e.heuresHebdomadaires,
    salaireHoraire: t0, // décision Direction : HS au taux du CONTRAT
    joursFeries: e.joursFeries,
    params: e.params,
  });

  const avertissements: AvertissementPaie[] = [];
  const joursRole = e.jours.filter((j) => j.tauxRole != null && (j.heuresPlanifiees > 0 || j.heuresFaites > 0));
  if (joursRole.length > 0) {
    avertissements.push({ code: "TAUX_ROLE_IGNORE", message: `Taux de rôle ignoré (paie sur le planning) : ${joursRole.map((j) => jjmm(j.date)).join(", ")}` });
  }
  const seuilHs = t0 * (1 + e.params.hsMajTranche1);
  if (t > seuilHs) {
    avertissements.push({ code: "TAUX_MOIS_SUPERIEUR_HS", message: `Taux du mois ${virgule(t, 4)} $/h au-dessus d'une heure supplémentaire à +${Math.round(e.params.hsMajTranche1 * 100)} % (${virgule(seuilHs, 4)} $/h) : planning très inférieur au contrat` });
  }

  return {
    source: "PLANNING",
    motif: null,
    heuresReference: Math.round(R * 100) / 100,
    tauxMois: t,
    tauxContrat: t0,
    hs,
    moteur: {
      salaireHoraire: t,
      salaireJournalier: t, // unité = l'heure (voir EntreesMoteurBrigade)
      heuresNormales: hs.heuresTotalesMois - hs.hs30 - hs.hs60 - hs.hs100,
      joursPayesNonTravailles: heuresPayees100,
      joursPayes2_3: heuresMaladie,
      hsValorisee: hs.hsValorisee - t0 * heuresBaseFerieTravaille,
    },
    affichage: {
      joursPayesNonTravailles: joursPayes,
      heuresPayeesNonTravaillees: heuresPayees100,
      montantJoursPayesNet: t * heuresPayees100,
      indemniteCongesNet: t * heuresConge,
    },
    avertissements,
  };
}

/** L'ANCIENNE règle, à l'identique de `paie-batch.ts` avant ce lot (taux de rôle pondérés compris). */
function ancienneRegle(
  e: EntreesReference,
  t0: number,
  heuresContrat: number,
  joursFaits: { date: Date; heuresTravaillees: number }[],
  source: "CONTRAT" | "CONTRAT_REPLI",
  motif: string | null,
): ResultatReference {
  let sommeH = 0;
  let sommeHT = 0;
  for (const j of e.jours) {
    if (j.heuresFaites <= 0) continue;
    sommeH += j.heuresFaites;
    sommeHT += j.heuresFaites * (j.tauxRole ?? t0);
  }
  const salaireHoraire = sommeH > 0 ? sommeHT / sommeH : t0;
  const salaireJournalier = salaireHoraire * e.heuresParJour;
  const hs = calculerHeuresSupp({
    jours: joursFaits,
    heuresParJourContrat: e.heuresParJour,
    heuresHebdoContrat: e.heuresHebdomadaires,
    salaireHoraire: t0,
    joursFeries: e.joursFeries,
    params: e.params,
  });
  let jours = 0;
  let joursMaladie = 0;
  for (const j of e.jours) {
    if (j.heuresFaites > 0 || j.code == null) continue;
    if (PAYES_100.has(j.code)) jours++;
    else if (j.code === "M") joursMaladie++;
  }
  return {
    source,
    motif,
    heuresReference: Math.round(heuresContrat * 100) / 100,
    tauxMois: t0,
    tauxContrat: t0,
    hs,
    moteur: {
      salaireHoraire,
      salaireJournalier,
      heuresNormales: hs.heuresTotalesMois - hs.hs30 - hs.hs60 - hs.hs100,
      joursPayesNonTravailles: jours,
      joursPayes2_3: joursMaladie,
      hsValorisee: hs.hsValorisee,
    },
    affichage: {
      joursPayesNonTravailles: jours,
      heuresPayeesNonTravaillees: jours * e.heuresParJour,
      montantJoursPayesNet: salaireJournalier * jours,
      indemniteCongesNet: e.joursCongePris * salaireJournalier,
    },
    avertissements: source === "CONTRAT_REPLI" && motif ? [{ code: "REPLI_CONTRAT", message: `Référence contrat (repli) — ${motif}` }] : [],
  };
}
```

- [ ] **Step 4 : les voir passer**

Run : `npx vitest run src/lib/paie-reference.test.ts && npx eslint src/lib/paie-reference.ts src/lib/paie-reference.test.ts`
Attendu : 24 tests PASS, aucune erreur eslint.

- [ ] **Step 5 : falsifier** (chaque mutation seule, puis rétablir ; chacune doit faire rougir au moins le test indiqué)

| Mutation dans `paie-reference.ts` | Test qui doit rougir |
|---|---|
| `hsValorisee: hs.hsValorisee - t0 * heuresBaseFerieTravaille` → `hsValorisee: hs.hsValorisee` | « férié dû travaillé 8 h … » |
| `if (j.heuresPlanifiees <= 0) R += h;` → `R += h;` | « Marie … », « mois entier en congé, créneaux de travail laissés … », « maladie … » |
| `ouvrables.every((j) => j.code != null && CODES_SEMAINE_COUVERTE.has(j.code))` → `false` | « Syntyche … », « mois entier en congé SANS aucun créneau … », « semaine réduite à un dimanche … » |
| `salaireHoraire: t0, // décision Direction` → `salaireHoraire: t,` | « Esther … », « férié un jour de repos … » |
| ajouter `"S"` à `CODES_SEMAINE_COUVERTE` | « une semaine sans créneau, même en congé SANS SOLDE … » |

- [ ] **Step 6 : commit**

```bash
git add src/lib/paie-reference.ts src/lib/paie-reference.test.ts
git commit -m "feat(paie): calculer la référence du mois sur les heures planifiées

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3 : les avertissements de saisie (`src/lib/paie-avertissements.ts`)

**Files :**
- Create : `src/lib/paie-avertissements.ts`, `src/lib/paie-avertissements.test.ts`

**Interfaces :**
- Consumes : `jourCivilKinshasa` de `@/lib/heure-kinshasa` (module pur) ; `type AvertissementPaie` de `@/lib/paie-reference` (tâche 2).
- Produces :
  - `export type JourSaisie = { date: Date; code: string | null; codeSaisiLe: Date | null; heuresFaites: number; heuresSaisiesLe: Date | null; heuresModifieesLe: Date | null; heuresPlanifiees: number; creneauModifieLe: Date | null }`
  - `export function detecterAvertissementsSaisie(jours: JourSaisie[], opts: { referencePlanning: boolean }): AvertissementPaie[]` — ordre de sortie : `SAISIE_ANTICIPEE`, puis (si `referencePlanning`) `PRESENCE_SANS_CRENEAU`, `PLANNING_MODIFIE_APRES_HEURES` ; message `"<libellé> (<n> j) : JJ/MM, JJ/MM"`.
  - `export function lireAvertissements(json: unknown): AvertissementPaie[]`

Règles (spec §6.3, décision 4 de la Direction : avertir, jamais bloquer) :
- **Saisi d'avance** : code ou heures dont la date de SAISIE (jour civil de Kinshasa de `createdAt`) précède le jour saisi. Cas réel : lot du 22/09/2026 12:52 UTC pour les jours du 24 au 30/09.
- **Travail hors planning** (sous la règle planning seulement) : code P ou heures > 0 un jour sans créneau de travail. Cas réel : Rachel Lunda, 28 et 30/09.
- **Planning modifié après la saisie des heures** (sous la règle planning seulement) : créneau de travail et heures le même jour, `PlanningCreneau.updatedAt > OvertimeEntry.updatedAt`, heures ≠ durée planifiée. Cas réel : Jeannette Bongota et Thérèse Moleka, 21→30/09, créneaux modifiés à 15:09 et 15:13 après les heures de 12:52.

- [ ] **Step 1 : les tests qui échouent** — `src/lib/paie-avertissements.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { detecterAvertissementsSaisie, lireAvertissements, type JourSaisie } from "./paie-avertissements";

const j = (iso: string, e: Partial<JourSaisie> = {}): JourSaisie => ({
  date: new Date(`${iso}T00:00:00Z`), code: "P", codeSaisiLe: new Date(`${iso}T18:00:00Z`), heuresFaites: 8,
  heuresSaisiesLe: new Date(`${iso}T18:00:00Z`), heuresModifieesLe: new Date(`${iso}T18:00:00Z`),
  heuresPlanifiees: 8, creneauModifieLe: new Date("2026-09-01T08:00:00Z"), ...e,
});
// Saisie en lot RÉELLE du 22/09/2026 à 12:52 (UTC) — Jeannette Bongota, Rachel Lunda.
const LOT = new Date("2026-09-22T12:52:22Z");

describe("detecterAvertissementsSaisie", () => {
  it("rien à signaler sur des saisies du jour même", () => {
    expect(detecterAvertissementsSaisie([j("2026-09-21"), j("2026-09-22")], { referencePlanning: true })).toEqual([]);
  });

  it("présences et heures saisies avant le jour concerné → SAISIE_ANTICIPEE, avec les dates", () => {
    const jours = ["2026-09-22", "2026-09-24", "2026-09-25"].map((d) => j(d, { codeSaisiLe: LOT, heuresSaisiesLe: LOT, heuresModifieesLe: LOT }));
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: false })).toEqual([
      { code: "SAISIE_ANTICIPEE", message: "Saisi d'avance (2 j) : 24/09, 25/09" },
    ]);
  });

  it("le jour se lit à l'heure de Kinshasa : 23:30 UTC le 21 = le 22 à Kinshasa → pas d'avance pour le 22", () => {
    const tard = new Date("2026-09-21T23:30:00Z");
    expect(detecterAvertissementsSaisie([j("2026-09-22", { codeSaisiLe: tard, heuresSaisiesLe: tard, heuresModifieesLe: tard })], { referencePlanning: false })).toEqual([]);
  });

  it("jour codé P sans créneau (Rachel, 28 et 30/09) → PRESENCE_SANS_CRENEAU, seulement sous la règle planning", () => {
    const jours = [j("2026-09-28", { heuresPlanifiees: 0, creneauModifieLe: null }), j("2026-09-30", { heuresPlanifiees: 0, creneauModifieLe: null })];
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: true })).toEqual([
      { code: "PRESENCE_SANS_CRENEAU", message: "Travail hors planning (2 j) : 28/09, 30/09" },
    ]);
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: false })).toEqual([]);
  });

  it("créneau modifié APRÈS les heures et heures différentes (Jeannette, 21/09) → PLANNING_MODIFIE_APRES_HEURES", () => {
    const jours = [
      j("2026-09-21", { heuresPlanifiees: 8, heuresFaites: 6, heuresSaisiesLe: new Date("2026-09-21T18:00:00Z"), heuresModifieesLe: new Date("2026-09-21T18:00:00Z"), creneauModifieLe: new Date("2026-09-22T15:09:11Z") }),
      j("2026-09-23", { heuresPlanifiees: 8, heuresFaites: 8, creneauModifieLe: new Date("2026-09-24T15:00:00Z") }), // mêmes heures : rien
    ];
    expect(detecterAvertissementsSaisie(jours, { referencePlanning: true })).toEqual([
      { code: "PLANNING_MODIFIE_APRES_HEURES", message: "Planning modifié après la saisie des heures (1 j) : 21/09" },
    ]);
  });
});

describe("lireAvertissements", () => {
  it("relit un tableau JSON bien formé et ignore le reste", () => {
    const ok = { code: "REPLI_CONTRAT", message: "Référence contrat (repli) — x" };
    expect(lireAvertissements([ok, { code: "INCONNU", message: "?" }, { code: "SAISIE_ANTICIPEE" }, null, 3])).toEqual([ok]);
    expect(lireAvertissements(null)).toEqual([]);
    expect(lireAvertissements({})).toEqual([]);
  });
});
```

- [ ] **Step 2 : les voir échouer**

Run : `npx vitest run src/lib/paie-avertissements.test.ts`
Attendu : FAIL, `Failed to resolve import "./paie-avertissements"`.

- [ ] **Step 3 : implémentation** — `src/lib/paie-avertissements.ts`

```ts
// Avertissements de SAISIE sur une ligne de paie — module PUR. Ne bloquent jamais : la Direction
// voit et tranche (spec paie-heures-planifiees §6.3). Les avertissements de CALCUL (repli, taux de
// rôle, taux du mois) viennent de `calculerReferenceMois` (paie-reference.ts).
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import type { AvertissementPaie } from "@/lib/paie-reference";

export type JourSaisie = {
  date: Date; // date PURE (minuit UTC)
  code: string | null;
  codeSaisiLe: Date | null; // Attendance.createdAt
  heuresFaites: number;
  heuresSaisiesLe: Date | null; // OvertimeEntry.createdAt
  heuresModifieesLe: Date | null; // OvertimeEntry.updatedAt
  heuresPlanifiees: number; // durée du créneau de TRAVAIL, 0 sinon
  creneauModifieLe: Date | null; // PlanningCreneau.updatedAt, null sans créneau
};

const jjmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const avant = (instant: Date | null, jour: Date) => instant != null && jourCivilKinshasa(instant).getTime() < jour.getTime();

export function detecterAvertissementsSaisie(jours: JourSaisie[], opts: { referencePlanning: boolean }): AvertissementPaie[] {
  const tries = [...jours].sort((a, b) => a.date.getTime() - b.date.getTime());
  const sortie: AvertissementPaie[] = [];
  const pousser = (code: AvertissementPaie["code"], libelle: string, js: JourSaisie[]) => {
    if (js.length > 0) sortie.push({ code, message: `${libelle} (${js.length} j) : ${js.map((j) => jjmm(j.date)).join(", ")}` });
  };

  pousser("SAISIE_ANTICIPEE", "Saisi d'avance", tries.filter((j) =>
    (j.code != null && avant(j.codeSaisiLe, j.date)) || (j.heuresFaites > 0 && avant(j.heuresSaisiesLe, j.date))));

  if (opts.referencePlanning) {
    pousser("PRESENCE_SANS_CRENEAU", "Travail hors planning", tries.filter((j) =>
      (j.code === "P" || j.heuresFaites > 0) && j.heuresPlanifiees <= 0));
    pousser("PLANNING_MODIFIE_APRES_HEURES", "Planning modifié après la saisie des heures", tries.filter((j) =>
      j.heuresPlanifiees > 0 && j.heuresFaites > 0 && j.creneauModifieLe != null && j.heuresModifieesLe != null &&
      j.creneauModifieLe.getTime() > j.heuresModifieesLe.getTime() && Math.abs(j.heuresFaites - j.heuresPlanifiees) > 0.01));
  }
  return sortie;
}

const CODES: ReadonlySet<string> = new Set<AvertissementPaie["code"]>([
  "REPLI_CONTRAT", "TAUX_ROLE_IGNORE", "TAUX_MOIS_SUPERIEUR_HS", "SAISIE_ANTICIPEE", "PRESENCE_SANS_CRENEAU", "PLANNING_MODIFIE_APRES_HEURES",
]);

/** Relit la colonne JSON `PayrollLine.avertissementsPaie` : ne garde que les entrées bien formées
 *  (une colonne JSON n'a pas de schéma ; une ligne ancienne ou abîmée ne doit pas faire planter l'écran). */
export function lireAvertissements(json: unknown): AvertissementPaie[] {
  if (!Array.isArray(json)) return [];
  return json.filter((a): a is AvertissementPaie =>
    typeof a === "object" && a !== null && CODES.has((a as { code?: unknown }).code as string) &&
    typeof (a as { message?: unknown }).message === "string");
}
```

- [ ] **Step 4 : les voir passer**

Run : `npx vitest run src/lib/paie-avertissements.test.ts && npx eslint src/lib/paie-avertissements.ts src/lib/paie-avertissements.test.ts`
Attendu : 6 tests PASS.

- [ ] **Step 5 : falsifier** (une à la fois, puis rétablir)

| Mutation | Test qui doit rougir |
|---|---|
| dans `avant`, remplacer `jourCivilKinshasa(instant).getTime()` par `new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate())).getTime()` | « le jour se lit à l'heure de Kinshasa … » |
| `if (opts.referencePlanning) {` → `if (true) {` | « jour codé P sans créneau … » |
| `Math.abs(j.heuresFaites - j.heuresPlanifiees) > 0.01` → `true` | « créneau modifié APRÈS les heures … » |

- [ ] **Step 6 : commit**

```bash
git add src/lib/paie-avertissements.ts src/lib/paie-avertissements.test.ts
git commit -m "feat(paie): détecter les saisies d'avance, le travail hors planning et le planning modifié après coup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4 : schéma, migrations additives, paramètre daté

**Files :**
- Modify : `prisma/schema.prisma`, `src/lib/payroll.ts` (type seul), `src/lib/config.ts`, `src/lib/test/db.ts`, `scripts/seed-legal-2026.ts`
- Create : `prisma/migrations/20260924090000_paie_reference_planning/migration.sql`, `prisma/migrations/20260924090100_param_reference_planning/migration.sql`, `scripts/_verifier-migrations.mjs`
- Test : `src/lib/config-reference-planning.integration.test.ts`

**Interfaces :**
- Produces :
  - Prisma : `enum SourceReferencePaie { PLANNING CONTRAT CONTRAT_REPLI }` ; sur `PayrollLine` : `sourceReference SourceReferencePaie @default(CONTRAT)`, `motifReference String?`, `heuresPayeesNonTravaillees Decimal @default(0) @db.Decimal(6, 2)`, `avertissementsPaie Json @default("[]")`.
  - `ParametresPaie.referencePlanningDepuis?: number | null` (payroll.ts) ; `chargerParametresPaie()` le renseigne (`null` si la clé est absente ou vide).
  - `seedParametresLegaux(prisma: PrismaClient, annee = 2026, options: { referencePlanningDepuis?: number } = {})`.
  - `node scripts/_verifier-migrations.mjs` : sortie 0 = migrations cohérentes.

- [ ] **Step 1 : le test qui échoue** — `src/lib/config-reference-planning.integration.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// La date d'effet de la paie sur heures planifiées est un PARAMÈTRE (ParametreLegal, ADMIN seul),
// jamais une date écrite dans le code. Absent = ancienne règle partout (bases pas encore migrées).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { chargerParametresPaie } = await import("./config");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let exerciceId: number;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  exerciceId = (await seedParametresLegaux(prisma, 2026)).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("paramètre paie_reference_planning_depuis", () => {
  it("absent → null (ancienne règle)", async () => {
    expect((await chargerParametresPaie()).referencePlanningDepuis).toBeNull();
  });
  it("présent → 202609 (lu en nombre)", async () => {
    await prisma.parametreLegal.create({ data: { exerciceId, cle: "paie_reference_planning_depuis", valeur: 202609, unite: "AAAAMM", libelle: "test" } });
    expect((await chargerParametresPaie()).referencePlanningDepuis).toBe(202609);
  });
  it("le seed de test sait le poser", async () => {
    const db2 = await creerBaseTest();
    try {
      await seedParametresLegaux(db2.prisma, 2026, { referencePlanningDepuis: 202609 });
      const p = await db2.prisma.parametreLegal.findFirst({ where: { cle: "paie_reference_planning_depuis" } });
      expect(Number(p?.valeur)).toBe(202609);
    } finally { await db2.fermer(); }
  }, 120_000);
});
```

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/config-reference-planning.integration.test.ts`
Attendu : FAIL (`referencePlanningDepuis` vaut `undefined`, pas `null` ; le 3e test échoue sur la signature du seed).

- [ ] **Step 3 : schéma** — dans `prisma/schema.prisma` :
1. juste avant `model PayrollLine {`, ajouter :
```prisma
/// D'où vient la référence d'heures d'une ligne de paie (spec 2026-09-23-paie-heures-planifiees).
enum SourceReferencePaie {
  PLANNING // heures planifiées du mois (brigade, à partir de la date d'effet)
  CONTRAT // heures/semaine × 52/12 (mois antérieurs, back-office, stagiaires)
  CONTRAT_REPLI // planning incomplet ou mois d'embauche : retombée visible sur le contrat

  @@schema("public")
}
```
2. dans `model PayrollLine`, remplacer la ligne `heuresContractuelles Decimal @default(0) @db.Decimal(6, 2)` par :
```prisma
  // Référence du mois (paie sur heures planifiées, 2026-09-23) : R en mode PLANNING, heures/sem ×
  // 52/12 sinon. La SOURCE dit laquelle ; le MOTIF dit pourquoi un mois est retombé sur le contrat.
  heuresContractuelles Decimal             @default(0) @db.Decimal(6, 2)
  sourceReference      SourceReferencePaie @default(CONTRAT)
  motifReference       String?
  // Heures des jours payés non travaillés (congés, fériés dus, repos payés, absences payées) :
  // la base du bulletin se lit en heures × taux. 0 = ligne antérieure au 2026-09-23.
  heuresPayeesNonTravaillees Decimal @default(0) @db.Decimal(6, 2)
  // Avertissements (repli, saisies d'avance, travail hors planning…) figés avec la ligne : une
  // ligne validée garde la trace de ce que la Direction a vu en validant. Jamais bloquants.
  avertissementsPaie Json @default("[]")
```
Puis `npx prisma format` (formatage seul, aucune base touchée) et `npx prisma generate`.

- [ ] **Step 4 : migrations** — écrire à la main (JAMAIS `prisma migrate dev`, qui viserait la production).

`prisma/migrations/20260924090000_paie_reference_planning/migration.sql` :
```sql
-- Paie brigade sur heures planifiées (spec 2026-09-23) — migration PUREMENT ADDITIVE.
-- Les lignes existantes prennent la source CONTRAT : elles ont été calculées sur le contrat.

-- CreateEnum
CREATE TYPE "public"."SourceReferencePaie" AS ENUM ('PLANNING', 'CONTRAT', 'CONTRAT_REPLI');

-- AlterTable
ALTER TABLE "public"."PayrollLine" ADD COLUMN     "avertissementsPaie" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "heuresPayeesNonTravaillees" DECIMAL(6,2) NOT NULL DEFAULT 0,
ADD COLUMN     "motifReference" TEXT,
ADD COLUMN     "sourceReference" "public"."SourceReferencePaie" NOT NULL DEFAULT 'CONTRAT';
```

`prisma/migrations/20260924090100_param_reference_planning/migration.sql` :
```sql
-- Date d'effet de la paie brigade sur heures planifiées : septembre 2026 (AAAAMM = 202609).
-- Décision Direction 2026-09-23. Idempotent : n'écrase jamais une valeur déjà réglée par l'ADMIN.
-- Les mois antérieurs (juin, juillet encore « Pas validé ») restent calculés sur le contrat.
INSERT INTO "public"."ParametreLegal" ("exerciceId", "cle", "valeur", "unite", "libelle", "source", "statutValidation", "commentaire", "updatedAt")
SELECT e."id", 'paie_reference_planning_depuis', 202609, 'AAAAMM',
       'Paie brigade — référence = heures planifiées à partir du mois (AAAAMM)',
       'Décision Direction 2026-09-23', 'A_VALIDER',
       'Vide = ancienne règle (heures/semaine × 52/12) pour tous les mois.', now()
FROM "public"."ExerciceFiscal" e
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."ParametreLegal" x WHERE x."exerciceId" = e."id" AND x."cle" = 'paie_reference_planning_depuis'
);
```

- [ ] **Step 5 : code** 

`src/lib/payroll.ts`, dans `export type ParametresPaie`, après `salairesSaisisEnNet?: boolean;` :
```ts
  // Mois (AAAAMM) à partir duquel la brigade est payée sur les heures PLANIFIÉES du mois
  // (spec 2026-09-23-paie-heures-planifiees, src/lib/paie-reference.ts). null/undefined = jamais.
  referencePlanningDepuis?: number | null;
```
`src/lib/config.ts`, dans l'objet retourné, après `salairesSaisisEnNet: …,` :
```ts
    // Date d'effet de la paie sur heures planifiées (AAAAMM). Absente ou vide = ancienne règle :
    // `optionnel`, jamais `requis`, pour ne bloquer aucune base pas encore migrée.
    referencePlanningDepuis: optionnel("paie_reference_planning_depuis"),
```
`src/lib/test/db.ts` : signature `export async function seedParametresLegaux(prisma: PrismaClient, annee = 2026, options: { referencePlanningDepuis?: number } = {})`, et juste avant `return exercice;` :
```ts
  // Date d'effet de la paie sur heures planifiées : posée seulement si le test la demande — les
  // tests existants (juillet 2026) restent ainsi sur l'ancienne règle sans le savoir.
  if (options.referencePlanningDepuis != null) {
    await prisma.parametreLegal.create({
      data: { exerciceId: exercice.id, cle: "paie_reference_planning_depuis", valeur: options.referencePlanningDepuis, unite: "AAAAMM", libelle: "Paie brigade — référence = heures planifiées à partir du mois (AAAAMM)" },
    });
  }
```
`scripts/seed-legal-2026.ts`, dans le tableau `PARAMS`, après l'entrée `salaires_saisis_en_net` :
```ts
  {
    cle: "paie_reference_planning_depuis",
    valeur: 202609,
    unite: "AAAAMM",
    libelle: "Paie brigade — référence = heures planifiées à partir du mois (AAAAMM)",
    source: "Décision Direction 2026-09-23",
    commentaire: "Vide = ancienne règle (heures/semaine × 52/12) pour tous les mois.",
  },
```
(Ne PAS exécuter ce script : il écrit dans la base du `.env`, donc la production.)

`scripts/_verifier-migrations.mjs` (fichier complet — testé sur ce dépôt le 2026-09-23 : ✓ sur les migrations ci-dessus ; ✗ « Added column motifReference » quand on retire cette colonne de la migration) :
```js
#!/usr/bin/env node
/**
 * Vérifie les MIGRATIONS (pas le schéma) sur un Postgres EMBARQUÉ jetable — jamais la production.
 *
 * Les tests d'intégration créent leur base par `prisma db push` : ils ne disent rien des fichiers
 * `prisma/migrations/*`, qui sont pourtant ce que Render applique en production
 * (`prisma migrate deploy` dans render.yaml). Ce script :
 *   1. démarre un Postgres embarqué, y crée un exercice fiscal AVANT la dernière migration de données
 *      (sinon l'INSERT … FROM "ExerciceFiscal" n'insère rien et ne prouve rien) ;
 *   2. rejoue TOUTES les migrations (`migrate deploy`) avec une config Prisma TEMPORAIRE qui ne lit
 *      aucun .env (le .env de ce dépôt pointe la PRODUCTION) ;
 *   3. exige un diff VIDE entre la base migrée et `prisma/schema.prisma` ;
 *   4. vérifie que `paie_reference_planning_depuis` = 202609 a été inséré pour l'exercice, et qu'une
 *      2e exécution de la migration de données ne crée pas de doublon.
 *
 * Usage : node scripts/_verifier-migrations.mjs   (sortie 0 = OK, 1 = échec)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

const racine = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pef-migr-"));
const port = 59000 + Math.floor(Math.random() * 900);
const url = `postgresql://postgres:postgres@localhost:${port}/verif`;
if (!url.startsWith("postgresql://postgres:postgres@localhost:")) throw new Error("URL non locale : refus.");

const configTemp = path.join(racine, ".verif-migrations.config.mjs");
fs.writeFileSync(configTemp, `import { defineConfig } from "prisma/config";
export default defineConfig({ schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations" }, datasource: { url: ${JSON.stringify(url)} } });
`);
const prisma = (...args) => execFileSync("npx", ["prisma", ...args, "--config", configTemp], { cwd: racine, stdio: "pipe", encoding: "utf8", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });

const PARAM = "paie_reference_planning_depuis";
const MIGRATION_PARAM = "20260924090100_param_reference_planning";
const pgEmb = new EmbeddedPostgres({ databaseDir: path.join(dir, "data"), user: "postgres", password: "postgres", port, persistent: false, onLog: () => {} });
let echec = false;
try {
  await pgEmb.initialise();
  await pgEmb.start();
  await pgEmb.createDatabase("verif");

  // 1. Toutes les migrations SAUF la migration de données, pour pouvoir créer un exercice avant elle.
  const dossierParam = path.join(racine, "prisma/migrations", MIGRATION_PARAM);
  const cache = path.join(dir, MIGRATION_PARAM);
  fs.renameSync(dossierParam, cache);
  try { prisma("migrate", "deploy"); } finally { fs.renameSync(cache, dossierParam); }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`INSERT INTO "public"."ExerciceFiscal" ("annee", "actif") VALUES (2026, true)`);

  // 2. La migration de données, puis une 2e fois à la main (idempotence).
  prisma("migrate", "deploy");
  prisma("db", "execute", "--file", path.join(dossierParam, "migration.sql"));
  const { rows } = await client.query(`SELECT valeur::text AS v FROM "public"."ParametreLegal" WHERE cle = $1`, [PARAM]);
  await client.end();
  if (rows.length !== 1 || Number(rows[0].v) !== 202609) {
    echec = true;
    console.error(`✗ ${PARAM} : attendu une ligne à 202609, obtenu ${JSON.stringify(rows)}`);
  } else console.log(`✓ ${PARAM} = 202609, une seule ligne après deux exécutions`);

  // 3. Diff migrations ↔ schéma : doit être vide (code de sortie 0 avec --exit-code).
  try {
    prisma("migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code");
    console.log("✓ migrations rejouées = prisma/schema.prisma (diff vide)");
  } catch (e) {
    echec = true;
    console.error("✗ écart entre les migrations rejouées et le schéma :\n" + (e.stdout ?? "") + (e.stderr ?? ""));
  }
} catch (e) {
  echec = true;
  console.error("✗ " + (e.stderr ?? e.message ?? e));
} finally {
  fs.rmSync(configTemp, { force: true });
  await pgEmb.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(echec ? 1 : 0);
```

- [ ] **Step 6 : le voir passer**

Run :
```bash
npx vitest run src/lib/config-reference-planning.integration.test.ts
node scripts/_verifier-migrations.mjs     # ~2 min ; attendu : deux lignes ✓ et code de sortie 0
npm run typecheck
git status --short                        # .verif-migrations.config.mjs ne doit PAS rester
```

- [ ] **Step 7 : falsifier**
1. Dans `config.ts`, remplacer `optionnel("paie_reference_planning_depuis")` par `null` → le 2e test ROUGE. Rétablir.
2. Dans la 1re migration, supprimer la ligne `ADD COLUMN     "motifReference" TEXT,` → `node scripts/_verifier-migrations.mjs` affiche « ✗ … [+] Added column motifReference » et sort en 1. Rétablir, relancer : ✓.
3. Dans la 2e migration, remplacer `202609` par `202610` → ✗ sur le paramètre. Rétablir.

- [ ] **Step 8 : commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260924090000_paie_reference_planning prisma/migrations/20260924090100_param_reference_planning scripts/_verifier-migrations.mjs src/lib/payroll.ts src/lib/config.ts src/lib/test/db.ts scripts/seed-legal-2026.ts src/lib/config-reference-planning.integration.test.ts
git commit -m "feat(paie): ajouter la source de référence sur la ligne de paie et la date d'effet 202609

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5 : assembler les jours du mois depuis la base (`src/lib/paie-reference-donnees.ts`)

**Files :**
- Create : `src/lib/paie-reference-donnees.ts`, `src/lib/paie-reference-donnees.integration.test.ts`

**Interfaces :**
- Consumes : `dureeShift` (`@/lib/duree-shift`, tâche 1), `pariteSemaine` (`@/lib/dates-fr`), `type JourReference` (tâche 2), `type JourSaisie` (tâche 3), `prisma` (`@/lib/prisma`).
- Produces :
  - `export type JoursEmploye = { jours: JourReference[]; saisie: JourSaisie[] }`
  - `export async function chargerJoursMois(mois: number, annee: number, employeeIds: string[]): Promise<Map<string, JoursEmploye>>` — une entrée par `employeeId` demandé, chacune avec EXACTEMENT un jour par jour du mois, dans l'ordre.

Règles : durée d'un créneau de travail = `dureeShift`, **0 pour un shift `systeme`** (Repos/Congé/Férié) ; `aUnCreneau` = vrai pour tout créneau, système compris ; `heuresModele` = `null` si le salarié n'a AUCUNE ligne `PlanningModele`, sinon la durée du shift de la couche de parité (`pariteSemaine`) puis de la couche 0, et 0 si rien ce jour ; `tauxRole` = `Shift.tauxHoraireUSD` du créneau.

- [ ] **Step 1 : le test qui échoue** — `src/lib/paie-reference-donnees.integration.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { pariteSemaine } from "@/lib/dates-fr";

// Assemblage des jours de paie depuis la base : créneau de travail vs créneau SYSTÈME, modèle A/B,
// taux de rôle, horodatages de saisie. C'est ici que « ce qui est posé au planning » devient une
// durée payée : une erreur d'assemblage change un montant sans qu'aucun test pur ne le voie.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { chargerJoursMois } = await import("./paie-reference-donnees");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let avecId: string;
let sansId: string;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const SAMEDI_A = pariteSemaine(d("2026-09-19")); // couche du modèle posée pour le samedi 19, pas le 12

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Assistante", secteur: "Admin", categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0 };
  avecId = (await prisma.employee.create({ data: { ...base, matricule: "AV01-PEF", nom: "Avec Planning", heuresParJour: 9, heuresHebdomadaires: 51.92 } })).id;
  sansId = (await prisma.employee.create({ data: { ...base, matricule: "SA01-PEF", nom: "Sans Rien" } })).id;
  const journee = await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } });
  const admin = await prisma.shift.create({ data: { nom: "Admin", heureDebut: "09:30", heureFin: "13:00", dureeHeures: 3.5, tauxHoraireUSD: 4 } });
  const conge = await prisma.shift.create({ data: { nom: "Congé", systeme: true } });
  await prisma.planningCreneau.createMany({ data: [
    { employeeId: avecId, date: d("2026-09-14"), shiftId: journee.id },
    { employeeId: avecId, date: d("2026-09-15"), shiftId: conge.id },
    { employeeId: avecId, date: d("2026-09-16"), shiftId: admin.id },
  ] });
  await prisma.planningModele.createMany({ data: [
    { employeeId: avecId, jour: 4, semaine: 0, shiftId: journee.id }, // jeudi, chaque semaine
    { employeeId: avecId, jour: 6, semaine: SAMEDI_A, shiftId: journee.id }, // samedi, une semaine sur deux
  ] });
  await prisma.attendance.create({ data: { employeeId: avecId, date: d("2026-09-17"), code: "C" } });
  await prisma.attendance.create({ data: { employeeId: avecId, date: d("2026-09-14"), code: "P" } });
  await prisma.overtimeEntry.create({ data: { employeeId: avecId, date: d("2026-09-14"), heuresTravaillees: 9 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("chargerJoursMois", () => {
  it("un jour par jour du mois, pour chaque salarié demandé, même sans aucune donnée", async () => {
    const m = await chargerJoursMois(9, 2026, [avecId, sansId]);
    expect(m.get(avecId)!.jours).toHaveLength(30);
    expect(m.get(sansId)!.jours).toHaveLength(30);
    expect(m.get(sansId)!.jours.every((j) => j.heuresModele === null && !j.aUnCreneau && j.heuresFaites === 0)).toBe(true);
  });

  it("créneau de travail, créneau système, durée explicite et taux de rôle", async () => {
    const jours = (await chargerJoursMois(9, 2026, [avecId])).get(avecId)!.jours;
    const le = (n: number) => jours[n - 1];
    expect(le(14)).toMatchObject({ heuresPlanifiees: 9, aUnCreneau: true, code: "P", heuresFaites: 9, tauxRole: null });
    expect(le(15)).toMatchObject({ heuresPlanifiees: 0, aUnCreneau: true }); // Congé : système = 0 h
    expect(le(16)).toMatchObject({ heuresPlanifiees: 3.5, tauxRole: 4 });
    expect(le(17)).toMatchObject({ heuresPlanifiees: 0, aUnCreneau: false, code: "C", heuresModele: 9 });
    expect(le(19).heuresModele).toBe(9); // samedi de la bonne parité
    expect(le(12).heuresModele).toBe(0); // samedi de l'autre semaine : le modèle ne prévoit rien
    expect(le(13).heuresModele).toBe(0); // dimanche
  });

  it("horodatages de saisie recopiés pour les avertissements", async () => {
    const s = (await chargerJoursMois(9, 2026, [avecId])).get(avecId)!.saisie;
    const j14 = s[13];
    expect(j14.code).toBe("P");
    expect(j14.codeSaisiLe).toBeInstanceOf(Date);
    expect(j14.heuresSaisiesLe).toBeInstanceOf(Date);
    expect(j14.heuresModifieesLe).toBeInstanceOf(Date);
    expect(j14.creneauModifieLe).toBeInstanceOf(Date);
    expect(j14.heuresPlanifiees).toBe(9);
    expect(s[16].creneauModifieLe).toBeNull();
  });
});
```

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/paie-reference-donnees.integration.test.ts`
Attendu : FAIL, `Failed to resolve import "./paie-reference-donnees"`.

- [ ] **Step 3 : implémentation** — `src/lib/paie-reference-donnees.ts`

```ts
import "server-only";

// Assemble, depuis la base, les JOURS du mois dont la paie a besoin (spec 2026-09-23 §5) :
// `JourReference` pour `calculerReferenceMois` (paie-reference.ts) et `JourSaisie` pour
// `detecterAvertissementsSaisie` (paie-avertissements.ts). Appelé par paie-batch.ts ET
// bulletin-live.ts : un seul assemblage, sinon la fiche et la paie divergent.
import { prisma } from "@/lib/prisma";
import { dureeShift } from "@/lib/duree-shift";
import { pariteSemaine } from "@/lib/dates-fr";
import type { CodePresence } from "@/lib/payroll";
import type { JourReference } from "@/lib/paie-reference";
import type { JourSaisie } from "@/lib/paie-avertissements";

export type JoursEmploye = { jours: JourReference[]; saisie: JourSaisie[] };

type ShiftDuree = { heureDebut: string | null; heureFin: string | null; dureeHeures: { toString(): string } | null; systeme: boolean };
/** Heures de TRAVAIL d'un shift : 0 pour un shift système (Repos/Congé/Férié), quoi qu'il porte. */
const heuresTravail = (s: ShiftDuree) =>
  s.systeme ? 0 : dureeShift({ heureDebut: s.heureDebut, heureFin: s.heureFin, dureeHeures: s.dureeHeures == null ? null : Number(s.dureeHeures) });
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * Jours du mois `mois`/`annee` pour chaque salarié demandé — TOUS les jours du mois, un par jour,
 * même sans aucune donnée (un salarié sans rien reçoit des jours vides).
 */
export async function chargerJoursMois(mois: number, annee: number, employeeIds: string[]): Promise<Map<string, JoursEmploye>> {
  const debut = new Date(Date.UTC(annee, mois - 1, 1));
  const fin = new Date(Date.UTC(annee, mois, 0));
  const dansMois = { gte: debut, lte: fin };
  const [creneaux, modeles, presences, heures] = await Promise.all([
    prisma.planningCreneau.findMany({
      where: { employeeId: { in: employeeIds }, date: dansMois },
      select: { employeeId: true, date: true, updatedAt: true, shift: { select: { heureDebut: true, heureFin: true, dureeHeures: true, systeme: true, tauxHoraireUSD: true } } },
    }),
    prisma.planningModele.findMany({ where: { employeeId: { in: employeeIds } }, select: { employeeId: true, jour: true, semaine: true, shiftId: true } }),
    prisma.attendance.findMany({ where: { employeeId: { in: employeeIds }, date: dansMois }, select: { employeeId: true, date: true, code: true, createdAt: true } }),
    prisma.overtimeEntry.findMany({ where: { employeeId: { in: employeeIds }, date: dansMois }, select: { employeeId: true, date: true, heuresTravaillees: true, createdAt: true, updatedAt: true } }),
  ]);
  // `PlanningModele.shiftId` n'a pas de relation Prisma : on lit ses shifts à part.
  const shiftsModele = new Map(
    (await prisma.shift.findMany({
      where: { id: { in: [...new Set(modeles.map((m) => m.shiftId))] } },
      select: { id: true, heureDebut: true, heureFin: true, dureeHeures: true, systeme: true },
    })).map((s) => [s.id, s]),
  );

  const cle = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;
  const creneauPar = new Map(creneaux.map((c) => [cle(c.employeeId, c.date), c]));
  const presencePar = new Map(presences.map((p) => [cle(p.employeeId, p.date), p]));
  const heuresPar = new Map(heures.map((h) => [cle(h.employeeId, h.date), h]));
  const modelesPar = new Map<string, typeof modeles>();
  for (const m of modeles) (modelesPar.get(m.employeeId) ?? modelesPar.set(m.employeeId, []).get(m.employeeId)!).push(m);

  const nbJours = fin.getUTCDate();
  const sortie = new Map<string, JoursEmploye>();
  for (const employeeId of employeeIds) {
    const mods = modelesPar.get(employeeId) ?? [];
    const jours: JourReference[] = [];
    const saisie: JourSaisie[] = [];
    for (let n = 1; n <= nbJours; n++) {
      const date = new Date(Date.UTC(annee, mois - 1, n));
      const c = creneauPar.get(cle(employeeId, date));
      const p = presencePar.get(cle(employeeId, date));
      const h = heuresPar.get(cle(employeeId, date));
      const heuresPlanifiees = c ? heuresTravail(c.shift) : 0;
      const heuresFaites = h ? Number(h.heuresTravaillees) : 0;
      // Modèle du jour : couche de la parité (semaine A/B) puis couche 0 « chaque semaine » — même
      // ordre que le pré-remplissage des heures (presences/actions.ts).
      let heuresModele: number | null = null;
      if (mods.length > 0) {
        const jour = date.getUTCDay();
        const m = mods.find((x) => x.jour === jour && x.semaine === pariteSemaine(date)) ?? mods.find((x) => x.jour === jour && x.semaine === 0);
        const s = m ? shiftsModele.get(m.shiftId) : undefined;
        heuresModele = s ? heuresTravail(s) : 0;
      }
      jours.push({
        date,
        heuresPlanifiees,
        aUnCreneau: c != null,
        heuresModele,
        code: (p?.code ?? null) as CodePresence | null,
        heuresFaites,
        tauxRole: c?.shift.tauxHoraireUSD != null ? Number(c.shift.tauxHoraireUSD) : null,
      });
      saisie.push({
        date,
        code: p?.code ?? null,
        codeSaisiLe: p?.createdAt ?? null,
        heuresFaites,
        heuresSaisiesLe: h?.createdAt ?? null,
        heuresModifieesLe: h?.updatedAt ?? null,
        heuresPlanifiees,
        creneauModifieLe: c?.updatedAt ?? null,
      });
    }
    sortie.set(employeeId, { jours, saisie });
  }
  return sortie;
}
```

- [ ] **Step 4 : le voir passer**

Run : `npx vitest run src/lib/paie-reference-donnees.integration.test.ts && npx eslint src/lib/paie-reference-donnees.ts`
Attendu : 3 tests PASS (vérifié sur Postgres embarqué le 2026-09-23).

- [ ] **Step 5 : falsifier**
1. Remplacer `mods.find((x) => x.jour === jour && x.semaine === pariteSemaine(date))` par `mods.find((x) => x.jour === jour && x.semaine !== 0)` → ROUGE (samedi 12 vaudrait 9 h). Rétablir.
2. Remplacer `heuresModele = s ? heuresTravail(s) : 0;` par `heuresModele = s ? heuresTravail(s) : null;` → ROUGE (dimanche 13). Rétablir.
3. Remplacer `aUnCreneau: c != null` par `aUnCreneau: heuresPlanifiees > 0` → ROUGE (jour 15, créneau Congé). Rétablir.

- [ ] **Step 6 : commit**

```bash
git add src/lib/paie-reference-donnees.ts src/lib/paie-reference-donnees.integration.test.ts
git commit -m "feat(paie): assembler les jours du mois (planning, modèle, présences, heures) pour la référence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6 : brancher la référence dans le lot de paie (`paie-batch.ts`) — test de bout en bout

**Files :**
- Modify : `src/lib/paie-batch.ts` (fichier complet ci-dessous)
- Create : `src/lib/paie-heures-planifiees.integration.test.ts`

**Interfaces :**
- Consumes : `calculerReferenceMois`, `type AvertissementPaie`, `type SourceReference` (tâche 2) ; `detecterAvertissementsSaisie` (tâche 3) ; `ParametresPaie.referencePlanningDepuis` + colonnes Prisma (tâche 4) ; `chargerJoursMois` (tâche 5).
- Produces : `DonneesLignePaie` gagne `sourceReference: SourceReference`, `motifReference: string | null`, `heuresPayeesNonTravaillees: number`, `avertissementsPaie: AvertissementPaie[]` ; `heuresContractuelles` porte désormais R en mode PLANNING. `rafraichirPaieDuMois` (inchangé) les persiste par `...l.data`.

Ce qui change dans `paie-batch.ts` (et rien d'autre) :
- disparaissent : la constante `SEMAINES_PAR_MOIS` (elle vit dans `paie-reference.ts`), l'import de `calculerHeuresSupp`, les tables `codeParJour` / `heuresParEmp` / `heureParJour`, le bloc « Option A » (`creneauxMois`, `tauxParShift`, `tauxRoleParJour`), le calcul local `tauxDefaut` / `salaireHoraire` / `salaireJournalier` / `hs` / `joursPayesNonTravailles` / `joursMaladie`. Tout cela est dans `calculerReferenceMois`, ancienne règle comprise, À L'IDENTIQUE ;
- apparaissent : `chargerJoursMois` avant la boucle, `calculerReferenceMois` + avertissements dans la boucle, `...ref.moteur` dans l'appel à `calculerPaieBrigade`, 4 champs de ligne.
- Garde-fou de non-régression : `paie-batch.integration.test.ts`, `bulletin-live.integration.test.ts`, `avantage-nature.integration.test.ts` (tous en juillet 2026, donc ancienne règle) restent verts SANS modification. Vérifié le 2026-09-23 sur une copie : 10/10 verts.

- [ ] **Step 1 : le test qui échoue** — `src/lib/paie-heures-planifiees.integration.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// BOUT EN BOUT — septembre 2026 reconstitué pour trois salariés RÉELS (données de production lues
// le 2026-09-23, lecture seule), sur le VRAI moteur (calculerLignesPaie → calculerReferenceMois →
// calculerPaieBrigade, brut reconstitué depuis le net) et le VRAI chemin de persistance
// (rafraichirPaieDuMois). Critère d'acceptation de la spec §8 : 400,00 / 200,00 / 200,00 de base
// nette.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { calculerLignesPaie } = await import("./paie-batch");
const { rafraichirPaieDuMois } = await import("./paie-refresh");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { martine: "", syntyche: "", marie: "", semaineVide: "" };
let userId = "";

const d = (n: number, mois = 9) => new Date(Date.UTC(2026, mois - 1, n));
const SAISI = new Date("2026-10-01T08:00:00Z"); // saisies faites APRÈS les jours : aucun « saisi d'avance »
const PLANIFIE = new Date("2026-08-25T08:00:00Z"); // planning posé AVANT les heures
const septembre = Array.from({ length: 30 }, (_, i) => d(i + 1));
const lunSam = (x: Date) => x.getUTCDay() !== 0;

async function salarie(matricule: string, nom: string, salaireMensuel: number, heuresHebdomadaires: number, heuresParJour: number, enfants: number) {
  return (await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Brigade", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel, heuresHebdomadaires, heuresParJour, enfants, transportJourCDF: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDD",
  } })).id;
}
async function planifier(employeeId: string, shiftId: string, jours: Date[]) {
  await prisma.planningCreneau.createMany({ data: jours.map((date) => ({ employeeId, date, shiftId, createdAt: PLANIFIE, updatedAt: PLANIFIE })) });
}
async function pointer(employeeId: string, jours: Date[], code: "P" | "C", heures: number) {
  await prisma.attendance.createMany({ data: jours.map((date) => ({ employeeId, date, code, createdAt: SAISI, updatedAt: SAISI })) });
  if (heures > 0) await prisma.overtimeEntry.createMany({ data: jours.map((date) => ({ employeeId, date, heuresTravaillees: heures, createdAt: SAISI, updatedAt: SAISI })) });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: (await prisma.exerciceFiscal.findFirstOrThrow()).id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  userId = (await prisma.user.create({ data: { email: "paie@pef.cd", nom: "Direction", role: "ADMIN" } })).id;

  const journee = await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } }); // 9 h
  const service = await prisma.shift.create({ data: { nom: "Service", heureDebut: "10:00", heureFin: "16:00" } }); // 6 h
  const cuisine = await prisma.shift.create({ data: { nom: "Matin/cuisine", heureDebut: "08:30", heureFin: "16:30" } }); // 8 h

  // Martine Mutombo : 400 $ net, contrat 54 h, planning lun–ven + samedis 12 et 26 → 216 h, toutes faites.
  ids.martine = await salarie("MM01-PEF", "Martine Mutombo", 400, 54, 9, 2);
  const joursMartine = septembre.filter((x) => (x.getUTCDay() >= 1 && x.getUTCDay() <= 5) || x.getUTCDate() === 12 || x.getUTCDate() === 26);
  await planifier(ids.martine, journee.id, joursMartine);
  await pointer(ids.martine, joursMartine, "P", 9);

  // Syntyche Kanku : 200 $, 36 h, 6 h du lundi au samedi jusqu'au 19 ; congé du 21 au 30 SANS créneau.
  ids.syntyche = await salarie("SK01-PEF", "Syntyche Kanku", 200, 36, 6, 0);
  const travailSyntyche = septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 19);
  await planifier(ids.syntyche, service.id, travailSyntyche);
  await pointer(ids.syntyche, travailSyntyche, "P", 6);
  await pointer(ids.syntyche, septembre.filter((x) => lunSam(x) && x.getUTCDate() >= 21), "C", 0);

  // Marie Samwel : 200 $, 48 h, 8 h du lundi au samedi tout le mois ; congé du 1er au 14 posé SUR les créneaux.
  ids.marie = await salarie("MS01-PEF", "Marie Samwel", 200, 48, 8, 0);
  await planifier(ids.marie, cuisine.id, septembre.filter(lunSam));
  await pointer(ids.marie, septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 14), "C", 0);
  await pointer(ids.marie, septembre.filter((x) => lunSam(x) && x.getUTCDate() >= 15), "P", 8);

  // Planning incomplet : semaine du 21 au 27 sans aucun créneau → repli visible sur le contrat.
  ids.semaineVide = await salarie("SV01-PEF", "Semaine Vide", 208, 48, 8, 0);
  await planifier(ids.semaineVide, cuisine.id, septembre.filter((x) => lunSam(x) && (x.getUTCDate() < 21 || x.getUTCDate() > 27)));
  await pointer(ids.semaineVide, septembre.filter(lunSam), "P", 8);
}, 180_000);
afterAll(async () => { await fermer?.(); });

/** Base nette = salaire net − transport − allocation familiale (le salaire du contrat). */
const baseNette = (l: { salNetUSD: number; transportUSD: number; allocFamilialeUSD: number }) =>
  (l.salNetUSD - l.transportUSD - l.allocFamilialeUSD).toFixed(2);

describe("paie de septembre 2026 sur heures planifiées — bout en bout", () => {
  it("Martine 400,00 ; Syntyche 200,00 ; Marie 200,00 de base nette", async () => {
    const { lignes } = await calculerLignesPaie(9, 2026);
    const de = (id: string) => lignes.find((l) => l.employee.id === id)!.data;
    expect(baseNette(de(ids.martine))).toBe("400.00");
    expect(baseNette(de(ids.syntyche))).toBe("200.00");
    expect(baseNette(de(ids.marie))).toBe("200.00");
    expect(de(ids.martine)).toMatchObject({ sourceReference: "PLANNING", heuresContractuelles: 216, avertissementsPaie: [] });
    expect(de(ids.syntyche)).toMatchObject({ heuresContractuelles: 156, joursPayesNonTravailles: 9, heuresPayeesNonTravaillees: 54 });
    expect(de(ids.marie)).toMatchObject({ heuresContractuelles: 208, joursPayesNonTravailles: 12, heuresPayeesNonTravaillees: 96 });
  });

  it("semaine sans créneau → repli sur le contrat, motif et avertissement visibles", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.semaineVide)!.data;
    expect(l.sourceReference).toBe("CONTRAT_REPLI");
    expect(l.motifReference).toBe("Planning incomplet : semaine du 21/09 sans créneau");
    expect(l.heuresContractuelles).toBe(208);
    expect(l.avertissementsPaie.map((a) => a.code)).toEqual(["REPLI_CONTRAT"]);
  });

  it("juillet 2026 (avant la date d'effet) → ancienne référence contrat", async () => {
    const l = (await calculerLignesPaie(7, 2026)).lignes.find((x) => x.employee.id === ids.martine)!.data;
    expect(l.sourceReference).toBe("CONTRAT");
    expect(l.heuresContractuelles).toBe(234); // 54 × 52/12
    expect(l.avertissementsPaie).toEqual([]);
  });

  it("persistance : la ligne enregistrée porte la source, le motif et les avertissements", async () => {
    await rafraichirPaieDuMois({ creerRun: true, userId });
    const martine = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.martine } });
    expect(martine.sourceReference).toBe("PLANNING");
    expect(Number(martine.heuresContractuelles)).toBe(216);
    expect(martine.avertissementsPaie).toEqual([]);
    const vide = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.semaineVide } });
    expect(vide.sourceReference).toBe("CONTRAT_REPLI");
    expect(vide.motifReference).toBe("Planning incomplet : semaine du 21/09 sans créneau");
    expect(vide.avertissementsPaie).toEqual([{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Planning incomplet : semaine du 21/09 sans créneau" }]);
  });

  it("une ligne VALIDÉE n'est jamais recalculée, même si le planning ou les heures changent", async () => {
    const avant = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.martine } });
    await prisma.payrollLine.update({ where: { id: avant.id }, data: { statutPaiement: "VALIDE" } });
    await prisma.overtimeEntry.deleteMany({ where: { employeeId: ids.martine, date: d(30) } });
    await rafraichirPaieDuMois({ creerRun: false });
    const apres = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.martine } });
    expect(apres.id).toBe(avant.id);
    expect(apres.salNetUSD.toString()).toBe(avant.salNetUSD.toString());
  });
});
```

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/paie-heures-planifiees.integration.test.ts`
Attendu : FAIL — Martine à `"369.23"` au lieu de `"400.00"`, `sourceReference` indéfini.

- [ ] **Step 3 : implémentation** — remplacer `src/lib/paie-batch.ts` par (fichier complet) :

```ts
import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerEcheancePret } from "@/lib/prets";
import {
  calculerJoursOuvrables,
  calculerPaieBackoffice,
  calculerPaieBrigade,
  calculerPaieStage,
  resumerPresences,
  type CodePresence,
} from "@/lib/payroll";
import { calculerReferenceMois, type AvertissementPaie, type SourceReference } from "@/lib/paie-reference";
import { detecterAvertissementsSaisie } from "@/lib/paie-avertissements";
import { chargerJoursMois } from "@/lib/paie-reference-donnees";
import type { Employee } from "@prisma/client";

/** Champs numériques d'une PayrollLine produits par le calcul (hors payrollRunId/employeeId). */
export type DonneesLignePaie = {
  joursPayes100: number;
  joursPayes2_3: number;
  joursNonPayes: number;
  nombreAbsences: number;
  remuneration100: number;
  joursPayesNonTravailles: number;
  remunerationJoursPayesUSD: number;
  remuneration2_3: number;
  hsValorisee: number;
  heuresTravaillees: number;
  heuresContractuelles: number;
  /** D'où vient `heuresContractuelles` : heures planifiées, contrat, ou repli sur le contrat. */
  sourceReference: SourceReference;
  motifReference: string | null;
  heuresPayeesNonTravaillees: number;
  /** Avertissements de calcul et de saisie (jamais bloquants), figés avec la ligne. */
  avertissementsPaie: AvertissementPaie[];
  heuresSupp30: number;
  heuresSupp60: number;
  heuresSupp100: number;
  joursCongePris: number;
  indemniteCongesUSD: number;
  fraisMedicauxUSD: number;
  transportUSD: number;
  primesUSD: number;
  /** Avantages en nature du mois — mention informative recopiée telle quelle, hors de tout calcul. */
  avantagesNatureUSD: number;
  acompteUSD: number;
  retenuePretUSD: number;
  salBrutUSD: number;
  cnssSalarieUSD: number;
  netImposableUSD: number;
  iprCalculeUSD: number;
  allocFamilialeUSD: number;
  salNetUSD: number;
  salNetCDF: number;
  cnssPatronalUSD: number;
  inppUSD: number;
  onemUSD: number;
  coutEmployeurUSD: number;
  coutEmployeurCDF: number;
};

/** Une ligne de paie calculée (sans écriture en base) : les champs d'une PayrollLine + l'employé. */
export type LigneCalculee = {
  employee: Employee;
  data: DonneesLignePaie;
};

export type ResultatBatch = {
  lignes: LigneCalculee[];
};

/**
 * Calcule EN MÉMOIRE la paie de TOUS les employés actifs pour le mois donné, à partir des
 * données courantes (présences, HS, primes, acomptes, congés, planning multi-rôles). Aucune
 * écriture en base : sert à la fois à la persistance (`calculerPaieDuMois`) et à l'aperçu temps
 * réel de la page Paie. Reprend à l'identique la logique de paie (§8, transport B3, Option A,
 * Lot D). L'appelant décide de figer/écrire et de sauter les lignes déjà validées/payées.
 */
export async function calculerLignesPaie(mois: number, annee: number): Promise<ResultatBatch> {
  const parametres = await chargerParametresPaie();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  // BUG CONNU documenté le 2026-07-22 (Tier 2, #4 — NON corrigé, montants impactés) : `overtimeEntries`
  // est filtré STRICTEMENT par mois calendaire. `calculerHeuresSupp` (payroll.ts) regroupe pourtant les
  // heures par VRAIES semaines lundi→dimanche (`numeroSemaineDuMois`, déjà correct EN INTRA-mois). Une
  // semaine à cheval sur deux mois est donc scindée : le seuil hebdomadaire contractuel qui déclenche
  // les heures supp. (30 %/60 %) repart de zéro de CHAQUE côté de la coupure → sous-évaluation possible
  // des heures supp. sur ces semaines-charnières (ex. semaine du 27 juin au 3 juillet : les heures du
  // 27-30 juin ne « comptent » pas pour le seuil de la semaine côté juillet, et inversement).
  // Piste de correction recommandée (NON implémentée ici — risquée sans tests dédiés) : élargir la
  // fenêtre de chargement de `overtimeEntries`/`attendances` aux semaines complètes qui chevauchent le
  // mois (du lundi de la semaine du 1er au dimanche de la semaine du dernier jour — cf. `lundiDe` dans
  // `src/lib/dates-fr.ts`), puis faire évoluer `calculerHeuresSupp` pour qu'il attribue les heures supp.
  // JOUR PAR JOUR (cumul chronologique dans la semaine) au lieu d'un agrégat hebdomadaire, afin de ne
  // compter dans `heuresTotalesMois`/`hs30`/`hs60`/`hsValorisee` QUE les jours du mois en cours (les
  // jours « hors mois » ne servant qu'à positionner correctement le seuil, sans être payés deux fois —
  // ils sont déjà couverts par le mois voisin, y compris s'il est déjà VALIDE/PAYE et donc figé). C'est
  // un changement de signature/algorithme du moteur central (`calculerHeuresSupp`), couvert par
  // `payroll.test.ts` et `payroll-reference.test.ts` : à faire dans un lot dédié avec de nouveaux tests
  // de semaines-charnières, plutôt qu'un correctif partiel ici.
  const [employees, joursFeriesDuMois, attendances, overtimeEntries, primesDuMois, acomptesDuMois, congesDuMois, fraisMedDuMois, contratsActifs, pretsEnCours, avantagesDuMois] =
    await Promise.all([
      prisma.employee.findMany({ where: { actif: true } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.overtimeEntry.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.prime.findMany({ where: { mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { mois, annee, statut: "APPROUVE" } }),
      prisma.leaveRequest.findMany({ where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } } }),
      prisma.fraisMedical.findMany({ where: { mois, annee } }),
      prisma.contrat.findMany({ where: { statut: "ACTIF" }, orderBy: { dateDebut: "asc" }, select: { employeeId: true, type: true } }),
      prisma.pretPersonnel.findMany({ where: { statut: "EN_COURS" }, include: { retenues: true } }),
      // Avantages en nature : lus UNIQUEMENT pour être recopiés sur le bulletin. Ils n'entrent dans
      // aucun calcul (ni assiette, ni base imposable, ni net) — voir le modèle AvantageNature.
      prisma.avantageNature.findMany({ where: { mois, annee } }),
    ]);

  const avantagesParEmp = new Map<string, number>();
  for (const a of avantagesDuMois) {
    avantagesParEmp.set(a.employeeId, (avantagesParEmp.get(a.employeeId) ?? 0) + Number(a.montantUSD));
  }

  // Échéance de prêt du mois par employé : min(retenue mensuelle, solde AVANT ce mois). On exclut
  // la retenue du mois courant du solde → le recalcul de la paie du mois est idempotent.
  const pretParEmp = new Map<string, number>();
  for (const p of pretsEnCours) {
    const { echeanceUSD } = calculerEcheancePret(
      Number(p.montantUSD),
      Number(p.retenueMensuelleUSD),
      p.retenues.map((r) => ({ mois: r.mois, annee: r.annee, montantUSD: Number(r.montantUSD) })),
      mois,
      annee
    );
    if (echeanceUSD > 0) pretParEmp.set(p.employeeId, (pretParEmp.get(p.employeeId) ?? 0) + echeanceUSD);
  }

  // Régime de paie par employé : type du contrat ACTIF le plus récent, sinon le type de la fiche.
  const typeContratParEmp = new Map<string, string>();
  for (const c of contratsActifs) typeContratParEmp.set(c.employeeId, c.type);

  const fraisMedParEmp = new Map<string, number>();
  for (const f of fraisMedDuMois) fraisMedParEmp.set(f.employeeId, (fraisMedParEmp.get(f.employeeId) ?? 0) + Number(f.montantUSD));

  const joursCongeParEmp = new Map<string, number>();
  for (const c of congesDuMois) {
    const debut = new Date(c.dateDebut) < debutMois ? debutMois : new Date(c.dateDebut);
    const fin = new Date(c.dateFin) > finMois ? finMois : new Date(c.dateFin);
    joursCongeParEmp.set(c.employeeId, (joursCongeParEmp.get(c.employeeId) ?? 0) + calculerJoursOuvrables(debut, fin, joursFeriesDuMois.map((f) => f.date)));
  }

  const primesParEmp = new Map<string, number>();
  for (const p of primesDuMois) primesParEmp.set(p.employeeId, (primesParEmp.get(p.employeeId) ?? 0) + Number(p.montantUSD));
  const acomptesParEmp = new Map<string, number>();
  for (const a of acomptesDuMois) acomptesParEmp.set(a.employeeId, (acomptesParEmp.get(a.employeeId) ?? 0) + Number(a.montantUSD));

  const joursFeries = new Set(joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10)));

  const codesParEmp = new Map<string, CodePresence[]>();
  for (const a of attendances) {
    (codesParEmp.get(a.employeeId) ?? codesParEmp.set(a.employeeId, []).get(a.employeeId)!).push(a.code as CodePresence);
  }

  // Jours du mois (créneaux, modèle, codes, heures, horodatages) : même assemblage que
  // bulletin-live.ts — la référence d'heures et la base viennent de `calculerReferenceMois`.
  const joursParEmp = await chargerJoursMois(mois, annee, employees.map((e) => e.id));

  const lignes: LigneCalculee[] = [];

  for (const employee of employees) {
    const typeContrat = typeContratParEmp.get(employee.id) ?? employee.contrat;
    // INTERIMAIRE : salarié de l'AGENCE (qui l'emploie et le paie) — aucun bulletin ici.
    if (typeContrat === "INTERIM") continue;

    const codes = codesParEmp.get(employee.id) ?? [];
    const resume = resumerPresences(codes);
    // Frais médicaux : solde « saisie manuelle du mois » (employee.fraisMedicauxMoisCourant) +
    // entrées durables de la table FraisMedical (avec certificat) pour ce mois. La saisie manuelle
    // n'est remise à zéro qu'au moment où la ligne est VALIDÉE (voir appliquerTransitionPaie dans
    // paie/actions.ts) — jamais ici, qui sert aussi à un simple aperçu/rafraîchissement de brouillon
    // (bug corrigé le 2026-07-22 : le montant disparaissait silencieusement avant validation).
    const fraisMedicauxUSD = Number(employee.fraisMedicauxMoisCourant) + (fraisMedParEmp.get(employee.id) ?? 0);

    const estStage = typeContrat === "STAGE";
    // Paie sur heures planifiées (spec 2026-09-23) : brigade en CDD/CDI seulement. Tous les autres
    // passent `referencePlanningDepuis: null` → ancienne règle, à l'identique.
    const estBrigadePlanning = employee.categorie === "BRIGADE" && !estStage && typeContrat !== "JOURNALIER";
    const joursCongePris = estStage ? 0 : Math.max(codes.filter((c) => c === "C").length, joursCongeParEmp.get(employee.id) ?? 0);
    const joursEmp = joursParEmp.get(employee.id) ?? { jours: [], saisie: [] };
    const ref = calculerReferenceMois({
      annee,
      mois,
      jours: joursEmp.jours,
      salaireMensuel: Number(employee.salaireMensuel),
      heuresHebdomadaires: Number(employee.heuresHebdomadaires),
      heuresParJour: Number(employee.heuresParJour),
      dateEmbauche: new Date(employee.dateEmbauche),
      joursFeries,
      joursCongePris,
      referencePlanningDepuis: estBrigadePlanning ? (parametres.referencePlanningDepuis ?? null) : null,
      params: parametres,
    });
    const avertissementsPaie: AvertissementPaie[] = estBrigadePlanning
      ? [...ref.avertissements, ...detecterAvertissementsSaisie(joursEmp.saisie, { referencePlanning: ref.source === "PLANNING" })]
      : [];
    const nombreAbsences = codes.filter((c) => c === "A" || c === "N" || c === "S").length;

    const joursPresenceP = codes.filter((c) => c === "P").length;
    const transportUSD =
      employee.categorie === "BRIGADE"
        ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
        : Number(employee.transportMoisUSD);

    const primesUSD = primesParEmp.get(employee.id) ?? 0;
    const acompteUSD = acomptesParEmp.get(employee.id) ?? 0;
    const retenuePretUSD = pretParEmp.get(employee.id) ?? 0;

    const ligne =
      typeContrat === "STAGE"
        ? calculerPaieStage(
            { indemniteUSD: Number(employee.salaireMensuel), transportUSD, fraisMedicauxUSD, primesUSD, acompteUSD, retenuePretUSD },
            parametres
          )
        : employee.categorie === "BRIGADE"
        ? calculerPaieBrigade(
            {
              ...ref.moteur,
              transportMoisUSD: transportUSD,
              enfants: employee.enfants,
              fraisMedicauxUSD,
              primesUSD,
              acompteUSD,
              retenuePretUSD,
            },
            parametres
          )
        : calculerPaieBackoffice(
            { salaireBaseUSD: Number(employee.salaireMensuel), transportUSD, enfants: employee.enfants, fraisMedicauxUSD, primesUSD, acompteUSD, retenuePretUSD },
            parametres
          );

    // Facteur de reconstitution brut/net appliqué à la base (1 hors brigade / flag inactif). Les
    // composantes d'affichage dérivées du taux (jours payés non travaillés, HS, indemnité congés)
    // sont stockées AU MÊME facteur que la base grossie, sinon la répartition ligne à ligne du
    // bulletin devient incohérente avec `remuneration100` grossi (bug de répartition, 2026-07-22).
    const facteur = ligne.facteurReconstitution ?? 1;

    lignes.push({
      employee,
      data: {
        joursPayes100: resume.payes100,
        joursPayes2_3: resume.payes2_3,
        joursNonPayes: resume.nonPayes,
        nombreAbsences,
        remuneration100: ligne.remuneration100,
        // Part « jours payés non travaillés » de la rémunération 100 % (brigade uniquement :
        // back-office = salaire fixe, stage = indemnité forfaitaire).
        joursPayesNonTravailles:
          estStage || employee.categorie !== "BRIGADE" ? 0 : ref.affichage.joursPayesNonTravailles,
        remunerationJoursPayesUSD:
          estStage || employee.categorie !== "BRIGADE"
            ? 0
            : Math.round(ref.affichage.montantJoursPayesNet * facteur * 100) / 100,
        remuneration2_3: ligne.remuneration2_3,
        hsValorisee: estStage ? 0 : Math.round(ref.moteur.hsValorisee * facteur * 100) / 100,
        heuresTravaillees: ref.hs.heuresTotalesMois,
        heuresContractuelles: ref.heuresReference,
        sourceReference: ref.source,
        motifReference: ref.motif,
        heuresPayeesNonTravaillees:
          estStage || employee.categorie !== "BRIGADE" ? 0 : ref.affichage.heuresPayeesNonTravaillees,
        avertissementsPaie,
        heuresSupp30: estStage ? 0 : ref.hs.hs30,
        heuresSupp60: estStage ? 0 : ref.hs.hs60,
        heuresSupp100: estStage ? 0 : ref.hs.hs100,
        joursCongePris,
        indemniteCongesUSD: Math.round(ref.affichage.indemniteCongesNet * facteur * 100) / 100,
        fraisMedicauxUSD,
        transportUSD,
        primesUSD: ligne.primesUSD,
        // Recopie brute, hors de toute formule : `ligne` (le moteur) ne le voit même pas.
        avantagesNatureUSD: avantagesParEmp.get(employee.id) ?? 0,
        acompteUSD: ligne.acompteUSD,
        retenuePretUSD: ligne.retenuePretUSD,
        salBrutUSD: ligne.salBrutUSD,
        cnssSalarieUSD: ligne.cnssSalarieUSD,
        netImposableUSD: ligne.netImposableUSD,
        iprCalculeUSD: ligne.iprCalculeUSD,
        allocFamilialeUSD: ligne.allocFamilialeUSD,
        salNetUSD: ligne.salNetUSD,
        salNetCDF: ligne.salNetCDF,
        cnssPatronalUSD: ligne.cnssPatronalUSD,
        inppUSD: ligne.inppUSD,
        onemUSD: ligne.onemUSD,
        coutEmployeurUSD: ligne.coutEmployeurUSD,
        coutEmployeurCDF: ligne.coutEmployeurCDF,
      },
    });
  }

  return { lignes };
}
```

- [ ] **Step 4 : le voir passer, sans rien casser**

Run :
```bash
npx vitest run src/lib/paie-heures-planifiees.integration.test.ts src/lib/paie-batch.integration.test.ts src/lib/avantage-nature.integration.test.ts "src/app/(app)/paie/paie-frais-medicaux.integration.test.ts"
npm run typecheck && npx eslint src/lib/paie-batch.ts src/lib/paie-heures-planifiees.integration.test.ts
```
Attendu : tout vert (5 tests dans le nouveau fichier). Si `typecheck` refuse `avertissementsPaie` dans `createMany` (`paie-refresh.ts`), NE PAS changer le type : écrire dans `paie-refresh.ts` `.map((l) => ({ payrollRunId: runId, employeeId: l.employee.id, ...l.data, avertissementsPaie: l.data.avertissementsPaie as unknown as Prisma.InputJsonValue }))` avec `import type { Prisma } from "@prisma/client";` (vérifié le 2026-09-23 : sans ce cast, le typecheck passait).

- [ ] **Step 5 : falsifier**
1. Dans `paie-batch.ts`, remplacer `referencePlanningDepuis: estBrigadePlanning ? (parametres.referencePlanningDepuis ?? null) : null,` par `referencePlanningDepuis: null,` → 4 tests ROUGES dans le nouveau fichier (vérifié). Rétablir.
2. Remplacer `heuresContractuelles: ref.heuresReference,` par `heuresContractuelles: 0,` → ROUGE (216 attendu). Rétablir.
3. Dans `src/lib/paie-refresh.ts`, remplacer `STATUTS_FIGES` dans `deleteMany` par `[]` → le test « une ligne VALIDÉE n'est jamais recalculée » ROUGE. Rétablir (ne rien committer de cette mutation).

- [ ] **Step 6 : commit**

```bash
git add src/lib/paie-batch.ts src/lib/paie-heures-planifiees.integration.test.ts src/lib/paie-refresh.ts
git commit -m "feat(paie): payer la brigade sur les heures planifiées à partir de septembre 2026

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7 : même calcul pour l'aperçu de la fiche (`bulletin-live.ts`) — égal au lot au centime

**Files :**
- Modify : `src/lib/bulletin-live.ts` (fichier complet ci-dessous), `src/app/(app)/employes/[id]/apercu-bulletin.tsx`
- Create : `src/lib/paie-reference-libelles.ts`
- Test : `src/lib/paie-heures-planifiees.integration.test.ts` (ajout de deux `it`)

**Interfaces :**
- Consumes : `calculerReferenceMois` (tâche 2), `detecterAvertissementsSaisie` (tâche 3), `chargerJoursMois` (tâche 5).
- Produces :
  - `ApercuBulletin.reference: { source: SourceReference; motif: string | null; heuresReference: number; tauxMois: number; avertissements: AvertissementPaie[] }`
  - `src/lib/paie-reference-libelles.ts` : `export const LIBELLE_SOURCE_REFERENCE: Record<SourceReference, string>` = `{ PLANNING: "Heures planifiées", CONTRAT: "Heures / mois", CONTRAT_REPLI: "Heures contrat (repli)" }` — seul endroit où ces libellés sont écrits (repris par les tâches 8 et 9).

- [ ] **Step 1 : les tests qui échouent** — dans `src/lib/paie-heures-planifiees.integration.test.ts` :
1. sous `const { rafraichirPaieDuMois } = await import("./paie-refresh");`, ajouter :
```ts
const { calculerBulletinLive } = await import("./bulletin-live");
const { ApercuBulletinCard } = await import("@/app/(app)/employes/[id]/apercu-bulletin");
const { renderToStaticMarkup } = await import("react-dom/server");
```
2. avant `  it("persistance :`, ajouter :
```ts
  it("l'aperçu de la fiche (bulletin-live) est égal au lot, au centime", async () => {
    const { lignes } = await calculerLignesPaie(9, 2026);
    for (const id of Object.values(ids)) {
      const lot = lignes.find((l) => l.employee.id === id)!.data;
      const live = (await calculerBulletinLive(id, 9, 2026))!;
      expect(live.ligne.salNetUSD.toFixed(2)).toBe(lot.salNetUSD.toFixed(2));
      expect(live.ligne.salBrutUSD.toFixed(2)).toBe(lot.salBrutUSD.toFixed(2));
      expect(live.reference.heuresReference).toBe(lot.heuresContractuelles);
      expect(live.reference.source).toBe(lot.sourceReference);
      expect(live.reference.avertissements).toEqual(lot.avertissementsPaie);
    }
  });

  it("la carte d'aperçu dit la référence et affiche les avertissements", async () => {
    const martine = renderToStaticMarkup(ApercuBulletinCard({ apercu: (await calculerBulletinLive(ids.martine, 9, 2026))!, periode: "septembre 2026" }));
    expect(martine).toContain("Heures planifiées");
    expect(martine).toContain("216");
    const vide = renderToStaticMarkup(ApercuBulletinCard({ apercu: (await calculerBulletinLive(ids.semaineVide, 9, 2026))!, periode: "septembre 2026" }));
    expect(vide).toContain("Heures contrat (repli)");
    expect(vide).toContain("Planning incomplet : semaine du 21/09 sans créneau");
  });

```

- [ ] **Step 2 : les voir échouer**

Run : `npx vitest run src/lib/paie-heures-planifiees.integration.test.ts`
Attendu : FAIL — `live.reference` indéfini ; Martine en direct à 369,23 ≠ lot 400,00.

- [ ] **Step 3 : implémentation**

`src/lib/paie-reference-libelles.ts` :
```ts
// Libellés de la référence d'heures d'une ligne de paie — module sans dépendance (écran, fiche, PDF).
import type { SourceReference } from "@/lib/paie-reference";

export const LIBELLE_SOURCE_REFERENCE: Record<SourceReference, string> = {
  PLANNING: "Heures planifiées",
  CONTRAT: "Heures / mois",
  CONTRAT_REPLI: "Heures contrat (repli)",
};
```

Remplacer `src/lib/bulletin-live.ts` par (fichier complet ; la requête `overtimeEntry` et le bloc « Option A » disparaissent, les heures viennent de `chargerJoursMois`) :
```ts
import "server-only";

import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerEcheancePret } from "@/lib/prets";
import {
  calculerPaieBrigade,
  calculerPaieBackoffice,
  calculerPaieStage,
  type CodePresence,
  type LignePaie,
} from "@/lib/payroll";
import { calculerReferenceMois, type AvertissementPaie, type SourceReference } from "@/lib/paie-reference";
import { detecterAvertissementsSaisie } from "@/lib/paie-avertissements";
import { chargerJoursMois } from "@/lib/paie-reference-donnees";

export type ApercuBulletin = {
  ligne: LignePaie;
  heuresTravaillees: number;
  hs30: number;
  hs60: number;
  hs100: number;
  joursPresenceP: number;
  primesUSD: number;
  primes: { nom: string; montantUSD: number }[]; // détail des primes (une entrée chacune)
  // Avantages en nature : INFORMATIFS. Remontés pour l'affichage seul, exclus de tout calcul.
  avantagesNatureUSD: number;
  avantagesNature: { nature: string; montantUSD: number }[];
  acompteUSD: number;
  tauxChangeCDF: number;
  // Indemnité de transport du mois, incluse dans `ligne.salNetUSD` mais non isolée par le moteur
  // (LignePaie) — exposée ici pour dériver le salaire net hors transport (@/lib/paie-net).
  transportUSD: number;
  // Référence d'heures du mois (spec 2026-09-23) : la même que la ligne de paie du lot.
  reference: {
    source: SourceReference;
    motif: string | null;
    heuresReference: number;
    tauxMois: number;
    avertissements: AvertissementPaie[];
  };
};

/**
 * Calcule EN DIRECT le bulletin d'un employé pour une période (sans écrire en base) — sert à
 * l'aperçu intégré dans la fiche. Reprend la logique de `calculerLignesPaie` (paie-batch.ts) :
 * paie aux heures §8, transport B3, primes & acompte approuvé Lot D, ET le régime de contrat
 * (STAGE → indemnité forfaitaire sans cotisations ni IPR ; INTERIM → aucun bulletin, l'employé
 * est payé par l'agence). Corrigé le 2026-07-22 : avant, seule la catégorie BRIGADE/back-office
 * était testée, produisant un faux bulletin (avec cotisations jamais prélevées) pour un stagiaire
 * et un bulletin fictif pour un intérimaire.
 */
export async function calculerBulletinLive(
  employeeId: string,
  mois: number,
  annee: number
): Promise<ApercuBulletin | null> {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  // Régime de paie : type du contrat ACTIF le plus récent, sinon le type de la fiche — même
  // règle que paie-batch.ts (typeContratParEmp).
  const contratActif = await prisma.contrat.findFirst({
    where: { employeeId, statut: "ACTIF" },
    orderBy: { dateDebut: "desc" },
    select: { type: true },
  });
  const typeContrat = contratActif?.type ?? employee.contrat;

  // INTERIMAIRE : salarié de l'AGENCE (qui l'emploie et le paie) — aucun bulletin ici.
  if (typeContrat === "INTERIM") return null;
  const estStage = typeContrat === "STAGE";

  const parametres = await chargerParametresPaie();
  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));

  // BUG CONNU documenté (Tier 2, #4 — NON corrigé, montants impactés) : les heures (chargerJoursMois) sont filtrées
  // strictement par mois calendaire, alors que `calculerHeuresSupp` regroupe par vraies semaines
  // lundi→dimanche → une semaine à cheval sur deux mois sous-évalue les heures supp. de chaque côté.
  // Voir l'explication complète et la piste de correction recommandée dans paie-batch.ts (même fenêtre
  // de requête, même moteur `calculerHeuresSupp`).
  const [attendances, joursFeriesDuMois, primesDuMois, fraisMedDuMois, acomptesDuMois, pretsEnCours, avantagesDuMois, joursParEmp] =
    await Promise.all([
      prisma.attendance.findMany({ where: { employeeId, date: { gte: debutMois, lte: finMois } } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
      prisma.prime.findMany({ where: { employeeId, mois, annee } }),
      prisma.fraisMedical.findMany({ where: { employeeId, mois, annee } }),
      prisma.acompteSalaire.findMany({ where: { employeeId, mois, annee, statut: "APPROUVE" } }),
      prisma.pretPersonnel.findMany({ where: { employeeId, statut: "EN_COURS" }, include: { retenues: true } }),
      // Informatifs : jamais injectés dans le moteur, uniquement remontés pour l'affichage.
      prisma.avantageNature.findMany({ where: { employeeId, mois, annee } }),
      chargerJoursMois(mois, annee, [employeeId]),
    ]);

  const joursFeries = new Set(joursFeriesDuMois.map((j) => new Date(j.date).toISOString().slice(0, 10)));
  const codes = attendances.map((a) => a.code as CodePresence);

  // Référence d'heures et base : le MÊME calcul que paie-batch.ts (calculerReferenceMois), sur le
  // MÊME assemblage des jours (chargerJoursMois). `joursCongePris` ne sert qu'à l'indemnité de congé
  // affichée par le lot ; l'aperçu ne l'expose pas → 0.
  const estBrigadePlanning = employee.categorie === "BRIGADE" && !estStage && typeContrat !== "JOURNALIER";
  const joursEmp = joursParEmp.get(employeeId) ?? { jours: [], saisie: [] };
  const ref = calculerReferenceMois({
    annee,
    mois,
    jours: joursEmp.jours,
    salaireMensuel: Number(employee.salaireMensuel),
    heuresHebdomadaires: Number(employee.heuresHebdomadaires),
    heuresParJour: Number(employee.heuresParJour),
    dateEmbauche: new Date(employee.dateEmbauche),
    joursFeries,
    joursCongePris: 0,
    referencePlanningDepuis: estBrigadePlanning ? (parametres.referencePlanningDepuis ?? null) : null,
    params: parametres,
  });
  const avertissements: AvertissementPaie[] = estBrigadePlanning
    ? [...ref.avertissements, ...detecterAvertissementsSaisie(joursEmp.saisie, { referencePlanning: ref.source === "PLANNING" })]
    : [];
  const hs = ref.hs;

  const joursPresenceP = codes.filter((c) => c === "P").length;
  const transportUSD =
    employee.categorie === "BRIGADE"
      ? (Number(employee.transportJourCDF) * joursPresenceP) / parametres.tauxChangeCDF
      : Number(employee.transportMoisUSD);
  const primesUSD = primesDuMois.reduce((s, p) => s + Number(p.montantUSD), 0);
  const acompteUSD = acomptesDuMois.reduce((s, a) => s + Number(a.montantUSD), 0);
  // Échéance de prêt du mois : min(retenue mensuelle, solde avant ce mois). Idempotent au recalcul.
  const retenuePretUSD = pretsEnCours.reduce(
    (s, p) =>
      s +
      calculerEcheancePret(
        Number(p.montantUSD),
        Number(p.retenueMensuelleUSD),
        p.retenues.map((r) => ({ mois: r.mois, annee: r.annee, montantUSD: Number(r.montantUSD) })),
        mois,
        annee
      ).echeanceUSD,
    0
  );
  const fraisMedicauxUSD =
    Number(employee.fraisMedicauxMoisCourant) + fraisMedDuMois.reduce((s, f) => s + Number(f.montantUSD), 0);

  const ligne = estStage
    ? calculerPaieStage(
        { indemniteUSD: Number(employee.salaireMensuel), transportUSD, fraisMedicauxUSD, primesUSD, acompteUSD, retenuePretUSD },
        parametres
      )
    : employee.categorie === "BRIGADE"
      ? calculerPaieBrigade(
          {
            ...ref.moteur,
            transportMoisUSD: transportUSD,
            enfants: employee.enfants,
            fraisMedicauxUSD,
            primesUSD,
            acompteUSD,
            retenuePretUSD,
          },
          parametres
        )
      : calculerPaieBackoffice(
          {
            salaireBaseUSD: Number(employee.salaireMensuel),
            transportUSD,
            enfants: employee.enfants,
            fraisMedicauxUSD,
            primesUSD,
            acompteUSD,
            retenuePretUSD,
          },
          parametres
        );

  return {
    ligne,
    // Heures travaillées : toujours informatives (même pour un stagiaire), comme paie-batch.ts.
    heuresTravaillees: hs.heuresTotalesMois,
    // Stage : pas d'heures supp. valorisées (indemnité forfaitaire, même règle que paie-batch.ts).
    hs30: estStage ? 0 : hs.hs30,
    hs60: estStage ? 0 : hs.hs60,
    hs100: estStage ? 0 : hs.hs100,
    joursPresenceP,
    primesUSD,
    primes: primesDuMois.map((p) => ({ nom: p.nom, montantUSD: Number(p.montantUSD) })),
    avantagesNatureUSD: avantagesDuMois.reduce((s, a) => s + Number(a.montantUSD), 0),
    avantagesNature: avantagesDuMois.map((a) => ({ nature: a.nature, montantUSD: Number(a.montantUSD) })),
    acompteUSD,
    tauxChangeCDF: parametres.tauxChangeCDF,
    transportUSD,
    reference: {
      source: ref.source,
      motif: ref.motif,
      heuresReference: ref.heuresReference,
      tauxMois: ref.tauxMois,
      avertissements,
    },
  };
}
```

Dans `src/app/(app)/employes/[id]/apercu-bulletin.tsx` :
- ajouter l'import `import { LIBELLE_SOURCE_REFERENCE } from "@/lib/paie-reference-libelles";`
- juste après le bloc `<div …>` qui affiche « Travaillées · HS 30/60/100 » (se termine par `</div>` avant la fermeture du tableau), ajouter :
```tsx
          <div className="flex items-center justify-between px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">{LIBELLE_SOURCE_REFERENCE[apercu.reference.source]}</span>
            <span className="font-medium">{fmtH(apercu.reference.heuresReference)}h</span>
          </div>
          {apercu.reference.avertissements.length > 0 && (
            <ul className="mx-3 mb-2 space-y-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {apercu.reference.avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
            </ul>
          )}
```

- [ ] **Step 4 : les voir passer, sans rien casser**

Run :
```bash
npx vitest run src/lib/paie-heures-planifiees.integration.test.ts src/lib/bulletin-live.integration.test.ts src/lib/avantage-nature.integration.test.ts
npm run typecheck && npx eslint src/lib/bulletin-live.ts src/lib/paie-reference-libelles.ts "src/app/(app)/employes/[id]/apercu-bulletin.tsx"
```
Attendu : 7 tests PASS dans le fichier de bout en bout ; les deux autres fichiers inchangés et verts.

- [ ] **Step 5 : falsifier** — dans `bulletin-live.ts`, remplacer `referencePlanningDepuis: estBrigadePlanning ? (parametres.referencePlanningDepuis ?? null) : null,` par `referencePlanningDepuis: null,` → « l'aperçu de la fiche … égal au lot, au centime » ROUGE (vérifié). Rétablir.

- [ ] **Step 6 : commit**

```bash
git add src/lib/bulletin-live.ts src/lib/paie-reference-libelles.ts "src/app/(app)/employes/[id]/apercu-bulletin.tsx" src/lib/paie-heures-planifiees.integration.test.ts
git commit -m "feat(paie): aligner l'aperçu de la fiche sur la paie aux heures planifiées

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8 : le bulletin imprimé dit la référence du mois

**Files :**
- Modify : `src/lib/pdf/bulletin.tsx`
- Test : `src/lib/pdf/bulletin.render.test.ts` (ajouts en fin de fichier)

**Interfaces :**
- Consumes : `LIBELLE_SOURCE_REFERENCE` (tâche 7) ; colonnes `PayrollLine.sourceReference`, `heuresPayeesNonTravaillees` (tâche 4).
- Produces : aucune API ; rendu seulement. Le bulletin reste sur UNE page.

Rappel : la case « Taux horaire » du bulletin vaut déjà `brut(S) / heuresContractuelles` ; comme `heuresContractuelles` porte R (tâche 6), elle devient juste sans changement de calcul. Les libellés de la case récapitulative sont rendus EN CAPITALES (`textTransform: "uppercase"`) : les tests cherchent donc `HEURES PLANIFIÉES`.

- [ ] **Step 1 : les tests qui échouent** — ajouter en fin de `src/lib/pdf/bulletin.render.test.ts` :

```ts
/** Nombre de pages du PDF rendu : le bulletin tient sur UNE page. */
async function pagesDu(buffer: Buffer): Promise<number> {
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: new Uint8Array(buffer) }).getText()).pages.length;
}

describe("bulletin — référence d'heures du mois (paie sur heures planifiées, 2026-09-23)", () => {
  it("ligne antérieure (source CONTRAT par défaut) : « Heures / mois », comme avant", async () => {
    const t = await texteDu(await rendre(ligne()));
    // Les libellés de la case récapitulative sont rendus en capitales (style `recapLabel`).
    expect(t).toMatch(/HEURES \/ MOIS\s*208 h/);
    expect(t).not.toContain("HEURES PLANIFIÉES");
  }, 60_000);

  it("source PLANNING : « Heures planifiées » et R (216 h), sur une seule page", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 216 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/HEURES PLANIFIÉES\s*216 h/);
    expect(await pagesDu(buf)).toBe(1);
  }, 60_000);

  it("repli : « Heures contrat (repli) »", async () => {
    const t = await texteDu(await rendre(ligne({ sourceReference: "CONTRAT_REPLI" })));
    expect(t).toMatch(/HEURES CONTRAT \(REPLI\)\s*208 h/);
  }, 60_000);

  it("jours payés non travaillés en heures : base « 54 h (9 j) », une seule page avec congé", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 156, heuresPayeesNonTravaillees: 54, joursPayesNonTravailles: 9, remunerationJoursPayesUSD: 82.05, joursCongePris: 9 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/54 h \(9 j\)/);
    expect(await pagesDu(buf)).toBe(1);
  }, 60_000);
});
```

- [ ] **Step 2 : les voir échouer**

Run : `npx vitest run src/lib/pdf/bulletin.render.test.ts`
Attendu : 3 nouveaux tests ROUGES (PLANNING, repli, « 54 h (9 j) ») ; les 4 autres verts.

- [ ] **Step 3 : implémentation** — dans `src/lib/pdf/bulletin.tsx` :
1. sous `import { salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";` :
```ts
import { LIBELLE_SOURCE_REFERENCE } from "@/lib/paie-reference-libelles";
```
2. sous `const heuresContractuelles = Number(ligne.heuresContractuelles);` :
```ts
  // Paie sur heures planifiées (2026-09-23) : la case dit d'où viennent les heures du mois. Une ligne
  // antérieure (source CONTRAT par défaut en base) garde « Heures / mois ».
  const libelleHeuresMois = LIBELLE_SOURCE_REFERENCE[ligne.sourceReference] ?? LIBELLE_SOURCE_REFERENCE.CONTRAT;
  // Jours payés non travaillés comptés en HEURES depuis le 2026-09-23 (0 = ligne antérieure : base en jours).
  const heuresPayeesNonTravaillees = Number(ligne.heuresPayeesNonTravaillees ?? 0);
```
3. remplacer `<Recap label="Heures / mois" value={`${heuresContractuelles} h`} />` par :
```tsx
        <Recap label={libelleHeuresMois} value={`${heuresContractuelles} h`} />
```
4. dans la `Row` « Jours payés non travaillés (congés, fériés, repos) », remplacer les deux props `base` et `taux` par :
```tsx
                base={
                  heuresPayeesNonTravaillees > 0
                    ? `${heuresPayeesNonTravaillees} h (${Number(ligne.joursPayesNonTravailles ?? 0)} j)`
                    : `${Number(ligne.joursPayesNonTravailles ?? 0)} j`
                }
                taux={m(heuresPayeesNonTravaillees > 0 ? tauxHoraire : tauxHoraire * Number(employee.heuresParJour))}
```

- [ ] **Step 4 : les voir passer**

Run : `npx vitest run src/lib/pdf/bulletin.render.test.ts src/lib/pdf/glyphes-manquants.test.ts && npm run typecheck`
Attendu : 7 + garde-fou des glyphes verts (vérifié le 2026-09-23 sur une copie).

- [ ] **Step 5 : falsifier** (vérifié) — remettre `label="Heures / mois"` en dur → 2 tests ROUGES ; remplacer `heuresPayeesNonTravaillees > 0\n ? …` par `false ? …` → « 54 h (9 j) » ROUGE. Rétablir.

- [ ] **Step 6 : commit**

```bash
git add src/lib/pdf/bulletin.tsx src/lib/pdf/bulletin.render.test.ts
git commit -m "feat(bulletin): afficher les heures planifiées ou le repli contrat, et les jours payés en heures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9 : écran Paie — badge de référence, avertissements, confirmation avant validation

**Files :**
- Create : `src/app/(app)/paie/avertissements-validation.ts`, `src/app/(app)/paie/avertissements-paie.tsx`, `src/app/(app)/paie/avertissements-validation.test.ts`
- Modify : `src/app/(app)/paie/paie-bulk.tsx`, `src/app/(app)/paie/status-actions.tsx`, `src/app/(app)/paie/bulletins-validation.tsx`, `src/app/(app)/paie/page.tsx`

**Interfaces :**
- Consumes : `type AvertissementPaie`, `type SourceReference` (tâche 2) ; `lireAvertissements` (tâche 3) ; colonnes de la tâche 4 ; `DonneesLignePaie` enrichi (tâche 6) ; `ConfirmSubmitButton` (`@/components/confirm-submit-button`, existant, `variante="valider"`).
- Produces :
  - `export type LigneAAvertir = { nom: string; avertissements: AvertissementPaie[] }`
  - `export function messageConfirmationValidation(lignes: LigneAAvertir[]): string | null`
  - `export function BadgeReference(props: { sourceReference: SourceReference; motifReference: string | null; avertissements: AvertissementPaie[] }): JSX.Element`
  - `PaieRow` gagne `sourceReference: SourceReference; motifReference: string | null; avertissements: AvertissementPaie[]`.
  - `StatusActions` gagne la prop optionnelle `avertissements?: AvertissementPaie[]` et `nom?: string`.

Décision Direction 4 : avertir à la validation, **sans bloquer**. La boîte est la confirmation navigateur déjà utilisée par le dépôt (`ConfirmSubmitButton` / `window.confirm`) : « OK » valide, « Annuler » ne fait rien.

- [ ] **Step 1 : les tests qui échouent** — `src/app/(app)/paie/avertissements-validation.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { messageConfirmationValidation } from "./avertissements-validation";
import { BadgeReference } from "./avertissements-paie";

const RACHEL = { nom: "Rachel Lunda", avertissements: [{ code: "PRESENCE_SANS_CRENEAU" as const, message: "Travail hors planning (2 j) : 28/09, 30/09" }] };
const MARTINE = { nom: "Martine Mutombo", avertissements: [] };

describe("messageConfirmationValidation", () => {
  it("rien à signaler → null (validation directe, sans boîte)", () => {
    expect(messageConfirmationValidation([MARTINE])).toBeNull();
  });
  it("liste chaque avertissement avec le nom, et laisse valider", () => {
    expect(messageConfirmationValidation([MARTINE, RACHEL])).toBe(
      "Avant de valider (la validation reste possible) :\n\n• Rachel Lunda — Travail hors planning (2 j) : 28/09, 30/09\n\nValider quand même ?",
    );
  });
});

describe("BadgeReference", () => {
  it("rien quand la ligne est sur le planning sans avertissement", () => {
    expect(renderToStaticMarkup(BadgeReference({ sourceReference: "PLANNING", motifReference: null, avertissements: [] }))).toBe("");
  });
  it("repli : badge avec le motif en infobulle, sans le compter deux fois", () => {
    const html = renderToStaticMarkup(BadgeReference({ sourceReference: "CONTRAT_REPLI", motifReference: "Planning incomplet : semaine du 21/09 sans créneau",
      avertissements: [{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Planning incomplet : semaine du 21/09 sans créneau" }] }));
    expect(html).toContain("Réf. contrat (repli)");
    expect(html).toContain('title="Planning incomplet : semaine du 21/09 sans créneau"');
    expect(html).not.toContain("⚠");
  });
  it("autres avertissements : « ⚠ n » et le détail en infobulle", () => {
    const html = renderToStaticMarkup(BadgeReference({ sourceReference: "PLANNING", motifReference: null, avertissements: RACHEL.avertissements }));
    expect(html).toContain("⚠ 1");
    expect(html).toContain("Travail hors planning (2 j) : 28/09, 30/09");
  });
});
```

- [ ] **Step 2 : les voir échouer**

Run : `npx vitest run "src/app/(app)/paie/avertissements-validation.test.ts"`
Attendu : FAIL, modules introuvables.

- [ ] **Step 3 : implémentation**

`src/app/(app)/paie/avertissements-validation.ts` :
```ts
// Confirmation AVANT validation de la paie — module PUR. Décision Direction 2026-09-23 : les
// avertissements ne bloquent jamais ; ils sont montrés une fois, clairement, au moment de valider.
import type { AvertissementPaie } from "@/lib/paie-reference";

export type LigneAAvertir = { nom: string; avertissements: AvertissementPaie[] };

/** Message de la boîte de confirmation, ou `null` s'il n'y a rien à signaler (validation directe). */
export function messageConfirmationValidation(lignes: LigneAAvertir[]): string | null {
  const aSignaler = lignes.filter((l) => l.avertissements.length > 0);
  if (aSignaler.length === 0) return null;
  const puces = aSignaler.flatMap((l) => l.avertissements.map((a) => `• ${l.nom} — ${a.message}`));
  return `Avant de valider (la validation reste possible) :\n\n${puces.join("\n")}\n\nValider quand même ?`;
}
```

`src/app/(app)/paie/avertissements-paie.tsx` :
```tsx
// Badge « référence » et avertissements d'une ligne de paie — présentation seule, sans état.
import type { AvertissementPaie, SourceReference } from "@/lib/paie-reference";

/** Rien quand tout va bien ; « Réf. contrat (repli) » si le mois est retombé sur le contrat ;
 *  « ⚠ n » s'il reste d'autres avertissements. Le détail est dans l'infobulle (title). */
export function BadgeReference({ sourceReference, motifReference, avertissements }: {
  sourceReference: SourceReference;
  motifReference: string | null;
  avertissements: AvertissementPaie[];
}) {
  const autres = avertissements.filter((a) => a.code !== "REPLI_CONTRAT");
  return (
    <>
      {sourceReference === "CONTRAT_REPLI" && (
        <span title={motifReference ?? undefined} className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
          Réf. contrat (repli)
        </span>
      )}
      {autres.length > 0 && (
        <span title={autres.map((a) => a.message).join("\n")} className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
          ⚠ {autres.length}
        </span>
      )}
    </>
  );
}
```

`src/app/(app)/paie/paie-bulk.tsx` :
1. imports : `import type { AvertissementPaie, SourceReference } from "@/lib/paie-reference";`, `import { BadgeReference } from "./avertissements-paie";`, `import { messageConfirmationValidation } from "./avertissements-validation";`
2. dans `export type PaieRow`, après `acompteUSD: number;` :
```ts
  // Référence d'heures du mois (paie sur heures planifiées, 2026-09-23) et avertissements.
  sourceReference: SourceReference;
  motifReference: string | null;
  avertissements: AvertissementPaie[];
```
3. dans `lancer`, juste après `if (ids.length === 0) return;` :
```ts
    // Validation : montrer les avertissements des lignes choisies, sans jamais bloquer.
    if (versStatut === "VALIDE") {
      const message = messageConfirmationValidation(toutes.filter((r) => selection.has(r.id)));
      if (message && !window.confirm(message)) return;
    }
```
4. dans la cellule du nom (`<EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} />`), ajouter juste après :
```tsx
                  <BadgeReference sourceReference={l.sourceReference} motifReference={l.motifReference} avertissements={l.avertissements} />
```
5. à l'appel `<StatusActions … modePaiementDefaut={l.modePaiementDefaut} />` de ce fichier, ajouter `avertissements={l.avertissements} nom={l.nom}`.

`src/app/(app)/paie/status-actions.tsx` :
1. imports : `import { ConfirmSubmitButton } from "@/components/confirm-submit-button";`, `import type { AvertissementPaie } from "@/lib/paie-reference";`, `import { messageConfirmationValidation } from "./avertissements-validation";`
2. props : ajouter `avertissements = [],` et `nom = "",` dans la déstructuration, et dans le type `avertissements?: AvertissementPaie[]; // montrés avant de valider, jamais bloquants` et `nom?: string;`
3. avant `return (`, ajouter `const confirmation = messageConfirmationValidation([{ nom, avertissements }]);`
4. remplacer le bloc `) : (<BoutonValider type="submit">{LABEL_AVANT[vers]}</BoutonValider>)` par :
```tsx
            ) : vers === "VALIDE" && confirmation ? (
              <ConfirmSubmitButton variante="valider" message={confirmation}>{LABEL_AVANT[vers]}</ConfirmSubmitButton>
            ) : (
              <BoutonValider type="submit">{LABEL_AVANT[vers]}</BoutonValider>
            )}
```

`src/app/(app)/paie/bulletins-validation.tsx` :
1. import `import { BadgeReference } from "./avertissements-paie";`
2. après les DEUX `<p className="truncate text-sm font-medium">{r.nom}</p>` (carte mobile, liste bureau), ajouter :
```tsx
                    <BadgeReference sourceReference={r.sourceReference} motifReference={r.motifReference} avertissements={r.avertissements} />
```
3. aux DEUX appels `<StatusActions … />` (lignes `r` et `sel`), ajouter `avertissements={r.avertissements} nom={r.nom}` (resp. `sel.avertissements`, `sel.nom`).
4. sous le panneau de droite (là où `sel` est affiché, au-dessus de l'aperçu PDF), afficher la liste complète :
```tsx
              {sel && sel.avertissements.length > 0 && (
                <ul className="mb-2 space-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {sel.avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
                </ul>
              )}
```

`src/app/(app)/paie/page.tsx` :
1. import `import { lireAvertissements } from "@/lib/paie-avertissements";`
2. dans le `map` des lignes ENREGISTRÉES (`run.lignes.map((l) => ({ … }))`), après `acompteUSD: Number(l.acompteUSD),` :
```ts
        sourceReference: l.sourceReference,
        motifReference: l.motifReference,
        avertissements: lireAvertissements(l.avertissementsPaie),
```
3. dans le `map` de l'APERÇU (`apercu!.lignes`), après `acompteUSD: l.data.acompteUSD,` :
```ts
        sourceReference: l.data.sourceReference,
        motifReference: l.data.motifReference,
        avertissements: l.data.avertissementsPaie,
```

- [ ] **Step 4 : les voir passer**

Run : `npx vitest run "src/app/(app)/paie" && npm run typecheck && npx eslint "src/app/(app)/paie"`
Attendu : 5 nouveaux tests PASS (vérifiés le 2026-09-23), les tests existants du dossier verts, typecheck propre (tous les `PaieRow` construits portent les 3 nouveaux champs).

- [ ] **Step 5 : falsifier** — dans `avertissements-validation.ts`, remplacer `if (aSignaler.length === 0) return null;` par `if (aSignaler.length >= 0) return null;` → le 2e test ROUGE ; dans `avertissements-paie.tsx`, retirer `.filter((a) => a.code !== "REPLI_CONTRAT")` → « sans le compter deux fois » ROUGE. Rétablir.

- [ ] **Step 6 : vérification à l'écran** (serveur de dev sur une base LOCALE uniquement — jamais `npm run dev` avec le `.env` de production) : si aucune base locale n'est disponible, noter « non vérifié à l'écran » dans le rapport de tâche, sans contourner.

- [ ] **Step 7 : commit**

```bash
git add "src/app/(app)/paie"
git commit -m "feat(paie): montrer la référence et les avertissements, et les rappeler avant de valider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10 : écrire le planning par un seul chemin, tracé et verrouillé (`src/lib/planning-ecriture.ts`)

**Files :**
- Modify : `src/lib/audit.ts` (fichier complet ci-dessous ; `journaliser` garde sa signature)
- Create : `src/lib/planning-ecriture.ts`, `src/lib/planning-ecriture.integration.test.ts`

**Interfaces :**
- Produces :
  - `src/lib/audit.ts` : `export type EntreeJournal = { entite: string; entiteId: string; champ: string; ancienneValeur?: string | number | null; nouvelleValeur?: string | number | null; userId: string }` ; `export async function journaliser(client: ClientAudit, params: EntreeJournal): Promise<void>` (inchangée pour ses appelants) ; `export async function journaliserPlusieurs(client: ClientAudit, entrees: EntreeJournal[]): Promise<void>`.
  - `src/lib/planning-ecriture.ts` : `export type OperationCreneau = { employeeId: string; date: Date; shiftId: string | null }` (`null` = effacer) ; `export type Verrou = { employeeId: string; nom: string; mois: number; annee: number }` ; `export class PlanningVerrouilleError extends Error { readonly verrous: Verrou[] }` ; `export async function verrousPlanning(tx: Prisma.TransactionClient, operations: OperationCreneau[]): Promise<Verrou[]>` ; `export async function ecrireCreneaux(tx: Prisma.TransactionClient, userId: string, operations: OperationCreneau[], opts?: { genereAuto?: boolean }): Promise<number>`.

Règles (spec §6.1-6.2, décision 3) : journal `entite = "PlanningCreneau"`, `entiteId = "<employeeId>|AAAA-MM-JJ"`, `champ = "shiftId"`, avant → après (`null` = pas de créneau) ; une entrée par créneau RÉELLEMENT changé. **Verrou par (salarié, mois)** : refus si la ligne de paie DE CE SALARIÉ pour CE mois est `VALIDE` ou `PAYE` (les autres salariés du mois restent modifiables) ; un seul verrou → rien n'est écrit (tout ou rien).

- [ ] **Step 1 : le test qui échoue** — `src/lib/planning-ecriture.integration.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le planning est une pièce de paie depuis le 2026-09-23 : tracé à chaque changement, verrouillé
// pour un salarié dont la paie du mois est VALIDÉE ou PAYÉE (décision Direction 3).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { ecrireCreneaux, PlanningVerrouilleError } = await import("./planning-ecriture");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let userId = "";
let valide = "";
let ouvert = "";
let matin = "";
let soir = "";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ecrire = (ops: { employeeId: string; date: Date; shiftId: string | null }[], opts?: { genereAuto?: boolean }) =>
  prisma.$transaction((tx) => ecrireCreneaux(tx, userId, ops, opts));
const journal = (employeeId: string, iso: string) =>
  prisma.journalAudit.findMany({ where: { entite: "PlanningCreneau", entiteId: `${employeeId}|${iso}` }, orderBy: { date: "asc" } });

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  userId = (await prisma.user.create({ data: { email: "planning@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE" as const, salaireMensuel: 200, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0 };
  valide = (await prisma.employee.create({ data: { ...base, matricule: "VA01-PEF", nom: "Martine Mutombo" } })).id;
  ouvert = (await prisma.employee.create({ data: { ...base, matricule: "OU01-PEF", nom: "Rachel Lunda" } })).id;
  matin = (await prisma.shift.create({ data: { nom: "Matin", heureDebut: "08:00", heureFin: "16:00" } })).id;
  soir = (await prisma.shift.create({ data: { nom: "Soir", heureDebut: "16:00", heureFin: "22:00" } })).id;
  const run = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2300 } });
  const montants = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: valide, statutPaiement: "VALIDE" } });
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: ouvert, statutPaiement: "PAS_VALIDE" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("ecrireCreneaux — trace", () => {
  it("création, modification, suppression : une entrée de journal chacune, avant → après", async () => {
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-10"), shiftId: matin }])).toBe(1);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-10"), shiftId: soir }])).toBe(1);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-10"), shiftId: null }])).toBe(1);
    const j = await journal(ouvert, "2026-09-10");
    expect(j.map((e) => [e.ancienneValeur, e.nouvelleValeur, e.userId, e.champ])).toEqual([
      [null, matin, userId, "shiftId"],
      [matin, soir, userId, "shiftId"],
      [soir, null, userId, "shiftId"],
    ]);
    expect(await prisma.planningCreneau.count({ where: { employeeId: ouvert, date: d("2026-09-10") } })).toBe(0);
  });

  it("réécrire le même shift ne change rien et ne journalise rien", async () => {
    await ecrire([{ employeeId: ouvert, date: d("2026-09-11"), shiftId: matin }]);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-11"), shiftId: matin }])).toBe(0);
    expect(await journal(ouvert, "2026-09-11")).toHaveLength(1);
  });

  it("génération automatique : le marqueur genereAuto est posé", async () => {
    await ecrire([{ employeeId: ouvert, date: d("2026-09-12"), shiftId: matin }], { genereAuto: true });
    expect((await prisma.planningCreneau.findFirstOrThrow({ where: { employeeId: ouvert, date: d("2026-09-12") } })).genereAuto).toBe(true);
  });
});

describe("ecrireCreneaux — verrou", () => {
  it("paie VALIDÉE du salarié pour ce mois → refus, message lisible, RIEN d'écrit (lot compris)", async () => {
    const tentative = ecrire([
      { employeeId: ouvert, date: d("2026-09-15"), shiftId: matin },
      { employeeId: valide, date: d("2026-09-15"), shiftId: matin },
    ]);
    await expect(tentative).rejects.toBeInstanceOf(PlanningVerrouilleError);
    await expect(ecrire([{ employeeId: valide, date: d("2026-09-15"), shiftId: matin }])).rejects.toThrow(
      "Planning verrouillé : paie validée pour Martine Mutombo (septembre 2026). Rouvrir la ligne de paie avant de modifier ce planning.",
    );
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-15") } })).toBe(0);
    expect(await journal(ouvert, "2026-09-15")).toHaveLength(0);
  });

  it("même salarié, autre mois → autorisé ; autre salarié, même mois → autorisé", async () => {
    expect(await ecrire([{ employeeId: valide, date: d("2026-10-01"), shiftId: matin }])).toBe(1);
    expect(await ecrire([{ employeeId: ouvert, date: d("2026-09-16"), shiftId: matin }])).toBe(1);
  });

  it("lot croisé : salarié validé en septembre mais écrit en octobre, l'autre en septembre → autorisé", async () => {
    expect(await ecrire([
      { employeeId: valide, date: d("2026-10-02"), shiftId: matin },
      { employeeId: ouvert, date: d("2026-09-17"), shiftId: matin },
    ])).toBe(2);
  });

  it("paie PAYÉE → refus aussi", async () => {
    await prisma.payrollLine.updateMany({ where: { employeeId: valide }, data: { statutPaiement: "PAYE" } });
    await expect(ecrire([{ employeeId: valide, date: d("2026-09-20"), shiftId: null }])).rejects.toBeInstanceOf(PlanningVerrouilleError);
  });
});
```

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/planning-ecriture.integration.test.ts`
Attendu : FAIL, `Failed to resolve import "./planning-ecriture"`.

- [ ] **Step 3 : implémentation**

Remplacer `src/lib/audit.ts` par :
```ts
import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type ClientAudit = Prisma.TransactionClient | typeof prisma;

/** Une entrée du journal d'audit (qui / quoi / avant / après). */
export type EntreeJournal = {
  entite: string;
  entiteId: string;
  champ: string;
  ancienneValeur?: string | number | null;
  nouvelleValeur?: string | number | null;
  userId: string;
};

const texte = (v: string | number | null | undefined) => (v === undefined || v === null ? null : String(v));

/**
 * Enregistre une entrée au journal d'audit (qui / quand / champ / avant / après).
 * À appeler pour toute modification sensible : salaire, contrat, congé validé,
 * présence corrigée, transition de statut de paie, etc.
 */
export async function journaliser(client: ClientAudit, params: EntreeJournal) {
  await journaliserPlusieurs(client, [params]);
}

/** Plusieurs entrées en une requête (ex. une génération de planning : des centaines de créneaux). */
export async function journaliserPlusieurs(client: ClientAudit, entrees: EntreeJournal[]) {
  if (entrees.length === 0) return;
  await client.journalAudit.createMany({
    data: entrees.map((e) => ({
      entite: e.entite,
      entiteId: e.entiteId,
      champ: e.champ,
      ancienneValeur: texte(e.ancienneValeur),
      nouvelleValeur: texte(e.nouvelleValeur),
      userId: e.userId,
    })),
  });
}
```

`src/lib/planning-ecriture.ts` :
```ts
import "server-only";

// SEUL chemin d'écriture du planning (spec 2026-09-23 §6, décision Direction 3) : depuis que la paie
// de la brigade suit les heures PLANIFIÉES, un créneau est une pièce de paie. Chaque création,
// modification ou suppression est donc (1) refusée si la ligne de paie du salarié pour ce mois est
// VALIDÉE ou PAYÉE, (2) journalisée (qui, quand, avant, après) dans JournalAudit.
import type { Prisma } from "@prisma/client";
import { journaliserPlusieurs, type EntreeJournal } from "@/lib/audit";
import { MOIS_FR } from "@/lib/dates-fr";

/** `shiftId: null` = effacer le créneau de ce jour. */
export type OperationCreneau = { employeeId: string; date: Date; shiftId: string | null };

export type Verrou = { employeeId: string; nom: string; mois: number; annee: number };

export class PlanningVerrouilleError extends Error {
  constructor(public readonly verrous: Verrou[]) {
    super(
      `Planning verrouillé : paie validée pour ${verrous.map((v) => `${v.nom} (${MOIS_FR[v.mois - 1]} ${v.annee})`).join(", ")}. ` +
        "Rouvrir la ligne de paie avant de modifier ce planning.",
    );
    this.name = "PlanningVerrouilleError";
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cle = (employeeId: string, d: Date) => `${employeeId}|${iso(d)}`;

/** (salarié, mois) touchés par `operations` dont la ligne de paie est VALIDÉE ou PAYÉE. */
export async function verrousPlanning(tx: Prisma.TransactionClient, operations: OperationCreneau[]): Promise<Verrou[]> {
  if (operations.length === 0) return [];
  const paires = new Set(operations.map((o) => `${o.employeeId}|${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`));
  const mois = [...new Set(operations.map((o) => `${o.date.getUTCFullYear()}|${o.date.getUTCMonth() + 1}`))].map((m) => {
    const [annee, mo] = m.split("|").map(Number);
    return { annee, mois: mo };
  });
  const lignes = await tx.payrollLine.findMany({
    where: {
      employeeId: { in: [...new Set(operations.map((o) => o.employeeId))] },
      statutPaiement: { in: ["VALIDE", "PAYE"] },
      payrollRun: { OR: mois },
    },
    select: { employeeId: true, employee: { select: { nom: true } }, payrollRun: { select: { mois: true, annee: true } } },
  });
  return lignes
    .filter((l) => paires.has(`${l.employeeId}|${l.payrollRun.annee}|${l.payrollRun.mois}`))
    .map((l) => ({ employeeId: l.employeeId, nom: l.employee.nom, mois: l.payrollRun.mois, annee: l.payrollRun.annee }));
}

/**
 * Applique `operations` au planning dans la transaction `tx` : verrou d'abord (rien n'est écrit si
 * un seul (salarié, mois) est verrouillé), puis écriture, puis une entrée de journal par créneau
 * RÉELLEMENT changé. Renvoie le nombre de créneaux changés.
 */
export async function ecrireCreneaux(
  tx: Prisma.TransactionClient,
  userId: string,
  operations: OperationCreneau[],
  opts: { genereAuto?: boolean } = {},
): Promise<number> {
  const verrous = await verrousPlanning(tx, operations);
  if (verrous.length > 0) throw new PlanningVerrouilleError(verrous);

  const existants = operations.length === 0 ? [] : await tx.planningCreneau.findMany({
    where: { OR: operations.map((o) => ({ employeeId: o.employeeId, date: o.date })) },
    select: { employeeId: true, date: true, shiftId: true },
  });
  const avant = new Map(existants.map((e) => [cle(e.employeeId, e.date), e.shiftId]));
  const genereAuto = opts.genereAuto ?? false;

  const aEffacer: OperationCreneau[] = [];
  const aCreer: OperationCreneau[] = [];
  const aModifier: OperationCreneau[] = [];
  const journal: EntreeJournal[] = [];
  const vus = new Set<string>();
  for (const o of operations) {
    const k = cle(o.employeeId, o.date);
    if (vus.has(k)) continue; // une seule opération par (salarié, jour) : la première
    vus.add(k);
    const ancien = avant.get(k) ?? null;
    if (ancien === o.shiftId) continue;
    if (o.shiftId === null) aEffacer.push(o);
    else if (ancien === null) aCreer.push(o);
    else aModifier.push(o);
    journal.push({ entite: "PlanningCreneau", entiteId: k, champ: "shiftId", ancienneValeur: ancien, nouvelleValeur: o.shiftId, userId });
  }

  if (aEffacer.length > 0) {
    await tx.planningCreneau.deleteMany({ where: { OR: aEffacer.map((o) => ({ employeeId: o.employeeId, date: o.date })) } });
  }
  if (aCreer.length > 0) {
    await tx.planningCreneau.createMany({ data: aCreer.map((o) => ({ employeeId: o.employeeId, date: o.date, shiftId: o.shiftId!, genereAuto })) });
  }
  for (const o of aModifier) {
    await tx.planningCreneau.update({
      where: { employeeId_date: { employeeId: o.employeeId, date: o.date } },
      data: { shiftId: o.shiftId!, genereAuto },
    });
  }
  await journaliserPlusieurs(tx, journal);
  return journal.length;
}
```

- [ ] **Step 4 : le voir passer**

Run : `npx vitest run src/lib/planning-ecriture.integration.test.ts && npm run typecheck && npx eslint src/lib/planning-ecriture.ts src/lib/audit.ts`
Attendu : 7 tests PASS (vérifiés le 2026-09-23). Les appelants existants de `journaliser` compilent sans changement.

- [ ] **Step 5 : falsifier** (vérifié, chacune seule)

| Mutation dans `planning-ecriture.ts` | Test qui rougit |
|---|---|
| supprimer `if (verrous.length > 0) throw new PlanningVerrouilleError(verrous);` | « paie VALIDÉE … », « paie PAYÉE … » |
| supprimer `if (ancien === o.shiftId) continue;` | « réécrire le même shift … » |
| supprimer la ligne `.filter((l) => paires.has(…))` | « lot croisé … » |

- [ ] **Step 6 : commit**

```bash
git add src/lib/audit.ts src/lib/planning-ecriture.ts src/lib/planning-ecriture.integration.test.ts
git commit -m "feat(planning): tracer chaque créneau et verrouiller le planning d'une paie validée

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11 : tous les points d'écriture du planning passent par `ecrireCreneaux`

**Files :**
- Modify : `src/app/(app)/planning/actions.ts` (diff exact ci-dessous), `src/lib/echange-creneau.ts` (fichier complet), `src/app/espace/actions.ts`, `src/app/(app)/planning/planning-semaine.tsx`, `src/app/(app)/planning/auto-planning-form.tsx`, `src/app/(app)/a-valider/page.tsx`
- Create : `src/app/(app)/planning/planning-verrou.integration.test.ts`, `src/lib/planning-ecriture.source.test.ts`

**Interfaces :**
- Consumes : `ecrireCreneaux`, `PlanningVerrouilleError`, `type OperationCreneau` (tâche 10).
- Produces (signatures qui CHANGENT) :
  - `saisirCreneau(employeeId: string, dateIso: string, shiftId: string): Promise<{ erreur?: string }>`
  - `saisirCreneauxEnLot(entrees: { employeeId: string; dateIso: string; shiftId: string }[]): Promise<{ erreur?: string }>`
  - `ResumeGeneration.erreur?: string` (planning verrouillé : rien d'écrit)
  - `finaliserEchangeSiComplet(id: string, userId: string): Promise<{ fait: boolean; erreur?: string }>` (était `Promise<boolean>`)
  - `approuverChangementShift` / `approuverEchange` : planning verrouillé → `redirect("/a-valider?erreur=<message>")`.

Points d'écriture recensés (grep du 2026-09-23 : `planningCreneau.(create|createMany|update|upsert|delete|deleteMany)`) : `saisirCreneau`, `genererPlanningAuto`, `saisirCreneauxEnLot`, `approuverChangementShift` (planning/actions.ts), `finaliserEchangeSiComplet` (echange-creneau.ts). Aucun autre. Le garde-fou de source ci-dessous empêche d'en rajouter.

- [ ] **Step 1 : les tests qui échouent**

`src/lib/planning-ecriture.source.test.ts` :
```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Garde-fou de SOURCE : depuis le 2026-09-23 le planning est une pièce de paie. Toute écriture
// directe de PlanningCreneau contournerait le verrou (paie validée) et le journal d'audit.
const RACINE = path.join(process.cwd(), "src");
const ECRITURE = /planningCreneau\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

function fichiers(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("garde-fou : le planning ne s'écrit que par ecrireCreneaux", () => {
  it("aucune écriture directe de PlanningCreneau hors src/lib/planning-ecriture.ts", () => {
    const fautifs = fichiers(RACINE)
      .filter((f) => path.relative(RACINE, f) !== path.join("lib", "planning-ecriture.ts"))
      .filter((f) => ECRITURE.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(RACINE, f));
    expect(fautifs).toEqual([]);
  });
});
```

`src/app/(app)/planning/planning-verrou.integration.test.ts` :
```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Les ACTIONS du planning passent toutes par `ecrireCreneaux` : refus propre quand la paie du
// salarié est validée pour ce mois, et trace sinon (décision Direction 3, 2026-09-23).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { saisirCreneau, saisirCreneauxEnLot, genererPlanningAuto, approuverEchange } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let valide = "";
let ouvert = "";
let matin = "";
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const MESSAGE = "Planning verrouillé : paie validée pour Martine Mutombo (septembre 2026). Rouvrir la ligne de paie avant de modifier ce planning.";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Serveur", secteur: "Salle", categorie: "BRIGADE" as const, salaireMensuel: 200, dateEmbauche: d("2025-01-06"), contrat: "CDD", enfants: 0, heuresHebdomadaires: 48 };
  valide = (await prisma.employee.create({ data: { ...base, matricule: "VA01-PEF", nom: "Martine Mutombo" } })).id;
  ouvert = (await prisma.employee.create({ data: { ...base, matricule: "OU01-PEF", nom: "Rachel Lunda" } })).id;
  matin = (await prisma.shift.create({ data: { nom: "Matin", heureDebut: "08:00", heureFin: "16:00" } })).id;
  // Modèle du lundi pour les deux : la génération posera un créneau le lundi 14/09.
  await prisma.planningModele.createMany({ data: [valide, ouvert].map((employeeId) => ({ employeeId, jour: 1, semaine: 0, shiftId: matin })) });
  const run = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2300 } });
  const montants = { salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0, salNetUSD: 0, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: 0, coutEmployeurCDF: 0 };
  await prisma.payrollLine.create({ data: { ...montants, payrollRunId: run.id, employeeId: valide, statutPaiement: "VALIDE" } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("actions du planning — verrou et trace", () => {
  it("saisirCreneau : mois validé → erreur lisible, rien d'écrit", async () => {
    expect(await saisirCreneau(valide, "2026-09-10", matin)).toEqual({ erreur: MESSAGE });
    expect(await prisma.planningCreneau.count({ where: { employeeId: valide } })).toBe(0);
  });

  it("saisirCreneau : mois ouvert → écrit et journalisé au nom de l'utilisateur", async () => {
    expect(await saisirCreneau(ouvert, "2026-09-10", matin)).toEqual({});
    const j = await prisma.journalAudit.findMany({ where: { entite: "PlanningCreneau", entiteId: `${ouvert}|2026-09-10` } });
    expect(j.map((e) => [e.ancienneValeur, e.nouvelleValeur, e.userId])).toEqual([[null, matin, A.user.id]]);
  });

  it("saisirCreneauxEnLot : un seul salarié verrouillé → tout le lot refusé", async () => {
    expect(await saisirCreneauxEnLot([
      { employeeId: ouvert, dateIso: "2026-09-11", shiftId: matin },
      { employeeId: valide, dateIso: "2026-09-11", shiftId: matin },
    ])).toEqual({ erreur: MESSAGE });
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-11") } })).toBe(0);
  });

  it("genererPlanningAuto : un salarié verrouillé dans la période → erreur, rien d'écrit", async () => {
    const r = await genererPlanningAuto("2026-09-14", "2026-09-14", fd({ modeles: "on" }));
    expect(r.erreur).toBe(MESSAGE);
    expect(await prisma.planningCreneau.count({ where: { date: d("2026-09-14") } })).toBe(0);
  });

  it("genererPlanningAuto : période libre → créneaux ✨ journalisés", async () => {
    const r = await genererPlanningAuto("2026-10-05", "2026-10-05", fd({ modeles: "on" }));
    expect(r.erreur).toBeUndefined();
    const c = await prisma.planningCreneau.findMany({ where: { date: d("2026-10-05") } });
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.genereAuto)).toBe(true);
    expect(await prisma.journalAudit.count({ where: { entite: "PlanningCreneau", entiteId: { endsWith: "|2026-10-05" } } })).toBe(2);
  });

  it("approuverEchange : échange touchant un salarié verrouillé → renvoi vers /a-valider avec le message, échange en attente", async () => {
    const e = await prisma.echangeCreneau.create({ data: {
      demandeurId: ouvert, demandeurDate: d("2026-09-10"), demandeurShiftId: matin,
      collegueId: valide, collegueDate: d("2026-09-12"), collegueShiftId: matin, reponseCollegue: "ACCEPTE",
    } });
    await expect(approuverEchange(e.id)).rejects.toThrow(`REDIRECT /a-valider?erreur=${encodeURIComponent(MESSAGE)}`);
    expect((await prisma.echangeCreneau.findUniqueOrThrow({ where: { id: e.id } })).statut).toBe("EN_ATTENTE");
  });
});
```

- [ ] **Step 2 : les voir échouer**

Run : `npx vitest run src/lib/planning-ecriture.source.test.ts "src/app/(app)/planning/planning-verrou.integration.test.ts"`
Attendu : le garde-fou ROUGE avec exactement `["app/(app)/planning/actions.ts", "lib/echange-creneau.ts"]` (vérifié) ; les tests d'actions ROUGES (écriture sans verrou).

- [ ] **Step 3 : implémentation**

1. `src/app/(app)/planning/actions.ts` : enregistrer le diff ci-dessous dans un fichier temporaire HORS dépôt (ex. `$TMPDIR/actions.diff`), puis `git apply --check "$TMPDIR/actions.diff" && git apply "$TMPDIR/actions.diff"` depuis la racine de l'arbre (vérifié : `git apply --check` passe sur la branche au 2026-09-23). Si le fichier a bougé, appliquer les mêmes blocs à la main.
```diff
--- a/src/app/(app)/planning/actions.ts
+++ b/src/app/(app)/planning/actions.ts
@@ -1,6 +1,7 @@
 "use server";
 
 import { revalidatePath } from "next/cache";
+import { redirect } from "next/navigation";
 import { prisma } from "@/lib/prisma";
 import { verifySession, requireRole } from "@/lib/auth";
 import { dureeShift } from "./creneaux";
@@ -8,26 +9,35 @@
 import { formulaireLisible } from "@/lib/erreur-formulaire";
 import { notifierSalarie, compteSalarieDe, supprimerNotificationsPour } from "@/lib/notifications";
 import { finaliserEchangeSiComplet } from "@/lib/echange-creneau";
+import { ecrireCreneaux, PlanningVerrouilleError, type OperationCreneau } from "@/lib/planning-ecriture";
 import { MOIS_FR, MOIS_FR_COURT } from "@/lib/dates-fr";
 import type { Prisma } from "@prisma/client";
 
+/**
+ * Écrit des créneaux par le SEUL chemin autorisé (verrou de paie + journal d'audit). Renvoie
+ * `{ erreur }` au lieu de lever quand le planning est verrouillé : l'écran l'affiche.
+ */
+async function ecrireOuRefuser(userId: string, operations: OperationCreneau[], opts: { genereAuto?: boolean } = {}): Promise<{ erreur?: string }> {
+  try {
+    await prisma.$transaction((tx) => ecrireCreneaux(tx, userId, operations, opts), { timeout: 60_000 });
+    return {};
+  } catch (e) {
+    if (e instanceof PlanningVerrouilleError) return { erreur: e.message };
+    throw e;
+  }
+}
+
 /** Enregistre / efface le shift d'un employé pour un jour. shiftId vide = effacer. */
-export async function saisirCreneau(employeeId: string, dateIso: string, shiftId: string) {
+export async function saisirCreneau(employeeId: string, dateIso: string, shiftId: string): Promise<{ erreur?: string }> {
   const user = await verifySession();
   requireRole(user, ["ADMIN", "MANAGER"]);
 
-  // Date stockée en UTC minuit du bon jour (évite le décalage de fuseau).
+  // Date stockée en UTC minuit du bon jour (évite le décalage de fuseau). Une modif manuelle retire
+  // le marqueur ✨ (genereAuto: false).
   const date = new Date(dateIso + "T00:00:00Z");
-  if (!shiftId) {
-    await prisma.planningCreneau.deleteMany({ where: { employeeId, date } });
-  } else {
-    await prisma.planningCreneau.upsert({
-      where: { employeeId_date: { employeeId, date } },
-      update: { shiftId, genereAuto: false }, // une modif manuelle retire le marqueur ✨
-      create: { employeeId, date, shiftId, genereAuto: false },
-    });
-  }
+  const r = await ecrireOuRefuser(user.id, [{ employeeId, date, shiftId: shiftId || null }]);
   revalidatePath("/planning");
+  return r;
 }
 
 /** Enregistre / efface le shift du MODÈLE d'un employé pour un jour (0=dim…6=sam) et une couche
@@ -62,6 +72,8 @@
    *  compte des lignes (une par semaine), pas des personnes. */
   personnesEnDepassement: number;
   sousHeures: number;
+  /** Planning verrouillé (paie validée) : rien n'a été écrit. */
+  erreur?: string;
   /** Besoins/modèles ignorés car pointant sur un shift désactivé ou supprimé — nom si résolu, sinon identifiant brut. */
   shiftsInconnus: string[];
 };
@@ -152,16 +164,22 @@
     },
   });
 
-  if (formData.get("ecraser") === "on") {
-    await prisma.planningCreneau.deleteMany({ where: { date: { gte: debut, lte: fin } } });
-  }
-  if (creneaux.length > 0) {
-    await prisma.planningCreneau.createMany({
-      data: creneaux.map((c) => ({ ...c, genereAuto: true })),
-      skipDuplicates: true,
-    });
-  }
+  // Mêmes effets qu'avant (« écraser » vidait la période puis recréait ; sinon les créneaux existants
+  // étaient gardés), exprimés en opérations pour passer par le verrou et le journal.
+  const ecraser = formData.get("ecraser") === "on";
+  const cleCreneau = (employeeId: string, date: Date) => `${employeeId}|${date.toISOString().slice(0, 10)}`;
+  const existantsCles = new Set(existants.map((x) => cleCreneau(x.employeeId, x.date)));
+  const nouveaux = creneaux.filter((c) => ecraser || !existantsCles.has(cleCreneau(c.employeeId, c.date)));
+  const nouveauxCles = new Set(nouveaux.map((c) => cleCreneau(c.employeeId, c.date)));
+  const operations: OperationCreneau[] = [
+    ...(ecraser
+      ? existants.filter((x) => !nouveauxCles.has(cleCreneau(x.employeeId, x.date))).map((x) => ({ employeeId: x.employeeId, date: x.date, shiftId: null }))
+      : []),
+    ...nouveaux.map((c) => ({ employeeId: c.employeeId, date: c.date, shiftId: c.shiftId })),
+  ];
+  const ecriture = await ecrireOuRefuser(user.id, operations, { genereAuto: true });
   revalidatePath("/planning");
+  if (ecriture.erreur) return { ...vide, erreur: ecriture.erreur };
 
   // Identifiants → noms lisibles, uniquement pour l'affichage.
   const nomEmp = new Map(employes.map((e) => [e.id, e.nom]));
@@ -268,25 +286,16 @@
 /** Affecte (ou efface) un shift en LOT : plusieurs employés × plusieurs jours en un aller-retour. */
 export async function saisirCreneauxEnLot(
   entrees: { employeeId: string; dateIso: string; shiftId: string }[]
-) {
+): Promise<{ erreur?: string }> {
   const user = await verifySession();
   requireRole(user, ["ADMIN", "MANAGER"]);
-  const aVider = entrees.filter((e) => !e.shiftId);
-  const aPoser = entrees.filter((e) => e.shiftId);
-  if (aVider.length > 0) {
-    await prisma.planningCreneau.deleteMany({
-      where: { OR: aVider.map((e) => ({ employeeId: e.employeeId, date: new Date(e.dateIso + "T00:00:00Z") })) },
-    });
-  }
-  for (const e of aPoser) {
-    const date = new Date(e.dateIso + "T00:00:00Z");
-    await prisma.planningCreneau.upsert({
-      where: { employeeId_date: { employeeId: e.employeeId, date } },
-      update: { shiftId: e.shiftId, genereAuto: false }, // saisie manuelle groupée → retire le marqueur ✨
-      create: { employeeId: e.employeeId, date, shiftId: e.shiftId, genereAuto: false },
-    });
-  }
+  // Saisie manuelle groupée → retire le marqueur ✨ ; tout ou rien si un salarié est verrouillé.
+  const r = await ecrireOuRefuser(
+    user.id,
+    entrees.map((e) => ({ employeeId: e.employeeId, date: new Date(e.dateIso + "T00:00:00Z"), shiftId: e.shiftId || null })),
+  );
   revalidatePath("/planning");
+  return r;
 }
 
 function lireHeure(v: FormDataEntryValue | null): string | null {
@@ -488,14 +497,15 @@
   const dem = await prisma.demandeChangementShift.findUnique({ where: { id } });
   if (!dem || dem.statut !== "EN_ATTENTE") return;
 
-  await prisma.$transaction([
-    prisma.planningCreneau.upsert({
-      where: { employeeId_date: { employeeId: dem.employeeId, date: dem.date } },
-      update: { shiftId: dem.shiftDemandeId, genereAuto: false },
-      create: { employeeId: dem.employeeId, date: dem.date, shiftId: dem.shiftDemandeId, genereAuto: false },
-    }),
-    prisma.demandeChangementShift.update({ where: { id }, data: { statut: "APPROUVE", decideParId: user.id } }),
-  ]);
+  try {
+    await prisma.$transaction(async (tx) => {
+      await ecrireCreneaux(tx, user.id, [{ employeeId: dem.employeeId, date: dem.date, shiftId: dem.shiftDemandeId }]);
+      await tx.demandeChangementShift.update({ where: { id }, data: { statut: "APPROUVE", decideParId: user.id } });
+    });
+  } catch (e) {
+    if (e instanceof PlanningVerrouilleError) redirect(`/a-valider?erreur=${encodeURIComponent(e.message)}`);
+    throw e;
+  }
 
   const [shift, userId] = await Promise.all([
     prisma.shift.findUnique({ where: { id: dem.shiftDemandeId }, select: { nom: true } }),
@@ -542,7 +552,8 @@
   const e = await prisma.echangeCreneau.findUnique({ where: { id } });
   if (!e || e.statut !== "EN_ATTENTE") return;
   await prisma.echangeCreneau.update({ where: { id }, data: { reponseDirection: "APPROUVE" } });
-  const fait = await finaliserEchangeSiComplet(id);
+  const { fait, erreur } = await finaliserEchangeSiComplet(id, user.id);
+  if (erreur) redirect(`/a-valider?erreur=${encodeURIComponent(erreur)}`);
   if (!fait) {
     // En attente du collègue : le prévenir qu'il ne manque que sa réponse.
     const uB = await compteSalarieDe(e.collegueId);
```

2. Remplacer `src/lib/echange-creneau.ts` par :
```ts
import "server-only";
import { prisma } from "@/lib/prisma";
import { notifierSalarie, compteSalarieDe } from "@/lib/notifications";
import { ecrireCreneaux, PlanningVerrouilleError, type OperationCreneau } from "@/lib/planning-ecriture";

const fr = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" });

/**
 * Finalise un échange de créneau UNIQUEMENT quand le collègue A ACCEPTÉ et la Direction A APPROUVÉ.
 * Permute alors les deux créneaux du planning (même jour = échange direct ; jours différents =
 * chacun prend le créneau de l'autre) et notifie les deux salariés. Idempotent. Passe par
 * `ecrireCreneaux` (verrou de paie + journal) : `userId` = compte qui déclenche la finalisation
 * (Direction qui approuve, ou collègue qui accepte en dernier). Planning verrouillé → `{ fait: false, erreur }`,
 * rien n'est écrit et l'échange reste EN_ATTENTE.
 */
export async function finaliserEchangeSiComplet(id: string, userId: string): Promise<{ fait: boolean; erreur?: string }> {
  const e = await prisma.echangeCreneau.findUnique({ where: { id } });
  if (!e || e.statut !== "EN_ATTENTE") return { fait: false };
  if (e.reponseCollegue !== "ACCEPTE" || e.reponseDirection !== "APPROUVE") return { fait: false };

  const memeJour = new Date(e.demandeurDate).getTime() === new Date(e.collegueDate).getTime();
  const operations: OperationCreneau[] = memeJour
    ? [
        // Même jour : A ↔ B échangent leurs shifts.
        { employeeId: e.demandeurId, date: e.demandeurDate, shiftId: e.collegueShiftId },
        { employeeId: e.collegueId, date: e.collegueDate, shiftId: e.demandeurShiftId },
      ]
    : [
        // Jours différents : B couvre le jour de A (shift de A), A couvre le jour de B (shift de B).
        { employeeId: e.collegueId, date: e.demandeurDate, shiftId: e.demandeurShiftId },
        { employeeId: e.demandeurId, date: e.collegueDate, shiftId: e.collegueShiftId },
        { employeeId: e.demandeurId, date: e.demandeurDate, shiftId: null },
        { employeeId: e.collegueId, date: e.collegueDate, shiftId: null },
      ];

  try {
    await prisma.$transaction(async (tx) => {
      await ecrireCreneaux(tx, userId, operations);
      await tx.echangeCreneau.update({ where: { id }, data: { statut: "APPROUVE" } });
    });
  } catch (err) {
    if (err instanceof PlanningVerrouilleError) return { fait: false, erreur: err.message };
    throw err;
  }

  // Notifier les deux salariés que l'échange est effectif.
  const [uA, uB] = await Promise.all([compteSalarieDe(e.demandeurId), compteSalarieDe(e.collegueId)]);
  const msg = `Échange de shift confirmé : ${fr(e.demandeurDate)} ↔ ${fr(e.collegueDate)}. Votre planning est à jour.`;
  if (uA) await notifierSalarie(uA, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:fait` });
  if (uB) await notifierSalarie(uB, { type: "PLANNING", message: msg, lien: "/espace/echanges", refId: `${id}:fait` });
  return { fait: true };
}
```

3. `src/app/espace/actions.ts`, dans `repondreEchange` : remplacer `const { employeeId } = await exigerSalarie();` par `const { userId, employeeId } = await exigerSalarie();`, puis remplacer
```ts
    const fait = await finaliserEchangeSiComplet(id);
    if (!fait) {
```
par
```ts
    const { fait, erreur } = await finaliserEchangeSiComplet(id, userId);
    if (erreur) {
      // Planning verrouillé (paie validée) : l'échange reste en attente, la Direction est prévenue.
      await creerNotification({ type: "AUTRE", message: `Échange de shift accepté mais bloqué : ${erreur}`, lien: "/a-valider", refId: id });
    } else if (!fait) {
```

4. `src/app/(app)/planning/planning-semaine.tsx` :
- sous `const [edits, setEdits] = useState<Record<string, string>>({});`, ajouter `const [erreurPlanning, setErreurPlanning] = useState<string | null>(null);`
- dans `setCreneau`, remplacer `start(() => saisirCreneau(empId, iso, shiftId));` par :
```ts
    start(async () => {
      const r = await saisirCreneau(empId, iso, shiftId);
      if (r.erreur) {
        // Planning verrouillé : annuler l'édition optimiste et dire pourquoi.
        setErreurPlanning(r.erreur);
        setEdits((x) => { const n = { ...x }; delete n[`${empId}_${iso}`]; return n; });
      }
    });
```
- dans `appliquerBulk`, remplacer `start(() => saisirCreneauxEnLot(entrees));` par :
```ts
    start(async () => {
      const r = await saisirCreneauxEnLot(entrees);
      if (r.erreur) {
        setErreurPlanning(r.erreur);
        setEdits((x) => { const n = { ...x }; for (const k of Object.keys(patch)) delete n[k]; return n; });
      }
    });
```
- juste après le `<div>` racine du `return (` final du composant (ligne `return (` suivie de `<div>` puis du commentaire `{/* ---------- BUREAU ---------- */}`), ajouter :
```tsx
      {erreurPlanning && (
        <p role="alert" className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreurPlanning}</p>
      )}
```

5. `src/app/(app)/planning/auto-planning-form.tsx` : juste avant `{resume && (`, ajouter :
```tsx
              {resume?.erreur && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{resume.erreur}</p>
              )}
```

6. `src/app/(app)/a-valider/page.tsx` : signature `export default async function AValiderPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {`, puis en tête du corps `const { erreur } = await searchParams;`, et juste après `<div className="max-w-5xl">` :
```tsx
      {erreur && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>
      )}
```

- [ ] **Step 4 : les voir passer, sans rien casser**

Run :
```bash
npx vitest run src/lib/planning-ecriture.source.test.ts "src/app/(app)/planning" src/lib/planning-ecriture.integration.test.ts src/app/espace/signature-actions.integration.test.ts
npm run typecheck && npx eslint "src/app/(app)/planning" src/lib/echange-creneau.ts src/app/espace/actions.ts "src/app/(app)/a-valider/page.tsx"
```
Attendu : garde-fou VERT ; 6 tests d'actions PASS (vérifiés sur copie le 2026-09-23) ; `generation-feries.integration.test.ts` toujours vert ; typecheck propre (tout appelant de `finaliserEchangeSiComplet` corrigé).

- [ ] **Step 5 : falsifier**
1. Remettre dans `saisirCreneau` un `await prisma.planningCreneau.deleteMany({ where: { employeeId, date } });` avant l'appel à `ecrireOuRefuser` → le garde-fou ROUGE (`app/(app)/planning/actions.ts`). Rétablir.
2. Dans `ecrireOuRefuser`, remplacer `return { erreur: e.message };` par `return {};` → « saisirCreneau : mois validé → erreur lisible » ROUGE. Rétablir.

- [ ] **Step 6 : commit**

```bash
git add "src/app/(app)/planning" src/lib/echange-creneau.ts src/app/espace/actions.ts "src/app/(app)/a-valider/page.tsx" src/lib/planning-ecriture.source.test.ts
git commit -m "feat(planning): faire passer toute écriture du planning par le verrou de paie et le journal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12 : écrans d'estimation — dire que la paie suit le planning

**Files :**
- Create : `src/lib/mention-reference-planning.ts`, `src/lib/mention-reference-planning.test.ts`
- Modify : `src/app/(app)/employes/employee-form.tsx`, `src/app/(app)/employes/simulation-salaire.tsx`, `src/app/(app)/employes/[id]/page.tsx`, `src/app/(app)/planning/modele-grid.tsx`, `src/app/(app)/planning/page.tsx` (commentaire seul)

**Interfaces :**
- Produces : `export const MENTION_REFERENCE_PLANNING: string`.

Ces écrans calculent `heures/semaine × 52/12` : ce sont des ESTIMATIONS contractuelles, pas de l'argent payé. Aucun calcul ne change ; on dit seulement que la paie de la brigade suit le planning du mois.

- [ ] **Step 1 : le test qui échoue** — `src/lib/mention-reference-planning.test.ts`

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MENTION_REFERENCE_PLANNING } from "./mention-reference-planning";

// Garde-fou : chaque écran qui estime un taux horaire sur heures/semaine × 52/12 dit que la paie de
// la brigade suit en réalité le planning du mois (spec 2026-09-23). Sinon l'écran et la paie
// racontent deux histoires.
const ECRANS = [
  "src/app/(app)/employes/employee-form.tsx",
  "src/app/(app)/employes/simulation-salaire.tsx",
  "src/app/(app)/employes/[id]/page.tsx",
  "src/app/(app)/planning/modele-grid.tsx",
];

describe("mention « la paie suit le planning »", () => {
  it("texte unique", () => {
    expect(MENTION_REFERENCE_PLANNING).toBe(
      "Estimation sur le contrat. La paie de la brigade suit les heures planifiées du mois : le taux horaire réel varie d'un mois à l'autre.",
    );
  });
  it.each(ECRANS)("%s affiche la mention", (fichier) => {
    const source = fs.readFileSync(path.join(process.cwd(), fichier), "utf8");
    expect(source).toMatch(/\{MENTION_REFERENCE_PLANNING\}/);
  });
});
```

- [ ] **Step 2 : le voir échouer**

Run : `npx vitest run src/lib/mention-reference-planning.test.ts` — Attendu : FAIL (module introuvable).

- [ ] **Step 3 : implémentation**

`src/lib/mention-reference-planning.ts` :
```ts
// Mention unique des écrans d'ESTIMATION (heures/semaine × 52/12) : la paie de la brigade, elle,
// suit les heures planifiées du mois (src/lib/paie-reference.ts, spec 2026-09-23).
export const MENTION_REFERENCE_PLANNING =
  "Estimation sur le contrat. La paie de la brigade suit les heures planifiées du mois : le taux horaire réel varie d'un mois à l'autre.";
```
Dans chacun des quatre écrans, importer `import { MENTION_REFERENCE_PLANNING } from "@/lib/mention-reference-planning";` puis :
- `employee-form.tsx` : dans le paragraphe d'aide qui commence par « Heures/mois = heures/semaine × 52/12 », juste après « salaire mensuel, heures/semaine, heures/jour. », ajouter ` {MENTION_REFERENCE_PLANNING}`.
- `simulation-salaire.tsx` : dans le `Panneau titre="Simulation du bulletin"` du rendu principal (le second `return (`), en dernier enfant : `<p className="mt-2 text-xs text-muted-foreground">{MENTION_REFERENCE_PLANNING}</p>`.
- `employes/[id]/page.tsx` : juste après `<Info label={`Salaire horaire${suffixeNet}`} value={formatMoney(salaireHoraire)} />`, ajouter `{employee.categorie === "BRIGADE" && <p className="col-span-full text-xs text-muted-foreground">{MENTION_REFERENCE_PLANNING}</p>}` ; et renommer le libellé `"Heures / mois (contractuelles)"` en `"Heures / mois (contrat)"`.
- `planning/modele-grid.tsx` : sous la grille (après le conteneur qui contient la ligne « Aucun employé actif. »), ajouter `<p className="mt-2 text-xs text-muted-foreground">{MENTION_REFERENCE_PLANNING}</p>` ; remplacer le commentaire « …pour l'estimation mensuelle, cohérent avec le calcul de paie. » par « …pour l'estimation mensuelle SUR LE CONTRAT (la paie de la brigade suit le planning du mois). ».
- `planning/page.tsx` : commentaire « Taux horaire par défaut = salaire mensuel ÷ (heures/semaine × 52/12) — précis. » → « Taux horaire CONTRACTUEL (estimation du modèle) = salaire mensuel ÷ (heures/semaine × 52/12). La paie de la brigade, elle, suit le planning du mois (paie-reference.ts). »

- [ ] **Step 4 : le voir passer** — `npx vitest run src/lib/mention-reference-planning.test.ts && npm run typecheck && npx eslint "src/app/(app)/employes" "src/app/(app)/planning/modele-grid.tsx" src/lib/mention-reference-planning.ts` — Attendu : 5 tests PASS.

- [ ] **Step 5 : falsifier** — retirer le `{MENTION_REFERENCE_PLANNING}` de `modele-grid.tsx` → le test de ce fichier ROUGE. Rétablir.

- [ ] **Step 6 : commit**

```bash
git add src/lib/mention-reference-planning.ts src/lib/mention-reference-planning.test.ts "src/app/(app)/employes" "src/app/(app)/planning/modele-grid.tsx" "src/app/(app)/planning/page.tsx"
git commit -m "feat(paie): signaler sur les estimations que la paie de la brigade suit le planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13 : suite complète, migrations, build, relecture finale

**Files :** aucun nouveau (corrections éventuelles seulement, chacune avec son test).

- [ ] **Step 1 : suite complète**

```bash
npx vitest run --maxWorkers=2 2>&1 | tail -30
```
Attendu : tout vert. Un échec « timeout de setup » ou `shmmni` d'un fichier d'intégration se relance SEUL (`npx vitest run <fichier>`) avant de conclure ; un échec qui persiste seul est un vrai échec. Une erreur « column … does not exist » : vérifier que `node_modules` de CET arbre n'est pas un lien symbolique et relancer `npx prisma generate`.

- [ ] **Step 2 : types, lint, migrations**

```bash
npm run typecheck
npx eslint src
node scripts/_verifier-migrations.mjs     # deux ✓, code 0
git status --short                        # aucun fichier .verif-migrations.config.mjs, aucun fichier temporaire
```

- [ ] **Step 3 : build, SANS toucher la production**

```bash
DATABASE_URL="postgresql://build:build@127.0.0.1:1/aucune" DIRECT_URL="postgresql://build:build@127.0.0.1:1/aucune" npm run build
```
(Les variables déjà définies ne sont pas écrasées par le `.env` : le build ne peut joindre aucune base.) Attendu : build réussi. Une page qui tenterait une requête au build est un défaut à signaler (la page Paie est `force-dynamic`).

- [ ] **Step 4 : relecture finale (checklist, à cocher une à une en citant le fichier)**
  - `rg -n "52 / 12|52/12" src --glob '!*.test.*'` : chaque occurrence est une estimation relibellée (tâche 12), `paie-reference.ts` (`SEMAINES_PAR_MOIS`) ou un commentaire ; plus aucune dans `paie-batch.ts` ni `bulletin-live.ts`.
  - `rg -n "calculerHeuresSupp" src/lib/paie-batch.ts src/lib/bulletin-live.ts` : aucune occurrence (le calcul passe par `calculerReferenceMois`).
  - `rg -n "0\.3\b|1\.3\b|\b26\b" src/lib/paie-reference.ts src/lib/paie-avertissements.ts` : aucune valeur légale en dur.
  - `payroll.ts` : `git diff main -- src/lib/payroll.ts` ne montre QUE le champ `referencePlanningDepuis`.
  - Les tests de juillet (`paie-batch.integration.test.ts`, `bulletin-live.integration.test.ts`, `avantage-nature.integration.test.ts`) n'ont PAS été modifiés : `git diff main --stat -- src/lib/*.integration.test.ts` ne liste que les nouveaux fichiers.
  - Le garde-fou `planning-ecriture.source.test.ts` est vert et a été vu rouge (tâche 11).
  - Bulletin : une seule page (test de la tâche 8).

- [ ] **Step 5 : rapport** — liste des commits, résultat de la suite (fichiers/tests), sortie de `_verifier-migrations.mjs`, points non vérifiés à l'écran (tâche 9 step 6). Ne pas fusionner ni déployer depuis ce plan (décision du coordinateur). Signaler en tête du rapport les trois points de DONNÉES en attente de la Direction, hors code : (a) statuer sur les présences du 24 au 30/09 saisies d'avance, (b) sur les jours du 28 et 30/09 de Rachel Lunda, (c) sur les heures des contrats d'Esther et d'Aimée (note §11).

---
## Table de couverture spec → tâches

| Exigence (spec / note) | Tâche(s) | Verrouillée par |
|---|---|---|
| §2 Heures planifiées = `PlanningCreneau`, pas le gabarit ; durée `dureeShift` déplacée dans `src/lib` | 1, 5 | `duree-shift.test.ts`, `paie-reference-donnees.integration.test.ts` |
| §2 Créneaux système = 0 h ; dimanche jamais dans la référence | 2, 5 | tests « créneau système », « dimanche travaillé hors planning » |
| §2 R = planifié − HS planifiées + `hdu` des jours payés sans créneau et des fériés dus ; `hdu` = créneau → modèle (A/B puis 0) → heuresParJour | 2, 5 | Syntyche, Marie, fériés, `chargerJoursMois` (parité) |
| §2 t = S / R ; base = t × (normales + payées) + t × ⅔ × maladie | 2 | Martine 400,00 ; maladie ; absence N ; échange neutre |
| §2 / décision 2 : HS par `calculerHeuresSupp` inchangé, au taux du CONTRAT t0 | 2 | Esther (2,08 h × 1,3 × t0), mutation `t0 → t` |
| §2 Heure au-delà du planning sous le seuil payée à t | 2 | Rachel (180 h × t), échange de jour |
| §2 Férié dû payé même non codé F ; travaillé = prime seule (double, pas triple) | 2 | trois tests « fériés et dimanches » |
| §2 Taux de rôle : avertissement + ignoré | 2, 9 | « taux de rôle sur un créneau → ignoré et signalé » |
| §2 Reconstitution net → brut inchangée ; salaire journalier remplacé par des heures | 2, 6, 8 | `netSalaire` via `calculerPaieBrigade` ; e2e ; bulletin « 54 h (9 j) » |
| §2 Propriétés : planning fait → S ; absence → retenue ; échange neutre ; mois en congé → S ; mois en N → 0 ; congé jamais payé deux fois | 2 | describe « propriétés » + Syntyche (≠ 305,88) |
| §2 Périmètre : brigade CDD/CDI ; back-office, stage, journalier, intérim inchangés | 6, 7 | `estBrigadePlanning` ; tests de juillet inchangés et verts |
| §3 Repli : semaine sans créneau (sauf semaine entièrement en absence PAYÉE), mois d'embauche, R ≤ 0 ; visible (`sourceReference`, `motifReference`, badge, bulletin) | 2, 4, 6, 8, 9 | tests repli (pur + e2e), persistance, bulletin « HEURES CONTRAT (REPLI) », `BadgeReference` |
| §4 Date d'effet `paie_reference_planning_depuis = 202609` (ParametreLegal, ADMIN) ; juin/juillet inchangés | 4, 6 | `config-reference-planning.integration.test.ts`, `_verifier-migrations.mjs`, e2e « juillet 2026 » |
| §4 Mois VALIDÉS/PAYÉS jamais recalculés | 6 | e2e « une ligne VALIDÉE n'est jamais recalculée » |
| §5 Une seule fonction pure appelée par `paie-batch` ET `bulletin-live` | 2, 5, 6, 7 | e2e « égal au lot, au centime » |
| §5 `heuresContractuelles` = R ; `heuresPayeesNonTravaillees` ; `indemniteCongesUSD` = montant réellement compris ; migration additive | 4, 6 | e2e (216, 54, 96), `_verifier-migrations.mjs` |
| §6.1 Trace de toute écriture de créneau (saisie, lot, génération, échanges, changements de shift) | 10, 11 | `planning-ecriture.integration.test.ts`, `planning-verrou.integration.test.ts`, garde-fou de source |
| §6.2 Verrou du planning d'une paie VALIDÉE/PAYÉE | 10, 11 | tests verrou (lot compris, croisé, PAYÉE) |
| §6.3 Avertissements sans bloquer : saisies d'avance, P sans créneau, planning modifié après, repli, taux de rôle, t > 1,3 × t0 | 2, 3, 6, 9 | `paie-avertissements.test.ts`, tests d'avertissements purs, `messageConfirmationValidation` |
| §8 Critère : Martine 400,00, Syntyche 200,00, Marie 200,00 de base nette ; `bulletin-live` = lot au centime | 6, 7 | `paie-heures-planifiees.integration.test.ts` |
| §8 « Les 11 salariés inchangés inchangés » | 2 | code de la tâche 2 = prototype rejoué sur les 17 salariés brigade de septembre (note §10) ; pas de test automatique sur la base de production (lecture seule, hors plan) |
| Bulletin sur une seule page | 8 | tests « une seule page » |
| Écrans d'estimation cohérents avec la paie | 12 | `mention-reference-planning.test.ts` |

## Auto-relecture (faite le 2026-09-23)

- Aucun « TBD », aucun « écrire des tests » sans code : chaque étape de test contient le fichier complet ou le bloc exact à ajouter.
- Noms et types concordants d'une tâche à l'autre : `calculerReferenceMois` / `EntreesReference` / `ResultatReference.moteur|affichage|avertissements` (2 → 6, 7) ; `JourReference` / `JourSaisie` (2, 3 → 5) ; `chargerJoursMois(mois, annee, employeeIds)` (5 → 6, 7) ; `SourceReference` = enum Prisma `SourceReferencePaie` (2 ↔ 4) ; `AvertissementPaie` (2 → 3, 6, 7, 9) ; `LIBELLE_SOURCE_REFERENCE` (7 → 8) ; `ecrireCreneaux` / `PlanningVerrouilleError` / `OperationCreneau` (10 → 11) ; `finaliserEchangeSiComplet(id, userId)` (11, deux appelants corrigés).
- Code vérifié hors dépôt le 2026-09-23 (copies dans un banc, Postgres embarqué, client Prisma généré à part — jamais celui du dépôt) : tâches 2, 3, 5, 6, 7, 8, 9, 10, 11 et le script de la tâche 4 ; chaque falsification annoncée « vérifiée » a été vue rouge.
- Points NON vérifiés d'avance : rendu à l'écran (tâches 9, 11, 12 : composants client), `npm run build` (tâche 13).
