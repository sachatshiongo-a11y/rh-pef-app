# Planning — fiabiliser la génération automatique · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** sortir l'algorithme de génération de planning de la server action vers un module pur testé, puis corriger les quatre défauts constatés (mauvais shift, trous de couverture inexpliqués, répartition inégale, aucune règle de repos).

**Architecture :** un module `src/lib/planning-auto.ts` sans I/O — entrées valeurs simples, sortie créneaux + rapport structuré — construit incrémentalement par TDD, tâche par tâche. La server action `genererPlanningAuto` se réduit à lire, appeler, écrire. Un nouveau modèle `ShiftPoste` remplace le repli par expression régulière sur le nom des shifts.

**Tech Stack :** TypeScript, Next.js 16 (App Router, server actions), Prisma 7 / PostgreSQL, Vitest.

**Spec :** `docs/superpowers/specs/2026-08-16-planning-generation-design.md`

## Global Constraints

- **Français partout** : noms de types, de fonctions, de variables, commentaires, libellés. Le dépôt est entièrement en français.
- **Module pur** : `src/lib/planning-auto.ts` n'importe ni `@/lib/prisma`, ni `server-only`, ni quoi que ce soit de `src/app/`. Aucun `new Date()` sans argument. Même convention que `src/lib/payroll.ts` et `src/lib/prets.ts`.
- **Dates en UTC** : toutes les dates de planning sont des dates pures (colonne `DATE`). Construire avec `new Date(iso + "T00:00:00.000Z")` et lire avec `getUTC*`. Jamais `getDay()`/`getDate()` locaux — le fuseau de Kinshasa décalerait les jours.
- **Repos** : 1 jour de repos par semaine calendaire (lundi → dimanche), 6 jours consécutifs travaillés au maximum (fenêtre glissante). Valeurs **en dur**, pas de réglage.
- **Le logiciel n'engage jamais d'heures supplémentaires seul** : le dépassement du plafond d'heures exige l'option explicite `autoriserDepassementHeures`.
- **Aucune troncature silencieuse** : le moteur renvoie les listes complètes, l'écran décide d'en afficher une partie.
- **Tests** : `npx vitest run <fichier>` pour un fichier, `npm test` pour la suite. La suite doit rester verte à chaque commit (714 tests au départ de ce plan).
- **Commits** : un par tâche, message en français, terminé par `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Branche** : `feat/planning-generation`, créée depuis `main`.

---

## Structure des fichiers

| Fichier | Responsabilité | Tâches |
|---|---|---|
| `prisma/schema.prisma` | Modèle `ShiftPoste` | T1 |
| `prisma/migrations/20260817090000_shift_poste/migration.sql` | Création de la table | T1 |
| `scripts/reprise-shifts-poste.ts` | Reprise ponctuelle des correspondances codées en dur | T1 |
| `src/lib/dates-fr.ts` | Accueille `pariteSemaine` (déplacé) | T2 |
| `src/app/(app)/planning/creneaux.ts` | Ré-exporte `pariteSemaine` (compatibilité) | T2 |
| `src/lib/planning-auto.ts` | **Le moteur pur** : types, contraintes, couverture, équité, rapport | T2 → T6 |
| `src/lib/planning-auto.test.ts` | Tests unitaires du moteur | T2 → T6 |
| `src/lib/planning-auto.golden.test.ts` | Golden : brigade de référence | T7 |
| `src/app/(app)/planning/actions.ts` | Lecture/écriture + actions `ShiftPoste` | T1, T8 |
| `src/app/(app)/planning/shift-poste-manager.tsx` | UI de configuration des shifts par poste | T9 |
| `src/app/(app)/planning/page.tsx` | Chargement + rendu du manager | T9 |
| `src/app/(app)/planning/auto-planning-form.tsx` | Case « autoriser le dépassement » + rapport enrichi | T9 |

**Ordre d'exécution :** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9.
T1 est indépendante. T2→T7 construisent le moteur par couches. T8 branche. T9 expose.

---

### Tâche 0 : Préparer la branche

- [ ] **Étape 1 : Créer la branche depuis `main` à jour**

```bash
cd ~/Projects/rh-pef-app
git checkout main && git pull --ff-only
git checkout -b feat/planning-generation
```

- [ ] **Étape 2 : Vérifier que la suite part au vert**

Lancer : `npm test`
Attendu : `Test Files 61 passed (61)` · `Tests 714 passed (714)`

Si la suite n'est pas verte au départ, **s'arrêter** et le signaler : on ne construit pas sur une base rouge.

---

### Tâche 1 : Modèle `ShiftPoste`, migration et reprise de l'existant

**Fichiers :**
- Modifier : `prisma/schema.prisma`
- Créer : `prisma/migrations/20260817090000_shift_poste/migration.sql`
- Créer : `scripts/reprise-shifts-poste.ts`

**Interfaces :**
- Produit : le modèle Prisma `ShiftPoste { id, poste, shiftId, ordre }`, consommé par T8 (lecture) et T9 (UI).

- [ ] **Étape 1 : Ajouter le modèle au schéma**

Dans `prisma/schema.prisma`, juste **après** le modèle `BesoinShift` :

```prisma
/// Shifts qu'un poste peut tenir, dans l'ordre de préférence. Remplace le repli par expression
/// régulière sur le NOM du shift (`/caissi/`, `/cuisine/`, `/salle/`), qui changeait les
/// affectations dès qu'un shift était renommé et envoyait tout poste non reconnu sur
/// « Journée 8h-17h » sans le signaler.
///
/// Rattachement par la CHAÎNE `poste`, comme `BesoinShift` et `PolyvalencePoste` — mêmes voisins,
/// même écran de configuration, même convention.
///
/// Sert à la passe complémentaire (remplir quelqu'un jusqu'à ses heures). Sans liste déclarée pour
/// un poste, le moteur ne pose RIEN et le rapport nomme les salariés concernés : un trou visible
/// vaut mieux qu'un shift faux posé en silence.
model ShiftPoste {
  id        String   @id @default(uuid())
  poste     String // correspond à Employee.poste
  shiftId   String
  shift     Shift    @relation(fields: [shiftId], references: [id], onDelete: Cascade)
  ordre     Int      @default(0) // 0 = essayé en premier
  createdAt DateTime @default(now())

  @@unique([poste, shiftId])
  @@index([poste])
  @@schema("public")
}
```

Puis, dans le modèle `Shift`, ajouter la relation inverse à côté de `besoins  BesoinShift[]` :

```prisma
  postes   ShiftPoste[]
```

- [ ] **Étape 2 : Écrire la migration SQL**

Créer `prisma/migrations/20260817090000_shift_poste/migration.sql` :

```sql
-- Shifts acceptables par poste, dans l'ordre de préférence.
-- Remplace le repli par expression régulière sur le nom des shifts dans la génération auto.

-- CreateTable
CREATE TABLE "public"."ShiftPoste" (
    "id" TEXT NOT NULL,
    "poste" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftPoste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShiftPoste_poste_idx" ON "public"."ShiftPoste"("poste");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftPoste_poste_shiftId_key" ON "public"."ShiftPoste"("poste", "shiftId");

-- AddForeignKey
ALTER TABLE "public"."ShiftPoste" ADD CONSTRAINT "ShiftPoste_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "public"."Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Étape 3 : Régénérer le client et valider le schéma**

```bash
npx prisma generate && npx prisma validate
```

Attendu : `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Étape 4 : Vérifier que la migration produit EXACTEMENT le schéma**

Une migration écrite à la main peut diverger du schéma sans que rien ne le dise. On la rejoue sur une base neuve et on exige un diff vide.

Créer un fichier temporaire `_verif-migrations.mjs` à la racine :

```js
import EmbeddedPostgres from "embedded-postgres";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pef-mig-"));
const port = 56789;
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false });
await pg.initialise();
await pg.start();
await pg.createDatabase("migdb");
const url = `postgresql://postgres:postgres@localhost:${port}/migdb`;
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
try {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  const diff = execSync(
    "npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script",
    { encoding: "utf8", env }
  );
  console.log("DIFF:", diff.trim() || "(vide)");
} finally {
  await pg.stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
```

Lancer : `node _verif-migrations.mjs`

Attendu : le diff ne contient **aucune** ligne mentionnant `ShiftPoste`. Une ligne
`ALTER TABLE "ParamEntreprise" ALTER COLUMN "updatedAt" DROP DEFAULT;` peut apparaître : c'est une
dérive pré-existante, sans rapport avec cette tâche, à ignorer ici.

Puis supprimer le fichier : `rm _verif-migrations.mjs`

- [ ] **Étape 5 : Écrire le script de reprise**

Sans lui, la première génération après déploiement changerait les affectations sans prévenir.

Créer `scripts/reprise-shifts-poste.ts` :

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Reprise PONCTUELLE des correspondances poste → shift qui étaient codées en dur dans
// `genererPlanningAuto` (expressions régulières sur le nom du shift). Objectif : que la première
// génération après déploiement produise le même résultat qu'avant sur ce point précis.
//
// Idempotent : relançable sans créer de doublon (contrainte unique poste+shiftId + skipDuplicates).
// Ne touche jamais aux shifts « Admin » et « Nuit », qui n'étaient jamais affectés automatiquement.

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const [employes, shifts] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true, secteur: true }, distinct: ["poste"] }),
    prisma.shift.findMany({ where: { actif: true } }),
  ]);

  const parNom = (re: RegExp) => shifts.find((s) => re.test(s.nom));
  const caisse = parNom(/caisse/i);
  const cuisine = parNom(/matin cuisine/i);
  const salle = parNom(/matin\/midi salle/i);
  const journee = parNom(/journée 8h-17h/i) ?? shifts.find((s) => !s.systeme && !/admin|nuit/i.test(s.nom));

  const lignes: { poste: string; shiftId: string; ordre: number }[] = [];
  for (const e of employes) {
    if (!e.poste) continue;
    const poste = (e.poste ?? "").toLowerCase();
    const secteur = (e.secteur ?? "").toLowerCase();
    const shift = /caissi/.test(poste)
      ? (caisse ?? journee)
      : /cuisine/.test(secteur)
        ? (cuisine ?? journee)
        : /salle/.test(secteur)
          ? (salle ?? journee)
          : journee;
    if (!shift) {
      console.warn(`⚠ Aucun shift trouvé pour le poste « ${e.poste} » — à configurer à la main.`);
      continue;
    }
    lignes.push({ poste: e.poste, shiftId: shift.id, ordre: 0 });
  }

  const res = await prisma.shiftPoste.createMany({ data: lignes, skipDuplicates: true });
  console.log(`${res.count} correspondance(s) poste → shift écrite(s) sur ${lignes.length} calculée(s).`);
  console.table(lignes.map((l) => ({ poste: l.poste, shift: shifts.find((s) => s.id === l.shiftId)?.nom })));
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Étape 6 : Vérifier que le script compile**

Lancer : `npx tsc --noEmit`
Attendu : aucune sortie.

Le script n'est **pas** exécuté maintenant : il tourne au déploiement, contre la vraie base (cf. Tâche 9, étape finale).

- [ ] **Étape 7 : Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260817090000_shift_poste scripts/reprise-shifts-poste.ts
git commit -m "feat(planning): modèle ShiftPoste — shifts acceptables par poste

Remplace le repli par expression régulière sur le NOM du shift, qui changeait les
affectations dès qu'un shift était renommé et envoyait tout poste non reconnu sur
« Journée 8h-17h » sans rien signaler.

Rattachement par la chaîne poste, comme BesoinShift et PolyvalencePoste — mêmes
voisins, même écran de configuration.

Script de reprise idempotent pour que la première génération après déploiement ne
change pas les affectations existantes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 2 : Moteur pur — types, modèles hebdo et contraintes dures

**Fichiers :**
- Modifier : `src/lib/dates-fr.ts` (accueille `pariteSemaine`)
- Modifier : `src/app/(app)/planning/creneaux.ts` (ré-exporte `pariteSemaine`)
- Créer : `src/lib/planning-auto.ts`
- Créer : `src/lib/planning-auto.test.ts`

**Interfaces :**
- Consomme : rien.
- Produit : `genererPlanning(entrees: EntreesGeneration): ResultatGeneration`, et tous les types listés ci-dessous. T3 → T6 enrichissent cette même fonction.

- [ ] **Étape 1 : Déplacer `pariteSemaine` vers `src/lib/dates-fr.ts`**

Le moteur pur ne doit pas importer depuis `src/app/`. Couper la fonction de
`src/app/(app)/planning/creneaux.ts` (et la constante `LUNDI_REF`) et la coller telle quelle à la
fin de `src/lib/dates-fr.ts` :

```ts
const LUNDI_REF = Date.UTC(1970, 0, 5); // 5 janvier 1970 = un lundi

/** Parité de la semaine d'une date : 1 = semaine A, 2 = semaine B (pour les modèles bi-hebdo). */
export function pariteSemaine(d: Date): 1 | 2 {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); // lundi de la semaine
  const semaines = Math.floor((date.getTime() - LUNDI_REF) / (7 * 86_400_000));
  return semaines % 2 === 0 ? 1 : 2;
}
```

Puis, dans `creneaux.ts`, remplacer la définition supprimée par une ré-exportation, pour que les
imports existants continuent de fonctionner sans les toucher :

```ts
// `pariteSemaine` vit désormais dans src/lib/dates-fr.ts : le moteur pur (src/lib/planning-auto.ts)
// en a besoin et ne doit rien importer de src/app/. Ré-exporté ici pour les appelants existants.
export { pariteSemaine } from "@/lib/dates-fr";
```

- [ ] **Étape 2 : Vérifier que rien n'est cassé par le déplacement**

Lancer : `npx tsc --noEmit`
Attendu : aucune sortie.

- [ ] **Étape 3 : Écrire les tests des contraintes dures (ils doivent échouer)**

Créer `src/lib/planning-auto.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { genererPlanning, type EntreesGeneration, type EmployePlanning } from "@/lib/planning-auto";

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

const SHIFT_MATIN = { id: "sh-matin", nom: "Matin cuisine", dureeHeures: 8 };
const SHIFT_SOIR = { id: "sh-soir", nom: "Soir cuisine", dureeHeures: 8 };

const employe = (id: string, poste = "Cuisinier"): EmployePlanning => ({
  id, nom: `Employé ${id}`, poste, secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48,
});

/** Entrées minimales : une semaine complète lundi 6 → dimanche 12 juillet 2026, tout vide. */
export function entreesBase(surcharge: Partial<EntreesGeneration> = {}): EntreesGeneration {
  return {
    debut: d("2026-07-06"),
    fin: d("2026-07-12"),
    employes: [employe("e1")],
    shifts: [SHIFT_MATIN, SHIFT_SOIR],
    besoins: [],
    shiftsPoste: [],
    polyvalences: [],
    modeles: [],
    conges: [],
    feries: [],
    existants: [],
    historique: [],
    options: {
      jours: [0, 1, 2, 3, 4, 5, 6], // tous les jours autorisés : c'est le repos qui doit limiter
      nbParSemaine: 0,
      inclureFeries: false,
      utiliserModeles: true,
      ecraser: false,
      completer: false,
      autoriserDepassementHeures: false,
    },
    ...surcharge,
  };
}

describe("genererPlanning — modèles hebdomadaires", () => {
  it("pose les shifts du modèle sur les bons jours", () => {
    const r = genererPlanning(entreesBase({
      modeles: [
        { employeeId: "e1", jour: 1, semaine: 0, shiftId: SHIFT_MATIN.id }, // lundi, chaque semaine
        { employeeId: "e1", jour: 3, semaine: 0, shiftId: SHIFT_SOIR.id },  // mercredi
      ],
    }));
    expect(r.creneaux.map((c) => `${c.date.toISOString().slice(0, 10)}:${c.shiftId}`)).toEqual([
      "2026-07-06:sh-matin",
      "2026-07-08:sh-soir",
    ]);
  });

  it("ignore les modèles quand l'option est décochée", () => {
    const r = genererPlanning(entreesBase({
      modeles: [{ employeeId: "e1", jour: 1, semaine: 0, shiftId: SHIFT_MATIN.id }],
      options: { ...entreesBase().options, utiliserModeles: false },
    }));
    expect(r.creneaux).toHaveLength(0);
  });
});

describe("genererPlanning — contraintes dures", () => {
  it("ne pose jamais de créneau pendant un congé approuvé", () => {
    const r = genererPlanning(entreesBase({
      modeles: [1, 2, 3].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
      conges: [{ employeeId: "e1", dateDebut: d("2026-07-07"), dateFin: d("2026-07-08") }],
    }));
    const jours = r.creneaux.map((c) => c.date.toISOString().slice(0, 10));
    expect(jours).toEqual(["2026-07-06"]); // mardi et mercredi tombent dans le congé
  });

  it("ne pose jamais deux shifts le même jour pour la même personne", () => {
    const r = genererPlanning(entreesBase({
      modeles: [
        { employeeId: "e1", jour: 1, semaine: 0, shiftId: SHIFT_MATIN.id },
        { employeeId: "e1", jour: 1, semaine: 1, shiftId: SHIFT_SOIR.id }, // même lundi, autre couche
      ],
    }));
    const lundis = r.creneaux.filter((c) => c.date.toISOString().startsWith("2026-07-06"));
    expect(lundis).toHaveLength(1);
  });

  it("laisse AU MOINS un jour de repos dans la semaine, même si les 7 jours sont autorisés", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 100 }], // heures assez hautes pour ne pas limiter
      modeles: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.creneaux.length).toBeLessThanOrEqual(6);
  });

  it("compte les jours consécutifs à cheval sur deux semaines, et repart après un vrai repos", () => {
    // Vendredi 3, samedi 4 et dimanche 5 juillet déjà travaillés (semaine précédente, via
    // l'historique). La série continue donc au-delà de la frontière de semaine : lundi 6, mardi 7
    // et mercredi 8 atteignent 6 jours d'affilée, et jeudi 9 est refusé.
    //
    // Jeudi 9 devient alors un VRAI jour de repos, ce qui relance légitimement le compteur :
    // vendredi 10 et samedi 11 sont posés. Le résultat respecte les deux règles — jamais plus de
    // 6 jours d'affilée, et au moins un repos dans la semaine du 6 (jeudi 9 et dimanche 12).
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 100 }],
      historique: [
        { employeeId: "e1", date: d("2026-07-03"), shiftId: SHIFT_MATIN.id },
        { employeeId: "e1", date: d("2026-07-04"), shiftId: SHIFT_MATIN.id },
        { employeeId: "e1", date: d("2026-07-05"), shiftId: SHIFT_MATIN.id }, // dimanche travaillé
      ],
      modeles: [1, 2, 3, 4, 5, 6].map((j) => ({ employeeId: "e1", jour: j, semaine: 0, shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.creneaux.map((c) => c.date.toISOString().slice(0, 10))).toEqual([
      "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-10", "2026-07-11",
    ]);
  });
});
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils échouent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : ÉCHEC — `Failed to resolve import "@/lib/planning-auto"`.

- [ ] **Étape 5 : Écrire le moteur (types + étape 1 + contraintes dures)**

Créer `src/lib/planning-auto.ts` :

```ts
// Génération automatique du planning — moteur PUR (aucune I/O, aucun import de Prisma ni de
// src/app/), même convention que src/lib/payroll.ts et src/lib/prets.ts.
//
// Extrait de la server action `genererPlanningAuto`, où 320 lignes de logique métier n'étaient ni
// testables sans base, ni corrigeables sans risque.
//
// Toutes les dates sont des dates PURES en UTC : lire avec getUTC*, jamais getDay()/getDate().

import { pariteSemaine } from "@/lib/dates-fr";

export type EmployePlanning = {
  id: string;
  nom: string;
  poste: string;
  secteur: string;
  heuresParJour: number;
  heuresHebdomadaires: number;
};

export type ShiftPlanning = { id: string; nom: string; dureeHeures: number };
export type BesoinPlanning = { shiftId: string; poste: string; jourSemaine: number; nombreRequis: number };
export type ShiftPostePlanning = { poste: string; shiftId: string; ordre: number };
export type PolyvalencePlanning = { posteSource: string; posteCible: string };
export type ModelePlanning = { employeeId: string; jour: number; semaine: number; shiftId: string };
export type CongePlanning = { employeeId: string; dateDebut: Date; dateFin: Date };
export type CreneauPlanning = { employeeId: string; date: Date; shiftId: string };

export type OptionsGeneration = {
  /** Shift imposé par l'utilisateur (prioritaire sur la liste du poste). */
  shiftId?: string;
  /** Jours de semaine autorisés : 0 = dimanche … 6 = samedi. */
  jours: number[];
  /** Nombre de jours/semaine forcé ; 0 = viser les heures hebdomadaires. */
  nbParSemaine: number;
  inclureFeries: boolean;
  utiliserModeles: boolean;
  ecraser: boolean;
  completer: boolean;
  /** Autorise le dépassement du plafond d'heures POUR COUVRIR UN BESOIN. Jamais automatique. */
  autoriserDepassementHeures: boolean;
};

export type EntreesGeneration = {
  debut: Date;
  fin: Date;
  employes: EmployePlanning[];
  shifts: ShiftPlanning[];
  besoins: BesoinPlanning[];
  shiftsPoste: ShiftPostePlanning[];
  polyvalences: PolyvalencePlanning[];
  modeles: ModelePlanning[];
  conges: CongePlanning[];
  feries: Date[];
  /** Créneaux déjà posés SUR la période. */
  existants: CreneauPlanning[];
  /** Créneaux des 8 semaines PRÉCÉDANT la période — équité et jours consécutifs. */
  historique: CreneauPlanning[];
  options: OptionsGeneration;
};

export type RaisonNonCouverture =
  | "AUCUN_TITULAIRE"
  | "EFFECTIF_INSUFFISANT" // des gens étaient libres, ils ont tous été posés, il en manquait encore
  | "TOUS_EN_CONGE"
  | "TOUS_DEJA_PRIS"
  | "TOUS_AU_REPOS"
  | "TOUS_AU_PLAFOND";

export type TrouCouverture = {
  date: Date;
  shiftId: string;
  poste: string;
  manque: number;
  raison: RaisonNonCouverture;
};

export type DepassementHeures = {
  employeeId: string;
  lundi: Date;
  heuresPlanifiees: number;
  heuresContractuelles: number;
};

export type RapportGeneration = {
  crees: number;
  trous: TrouCouverture[];
  sansShiftPoste: { employeeId: string; poste: string }[];
  depassements: DepassementHeures[];
  sousHeures: { employeeId: string; heuresPlanifiees: number; heuresContractuelles: number }[];
};

export type ResultatGeneration = { creneaux: CreneauPlanning[]; rapport: RapportGeneration };

/** Repos hebdomadaire minimum RDC : 24 h consécutives → au moins 1 jour non travaillé par semaine. */
const JOURS_TRAVAILLES_MAX_PAR_SEMAINE = 6;
/** Plafond de jours travaillés d'affilée (fenêtre glissante, à cheval sur les semaines). */
const JOURS_CONSECUTIFS_MAX = 6;

const JOUR_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Lundi (UTC) de la semaine d'une date. */
export function lundiDeUTC(d: Date): Date {
  const dow = d.getUTCDay();
  const l = new Date(d);
  l.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()));
}

export function genererPlanning(entrees: EntreesGeneration): ResultatGeneration {
  const { options } = entrees;
  const joursAutorises = new Set(options.jours.length > 0 ? options.jours : [1, 2, 3, 4, 5, 6]);
  const feriesIso = new Set(entrees.feries.map(iso));
  const dureeParShift = new Map(entrees.shifts.map((s) => [s.id, s.dureeHeures]));

  // Jours de la période effectivement planifiables.
  const joursPeriode: Date[] = [];
  for (let t = entrees.debut.getTime(); t <= entrees.fin.getTime(); t += JOUR_MS) {
    const j = new Date(t);
    if (!joursAutorises.has(j.getUTCDay())) continue;
    if (!options.inclureFeries && feriesIso.has(iso(j))) continue;
    joursPeriode.push(j);
  }

  // Congés : intervalles par employé.
  const congesParEmp = new Map<string, { debut: number; fin: number }[]>();
  for (const c of entrees.conges) {
    const l = congesParEmp.get(c.employeeId) ?? [];
    l.push({ debut: c.dateDebut.getTime(), fin: c.dateFin.getTime() });
    congesParEmp.set(c.employeeId, l);
  }
  const estEnConge = (empId: string, d: Date) =>
    (congesParEmp.get(empId) ?? []).some((iv) => d.getTime() >= iv.debut && d.getTime() <= iv.fin);

  // État courant : ce qui est déjà posé (existants conservés + historique) et ce qu'on ajoute.
  const occupe = new Set<string>(); // `${empId}_${isoJour}`
  const joursSemaine = new Map<string, number>(); // `${empId}_${lundiIso}` → nb de jours travaillés
  const heuresSemaine = new Map<string, number>(); // `${empId}_${lundiIso}` → heures planifiées
  const ajouter = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

  // L'historique alimente `occupe` (jours consécutifs) mais PAS les quotas de la période.
  for (const h of entrees.historique) occupe.add(`${h.employeeId}_${iso(h.date)}`);

  if (!options.ecraser) {
    for (const ex of entrees.existants) {
      const lundi = iso(lundiDeUTC(ex.date));
      occupe.add(`${ex.employeeId}_${iso(ex.date)}`);
      ajouter(joursSemaine, `${ex.employeeId}_${lundi}`, 1);
      ajouter(heuresSemaine, `${ex.employeeId}_${lundi}`, dureeParShift.get(ex.shiftId) ?? 0);
    }
  }

  /** Nombre de jours travaillés d'affilée qui se termineraient en `d` si on y posait un créneau. */
  const serieAvec = (empId: string, d: Date): number => {
    let n = 1;
    for (let t = d.getTime() - JOUR_MS; occupe.has(`${empId}_${iso(new Date(t))}`); t -= JOUR_MS) n++;
    for (let t = d.getTime() + JOUR_MS; occupe.has(`${empId}_${iso(new Date(t))}`); t += JOUR_MS) n++;
    return n;
  };

  /** Contraintes DURES : jamais violées, à aucune étape. */
  const respecteContraintesDures = (empId: string, d: Date): boolean => {
    if (occupe.has(`${empId}_${iso(d)}`)) return false;
    if (estEnConge(empId, d)) return false;
    const lundi = iso(lundiDeUTC(d));
    if ((joursSemaine.get(`${empId}_${lundi}`) ?? 0) >= JOURS_TRAVAILLES_MAX_PAR_SEMAINE) return false;
    if (serieAvec(empId, d) > JOURS_CONSECUTIFS_MAX) return false;
    return true;
  };

  const creneaux: CreneauPlanning[] = [];
  const affecter = (empId: string, d: Date, shiftId: string) => {
    const lundi = iso(lundiDeUTC(d));
    creneaux.push({ employeeId: empId, date: d, shiftId });
    occupe.add(`${empId}_${iso(d)}`);
    ajouter(joursSemaine, `${empId}_${lundi}`, 1);
    ajouter(heuresSemaine, `${empId}_${lundi}`, dureeParShift.get(shiftId) ?? 0);
  };

  // ── Étape 1 : modèles hebdomadaires (affectations fixes, prioritaires) ────────────────────
  if (options.utiliserModeles) {
    const modeleParEmp = new Map<string, Map<string, string>>();
    for (const m of entrees.modeles) {
      const cle = modeleParEmp.get(m.employeeId) ?? new Map<string, string>();
      cle.set(`${m.jour}_${m.semaine}`, m.shiftId);
      modeleParEmp.set(m.employeeId, cle);
    }
    for (const emp of entrees.employes) {
      const mod = modeleParEmp.get(emp.id);
      if (!mod || mod.size === 0) continue;
      for (const d of joursPeriode) {
        const shiftId = mod.get(`${d.getUTCDay()}_${pariteSemaine(d)}`) ?? mod.get(`${d.getUTCDay()}_0`);
        if (!shiftId) continue;
        if (!respecteContraintesDures(emp.id, d)) continue;
        affecter(emp.id, d, shiftId);
      }
    }
  }

  return {
    creneaux,
    rapport: { crees: creneaux.length, trous: [], sansShiftPoste: [], depassements: [], sousHeures: [] },
  };
}
```

- [ ] **Étape 6 : Lancer les tests pour vérifier qu'ils passent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : 6 tests verts.

- [ ] **Étape 7 : Vérifier la suite complète et les types**

```bash
npx tsc --noEmit && npm test
```

Attendu : aucune sortie de `tsc` ; suite verte (714 + 6 = 720 tests).

- [ ] **Étape 8 : Commit**

```bash
git add src/lib/planning-auto.ts src/lib/planning-auto.test.ts src/lib/dates-fr.ts "src/app/(app)/planning/creneaux.ts"
git commit -m "feat(planning): moteur pur — types, modèles hebdo et contraintes dures

Premier étage du moteur extrait de la server action : un shift par jour et par
personne, aucun créneau sur un congé approuvé, au moins 1 jour de repos par
semaine et 6 jours consécutifs au maximum — ces deux dernières règles n'existaient
pas du tout, rien n'empêchait sept jours d'affilée.

La série de jours consécutifs tient compte de l'historique, sinon une série à
cheval sur deux semaines passerait inaperçue.

pariteSemaine déplacée dans src/lib/dates-fr.ts (le moteur pur ne doit rien
importer de src/app/), ré-exportée depuis creneaux.ts pour les appelants existants.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 3 : Couverture des besoins et rapport des causes

**Fichiers :**
- Modifier : `src/lib/planning-auto.ts`
- Modifier : `src/lib/planning-auto.test.ts`

**Interfaces :**
- Consomme : `genererPlanning`, `respecteContraintesDures`, `affecter` (T2).
- Produit : `rapport.trous: TrouCouverture[]` renseigné avec sa `raison`, consommé par T9 (affichage).

- [ ] **Étape 1 : Écrire les tests de couverture et de causes (ils doivent échouer)**

Ajouter à `src/lib/planning-auto.test.ts` :

```ts
describe("genererPlanning — couverture des besoins", () => {
  const besoinLundiMatin = { shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 1, nombreRequis: 2 };

  it("couvre un besoin avec les titulaires du poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1"), employe("e2"), employe("e3")],
      besoins: [besoinLundiMatin],
    }));
    const lundi = r.creneaux.filter((c) => iso2(c.date) === "2026-07-06");
    expect(lundi).toHaveLength(2);
    expect(r.rapport.trous).toHaveLength(0);
  });

  it("complète avec la polyvalence quand les titulaires ne suffisent pas", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1"), employe("chef", "Chef de partie")],
      besoins: [besoinLundiMatin],
      polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
    }));
    expect(r.creneaux.filter((c) => iso2(c.date) === "2026-07-06")).toHaveLength(2);
    expect(r.rapport.trous).toHaveLength(0);
  });

  it("rapporte AUCUN_TITULAIRE quand personne ne tient le poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1", "Plongeur")],
      besoins: [besoinLundiMatin],
    }));
    expect(r.rapport.trous).toEqual([
      { date: d("2026-07-06"), shiftId: SHIFT_MATIN.id, poste: "Cuisinier", manque: 2, raison: "AUCUN_TITULAIRE" },
    ]);
  });

  it("rapporte EFFECTIF_INSUFFISANT quand tout le monde était libre mais en nombre insuffisant", () => {
    // Le piège que ce test verrouille : les candidats posés pour CE besoin ne doivent pas être
    // relus comme « déjà pris ». Ici les deux étaient libres, ils sont posés, il en manquait un
    // troisième — la cause est l'effectif, pas un blocage.
    const r = genererPlanning(entreesBase({
      employes: [employe("e1"), employe("chef", "Chef de partie")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 3 }],
      polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
    }));
    expect(r.creneaux.filter((c) => iso2(c.date) === "2026-07-06")).toHaveLength(2);
    expect(r.rapport.trous[0].manque).toBe(1);
    expect(r.rapport.trous[0].raison).toBe("EFFECTIF_INSUFFISANT");
  });

  it("rapporte TOUS_EN_CONGE", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 1 }],
      conges: [{ employeeId: "e1", dateDebut: d("2026-07-06"), dateFin: d("2026-07-06") }],
    }));
    expect(r.rapport.trous[0].raison).toBe("TOUS_EN_CONGE");
  });

  it("rapporte TOUS_DEJA_PRIS quand chacun a déjà un shift ce jour-là", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1")],
      besoins: [{ ...besoinLundiMatin, nombreRequis: 1 }],
      existants: [{ employeeId: "e1", date: d("2026-07-06"), shiftId: SHIFT_SOIR.id }],
    }));
    expect(r.rapport.trous[0].raison).toBe("TOUS_DEJA_PRIS");
  });

  it("rapporte TOUS_AU_REPOS quand la règle de repos bloque tout le monde", () => {
    // e1 a déjà 6 jours posés dans la semaine : le 7e est interdit par le repos hebdomadaire.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-12"), fin: d("2026-07-12"), // dimanche seul
      employes: [{ ...employe("e1"), heuresHebdomadaires: 100 }],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 0, nombreRequis: 1 }],
      existants: ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"]
        .map((j) => ({ employeeId: "e1", date: d(j), shiftId: SHIFT_MATIN.id })),
    }));
    expect(r.rapport.trous[0].raison).toBe("TOUS_AU_REPOS");
  });
});
```

Ajouter aussi, en haut du fichier de test, le raccourci utilisé ci-dessus :

```ts
const iso2 = (x: Date) => x.toISOString().slice(0, 10);
```

- [ ] **Étape 2 : Lancer les tests pour vérifier qu'ils échouent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : les 6 nouveaux tests échouent (aucun créneau de couverture, `trous` vide).

- [ ] **Étape 3 : Implémenter l'étape 2 du moteur**

Dans `src/lib/planning-auto.ts`, **après** le bloc « Étape 1 : modèles hebdomadaires » et **avant**
le `return`, insérer :

```ts
  // ── Étape 2 : couverture des besoins ──────────────────────────────────────────────────────
  const trous: TrouCouverture[] = [];
  const empsParPoste = new Map<string, EmployePlanning[]>();
  for (const e of entrees.employes) {
    const l = empsParPoste.get(e.poste) ?? [];
    l.push(e);
    empsParPoste.set(e.poste, l);
  }

  // Couverture déjà acquise : modèles posés + créneaux existants conservés.
  const posteDe = new Map(entrees.employes.map((e) => [e.id, e.poste]));
  const couverture = new Map<string, number>(); // `${isoJour}_${shiftId}_${poste}`
  const compterCouverture = (c: CreneauPlanning) => {
    const p = posteDe.get(c.employeeId);
    if (p) ajouter(couverture, `${iso(c.date)}_${c.shiftId}_${p}`, 1);
  };
  creneaux.forEach(compterCouverture);
  if (!options.ecraser) entrees.existants.forEach(compterCouverture);

  const besoinsParJour = new Map<number, BesoinPlanning[]>();
  for (const b of entrees.besoins) {
    const l = besoinsParJour.get(b.jourSemaine) ?? [];
    l.push(b);
    besoinsParJour.set(b.jourSemaine, l);
  }

  /**
   * Pourquoi le besoin n'est pas couvert. Le diagnostic se fait sur un INSTANTANÉ pris AVANT la
   * boucle d'affectation : sans lui, les candidats qu'on vient tout juste de poser pour ce besoin
   * apparaîtraient « déjà pris », et un simple manque d'effectif serait rapporté comme un blocage.
   * Un lecteur chercherait alors qui bloque, au lieu de voir qu'il manque du monde.
   *
   * `libresAvant` = les candidats qui, avant toute affectation de ce besoin, satisfaisaient les
   * contraintes dures. S'il y en avait — ils ont donc tous été posés — et que le compte n'y est
   * toujours pas, la cause est l'effectif, pas un blocage.
   */
  const diagnostiquer = (
    candidats: EmployePlanning[],
    libresAvant: EmployePlanning[],
    d: Date
  ): RaisonNonCouverture => {
    if (candidats.length === 0) return "AUCUN_TITULAIRE";
    if (libresAvant.length > 0) return "EFFECTIF_INSUFFISANT";
    if (candidats.every((e) => estEnConge(e.id, d))) return "TOUS_EN_CONGE";
    const dispos = candidats.filter((e) => !estEnConge(e.id, d));
    if (dispos.every((e) => occupe.has(`${e.id}_${iso(d)}`))) return "TOUS_DEJA_PRIS";
    return "TOUS_AU_REPOS";
  };

  for (const d of joursPeriode) {
    for (const b of besoinsParJour.get(d.getUTCDay()) ?? []) {
      const cle = `${iso(d)}_${b.shiftId}_${b.poste}`;
      let acquis = couverture.get(cle) ?? 0;
      if (acquis >= b.nombreRequis) continue;

      // Titulaires du poste, puis postes déclarés capables de le couvrir (polyvalence).
      const titulaires = empsParPoste.get(b.poste) ?? [];
      const renforts = entrees.polyvalences
        .filter((p) => p.posteCible === b.poste)
        .flatMap((p) => empsParPoste.get(p.posteSource) ?? []);
      const candidats = [...titulaires, ...renforts];

      // Instantané AVANT toute affectation de ce besoin — sert au diagnostic (voir `diagnostiquer`).
      const libresAvant = candidats.filter((e) => respecteContraintesDures(e.id, d));

      for (const e of candidats) {
        if (acquis >= b.nombreRequis) break;
        if (!respecteContraintesDures(e.id, d)) continue;
        affecter(e.id, d, b.shiftId);
        ajouter(couverture, cle, 1);
        acquis++;
      }

      if (acquis < b.nombreRequis) {
        trous.push({
          date: d,
          shiftId: b.shiftId,
          poste: b.poste,
          manque: b.nombreRequis - acquis,
          raison: diagnostiquer(candidats, libresAvant, d),
        });
      }
    }
  }
```

Puis remplacer le `return` final par :

```ts
  return {
    creneaux,
    rapport: { crees: creneaux.length, trous, sansShiftPoste: [], depassements: [], sousHeures: [] },
  };
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : 12 tests verts.

- [ ] **Étape 5 : Vérifier la suite complète**

Lancer : `npx tsc --noEmit && npm test`
Attendu : `tsc` muet, suite verte.

- [ ] **Étape 6 : Commit**

```bash
git add src/lib/planning-auto.ts src/lib/planning-auto.test.ts
git commit -m "feat(planning): couverture des besoins, et chaque trou dit sa cause

Le rapport annonçait « manque 2 » sans dire pourquoi, ce qui rendait les trous de
couverture impossibles à corriger. Le moteur élimine les candidats dans un ordre
connu : il suffit de retenir à quelle étape le vivier s'est vidé (aucun titulaire,
tous en congé, tous déjà pris, tous au repos).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 4 : Plafond d'heures souple et dépassement explicite

**Fichiers :**
- Modifier : `src/lib/planning-auto.ts`
- Modifier : `src/lib/planning-auto.test.ts`

**Interfaces :**
- Consomme : `heuresSemaine`, `respecteContraintesDures`, `diagnostiquer` (T2, T3).
- Produit : `rapport.depassements: DepassementHeures[]` et la raison `TOUS_AU_PLAFOND`.

- [ ] **Étape 1 : Écrire les tests (ils doivent échouer)**

Ajouter à `src/lib/planning-auto.test.ts` :

```ts
describe("genererPlanning — plafond d'heures", () => {
  /** e1 : 8 h contractuelles/semaine → un seul shift de 8 h tient dans son plafond. */
  const entreesPlafond = (autoriser: boolean) => entreesBase({
    employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
    besoins: [
      { shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 1, nombreRequis: 1 },
      { shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 2, nombreRequis: 1 },
    ],
    options: { ...entreesBase().options, autoriserDepassementHeures: autoriser },
  });

  it("sans l'option, laisse le besoin découvert et rapporte TOUS_AU_PLAFOND", () => {
    const r = genererPlanning(entreesPlafond(false));
    expect(r.creneaux).toHaveLength(1); // seul le lundi tient dans les 8 h
    expect(r.rapport.trous).toHaveLength(1);
    expect(r.rapport.trous[0].raison).toBe("TOUS_AU_PLAFOND");
    expect(r.rapport.depassements).toHaveLength(0);
  });

  it("avec l'option, couvre le besoin ET liste le dépassement engagé", () => {
    const r = genererPlanning(entreesPlafond(true));
    expect(r.creneaux).toHaveLength(2);
    expect(r.rapport.trous).toHaveLength(0);
    expect(r.rapport.depassements).toEqual([
      { employeeId: "e1", lundi: d("2026-07-06"), heuresPlanifiees: 16, heuresContractuelles: 8 },
    ]);
  });

});
```

> Le test « ne dépasse jamais le plafond dans la passe complémentaire » n'est **pas** écrit ici : il
> porte sur une passe qui n'existe qu'à la tâche 5. L'y écrire maintenant le rendrait rouge, ce qui
> violerait la contrainte « la suite reste verte à chaque commit ». Il est donc écrit en tâche 5.

- [ ] **Étape 2 : Lancer les tests pour vérifier qu'ils échouent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts -t "plafond"`
Attendu : ÉCHEC — le plafond d'heures n'est pas encore implémenté, les 3 tests tombent.

- [ ] **Étape 3 : Implémenter le plafond**

Dans `src/lib/planning-auto.ts`, ajouter après `respecteContraintesDures` :

```ts
  /**
   * Contrainte SOUPLE : le plafond d'heures hebdomadaires. Séparée des contraintes dures parce
   * qu'elle seule peut être levée — et uniquement sur décision explicite, pour couvrir un besoin.
   * En mode « nombre de jours par semaine » forcé, le plafond s'exprime en jours.
   */
  const tientDansLesHeures = (e: EmployePlanning, d: Date, shiftId: string): boolean => {
    const lundi = iso(lundiDeUTC(d));
    if (options.nbParSemaine > 0) {
      return (joursSemaine.get(`${e.id}_${lundi}`) ?? 0) < options.nbParSemaine;
    }
    const ds = dureeParShift.get(shiftId) ?? 0;
    const cible = e.heuresHebdomadaires || 48;
    // Tolérance d'un demi-shift : on accepte le shift qui RAPPROCHE le plus de la cible.
    return (heuresSemaine.get(`${e.id}_${lundi}`) ?? 0) <= cible - ds / 2 + 0.01;
  };

  const depassements: DepassementHeures[] = [];
  const noterDepassement = (e: EmployePlanning, d: Date) => {
    const lundiD = lundiDeUTC(d);
    const cle = `${e.id}_${iso(lundiD)}`;
    const existant = depassements.find((x) => x.employeeId === e.id && x.lundi.getTime() === lundiD.getTime());
    const heures = heuresSemaine.get(cle) ?? 0;
    if (existant) existant.heuresPlanifiees = heures;
    else depassements.push({ employeeId: e.id, lundi: lundiD, heuresPlanifiees: heures, heuresContractuelles: e.heuresHebdomadaires || 48 });
  };
```

Puis, dans la boucle de couverture (étape 2), remplacer le corps de la boucle `for (const e of candidats)` par :

```ts
      for (const e of candidats) {
        if (acquis >= b.nombreRequis) break;
        if (!respecteContraintesDures(e.id, d)) continue;
        const dansLesHeures = tientDansLesHeures(e, d, b.shiftId);
        if (!dansLesHeures && !options.autoriserDepassementHeures) continue;
        affecter(e.id, d, b.shiftId);
        ajouter(couverture, cle, 1);
        acquis++;
        if (!dansLesHeures) noterDepassement(e, d);
      }
```

Enfin, dans `diagnostiquer`, insérer le plafond **avant** `TOUS_AU_REPOS` — c'est la dernière cause
testée, et la seule levable :

```ts
  const diagnostiquer = (candidats: EmployePlanning[], d: Date, shiftId: string): RaisonNonCouverture => {
    if (candidats.length === 0) return "AUCUN_TITULAIRE";
    if (candidats.every((e) => estEnConge(e.id, d))) return "TOUS_EN_CONGE";
    const dispos = candidats.filter((e) => !estEnConge(e.id, d));
    if (dispos.every((e) => occupe.has(`${e.id}_${iso(d)}`))) return "TOUS_DEJA_PRIS";
    const libres = dispos.filter((e) => respecteContraintesDures(e.id, d));
    if (libres.length > 0 && libres.every((e) => !tientDansLesHeures(e, d, shiftId))) return "TOUS_AU_PLAFOND";
    return "TOUS_AU_REPOS";
  };
```

Mettre à jour son appel : `raison: diagnostiquer(candidats, d, b.shiftId)`.

Et le `return` final : `depassements` à la place du tableau vide.

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : 15 tests verts (13 des tâches précédentes + les 2 du bloc « plafond »).

- [ ] **Étape 5 : Commit**

```bash
git add src/lib/planning-auto.ts src/lib/planning-auto.test.ts
git commit -m "feat(planning): plafond d'heures relâchable sur décision explicite

Le plafond d'heures filtrait le vivier AVANT que la couverture soit satisfaite :
un besoin restait découvert alors que quelqu'un aurait pu le prendre, sans que
rien ne le dise. Il devient une contrainte souple, levable par la seule option
autoriserDepassementHeures, et chaque dépassement engagé est listé — le logiciel
n'engage pas d'heures supplémentaires de sa propre initiative.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 5 : Passe complémentaire via `ShiftPoste`

**Fichiers :**
- Modifier : `src/lib/planning-auto.ts`
- Modifier : `src/lib/planning-auto.test.ts`

**Interfaces :**
- Consomme : `tientDansLesHeures`, `respecteContraintesDures`, `affecter` (T2, T4).
- Produit : `rapport.sansShiftPoste` et `rapport.sousHeures`, consommés par T9.

- [ ] **Étape 1 : Écrire les tests (ils doivent échouer)**

Ajouter à `src/lib/planning-auto.test.ts` :

```ts
describe("genererPlanning — passe complémentaire", () => {
  const optionsCompleter = { ...entreesBase().options, completer: true, jours: [1, 2, 3, 4, 5, 6] };

  it("remplit jusqu'aux heures avec le premier shift acceptable du poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 24 }], // 3 shifts de 8 h
      shiftsPoste: [
        { poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 },
        { poste: "Cuisinier", shiftId: SHIFT_SOIR.id, ordre: 1 },
      ],
      options: optionsCompleter,
    }));
    expect(r.creneaux).toHaveLength(3);
    expect(r.creneaux.every((c) => c.shiftId === SHIFT_MATIN.id)).toBe(true);
  });

  it("respecte un shift imposé par l'utilisateur, en ignorant la liste du poste", () => {
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: { ...optionsCompleter, shiftId: SHIFT_SOIR.id },
    }));
    expect(r.creneaux[0].shiftId).toBe(SHIFT_SOIR.id);
  });

  it("ne pose RIEN et nomme le salarié quand son poste n'a aucun shift acceptable", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("e1", "Plongeur")],
      shiftsPoste: [],
      options: optionsCompleter,
    }));
    expect(r.creneaux).toHaveLength(0);
    expect(r.rapport.sansShiftPoste).toEqual([{ employeeId: "e1", poste: "Plongeur" }]);
  });

  it("ne dépasse JAMAIS le plafond dans la passe complémentaire, même avec l'option", () => {
    // Déplacé depuis la tâche 4 : il porte sur cette passe, il ne pouvait donc pas y être écrit
    // sans être rouge. Aucun besoin déclaré ici — rien ne justifie de pousser quelqu'un au-delà
    // de ses heures quand aucune couverture ne l'exige.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: { ...optionsCompleter, autoriserDepassementHeures: true },
    }));
    expect(r.creneaux).toHaveLength(1);
    expect(r.rapport.depassements).toHaveLength(0);
  });

  it("rapporte les salariés restés sous leurs heures, au prorata de la période", () => {
    // Semaine complète (6 jours ouvrables → 48 h attendues), mais 2 jours de congé approuvé :
    // seuls 4 jours sont planifiables, soit 32 h. Le manque est réel et doit être signalé.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-06"), fin: d("2026-07-11"),
      employes: [{ ...employe("e1"), heuresHebdomadaires: 48 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      conges: [{ employeeId: "e1", dateDebut: d("2026-07-09"), dateFin: d("2026-07-10") }],
      options: optionsCompleter,
    }));
    expect(r.rapport.sousHeures).toEqual([
      { employeeId: "e1", heuresPlanifiees: 32, heuresContractuelles: 48 },
    ]);
  });

  it("n'annonce AUCUN manque sur une période à cheval qui couvre bien une semaine de travail", () => {
    // Le piège corrigé : mercredi → mardi touche DEUX lundis civils mais ne couvre qu'une seule
    // semaine de travail. Compter deux fois l'horaire hebdomadaire inventait un manque de 48 h.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-08"), fin: d("2026-07-14"), // mercredi → mardi
      employes: [{ ...employe("e1"), heuresHebdomadaires: 48 }],
      shiftsPoste: [{ poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 }],
      options: optionsCompleter,
    }));
    expect(r.rapport.sousHeures).toEqual([]);
  });
});
```

- [ ] **Étape 2 : Lancer les tests pour vérifier qu'ils échouent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts -t "complémentaire"`
Attendu : les 4 tests échouent (aucun créneau, rapports vides).

- [ ] **Étape 3 : Implémenter la passe complémentaire**

Dans `src/lib/planning-auto.ts`, après la boucle de couverture et avant le `return` :

```ts
  // ── Étape 3 : passe complémentaire ────────────────────────────────────────────────────────
  // Remplir chacun jusqu'à ses heures, via la liste ordonnée des shifts que son poste peut tenir.
  // JAMAIS de dépassement d'heures ici : sans besoin déclaré à couvrir, rien ne le justifierait.
  const sansShiftPoste: { employeeId: string; poste: string }[] = [];

  if (options.completer) {
    const shiftsParPoste = new Map<string, string[]>();
    for (const sp of [...entrees.shiftsPoste].sort((a, b) => a.ordre - b.ordre)) {
      const l = shiftsParPoste.get(sp.poste) ?? [];
      l.push(sp.shiftId);
      shiftsParPoste.set(sp.poste, l);
    }

    for (const emp of entrees.employes) {
      // Un shift imposé par l'utilisateur court-circuite la liste du poste.
      const candidatsShift = options.shiftId ? [options.shiftId] : (shiftsParPoste.get(emp.poste) ?? []);
      if (candidatsShift.length === 0) {
        sansShiftPoste.push({ employeeId: emp.id, poste: emp.poste });
        continue;
      }
      for (const d of joursPeriode) {
        if (!respecteContraintesDures(emp.id, d)) continue;
        const shiftId = candidatsShift.find((s) => tientDansLesHeures(emp, d, s));
        if (!shiftId) continue;
        affecter(emp.id, d, shiftId);
      }
    }
  }

  // Salariés restés sous leurs heures contractuelles sur la période.
  //
  // L'attendu se calcule AU PRORATA des jours réellement planifiables, pas du nombre de lundis
  // touchés. Une période mercredi → mardi touche deux lundis sans couvrir deux semaines : compter
  // deux fois l'horaire hebdomadaire annoncerait un manque qui n'existe pas, et pousserait à
  // sur-planifier quelqu'un qui a déjà son compte.
  const joursActifsParSemaine = Math.max(1, joursAutorises.size);
  const proportionSemaines = joursPeriode.length / joursActifsParSemaine;
  const heuresTotales = new Map<string, number>();
  for (const c of creneaux) ajouter(heuresTotales, c.employeeId, dureeParShift.get(c.shiftId) ?? 0);
  if (!options.ecraser) {
    for (const ex of entrees.existants) ajouter(heuresTotales, ex.employeeId, dureeParShift.get(ex.shiftId) ?? 0);
  }
  const sousHeures = entrees.employes
    .map((e) => ({
      employeeId: e.id,
      heuresPlanifiees: heuresTotales.get(e.id) ?? 0,
      heuresContractuelles:
        Math.round((e.heuresHebdomadaires || 48) * proportionSemaines * 100) / 100,
    }))
    .filter((x) => x.heuresPlanifiees < x.heuresContractuelles - 0.01);
```

Et le `return` final :

```ts
  return {
    creneaux,
    rapport: { crees: creneaux.length, trous, sansShiftPoste, depassements, sousHeures },
  };
```

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : 19 tests verts — **y compris** « ne dépasse JAMAIS le plafond dans la passe
complémentaire » (T4), qui est maintenant réellement exercé.

- [ ] **Étape 5 : Vérifier la suite complète**

Lancer : `npx tsc --noEmit && npm test`

- [ ] **Étape 6 : Commit**

```bash
git add src/lib/planning-auto.ts src/lib/planning-auto.test.ts
git commit -m "feat(planning): passe complémentaire via les shifts acceptables du poste

Remplace le repli par expression régulière sur le nom du shift. Sans liste
déclarée, le moteur ne pose plus rien et nomme les salariés concernés : un trou
visible vaut mieux qu'un shift faux posé en silence.

Aucun dépassement d'heures dans cette passe, même quand l'option est cochée :
sans besoin déclaré à couvrir, rien ne le justifie.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 6 : Équité — jours pénibles et alternance des shifts

**Fichiers :**
- Modifier : `src/lib/planning-auto.ts`
- Modifier : `src/lib/planning-auto.test.ts`

**Interfaces :**
- Consomme : `entrees.historique`, la boucle de couverture (T3) et la passe complémentaire (T5).
- Produit : l'ordre de passage des candidats. Aucun nouveau type.

- [ ] **Étape 1 : Écrire les tests (ils doivent échouer)**

Ajouter à `src/lib/planning-auto.test.ts` :

```ts
describe("genererPlanning — équité", () => {
  it("choisit d'abord celui qui a le moins d'heures sur la période", () => {
    const r = genererPlanning(entreesBase({
      employes: [employe("charge"), employe("leger")],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 1, nombreRequis: 1 }],
      existants: [{ employeeId: "charge", date: d("2026-07-07"), shiftId: SHIFT_MATIN.id }],
    }));
    expect(r.creneaux.find((c) => iso2(c.date) === "2026-07-06")?.employeeId).toBe("leger");
  });

  it("fait tourner les dimanches d'après l'historique, à heures égales", () => {
    // Les deux ont autant d'heures sur la période ; « habitue » a déjà pris 3 dimanches avant.
    const r = genererPlanning(entreesBase({
      debut: d("2026-07-12"), fin: d("2026-07-12"), // dimanche
      employes: [employe("habitue"), employe("repose")],
      besoins: [{ shiftId: SHIFT_MATIN.id, poste: "Cuisinier", jourSemaine: 0, nombreRequis: 1 }],
      options: { ...entreesBase().options, jours: [0] },
      historique: ["2026-06-21", "2026-06-28", "2026-07-05"].map((j) => ({
        employeeId: "habitue", date: d(j), shiftId: SHIFT_MATIN.id,
      })),
    }));
    expect(r.creneaux[0].employeeId).toBe("repose");
  });

  it("alterne les shifts acceptables d'une génération à l'autre, d'après l'historique", () => {
    // e1 a déjà beaucoup fait « Matin » les semaines précédentes : « Soir » passe devant.
    // L'ordre est figé pour toute la génération — on ne veut pas d'un cuisinier qui bascule
    // matin/soir d'un jour sur l'autre.
    const r = genererPlanning(entreesBase({
      employes: [{ ...employe("e1"), heuresHebdomadaires: 8 }],
      shiftsPoste: [
        { poste: "Cuisinier", shiftId: SHIFT_MATIN.id, ordre: 0 },
        { poste: "Cuisinier", shiftId: SHIFT_SOIR.id, ordre: 1 },
      ],
      historique: ["2026-06-29", "2026-06-30", "2026-07-01"].map((j) => ({
        employeeId: "e1", date: d(j), shiftId: SHIFT_MATIN.id,
      })),
      options: { ...entreesBase().options, completer: true },
    }));
    expect(r.creneaux[0].shiftId).toBe(SHIFT_SOIR.id);
  });
});
```

- [ ] **Étape 2 : Lancer les tests pour vérifier qu'ils échouent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts -t "équité"`
Attendu : au moins les deux derniers tests échouent (aucune prise en compte de l'historique).

- [ ] **Étape 3 : Implémenter l'équité**

Dans `src/lib/planning-auto.ts`, après la construction de `couverture` (étape 2), ajouter :

```ts
  // ── Équité ────────────────────────────────────────────────────────────────────────────────
  // Un DÉPARTAGE entre candidats disponibles, jamais un veto : l'équité ne peut pas empêcher de
  // couvrir un besoin, elle choisit seulement qui le couvre.
  //
  // Critère 1 = heures sur la PÉRIODE seule (comportement actuel, strictement inchangé).
  // Critères 2 et 3 = période + historique, sinon ils ne veulent rien dire sur une semaine isolée :
  // un seul dimanche, et pas la place d'alterner matin et soir.
  const heuresPeriode = new Map<string, number>();
  const joursPenibles = new Map<string, number>(); // dimanches + fériés, période et historique
  const shiftsPris = new Map<string, number>(); // `${empId}_${shiftId}` — période et historique

  const estPenible = (d: Date) => d.getUTCDay() === 0 || feriesIso.has(iso(d));
  const compterEquite = (c: CreneauPlanning, compteHeures: boolean) => {
    if (compteHeures) ajouter(heuresPeriode, c.employeeId, dureeParShift.get(c.shiftId) ?? 0);
    if (estPenible(c.date)) ajouter(joursPenibles, c.employeeId, 1);
    ajouter(shiftsPris, `${c.employeeId}_${c.shiftId}`, 1);
  };
  for (const h of entrees.historique) compterEquite(h, false);
  if (!options.ecraser) for (const ex of entrees.existants) compterEquite(ex, true);
  for (const c of creneaux) compterEquite(c, true); // modèles déjà posés

  const ordonnerCandidats = (candidats: EmployePlanning[], d: Date) =>
    [...candidats].sort(
      (a, b) =>
        (heuresPeriode.get(a.id) ?? 0) - (heuresPeriode.get(b.id) ?? 0) ||
        (estPenible(d) ? (joursPenibles.get(a.id) ?? 0) - (joursPenibles.get(b.id) ?? 0) : 0) ||
        a.id.localeCompare(b.id), // départage stable : deux générations identiques donnent le même résultat
    );
```

Dans la boucle de couverture, remplacer `for (const e of candidats)` par
`for (const e of ordonnerCandidats(candidats, d))`, et faire suivre chaque `affecter(...)` de
`compterEquite({ employeeId: e.id, date: d, shiftId: b.shiftId }, true);`.

Dans la passe complémentaire, l'ordre de préférence des shifts est **figé une fois par employé**,
avant sa boucle de jours — surtout pas recalculé chaque jour.

C'est un point de conception, pas un détail d'implémentation : si l'ordre se recalculait à chaque
jour, un cuisinier basculerait matin / soir / matin / soir d'un jour sur l'autre, ce que personne
ne veut. La rotation doit se faire **entre générations**, pas à l'intérieur d'une. Un instantané
pris avant la passe suffit à obtenir ça.

Juste avant la boucle `for (const emp of entrees.employes)`, prendre l'instantané :

```ts
    // Photo des shifts déjà pris (historique + existants + modèles + couverture) AVANT la passe.
    // Fige l'ordre de préférence : on rééquilibre d'une génération à l'autre, jamais d'un jour à l'autre.
    const shiftsPrisInitial = new Map(shiftsPris);
```

Puis, dans le corps de la boucle employé, après le contrôle de `candidatsShift.length === 0` :

```ts
      const ordrePrefere = [...candidatsShift].sort(
        (s1, s2) =>
          (shiftsPrisInitial.get(`${emp.id}_${s1}`) ?? 0) - (shiftsPrisInitial.get(`${emp.id}_${s2}`) ?? 0),
      );
```

Et dans la boucle de jours, remplacer la sélection du shift par :

```ts
        const shiftId = ordrePrefere.find((s) => tientDansLesHeures(emp, d, s));
        if (!shiftId) continue;
        affecter(emp.id, d, shiftId);
        compterEquite({ employeeId: emp.id, date: d, shiftId }, true);
```

Le tri de JavaScript étant stable, à compteurs égaux l'ordre déclaré dans `ShiftPoste` est
conservé — le test « remplit avec le premier shift acceptable » de la tâche 5 reste vert.

- [ ] **Étape 4 : Lancer les tests pour vérifier qu'ils passent**

Lancer : `npx vitest run src/lib/planning-auto.test.ts`
Attendu : 22 tests verts.

- [ ] **Étape 5 : Vérifier la suite complète**

Lancer : `npx tsc --noEmit && npm test`

- [ ] **Étape 6 : Commit**

```bash
git add src/lib/planning-auto.ts src/lib/planning-auto.test.ts
git commit -m "feat(planning): équité étendue aux jours pénibles et à l'alternance des shifts

L'équité ne regardait que le cumul d'heures : rien n'empêchait que ce soient
toujours les mêmes qui prennent les dimanches et les fériés, ni que le premier
shift de la liste monopolise.

Le critère des heures reste STRICTEMENT inchangé (période seule) : le faire porter
sur l'historique aurait modifié le seul critère qui fonctionne aujourd'hui.
L'historique de 8 semaines ne sert qu'à la rotation des jours pénibles et des
types de shift, qui n'ont aucun sens sur une semaine isolée.

Départage final par identifiant : deux générations identiques donnent le même
planning, condition nécessaire au golden.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 7 : Golden — brigade de référence

**Fichiers :**
- Créer : `src/lib/planning-auto.golden.test.ts`

**Interfaces :**
- Consomme : `genererPlanning` (T2 → T6).
- Produit : rien. C'est un filet, pas une brique.

- [ ] **Étape 1 : Écrire le golden**

Créer `src/lib/planning-auto.golden.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { genererPlanning, type EntreesGeneration } from "@/lib/planning-auto";

// GOLDEN — une brigade de référence réaliste et son planning figé. Ce test n'a pas vocation à
// prouver une règle précise (les autres s'en chargent) mais à rendre VISIBLE tout changement de
// comportement, y compris ceux qu'on n'avait pas prévus.
//
// Quand il casse : lire le diff, décider si le changement est voulu, et seulement alors mettre à
// jour l'attendu — jamais l'inverse. Même convention que src/lib/fiches/golden.integration.test.ts.

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");

const SHIFTS = [
  { id: "matin-cuisine", nom: "Matin cuisine", dureeHeures: 8 },
  { id: "soir-cuisine", nom: "Soir cuisine", dureeHeures: 8 },
  { id: "matin-salle", nom: "Matin/midi salle", dureeHeures: 8 },
  { id: "caisse", nom: "Caisse", dureeHeures: 8 },
];

const BRIGADE = [
  { id: "cuis-1", nom: "Cuisinier 1", poste: "Cuisinier", secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "cuis-2", nom: "Cuisinier 2", poste: "Cuisinier", secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "chef-1", nom: "Chef de partie", poste: "Chef de partie", secteur: "Cuisine", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "serv-1", nom: "Serveur 1", poste: "Serveur", secteur: "Salle", heuresParJour: 8, heuresHebdomadaires: 48 },
  { id: "caiss-1", nom: "Caissière", poste: "Caissier", secteur: "Salle", heuresParJour: 8, heuresHebdomadaires: 48 },
];

/** Semaine du lundi 6 au dimanche 12 juillet 2026. */
const ENTREES: EntreesGeneration = {
  debut: d("2026-07-06"),
  fin: d("2026-07-12"),
  employes: BRIGADE,
  shifts: SHIFTS,
  besoins: [1, 2, 3, 4, 5, 6].flatMap((j) => [
    { shiftId: "matin-cuisine", poste: "Cuisinier", jourSemaine: j, nombreRequis: 2 },
    { shiftId: "matin-salle", poste: "Serveur", jourSemaine: j, nombreRequis: 1 },
    { shiftId: "caisse", poste: "Caissier", jourSemaine: j, nombreRequis: 1 },
  ]),
  shiftsPoste: [
    { poste: "Cuisinier", shiftId: "matin-cuisine", ordre: 0 },
    { poste: "Cuisinier", shiftId: "soir-cuisine", ordre: 1 },
    { poste: "Chef de partie", shiftId: "matin-cuisine", ordre: 0 },
    { poste: "Serveur", shiftId: "matin-salle", ordre: 0 },
    { poste: "Caissier", shiftId: "caisse", ordre: 0 },
  ],
  polyvalences: [{ posteSource: "Chef de partie", posteCible: "Cuisinier" }],
  modeles: [],
  conges: [{ employeeId: "cuis-2", dateDebut: d("2026-07-08"), dateFin: d("2026-07-09") }],
  feries: [],
  existants: [],
  historique: [],
  options: {
    jours: [1, 2, 3, 4, 5, 6],
    nbParSemaine: 0,
    inclureFeries: false,
    utiliserModeles: true,
    ecraser: true,
    completer: true,
    autoriserDepassementHeures: false,
  },
};

describe("GOLDEN — brigade de référence, semaine du 6 juillet 2026", () => {
  it("produit un planning stable et explicable", () => {
    const r = genererPlanning(ENTREES);

    // Forme lisible : « jour | employé | shift », triée, pour que le diff soit parlant.
    const lignes = r.creneaux
      .map((c) => `${c.date.toISOString().slice(0, 10)} | ${c.employeeId} | ${c.shiftId}`)
      .sort();

    expect(lignes).toMatchSnapshot();
    expect({
      crees: r.rapport.crees,
      trous: r.rapport.trous.map((t) => `${t.date.toISOString().slice(0, 10)} ${t.shiftId}×${t.poste} manque ${t.manque} (${t.raison})`),
      sansShiftPoste: r.rapport.sansShiftPoste,
      depassements: r.rapport.depassements.length,
      sousHeures: r.rapport.sousHeures.map((s) => s.employeeId),
    }).toMatchSnapshot();
  });

  it("respecte les invariants, quoi qu'il arrive au reste du planning", () => {
    const r = genererPlanning(ENTREES);

    // Un seul shift par personne et par jour.
    const cles = r.creneaux.map((c) => `${c.employeeId}_${c.date.toISOString().slice(0, 10)}`);
    expect(new Set(cles).size).toBe(cles.length);

    // Jamais plus de 6 jours dans la semaine.
    for (const emp of BRIGADE) {
      const n = r.creneaux.filter((c) => c.employeeId === emp.id).length;
      expect(n, `${emp.nom} travaille ${n} jours`).toBeLessThanOrEqual(6);
    }

    // Aucun créneau pendant le congé de cuis-2.
    const pendantConge = r.creneaux.filter(
      (c) => c.employeeId === "cuis-2" && ["2026-07-08", "2026-07-09"].includes(c.date.toISOString().slice(0, 10)),
    );
    expect(pendantConge).toEqual([]);

    // Sans l'option de dépassement, aucun dépassement n'est engagé.
    expect(r.rapport.depassements).toEqual([]);
  });
});
```

- [ ] **Étape 2 : Générer les instantanés et les relire**

Lancer : `npx vitest run src/lib/planning-auto.golden.test.ts`
Attendu : PASS, avec `2 snapshots written`.

**Puis ouvrir `src/lib/__snapshots__/planning-auto.golden.test.ts.snap` et le LIRE.** Un instantané
généré sans être relu ne prouve rien : il fige ce que le code fait, pas ce qu'il devrait faire.
Vérifier que le planning obtenu est plausible pour une brigade de restaurant — les deux cuisiniers
couvrent le matin, le chef de partie prend le relais pendant le congé de `cuis-2`, la caissière est
sur la caisse, personne ne dépasse 6 jours. Si quelque chose choque, **c'est un défaut du moteur à
corriger**, pas un instantané à accepter.

- [ ] **Étape 3 : Vérifier le déterminisme**

Lancer deux fois : `npx vitest run src/lib/planning-auto.golden.test.ts`
Attendu : PASS les deux fois, sans `snapshots obsolete` ni écriture. Un golden non déterministe est
inutile.

- [ ] **Étape 4 : Commit**

```bash
git add src/lib/planning-auto.golden.test.ts src/lib/__snapshots__/planning-auto.golden.test.ts.snap
git commit -m "test(planning): golden d'une brigade de référence

Fige le planning d'une semaine réaliste (5 personnes, 4 shifts, besoins, congé,
polyvalence) pour rendre visible tout changement de comportement futur, y compris
non prévu. Doublé d'invariants qui, eux, ne doivent jamais bouger : un shift par
jour, 6 jours maximum, aucun créneau sur un congé, aucun dépassement sans option.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Tâche 8 : Brancher la server action sur le moteur

**Fichiers :**
- Modifier : `src/app/(app)/planning/actions.ts` (remplacer le corps de `genererPlanningAuto`, lignes ~49-372 ; ajouter les actions `ShiftPoste`)

**Interfaces :**
- Consomme : `genererPlanning`, `EntreesGeneration`, `RapportGeneration` (T2 → T6) ; modèle `ShiftPoste` (T1).
- Produit : `ResumeGeneration` (type de retour public, enrichi), `definirShiftPoste`, `supprimerShiftPoste` — consommés par T9.

- [ ] **Étape 1 : Remplacer le corps de `genererPlanningAuto`**

Dans `src/app/(app)/planning/actions.ts`, remplacer **tout** le bloc allant du commentaire
`/** Génère automatiquement le planning sur une période… */` jusqu'à la fin de la fonction
(accolade fermante avant `/** Affecte (ou efface) un shift en LOT`) par :

```ts
/** Résumé renvoyé au formulaire de génération. Reprend le rapport du moteur, enrichi des noms
 *  lisibles (le moteur ne connaît que des identifiants). */
export type ResumeGeneration = {
  crees: number;
  trous: { date: string; libelle: string; manque: number; raison: RaisonNonCouverture }[];
  sansShiftPoste: { nom: string; poste: string }[];
  depassements: { nom: string; heuresPlanifiees: number; heuresContractuelles: number }[];
  sousHeures: number;
};

/** Nombre de semaines d'historique lues pour l'équité (rotation des dimanches/fériés et des shifts). */
const SEMAINES_HISTORIQUE = 8;

/**
 * Génère automatiquement le planning sur une période. Ne fait plus que lire, appeler le moteur
 * (`src/lib/planning-auto.ts`, pur et testé) et écrire — toute la logique métier est là-bas.
 */
export async function genererPlanningAuto(
  debutIso: string,
  finIso: string,
  formData: FormData,
): Promise<ResumeGeneration> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const vide: ResumeGeneration = { crees: 0, trous: [], sansShiftPoste: [], depassements: [], sousHeures: 0 };
  const debut = new Date(debutIso + "T00:00:00.000Z");
  const fin = new Date(finIso + "T00:00:00.000Z");
  if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || debut > fin) return vide;

  const debutHistorique = new Date(debut.getTime() - SEMAINES_HISTORIQUE * 7 * 86_400_000);
  const veilleDebut = new Date(debut.getTime() - 86_400_000);

  const [employes, shiftsRows, feries, existants, historique, modeles, besoins, polyvalences, shiftsPoste, conges] =
    await Promise.all([
      prisma.employee.findMany({
        where: { actif: true },
        select: { id: true, nom: true, poste: true, secteur: true, heuresParJour: true, heuresHebdomadaires: true },
      }),
      prisma.shift.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
      prisma.jourFerie.findMany({ where: { date: { gte: debut, lte: fin } } }),
      prisma.planningCreneau.findMany({ where: { date: { gte: debut, lte: fin } }, select: { employeeId: true, date: true, shiftId: true } }),
      prisma.planningCreneau.findMany({ where: { date: { gte: debutHistorique, lte: veilleDebut } }, select: { employeeId: true, date: true, shiftId: true } }),
      formData.get("modeles") === "on" ? prisma.planningModele.findMany() : Promise.resolve([]),
      prisma.besoinShift.findMany(),
      prisma.polyvalencePoste.findMany(),
      prisma.shiftPoste.findMany({ orderBy: { ordre: "asc" } }),
      prisma.leaveRequest.findMany({
        where: { statut: "APPROUVE", dateDebut: { lte: fin }, dateFin: { gte: debut } },
        select: { employeeId: true, dateDebut: true, dateFin: true },
      }),
    ]);

  const shiftIdParam = String(formData.get("shiftId") ?? "").trim();
  const joursParam = formData.getAll("jours").map(Number).filter((n) => n >= 0 && n <= 6);

  const { creneaux, rapport } = genererPlanning({
    debut,
    fin,
    employes: employes.map((e) => ({
      id: e.id, nom: e.nom, poste: e.poste, secteur: e.secteur,
      heuresParJour: Number(e.heuresParJour), heuresHebdomadaires: Number(e.heuresHebdomadaires),
    })),
    shifts: shiftsRows.map((s) => ({
      id: s.id, nom: s.nom,
      dureeHeures: dureeShift({
        heureDebut: s.heureDebut, heureFin: s.heureFin,
        dureeHeures: s.dureeHeures == null ? null : Number(s.dureeHeures),
      }),
    })),
    besoins: besoins.map((b) => ({ shiftId: b.shiftId, poste: b.poste, jourSemaine: b.jourSemaine, nombreRequis: b.nombreRequis })),
    shiftsPoste: shiftsPoste.map((s) => ({ poste: s.poste, shiftId: s.shiftId, ordre: s.ordre })),
    polyvalences: polyvalences.map((p) => ({ posteSource: p.posteSource, posteCible: p.posteCible })),
    modeles: modeles.map((m) => ({ employeeId: m.employeeId, jour: m.jour, semaine: m.semaine, shiftId: m.shiftId })),
    conges: conges.map((c) => ({ employeeId: c.employeeId, dateDebut: c.dateDebut, dateFin: c.dateFin })),
    feries: feries.map((f) => f.date),
    existants,
    historique,
    options: {
      shiftId: shiftIdParam || undefined,
      jours: joursParam,
      nbParSemaine: Number(formData.get("nbParSemaine") ?? 0) || 0,
      inclureFeries: formData.get("inclureFeries") === "on",
      utiliserModeles: formData.get("modeles") === "on",
      ecraser: formData.get("ecraser") === "on",
      completer: formData.get("completer") === "on",
      autoriserDepassementHeures: formData.get("depassement") === "on",
    },
  });

  if (formData.get("ecraser") === "on") {
    await prisma.planningCreneau.deleteMany({ where: { date: { gte: debut, lte: fin } } });
  }
  if (creneaux.length > 0) {
    await prisma.planningCreneau.createMany({
      data: creneaux.map((c) => ({ ...c, genereAuto: true })),
      skipDuplicates: true,
    });
  }
  revalidatePath("/planning");

  // Identifiants → noms lisibles, uniquement pour l'affichage.
  const nomEmp = new Map(employes.map((e) => [e.id, e.nom]));
  const nomShift = new Map(shiftsRows.map((s) => [s.id, s.nom]));
  return {
    crees: rapport.crees,
    trous: rapport.trous.map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      libelle: `${t.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${nomShift.get(t.shiftId) ?? "shift"} × ${t.poste}`,
      manque: t.manque,
      raison: t.raison,
    })),
    sansShiftPoste: rapport.sansShiftPoste.map((s) => ({ nom: nomEmp.get(s.employeeId) ?? "—", poste: s.poste })),
    depassements: rapport.depassements.map((x) => ({
      nom: nomEmp.get(x.employeeId) ?? "—",
      heuresPlanifiees: x.heuresPlanifiees,
      heuresContractuelles: x.heuresContractuelles,
    })),
    sousHeures: rapport.sousHeures.length,
  };
}

/** Déclare qu'un poste peut tenir un shift, à la position donnée dans l'ordre de préférence. */
export async function definirShiftPoste(poste: string, shiftId: string, ordre: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const p = poste.trim();
  if (!p || !shiftId) return;
  await prisma.shiftPoste.upsert({
    where: { poste_shiftId: { poste: p, shiftId } },
    create: { poste: p, shiftId, ordre },
    update: { ordre },
  });
  revalidatePath("/planning");
}

/** Retire un shift de la liste des shifts acceptables d'un poste. */
export async function supprimerShiftPoste(id: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  await prisma.shiftPoste.delete({ where: { id } });
  revalidatePath("/planning");
}
```

- [ ] **Étape 2 : Ajouter les imports en tête de `actions.ts`**

```ts
import { genererPlanning, type RaisonNonCouverture } from "@/lib/planning-auto";
import { dureeShift } from "./creneaux";
```

Puis **supprimer** les imports devenus inutiles s'ils ne servent plus ailleurs dans le fichier
(`pariteSemaine` notamment). Vérifier avec `npx eslint "src/app/(app)/planning/actions.ts"`.

- [ ] **Étape 3 : Vérifier les types et le lint**

```bash
npx tsc --noEmit && npx eslint "src/app/(app)/planning/actions.ts"
```

Attendu : aucune erreur. `auto-planning-form.tsx` peut signaler une erreur de type sur
`ResumeGeneration` — c'est normal, T9 la corrige. **Si c'est le cas, ne pas commiter avant T9** :
enchaîner directement.

- [ ] **Étape 4 : Vérifier la taille du fichier**

Lancer : `wc -l "src/app/(app)/planning/actions.ts"`
Attendu : nettement sous les 676 lignes de départ (~400). Si le compte est resté proche de 676,
c'est que l'ancien algorithme n'a pas été supprimé — le relire et le retirer.

- [ ] **Étape 5 : Vérifier qu'aucune expression régulière sur les noms de shifts ne subsiste**

Lancer : `grep -n "matin cuisine\|matin/midi salle\|journée 8h-17h\|caissi" "src/app/(app)/planning/actions.ts"`
Attendu : aucune sortie. Ces correspondances vivent désormais en base (`ShiftPoste`).

---

### Tâche 9 : Interface — configuration des shifts par poste et rapport enrichi

**Fichiers :**
- Créer : `src/app/(app)/planning/shift-poste-manager.tsx`
- Modifier : `src/app/(app)/planning/page.tsx`
- Modifier : `src/app/(app)/planning/auto-planning-form.tsx`

**Interfaces :**
- Consomme : `definirShiftPoste`, `supprimerShiftPoste`, `ResumeGeneration` (T8).

- [ ] **Étape 1 : Créer le gestionnaire de shifts par poste**

Créer `src/app/(app)/planning/shift-poste-manager.tsx`, calqué sur `polyvalence-manager.tsx` pour
rester cohérent avec ses voisins de la même zone de configuration :

```tsx
"use client";

import { useState, useTransition } from "react";
import { definirShiftPoste, supprimerShiftPoste } from "./actions";

type ShiftPosteDTO = { id: string; poste: string; shiftId: string; ordre: number };

/** Shifts qu'un poste peut tenir, dans l'ordre de préférence. Sert à la génération automatique
 *  quand elle remplit chacun jusqu'à ses heures. */
export function ShiftPosteManager({
  postes,
  shifts,
  shiftsPoste,
}: {
  postes: string[];
  shifts: { id: string; nom: string }[];
  shiftsPoste: ShiftPosteDTO[];
}) {
  const [pending, startTransition] = useTransition();
  const [poste, setPoste] = useState("");
  const [shiftId, setShiftId] = useState("");

  const nomShift = new Map(shifts.map((s) => [s.id, s.nom]));
  const parPoste = new Map<string, ShiftPosteDTO[]>();
  for (const sp of [...shiftsPoste].sort((a, b) => a.ordre - b.ordre)) {
    parPoste.set(sp.poste, [...(parPoste.get(sp.poste) ?? []), sp]);
  }
  const postesSansShift = postes.filter((p) => !parPoste.has(p));

  const ajouter = () => {
    if (!poste || !shiftId) return;
    const ordre = (parPoste.get(poste) ?? []).length;
    startTransition(() => definirShiftPoste(poste, shiftId, ordre));
  };

  return (
    <details className="rounded-lg border bg-muted/20">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
        Shifts par poste{" "}
        <span className="font-normal text-muted-foreground">· {shiftsPoste.length} règle(s)</span>
        {postesSansShift.length > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {postesSansShift.length} poste(s) sans shift
          </span>
        )}
      </summary>
      <div className="space-y-3 p-4 pt-1">
        <p className="text-xs text-muted-foreground">
          Quand la génération automatique remplit chacun jusqu&apos;à ses heures, elle descend cette liste
          dans l&apos;ordre et prend le premier shift possible. <strong>Un poste sans shift déclaré n&apos;est
          pas rempli</strong> — le rapport de génération le signale plutôt que de poser un shift au hasard.
        </p>

        {postesSansShift.length > 0 && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Aucun shift déclaré pour : {postesSansShift.join(", ")}.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Le poste…
            <select value={poste} onChange={(e) => setPoste(e.target.value)} className="min-w-40 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">— choisir —</option>
              {postes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <span className="pb-2 text-muted-foreground">peut tenir</span>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            …le shift
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="min-w-40 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
              <option value="">— choisir —</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </label>
          <button onClick={ajouter} disabled={pending || !poste || !shiftId} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Ajouter
          </button>
        </div>

        {parPoste.size > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {[...parPoste.entries()].map(([p, liste]) => (
              <li key={p} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="font-medium">{p}</span>
                <span className="text-muted-foreground">:</span>
                {liste.map((sp, i) => (
                  <span key={sp.id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">
                    {i + 1}. {nomShift.get(sp.shiftId) ?? "shift"}
                    <button onClick={() => startTransition(() => supprimerShiftPoste(sp.id))} disabled={pending} className="opacity-70 hover:opacity-100" title="Retirer">✕</button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
```

- [ ] **Étape 2 : Charger et rendre le manager dans la page**

Dans `src/app/(app)/planning/page.tsx`, ajouter `prisma.shiftPoste.findMany()` au `Promise.all`
existant (celui qui lit `postesRows`, `besoinsRows`, `polyvalences`) :

```ts
  const [postesRows, besoinsRows, polyvalences, shiftsPosteRows] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, select: { poste: true }, distinct: ["poste"], orderBy: { poste: "asc" } }),
    prisma.besoinShift.findMany(),
    prisma.polyvalencePoste.findMany({ orderBy: [{ posteCible: "asc" }, { posteSource: "asc" }] }),
    prisma.shiftPoste.findMany({ orderBy: [{ poste: "asc" }, { ordre: "asc" }] }),
  ]);
```

Puis, dans `besoinsPanel`, ajouter le manager sous `PolyvalenceManager` :

```tsx
      <ShiftPosteManager
        postes={postesBesoin}
        shifts={shiftsBesoin}
        shiftsPoste={shiftsPosteRows.map((s) => ({ id: s.id, poste: s.poste, shiftId: s.shiftId, ordre: s.ordre }))}
      />
```

Et l'import en tête du fichier :

```ts
import { ShiftPosteManager } from "./shift-poste-manager";
```

- [ ] **Étape 3 : Ajouter la case « autoriser le dépassement » au formulaire**

Dans `src/app/(app)/planning/auto-planning-form.tsx`, ajouter dans le `<form>`, juste après la case
`ecraser` :

```tsx
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" name="depassement" value="on" className="mt-0.5" />
                <span>
                  <span className="font-medium">Autoriser le dépassement d&apos;heures</span> — pour couvrir
                  un besoin resté découvert faute de monde sous son plafond hebdomadaire. Engage des
                  heures supplémentaires : chaque dépassement est listé dans le rapport.
                </span>
              </label>
```

- [ ] **Étape 4 : Remplacer l'affichage du rapport**

Toujours dans `auto-planning-form.tsx`, remplacer le bloc conditionnel qui affiche `resume` par :

```tsx
              {resume && (
                <div className={`space-y-1.5 rounded-md border p-2 text-xs ${resume.trous.length > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
                  <p className="font-medium">{resume.crees} créneau(x) créé(s).</p>

                  {resume.trous.length === 0 && resume.crees > 0 && <p>Tous les besoins sont couverts ✅</p>}

                  {resume.trous.length > 0 && (
                    <div>
                      <p className="font-medium">{resume.trous.reduce((s, t) => s + t.manque, 0)} besoin(s) non couvert(s) :</p>
                      <ul className="ml-3 list-disc">
                        {resume.trous.slice(0, 6).map((t, i) => (
                          <li key={i}>{t.libelle} : manque {t.manque} — {LIBELLE_RAISON[t.raison]}</li>
                        ))}
                      </ul>
                      {resume.trous.length > 6 && <p className="italic">et {resume.trous.length - 6} autre(s).</p>}
                    </div>
                  )}

                  {resume.sansShiftPoste.length > 0 && (
                    <p>
                      {resume.sansShiftPoste.length} salarié(s) non planifié(s), faute de shift déclaré pour leur
                      poste : {resume.sansShiftPoste.slice(0, 4).map((s) => `${s.nom} (${s.poste})`).join(", ")}
                      {resume.sansShiftPoste.length > 4 ? "…" : ""}. À configurer dans « Shifts par poste ».
                    </p>
                  )}

                  {resume.depassements.length > 0 && (
                    <p className="font-medium">
                      ⚠ Heures supplémentaires engagées pour {resume.depassements.length} salarié(s) :{" "}
                      {resume.depassements.slice(0, 4).map((x) => `${x.nom} (${x.heuresPlanifiees} h au lieu de ${x.heuresContractuelles} h)`).join(", ")}
                      {resume.depassements.length > 4 ? "…" : ""}.
                    </p>
                  )}

                  {resume.sousHeures > 0 && <p>{resume.sousHeures} salarié(s) sous leurs heures hebdo (congés compris).</p>}
                </div>
              )}
```

Et ajouter en haut du fichier, sous les imports :

```tsx
const LIBELLE_RAISON: Record<ResumeGeneration["trous"][number]["raison"], string> = {
  AUCUN_TITULAIRE: "personne à ce poste, ni en polyvalence",
  EFFECTIF_INSUFFISANT: "tous les disponibles ont été posés, il en manquait encore",
  TOUS_EN_CONGE: "tous en congé",
  TOUS_DEJA_PRIS: "tous déjà pris ce jour-là",
  TOUS_AU_REPOS: "tous au repos obligatoire",
  TOUS_AU_PLAFOND: "tous au plafond d'heures — cochez « autoriser le dépassement » pour couvrir",
};
```

- [ ] **Étape 5 : Vérifier les types, le lint et la compilation**

```bash
npx tsc --noEmit && npx eslint "src/app/(app)/planning" && npm run build
```

Attendu : aucune erreur ; `✓ Compiled successfully`.

- [ ] **Étape 6 : Lancer la suite complète**

Lancer : `npm test`
Attendu : toutes vertes (714 de départ + ~24 nouvelles).

- [ ] **Étape 7 : Commit**

```bash
git add "src/app/(app)/planning"
git commit -m "feat(planning): branche la génération sur le moteur pur, et explique ses résultats

La server action ne fait plus que lire, appeler et écrire ; les 320 lignes
d'algorithme vivent dans src/lib/planning-auto.ts, testées.

Nouvel écran de configuration « Shifts par poste », à côté des besoins et de la
polyvalence, qui signale les postes sans shift déclaré. Case « autoriser le
dépassement d'heures », décochée par défaut. Le rapport de génération dit
désormais POURQUOI chaque besoin n'est pas couvert, nomme les salariés non
planifiés faute de configuration, et liste les heures supplémentaires engagées.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Étape 8 : Note de déploiement**

Ajouter à `docs/DEPLOIEMENT.md`, section des étapes ponctuelles :

```markdown
### Lot « génération de planning » (2026-08)

Après `prisma migrate deploy`, lancer **une fois** la reprise des correspondances poste → shift,
sinon la première génération n'attribuera plus aucun shift dans la passe complémentaire :

```bash
npx tsx scripts/reprise-shifts-poste.ts
```

Puis vérifier dans Planning → « Shifts par poste » qu'aucun poste ne reste sans shift déclaré.

**Attendu** : les plannings générés vont changer, à cause des règles de repos (1 jour par semaine,
6 jours consécutifs au maximum) qui n'existaient pas. Ne pas régénérer un mois déjà validé sans
l'avoir décidé.
```

```bash
git add docs/DEPLOIEMENT.md && git commit -m "docs(déploiement): étape de reprise des shifts par poste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Vérification finale

- [ ] `npm test` — suite complète verte
- [ ] `npx tsc --noEmit` — muet
- [ ] `npx eslint "src/app/(app)/planning" src/lib/planning-auto.ts` — muet
- [ ] `npm run build` — compile
- [ ] `grep -rn "matin cuisine\|journée 8h-17h" "src/app/(app)/planning/actions.ts"` — aucune sortie
- [ ] `wc -l "src/app/(app)/planning/actions.ts"` — nettement sous 676
- [ ] Relire `src/lib/__snapshots__/planning-auto.golden.test.ts.snap` : le planning figé est-il plausible pour une brigade de restaurant ?

## Ce que ce plan ne fait pas

- **Écart prévu / réalisé** (chantier B) et **ergonomie de la grille** (chantier C) : conceptions séparées, à venir.
- **Vérification à l'écran** : le `.env` du dépôt pointe sur la Supabase de production et
  l'authentification passe par elle. Les écrans de cette tâche ne peuvent pas être contrôlés
  visuellement sans toucher aux données réelles — `npm run build` et la suite de tests sont les
  seules garanties automatiques. Le contrôle visuel reste à faire par la Direction après
  déploiement.
