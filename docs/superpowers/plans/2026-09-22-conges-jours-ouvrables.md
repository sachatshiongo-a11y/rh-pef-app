# Congés — jours ouvrables saisis, solde de congé annuel seul — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur les deux formulaires de demande de congé (Direction et espace salarié), saisir un nombre de jours ouvrables et voir la date de fin se calculer — et faire du solde affiché le solde du seul congé annuel, décidé par une case sur le type de congé au lieu d'une liste de mots-clés.

**Architecture:** Un module pur `lib/jours-ouvrables.ts` porte les deux sens du calcul (dates → jours, jours → fin) et la règle de recalcul du formulaire ; le composant partagé `ChampsDatesConge` ne fait plus que l'afficher. Le serveur recalcule et refuse un écart. Le drapeau `TypeConge.compteDansSolde` remplace `MOTS_CONGES_NON_DEDUCTIBLES` ; la fonction `congeDeductibleDuSolde` se réduit à le lire, et les six écrans qui l'appellent passent une carte `nom → boolean` au lieu de `nom → tauxPct`.

**Tech Stack:** Next.js (App Router, server actions), Prisma + Postgres (Supabase), React 19, vitest (tests purs + Postgres embarqué via `creerBaseTest`), TypeScript strict.

**Spec :** `docs/superpowers/specs/2026-09-22-conges-jours-ouvrables-design.md`

## Global Constraints

- Dépôt `~/Projects/rh-pef-app`, branche `feat/conges-jours-ouvrables` (déjà créée, contient la spec).
- Jours **entiers** seulement ; le calcul exclut les **dimanches et jours fériés**, le samedi est ouvrable (usage RDC).
- Le serveur **recalcule** toujours `nbJours` depuis les dates et **refuse** un nombre soumis différent, avec le message exact : `Le nombre de jours ne correspond plus aux dates (12 saisis, 11 recalculés) — vérifiez la date de fin.`
- Libellé partout où le solde s'affiche : **« Solde de congé annuel »**.
- Migration : `prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.sql`, tables préfixées `"public".` comme les migrations existantes.
- Jamais `prisma migrate` contre la base réelle depuis ce plan : la migration est écrite, appliquée par le déploiement.
- Tests : `npx vitest run <fichier>` ; suite complète `npm test` (déjà bornée à 2 workers) ; `npm run typecheck` ; lint sur les fichiers touchés `npx eslint <fichiers>`.
- Messages de commit : conventionnels, en français, terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Pas d'outil de rendu React dans le dépôt (ni jsdom ni testing-library) : la logique du formulaire est testée comme **fonction pure** (`recalculerChampsConge`), pas par rendu.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| **Créer** `src/lib/jours-ouvrables.ts` | Les deux sens du calcul, la règle de recalcul du formulaire, le contrôle d'écart soumis/calculé. Aucune dépendance. |
| **Créer** `src/lib/jours-ouvrables.test.ts` | Tests purs de tout ce module. |
| Modifier `src/lib/payroll.ts` | `calculerJoursOuvrables` devient un réexport ; `congeDeductibleDuSolde` lit le drapeau ; `MOTS_CONGES_NON_DEDUCTIBLES` supprimée. |
| Modifier `src/lib/payroll.test.ts` | Remplace le bloc de tests de `congeDeductibleDuSolde`. |
| Modifier `src/lib/regles-contrats.ts` | `chargerTauxParTypeConge` → `chargerCompteDansSoldeParType`. |
| **Supprimer** `src/lib/conges.ts` | Doublon mort de `chargerTauxParTypeConge` (aucun import). |
| Modifier `src/components/champs-dates-conge.tsx` | Trois champs, état porté par le reducer. |
| Modifier `src/app/(app)/conges/actions.ts` | `demanderConge` : contrôle d'écart + `formulaireLisible`. |
| Modifier `src/app/(app)/conges/page.tsx` | Affiche `?erreur=` près du formulaire. |
| Modifier `src/app/espace/actions.ts` | `demanderMonConge` : contrôle d'écart. |
| **Créer** `src/app/(app)/conges/actions.integration.test.ts` | Preuve du refus serveur sur écart, Postgres embarqué. |
| Modifier `prisma/schema.prisma` | `TypeConge.compteDansSolde`. |
| **Créer** `prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.sql` | Colonne + `UPDATE` sur « annuel ». |
| **Créer** `prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.integration.test.ts` | Preuve du `UPDATE`. |
| Modifier les 6 appelants | `employes/[id]/page.tsx`, `employes/[id]/fiche/route.ts`, `conges/demande/[id]/route.ts`, `conges/calendrier.tsx`, `espace/page.tsx`, `espace/conges/page.tsx`. |
| Modifier `src/app/(app)/parametres/types-conges-admin.tsx`, `typeconge-actions.ts`, `page.tsx` | Case « Solde annuel ». |
| Modifier libellés | `espace/conges/page.tsx`, `espace/page.tsx`, `employes/[id]/page.tsx`. |

---

### Task 1 : le module `jours-ouvrables` — dates → jours, jours → fin

**Files:**
- Create: `src/lib/jours-ouvrables.ts`
- Create: `src/lib/jours-ouvrables.test.ts`
- Modify: `src/lib/payroll.ts:640-651` (remplacer la définition de `calculerJoursOuvrables` par un réexport)

**Interfaces:**
- Produces:
  - `compterJoursOuvrables(debut: Date, fin: Date, joursFeries?: Iterable<Date | string>): number`
  - `finApresJoursOuvrables(debut: Date, jours: number, joursFeries?: Iterable<Date | string>): Date | null`
  - `calculerJoursOuvrables` (dans `@/lib/payroll`) reste importable, même signature qu'avant.

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `src/lib/jours-ouvrables.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { compterJoursOuvrables, finApresJoursOuvrables } from "./jours-ouvrables";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

describe("compterJoursOuvrables — dimanches et fériés exclus (déplacé depuis payroll.ts)", () => {
  // Lundi 29 juin → dimanche 5 juillet 2026 : 7 jours calendaires, 1 dimanche.
  it("exclut les dimanches", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"))).toBe(6);
  });
  it("exclut aussi les jours fériés fournis (Date ou AAAA-MM-JJ)", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), [d("2026-06-30")])).toBe(5);
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), ["2026-06-30"])).toBe(5);
  });
  it("un férié tombant un dimanche n'est pas déduit deux fois", () => {
    expect(compterJoursOuvrables(d("2026-06-29"), d("2026-07-05"), [d("2026-07-05")])).toBe(6);
  });
  it("fin avant début → 0", () => {
    expect(compterJoursOuvrables(d("2026-07-05"), d("2026-06-29"))).toBe(0);
  });
});

describe("finApresJoursOuvrables — la date de fin pour N jours ouvrables à partir du début", () => {
  it("1 jour un lundi → ce lundi (début inclus)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 1))).toBe("2026-06-29");
  });
  it("6 jours un lundi → le samedi (le samedi est ouvrable)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 6))).toBe("2026-07-04");
  });
  it("7 jours un lundi → le lundi suivant (le dimanche est sauté)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 7))).toBe("2026-07-06");
  });
  it("début un dimanche, 1 jour → le lundi (le dimanche ne compte pas)", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-28"), 1))).toBe("2026-06-29");
  });
  it("férié en plein milieu → la fin recule d'un jour", () => {
    // 29 juin → 6 jours = 4 juillet sans férié ; avec le 30 juin férié, 6 jours = 6 juillet (lundi).
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 6, ["2026-06-30"]))).toBe("2026-07-06");
  });
  it("férié LE jour de début → non compté, la fin ne tombe jamais sur un férié", () => {
    expect(iso(finApresJoursOuvrables(d("2026-06-30"), 1, ["2026-06-30"]))).toBe("2026-07-01");
    expect(iso(finApresJoursOuvrables(d("2026-06-29"), 2, ["2026-06-30"]))).toBe("2026-07-01");
  });
  it("0 jour, jour négatif ou non entier → null", () => {
    expect(finApresJoursOuvrables(d("2026-06-29"), 0)).toBeNull();
    expect(finApresJoursOuvrables(d("2026-06-29"), -3)).toBeNull();
    expect(finApresJoursOuvrables(d("2026-06-29"), 1.5)).toBeNull();
  });
  it("aller-retour : compter(début, fin(début, n)) === n, sur 200 tirages avec fériés", () => {
    const feries = ["2026-06-30", "2026-08-01", "2026-12-25", "2027-01-01"];
    let graine = 42;
    const alea = (max: number) => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine % max; };
    for (let i = 0; i < 200; i++) {
      const debut = new Date(Date.UTC(2026, alea(12), 1 + alea(28)));
      const n = 1 + alea(40);
      const fin = finApresJoursOuvrables(debut, n, feries)!;
      expect(compterJoursOuvrables(debut, fin, feries), `${iso(debut)} + ${n} j`).toBe(n);
    }
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `cd ~/Projects/rh-pef-app && npx vitest run src/lib/jours-ouvrables.test.ts`
Expected: FAIL — `Cannot find module './jours-ouvrables'`.

- [ ] **Step 3 : écrire le module**

Créer `src/lib/jours-ouvrables.ts` :

```ts
/**
 * JOURS OUVRABLES — les deux sens du calcul, à un seul endroit.
 *
 * Règle de la paie et des congés (usage RDC) : le dimanche et les jours fériés ne sont pas
 * ouvrables ; le SAMEDI l'est (semaine de six jours). Toutes les dates sont manipulées en UTC à
 * minuit — c'est ainsi que les colonnes `@db.Date` reviennent de Prisma et que les `<input
 * type="date">` envoient leurs valeurs.
 *
 * Ce module ne dépend de RIEN : il est importé par les composants client (formulaire de congé)
 * comme par les actions serveur et la paie. La copie client de cette boucle, qui vivait dans
 * `components/champs-dates-conge.tsx`, a été supprimée le 2026-09-22 à son profit.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

function ensembleFeries(joursFeries: Iterable<Date | string>): Set<string> {
  return new Set([...joursFeries].map((d) => iso(d instanceof Date ? d : new Date(d))));
}

/** Vrai si ce jour compte : ni dimanche, ni férié. */
function estOuvrable(jour: Date, feries: Set<string>): boolean {
  return jour.getUTCDay() !== 0 && !feries.has(iso(jour));
}

/** Jours ouvrables entre deux dates, bornes incluses. 0 si `fin < debut`. */
export function compterJoursOuvrables(debut: Date, fin: Date, joursFeries: Iterable<Date | string> = []): number {
  const feries = ensembleFeries(joursFeries);
  let n = 0;
  const cur = new Date(debut);
  while (cur <= fin) {
    if (estOuvrable(cur, feries)) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

/**
 * La date de fin pour `jours` jours ouvrables à partir de `debut` (début inclus s'il est
 * ouvrable). La fin est le DERNIER jour compté : elle ne tombe jamais sur un dimanche ni un férié.
 * `null` si `jours` n'est pas un entier ≥ 1.
 */
export function finApresJoursOuvrables(debut: Date, jours: number, joursFeries: Iterable<Date | string> = []): Date | null {
  if (!Number.isInteger(jours) || jours < 1) return null;
  const feries = ensembleFeries(joursFeries);
  const cur = new Date(debut);
  let restants = jours;
  // Borne de sécurité : dix ans de calendrier. Les fériés sont finis, la boucle s'arrête bien
  // avant ; la borne évite qu'une entrée absurde ne tourne sans fin.
  for (let i = 0; i < 3660; i++) {
    if (estOuvrable(cur, feries)) {
      restants--;
      if (restants === 0) return new Date(cur);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return null;
}
```

- [ ] **Step 4 : lancer, vérifier le succès**

Run: `npx vitest run src/lib/jours-ouvrables.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5 : `calculerJoursOuvrables` de payroll.ts devient un réexport**

Dans `src/lib/payroll.ts`, remplacer les lignes 640-651 (les deux commentaires `/** … */` et la fonction) par :

```ts
/**
 * Jours ouvrables entre deux dates — déplacé dans `@/lib/jours-ouvrables` le 2026-09-22 (le module
 * porte aussi le sens inverse, jours → date de fin, pour le formulaire de congé). Réexporté ici
 * pour ses appelants historiques (paie, contrats).
 */
export { compterJoursOuvrables as calculerJoursOuvrables } from "@/lib/jours-ouvrables";
```

- [ ] **Step 6 : les tests historiques de payroll passent inchangés, et le type est bon**

Run: `npx vitest run src/lib/payroll.test.ts && npm run typecheck`
Expected: PASS (le bloc `calculerJoursOuvrables — dimanches et jours fériés exclus` reste vert sans modification) ; typecheck sans erreur.

- [ ] **Step 7 : commit**

```bash
git add src/lib/jours-ouvrables.ts src/lib/jours-ouvrables.test.ts src/lib/payroll.ts
git commit -m "feat(congés): module jours-ouvrables — dates → jours et jours → date de fin

Les deux sens du calcul à un seul endroit, sans dépendance, importable par le
client comme par le serveur. calculerJoursOuvrables (payroll) devient un réexport.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : la règle de recalcul du formulaire, fonction pure

**Files:**
- Modify: `src/lib/jours-ouvrables.ts` (ajouter en fin de fichier)
- Modify: `src/lib/jours-ouvrables.test.ts` (ajouter un `describe`)

**Interfaces:**
- Consumes: `compterJoursOuvrables`, `finApresJoursOuvrables` (Task 1).
- Produces:
  - `type ChampsConge = { debut: string; jours: string; fin: string; dernierTouche: "jours" | "fin" | null }` — chaînes telles que les `<input>` les portent (`AAAA-MM-JJ`, ou `""`).
  - `type ChampConge = "debut" | "jours" | "fin"`
  - `recalculerChampsConge(etat: ChampsConge, champ: ChampConge, valeur: string, feries: Set<string>): ChampsConge`
  - `CHAMPS_CONGE_VIDES: ChampsConge`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à `src/lib/jours-ouvrables.test.ts` :

```ts
import { recalculerChampsConge, CHAMPS_CONGE_VIDES, type ChampsConge } from "./jours-ouvrables";

describe("recalculerChampsConge — le dernier champ touché entre jours et fin a raison", () => {
  const feries = new Set(["2026-06-30"]);
  const depuis = (e: Partial<ChampsConge>): ChampsConge => ({ ...CHAMPS_CONGE_VIDES, ...e });

  it("je tape les jours → la fin se calcule", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29" }), "jours", "6", feries);
    expect(e).toEqual({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" });
  });
  it("je touche la fin → les jours se recalculent", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" }), "fin", "2026-07-04", feries);
    expect(e).toEqual({ debut: "2026-06-29", jours: "5", fin: "2026-07-04", dernierTouche: "fin" });
  });
  it("je change le début après avoir tapé des jours → la fin suit", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" }), "debut", "2026-07-06", feries);
    expect(e.fin).toBe("2026-07-11");
    expect(e.jours).toBe("6");
  });
  it("je change le début après avoir tapé une fin → les jours se recalculent", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29", jours: "5", fin: "2026-07-04", dernierTouche: "fin" }), "debut", "2026-07-01", feries);
    expect(e.jours).toBe("3");
    expect(e.fin).toBe("2026-07-04");
  });
  it("je change le début sans rien d'autre → rien ne se calcule", () => {
    const e = recalculerChampsConge(CHAMPS_CONGE_VIDES, "debut", "2026-06-29", feries);
    expect(e).toEqual({ debut: "2026-06-29", jours: "", fin: "", dernierTouche: null });
  });
  it("jours vides ou 0 → la fin s'efface", () => {
    const base = depuis({ debut: "2026-06-29", jours: "6", fin: "2026-07-06", dernierTouche: "jours" });
    expect(recalculerChampsConge(base, "jours", "", feries).fin).toBe("");
    expect(recalculerChampsConge(base, "jours", "0", feries).fin).toBe("");
  });
  it("fin avant début → les jours s'effacent (le formulaire ne s'enverra pas)", () => {
    const e = recalculerChampsConge(depuis({ debut: "2026-06-29" }), "fin", "2026-06-20", feries);
    expect(e.jours).toBe("");
    expect(e.fin).toBe("2026-06-20");
  });
  it("jours tapés sans début → rien ne se calcule, la valeur est gardée", () => {
    const e = recalculerChampsConge(CHAMPS_CONGE_VIDES, "jours", "4", feries);
    expect(e).toEqual({ debut: "", jours: "4", fin: "", dernierTouche: "jours" });
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `npx vitest run src/lib/jours-ouvrables.test.ts`
Expected: FAIL — `recalculerChampsConge` n'est pas exporté.

- [ ] **Step 3 : écrire le reducer**

Ajouter en fin de `src/lib/jours-ouvrables.ts` :

```ts
// ─────────────────────────────────────────────────────────────────────────────────────────────
// LE FORMULAIRE DE CONGÉ : début · jours ouvrables · fin, où le dernier champ touché entre
// « jours » et « fin » a raison. Fonction pure, testée sans rendu React : le composant
// `ChampsDatesConge` ne fait que l'appeler.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les trois champs tels que les `<input>` les portent : `AAAA-MM-JJ` ou `""`, jours en texte. */
export type ChampsConge = { debut: string; jours: string; fin: string; dernierTouche: "jours" | "fin" | null };
export type ChampConge = "debut" | "jours" | "fin";

export const CHAMPS_CONGE_VIDES: ChampsConge = { debut: "", jours: "", fin: "", dernierTouche: null };

const dateIso = (s: string): Date | null => {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const entier = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

function finDepuisJours(debut: string, jours: string, feries: Set<string>): string {
  const d = dateIso(debut);
  const n = entier(jours);
  if (!d || n === null) return "";
  const f = finApresJoursOuvrables(d, n, feries);
  return f ? iso(f) : "";
}

function joursDepuisFin(debut: string, fin: string, feries: Set<string>): string {
  const d = dateIso(debut);
  const f = dateIso(fin);
  if (!d || !f || f < d) return "";
  return String(compterJoursOuvrables(d, f, feries));
}

/**
 * Nouvel état après que l'utilisateur a touché `champ`.
 * - jours → la fin se calcule ; fin → les jours se recalculent ;
 * - début → si le dernier touché est « jours », la fin suit ; sinon, si une fin existe, les
 *   jours se recalculent ; sinon rien.
 */
export function recalculerChampsConge(etat: ChampsConge, champ: ChampConge, valeur: string, feries: Set<string>): ChampsConge {
  switch (champ) {
    case "jours":
      return { ...etat, jours: valeur, fin: finDepuisJours(etat.debut, valeur, feries), dernierTouche: "jours" };
    case "fin":
      return { ...etat, fin: valeur, jours: joursDepuisFin(etat.debut, valeur, feries), dernierTouche: "fin" };
    case "debut": {
      const suivant = { ...etat, debut: valeur };
      if (etat.dernierTouche === "jours" && etat.jours) return { ...suivant, fin: finDepuisJours(valeur, etat.jours, feries) };
      if (etat.fin) return { ...suivant, jours: joursDepuisFin(valeur, etat.fin, feries) };
      return suivant;
    }
  }
}
```

- [ ] **Step 4 : lancer, vérifier le succès**

Run: `npx vitest run src/lib/jours-ouvrables.test.ts && npm run typecheck`
Expected: PASS, 20 tests ; typecheck sans erreur.

- [ ] **Step 5 : commit**

```bash
git add src/lib/jours-ouvrables.ts src/lib/jours-ouvrables.test.ts
git commit -m "feat(congés): règle de recalcul du formulaire — le dernier champ touché a raison

Fonction pure, testée sans rendu : jours → fin, fin → jours, début → l'un ou
l'autre selon ce qui a été touché en dernier.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : le composant partagé rend trois champs

**Files:**
- Modify: `src/components/champs-dates-conge.tsx` (réécriture complète)

**Interfaces:**
- Consumes: `recalculerChampsConge`, `CHAMPS_CONGE_VIDES` (Task 2).
- Produces: le composant `ChampsDatesConge` garde ses props (`feries`, `inputClassName`, `min`, `labelDebut`, `labelFin`) et rend désormais **trois** cellules sœurs : `dateDebut`, `nbJours`, `dateFin`. Les deux formulaires (`(app)/conges/page.tsx:134`, `espace/conges/page.tsx:82`) ne changent pas — leur grille absorbe une cellule de plus.

- [ ] **Step 1 : réécrire le composant**

Remplacer tout le contenu de `src/components/champs-dates-conge.tsx` par :

```tsx
"use client";

import { useState } from "react";
import { recalculerChampsConge, CHAMPS_CONGE_VIDES, type ChampConge } from "@/lib/jours-ouvrables";

/**
 * Les trois champs d'une demande de congé — Date début · Jours ouvrables · Date fin — avec
 * recalcul EN DIRECT : les jours et la fin se recalculent l'un l'autre, le dernier touché a
 * raison (règle dans `lib/jours-ouvrables`, testée là-bas). Partagé entre le formulaire Direction
 * et l'espace salarié. Rend trois cellules sœurs (fragment) : s'insère tel quel dans la grille.
 *
 * Le serveur recalcule les jours depuis les dates et refuse un écart : ce composant aide à saisir,
 * il ne décide de rien.
 */
export function ChampsDatesConge({
  feries,
  inputClassName,
  min,
  labelDebut = "Date début",
  labelFin = "Date fin",
}: {
  feries: string[]; // jours fériés au format AAAA-MM-JJ
  inputClassName: string;
  min?: string; // date minimale (ex. aujourd'hui, côté salarié)
  labelDebut?: string;
  labelFin?: string;
}) {
  const [etat, setEtat] = useState(CHAMPS_CONGE_VIDES);
  const feriesSet = new Set(feries);
  const toucher = (champ: ChampConge) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEtat((s) => recalculerChampsConge(s, champ, e.target.value, feriesSet));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateDebut" className="text-sm font-medium">{labelDebut}</label>
        <input id="dateDebut" name="dateDebut" type="date" required min={min} value={etat.debut} onChange={toucher("debut")} className={inputClassName} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="nbJours" className="text-sm font-medium">Jours ouvrables</label>
        <input id="nbJours" name="nbJours" type="number" inputMode="numeric" required min={1} step={1} value={etat.jours} onChange={toucher("jours")} className={inputClassName} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dateFin" className="text-sm font-medium">{labelFin}</label>
        <input id="dateFin" name="dateFin" type="date" required min={etat.debut || min} value={etat.fin} onChange={toucher("fin")} className={inputClassName} />
        <p className="text-xs text-muted-foreground">Dimanches et jours fériés exclus.</p>
      </div>
    </>
  );
}
```

- [ ] **Step 2 : typecheck et lint**

Run: `npm run typecheck && npx eslint src/components/champs-dates-conge.tsx`
Expected: aucune erreur (les avertissements préexistants du dépôt ne concernent pas ce fichier).

- [ ] **Step 3 : vérifier à l'écran**

Lancer le serveur de développement (`npm run dev`, ou via le navigateur intégré), ouvrir `/conges`, déplier « + Nouvelle demande de congé » : taper un début, taper `6` jours → la fin s'affiche ; modifier la fin → les jours changent ; modifier le début → la fin suit. Refaire dans l'espace salarié (`/espace/conges`) si un compte salarié de test existe. Ne pas envoyer le formulaire (le serveur n'est pas encore adapté, Task 4).

- [ ] **Step 4 : commit**

```bash
git add src/components/champs-dates-conge.tsx
git commit -m "feat(congés): le formulaire saisit les jours ouvrables, la fin se calcule

Trois champs au lieu de deux, sur les deux formulaires (composant partagé). La
copie client de la boucle de jours ouvrables disparaît au profit du module.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : le serveur refuse un écart entre jours soumis et jours recalculés

**Files:**
- Modify: `src/lib/jours-ouvrables.ts` (ajouter `ecartJoursSoumis`)
- Modify: `src/lib/jours-ouvrables.test.ts` (ajouter un `describe`)
- Modify: `src/app/(app)/conges/actions.ts:21-33` (`demanderConge`)
- Modify: `src/app/(app)/conges/page.tsx:25-31` et `:96-99` (afficher `?erreur=`)
- Modify: `src/app/espace/actions.ts:59-71` (`demanderMonConge`)
- Create: `src/app/(app)/conges/actions.integration.test.ts`

**Interfaces:**
- Produces: `ecartJoursSoumis(soumis: FormDataEntryValue | null, calcule: number): string | null` — `null` si cohérent (ou champ absent), sinon le message d'erreur exact.

- [ ] **Step 1 : test pur du message d'écart**

Ajouter à `src/lib/jours-ouvrables.test.ts` :

```ts
import { ecartJoursSoumis } from "./jours-ouvrables";

describe("ecartJoursSoumis — le serveur refuse un nombre qui ne colle plus aux dates", () => {
  it("cohérent → pas d'erreur", () => {
    expect(ecartJoursSoumis("11", 11)).toBeNull();
  });
  it("champ absent ou vide → pas d'erreur (le serveur fait foi)", () => {
    expect(ecartJoursSoumis(null, 11)).toBeNull();
    expect(ecartJoursSoumis("", 11)).toBeNull();
  });
  it("écart → le message dit les deux nombres et quoi faire", () => {
    expect(ecartJoursSoumis("12", 11)).toBe(
      "Le nombre de jours ne correspond plus aux dates (12 saisis, 11 recalculés) — vérifiez la date de fin.",
    );
  });
  it("valeur non numérique → traitée comme un écart", () => {
    expect(ecartJoursSoumis("douze", 11)).toContain("ne correspond plus aux dates");
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `npx vitest run src/lib/jours-ouvrables.test.ts`
Expected: FAIL — `ecartJoursSoumis` n'est pas exporté.

- [ ] **Step 3 : écrire la fonction**

Ajouter en fin de `src/lib/jours-ouvrables.ts` :

```ts
/**
 * Contrôle serveur : le nombre de jours SOUMIS par le formulaire doit être celui que le serveur
 * recalcule depuis les dates. Un écart n'est pas corrigé en silence — c'est un signal (fériés
 * chargés partiellement côté client, formulaire resté ouvert la veille d'un férié ajouté), et
 * enregistrer un nombre différent de celui affiché est ce qu'un utilisateur ne pardonne pas.
 * Champ absent ou vide : aucun contrôle, le serveur fait foi (anciens formulaires).
 */
export function ecartJoursSoumis(soumis: FormDataEntryValue | null, calcule: number): string | null {
  const texte = String(soumis ?? "").trim();
  if (texte === "") return null;
  if (/^\d+$/.test(texte) && Number(texte) === calcule) return null;
  return `Le nombre de jours ne correspond plus aux dates (${texte} saisis, ${calcule} recalculés) — vérifiez la date de fin.`;
}
```

- [ ] **Step 4 : lancer, vérifier le succès**

Run: `npx vitest run src/lib/jours-ouvrables.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5 : `demanderConge` (Direction) — contrôle + erreur lisible**

Dans `src/app/(app)/conges/actions.ts` :

Ajouter aux imports :
```ts
import { ecartJoursSoumis } from "@/lib/jours-ouvrables";
import { formulaireLisible } from "@/lib/erreur-formulaire";
```

Remplacer l'en-tête de `demanderConge` (de `export async function demanderConge` jusqu'à la ligne `const remplacantId = …` incluse) par :

```ts
export async function demanderConge(formData: FormData) {
  return formulaireLisible("/conges", async () => {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const employeeId = String(formData.get("employeeId"));
  const type = String(formData.get("type"));
  const dateDebut = new Date(String(formData.get("dateDebut")));
  const dateFin = new Date(String(formData.get("dateFin")));
  if (Number.isNaN(dateDebut.getTime()) || Number.isNaN(dateFin.getTime())) throw new Error("Dates requises.");
  if (dateFin < dateDebut) throw new Error("La date de fin doit être après la date de début.");
  // Jours ouvrables : dimanches ET jours fériés exclus du décompte.
  const feries = await prisma.jourFerie.findMany({ where: { date: { gte: dateDebut, lte: dateFin } }, select: { date: true } });
  const nbJours = calculerJoursOuvrables(dateDebut, dateFin, feries.map((f) => f.date));
  if (nbJours <= 0) throw new Error("La période ne contient aucun jour ouvrable (dimanches et fériés exclus).");
  // Le formulaire a affiché un nombre : il doit être celui-ci, sinon on refuse plutôt que d'enregistrer autre chose.
  const ecart = ecartJoursSoumis(formData.get("nbJours"), nbJours);
  if (ecart) throw new Error(ecart);
  const motif = String(formData.get("motif") ?? "").trim() || null;
  const remplacantId = String(formData.get("remplacantId") ?? "").trim() || null;
```

Puis, à la **fin** de la fonction, les trois `revalidatePath` qui la closent (lignes 62-65, juste avant le commentaire `/** Seuls les comptes Admin … */` d'`approuverConge`) :

```ts
  revalidatePath("/conges");
  revalidatePath("/employes");
  revalidatePath("/", "layout");
}
```
deviennent :
```ts
  revalidatePath("/conges");
  revalidatePath("/employes");
  revalidatePath("/", "layout");
  });
}
```

Puis réindenter le corps de deux espaces (`npx eslint --fix "src/app/(app)/conges/actions.ts"` ne réindente pas : le faire à la main ou avec l'éditeur — la lisibilité compte, c'est un fichier relu).

- [ ] **Step 6 : la page `/conges` affiche l'erreur**

Dans `src/app/(app)/conges/page.tsx` :

Ligne 28, le type de `searchParams` : ajouter `erreur?: string` :
```ts
  searchParams: Promise<{ statut?: string; type?: string; q?: string; vue?: string; erreur?: string } & SPCalendrier>;
```

Juste après `<div className="border-t p-5">` (ligne 98) et avant `<form action={demanderConge}`, insérer :
```tsx
          {sp.erreur && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>
          )}
```

Et pour que le `<details>` soit **ouvert** quand une erreur revient (sinon le message est caché dans le repli), ligne 96 :
```tsx
        <details open={!!sp.erreur} className="mb-6 rounded-xl border">
```

- [ ] **Step 7 : `demanderMonConge` (salarié) — contrôle**

Dans `src/app/espace/actions.ts`, ajouter à l'import :
```ts
import { ecartJoursSoumis } from "@/lib/jours-ouvrables";
```
et, dans `demanderMonConge`, juste après la ligne
`if (nbJours <= 0) throw new Error("La période ne contient aucun jour ouvrable (dimanches et fériés exclus).");`
insérer :
```ts
    const ecart = ecartJoursSoumis(formData.get("nbJours"), nbJours);
    if (ecart) throw new Error(ecart);
```
(La page `/espace/conges` affiche déjà `?erreur=`, ligne 67.)

- [ ] **Step 8 : test d'intégration du refus serveur (Direction)**

Créer `src/app/(app)/conges/actions.integration.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le serveur reste juge : une demande dont le nombre de jours soumis ne colle plus aux dates est
// REFUSÉE avec un message lisible, jamais enregistrée avec un autre nombre en silence.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
// MANAGER, pas ADMIN : pas d'auto-approbation, donc pas de codes de présence à poser dans ce test.
const A = vi.hoisted(() => ({ user: { id: "seed", role: "MANAGER", nom: "Testeur" } }));
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
// `formulaireLisible` redirige vers `/conges?erreur=…` : on capture l'URL au lieu de naviguer.
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

const { demanderConge } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let empId: string;

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const e = await prisma.employee.create({
    data: {
      matricule: "TT02-PEF", nom: "Test Écart", sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle",
      categorie: "BRIGADE", salaireMensuel: 100, dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  empId = e.id;
  // Le 30 juin est férié (indépendance) : 29 juin → 4 juillet = 5 jours ouvrables, pas 6.
  await prisma.jourFerie.create({ data: { date: new Date("2026-06-30"), designation: "Indépendance", annee: 2026 } });
}, 120_000);

afterAll(async () => { await fermer(); });

describe("demanderConge — cohérence jours soumis / jours recalculés", () => {
  it("enregistre une demande dont le nombre soumis est celui recalculé (5 j du 29/06 au 04/07, férié le 30)", async () => {
    await demanderConge(fd({ employeeId: empId, type: "Congé annuel", dateDebut: "2026-06-29", dateFin: "2026-07-04", nbJours: "5" }));
    const d = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: empId } });
    expect(Number(d.nbJours)).toBe(5);
    expect(d.statut).toBe("EN_ATTENTE");
  });

  it("refuse un nombre soumis différent, avec le message attendu, et n'enregistre rien", async () => {
    const avant = await prisma.leaveRequest.count({ where: { employeeId: empId } });
    await expect(
      demanderConge(fd({ employeeId: empId, type: "Congé annuel", dateDebut: "2026-07-06", dateFin: "2026-07-11", nbJours: "7" })),
    ).rejects.toThrow(/REDIRECT \/conges\?erreur=.*ne%20correspond%20plus/);
    expect(await prisma.leaveRequest.count({ where: { employeeId: empId } })).toBe(avant);
  });

  it("sans champ nbJours (ancien formulaire), le serveur fait foi et enregistre", async () => {
    await demanderConge(fd({ employeeId: empId, type: "Congé annuel", dateDebut: "2026-08-03", dateFin: "2026-08-08" }));
    const d = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: empId, dateDebut: new Date("2026-08-03") } });
    expect(Number(d.nbJours)).toBe(6);
  });
});
```

- [ ] **Step 9 : lancer, vérifier le succès**

Run: `npx vitest run "src/app/(app)/conges/actions.integration.test.ts" src/lib/jours-ouvrables.test.ts && npm run typecheck`
Expected: PASS (3 tests d'intégration, 24 purs) ; typecheck sans erreur.

Si le premier test échoue sur un champ manquant de `employee.create`, reprendre exactement le `baseEmp` de `src/lib/conges-couverture.integration.test.ts:31-34`.

- [ ] **Step 10 : vérifier à l'écran**

Sur `/conges` : envoyer une demande normale → enregistrée. Puis, dans l'outil de développement du navigateur, modifier la valeur du champ `nbJours` après l'avoir calculé (ou saisir une fin puis retaper des jours qui ne collent pas) et envoyer → le repli s'ouvre avec le message rouge, rien n'est enregistré.

- [ ] **Step 11 : commit**

```bash
git add src/lib/jours-ouvrables.ts src/lib/jours-ouvrables.test.ts "src/app/(app)/conges/actions.ts" "src/app/(app)/conges/page.tsx" src/app/espace/actions.ts "src/app/(app)/conges/actions.integration.test.ts"
git commit -m "feat(congés): le serveur refuse un nombre de jours qui ne colle plus aux dates

Direction et salarié : le nombre soumis doit être celui recalculé, sinon refus
avec un message qui dit les deux nombres. Le formulaire Direction passe par
formulaireLisible et la page /conges affiche l'erreur, repli ouvert.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : le drapeau `compteDansSolde` — schéma, migration, règle, et ses six appelants

**Files:**
- Modify: `prisma/schema.prisma:426-437` (`model TypeConge`)
- Create: `prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.sql`
- Modify: `src/lib/payroll.ts:618-638`
- Modify: `src/lib/payroll.test.ts:341-365`
- Modify: `src/lib/regles-contrats.ts:85-93`
- Delete: `src/lib/conges.ts`
- Modify: `src/app/(app)/employes/[id]/page.tsx:31,130-146,300-306`
- Modify: `src/app/(app)/employes/[id]/fiche/route.ts:7,28-39,53-56`
- Modify: `src/app/(app)/conges/demande/[id]/route.ts:7,33-48`
- Modify: `src/app/(app)/conges/calendrier.tsx:6,105-122,151`
- Modify: `src/app/espace/page.tsx:6,35-43`
- Modify: `src/app/espace/conges/page.tsx:4,26-29,41`

**Interfaces:**
- Produces:
  - `TypeConge.compteDansSolde: boolean` (Prisma).
  - `chargerCompteDansSoldeParType(): Promise<Map<string, boolean>>` dans `@/lib/regles-contrats` (remplace `chargerTauxParTypeConge`).
  - `congeDeductibleDuSolde(compteDansSolde: boolean | undefined): boolean` dans `@/lib/payroll` — **un seul paramètre** (la spec écrivait `(type, compteDansSolde)` ; le nom du type ne sert plus à rien, on ne garde pas un paramètre mort).

Tout ce task se commite **en une fois** : changer la signature sans ses appelants laisserait le typecheck rouge entre deux commits.

- [ ] **Step 1 : remplacer les tests de `congeDeductibleDuSolde`**

Dans `src/lib/payroll.test.ts`, remplacer tout le bloc `describe("congeDeductibleDuSolde (déductibilité du solde de congés payés)", …)` (lignes 341 jusqu'à la `});` qui le ferme, vers la ligne 365) par :

```ts
describe("congeDeductibleDuSolde — la case sur le type décide, rien d'autre (2026-09-22)", () => {
  it("type coché → déduit du solde de congé annuel", () => {
    expect(congeDeductibleDuSolde(true)).toBe(true);
  });
  it("type décoché → non déduit, quel que soit son nom", () => {
    // Un « Congé annuel » décoché ne compte pas : la case prime sur le nom.
    expect(congeDeductibleDuSolde(false)).toBe(false);
  });
  it("type inconnu de la table (LeaveRequest.type est du texte libre) → non déduit", () => {
    expect(congeDeductibleDuSolde(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `npx vitest run src/lib/payroll.test.ts`
Expected: FAIL — `congeDeductibleDuSolde(true)` retourne `true` par hasard mais `congeDeductibleDuSolde(false)` retourne `true` (l'ancienne règle ne lit pas un booléen). Au moins un test rouge.

- [ ] **Step 3 : le schéma et la migration**

Dans `prisma/schema.prisma`, `model TypeConge`, ajouter après `actif`:
```prisma
  // Seul(s) type(s) déduit(s) du solde de congé annuel — décidé ici, dans Paramètres, jamais par
  // le nom du type. Coché à la migration pour tout type dont le nom contient « annuel ».
  compteDansSolde Boolean @default(false)
```

Créer `prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.sql` :
```sql
-- Le solde de congé ne compte que le congé annuel : une case sur le type de congé remplace la
-- reconnaissance par mots-clés (matern/patern/naiss/enfant/maladie/accident) du code.

-- AlterTable
ALTER TABLE "public"."TypeConge" ADD COLUMN "compteDansSolde" BOOLEAN NOT NULL DEFAULT false;

-- Reproduit l'intention d'aujourd'hui sans rien deviner d'autre : le congé annuel se déduit.
-- Si aucun type ne contient « annuel », rien n'est coché — la Direction coche le bon dans Paramètres.
UPDATE "public"."TypeConge" SET "compteDansSolde" = true WHERE lower("nom") LIKE '%annuel%';
```

Run: `npx prisma generate`
Expected: client régénéré, `compteDansSolde` disponible dans les types.

- [ ] **Step 4 : la règle**

Dans `src/lib/payroll.ts`, remplacer les lignes 618-638 (le commentaire sur les mots-clés, la constante `MOTS_CONGES_NON_DEDUCTIBLES`, le bloc `/** … */` et la fonction) par :

```ts
/**
 * Un congé de ce type se déduit-il du solde de congé annuel ? C'est la case `compteDansSolde` du
 * `TypeConge` qui le dit (Paramètres → Types de congé), et rien d'autre — plus de reconnaissance
 * par mots-clés sur le nom, plus de règle « taux à 0 % ». `undefined` = type absent de la table
 * (`LeaveRequest.type` est du texte libre) → ne compte pas.
 */
export function congeDeductibleDuSolde(compteDansSolde: boolean | undefined): boolean {
  return compteDansSolde === true;
}
```

- [ ] **Step 5 : le helper qui charge la carte**

Dans `src/lib/regles-contrats.ts`, remplacer les lignes 85-93 (commentaire + `chargerTauxParTypeConge`) par :

```ts
/**
 * `TypeConge.compteDansSolde` par nom, pour résoudre la déductibilité d'une demande de congé
 * (`congeDeductibleDuSolde`, dans `@/lib/payroll`) : `LeaveRequest.type` est un texte libre (pas de
 * FK stricte vers `TypeConge`, cf. schéma), donc on résout la case par nom au moment du calcul.
 */
export async function chargerCompteDansSoldeParType(): Promise<Map<string, boolean>> {
  const types = await prisma.typeConge.findMany({ select: { nom: true, compteDansSolde: true } });
  return new Map(types.map((t) => [t.nom, t.compteDansSolde]));
}
```

Supprimer `src/lib/conges.ts` (doublon de l'ancien helper, importé par personne — vérifier : `grep -rn 'from "@/lib/conges"' src` doit ne rien renvoyer) :
```bash
git rm src/lib/conges.ts
```

- [ ] **Step 6 : les cinq appelants du helper**

Dans chacun des cinq fichiers ci-dessous, trois remplacements textuels — l'import, le nom de la variable du `Promise.all`, l'appel :

1. `import { typeSansConges, chargerTauxParTypeConge } from "@/lib/regles-contrats";`
   → `import { typeSansConges, chargerCompteDansSoldeParType } from "@/lib/regles-contrats";`
2. dans la destructuration du `Promise.all` : `tauxParType` → `compteParType` ; dans la liste des promesses : `chargerTauxParTypeConge(),` → `chargerCompteDansSoldeParType(),`
3. `congeDeductibleDuSolde(l.type, tauxParType.get(l.type))` → `congeDeductibleDuSolde(compteParType.get(l.type))` (dans `calendrier.tsx` la variable de boucle est `d`, pas `l`).

Fichiers et lignes :
- `src/app/(app)/employes/[id]/page.tsx` : import ligne 31 ; `const [attendances, leaveRequests, payrollLines, tauxParType]` ligne 130 ; `chargerTauxParTypeConge(),` ligne 145 ; appel ligne 304.
- `src/app/(app)/employes/[id]/fiche/route.ts` : import ligne 7 ; destructuration ligne 28 ; promesse ligne 38 ; appel ligne 55.
- `src/app/(app)/conges/demande/[id]/route.ts` : import ligne 7 ; `const [approuvees, tauxParType]` ligne 33 ; promesse ligne 41 ; appel ligne 47. Remplacer aussi le commentaire des lignes 43-45 par :
  ```ts
  // Seuls les types cochés « compte dans le solde » (Paramètres) entament le solde de congé annuel.
  ```
- `src/app/(app)/conges/calendrier.tsx` : import ligne 6 ; destructuration ligne 105 (dernier élément) ; promesse ligne 121 ; appel ligne 151 : `if (!congeDeductibleDuSolde(compteParType.get(d.type))) continue;`.
- `src/app/espace/page.tsx` : import ligne 6 ; `const [congesAnnee, tauxParType]` ligne 35 ; promesse ligne 40 ; appel ligne 43.

- [ ] **Step 7 : le sixième appelant, qui charge lui-même les types**

`src/app/espace/conges/page.tsx` interroge `typeConge` lui-même (il a besoin de la liste pour le `<select>`). Ligne 26 :
```ts
    prisma.typeConge.findMany({ where: { actif: true }, orderBy: { ordre: "asc" }, select: { nom: true, compteDansSolde: true } }),
```
Ligne 29 :
```ts
  const compteParType = new Map(typesConges.map((t) => [t.nom, t.compteDansSolde]));
```
Ligne 41 :
```ts
        congeDeductibleDuSolde(compteParType.get(l.type))
```
Ligne 4 : l'import de `congeDeductibleDuSolde` reste tel quel.

- [ ] **Step 8 : vérifier**

Run: `npm run typecheck && npx vitest run src/lib/payroll.test.ts && grep -rn "tauxParType\|chargerTauxParTypeConge\|MOTS_CONGES_NON_DEDUCTIBLES" src`
Expected: typecheck sans erreur ; payroll.test.ts PASS ; le `grep` ne renvoie **rien**.

- [ ] **Step 9 : commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.sql src/lib/payroll.ts src/lib/payroll.test.ts src/lib/regles-contrats.ts "src/app/(app)/employes/[id]/page.tsx" "src/app/(app)/employes/[id]/fiche/route.ts" "src/app/(app)/conges/demande/[id]/route.ts" "src/app/(app)/conges/calendrier.tsx" src/app/espace/page.tsx src/app/espace/conges/page.tsx
git commit -m "feat(congés): le solde ne compte que les types cochés « compte dans le solde »

TypeConge.compteDansSolde remplace la liste de mots-clés et la règle « taux à
0 % ». La migration coche tout type dont le nom contient « annuel ». Les six
écrans qui calculent le solde passent la case au lieu du taux.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : la case dans Paramètres → Types de congé

**Files:**
- Modify: `src/app/(app)/parametres/types-conges-admin.tsx`
- Modify: `src/app/(app)/parametres/typeconge-actions.ts:19-30,38-49`
- Modify: `src/app/(app)/parametres/page.tsx:51`

**Interfaces:**
- Consumes: `TypeConge.compteDansSolde` (Task 5).
- Produces: `TypeCongeRow.compteDansSolde: boolean`.

- [ ] **Step 1 : la ligne de données**

Dans `src/app/(app)/parametres/types-conges-admin.tsx`, type `TypeCongeRow` : ajouter `compteDansSolde: boolean;` après `tauxPct`.

Dans `src/app/(app)/parametres/page.tsx` ligne 51, ajouter `compteDansSolde: t.compteDansSolde` dans l'objet :
```ts
  const typeCongeRows: TypeCongeRow[] = typesConges.map((t) => ({ id: t.id, nom: t.nom, joursPayes: t.joursPayes, tauxPct: t.tauxPct, compteDansSolde: t.compteDansSolde, systeme: t.systeme, actif: t.actif }));
```

- [ ] **Step 2 : les actions lisent la case**

Dans `src/app/(app)/parametres/typeconge-actions.ts`, dans `creerTypeConge` et dans `modifierTypeConge`, ajouter dans `data:` après `tauxPct: …,` :
```ts
      compteDansSolde: formData.get("compteDansSolde") === "on",
```
(Une case décochée n'envoie rien : `=== "on"` donne bien `false`.)

- [ ] **Step 3 : le tableau**

Dans `types-conges-admin.tsx` :

En-tête, après `<th className="py-2 text-center">Taux %</th>` :
```tsx
              <th className="py-2 text-center">Solde annuel</th>
```

Dans le `<form>` d'édition de chaque ligne, après l'input `tauxPct` et avant le bouton Enregistrer :
```tsx
                    <label className="flex items-center gap-1 text-xs" title="Ce type se déduit du solde de congé annuel">
                      <input type="checkbox" name="compteDansSolde" defaultChecked={t.compteDansSolde} />
                      solde
                    </label>
```

Colonne d'affichage, après la cellule `{t.tauxPct ?? …}` :
```tsx
                <td className="py-1.5 text-center">{t.compteDansSolde ? <span className="font-medium text-emerald-700">✓</span> : <span className="text-muted-foreground">—</span>}</td>
```

Formulaire de création, après l'input `tauxPct` :
```tsx
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="compteDansSolde" /> Compte dans le solde</label>
```

Texte d'aide, remplacer le `<p className="text-xs text-muted-foreground">…</p>` final par :
```tsx
      <p className="text-xs text-muted-foreground">
        Jours payés / taux laissés vides = <span className="font-medium text-amber-600">À valider</span> par un
        comptable-juriste (non appliqués en paie tant que non renseignés). Seuls les types cochés
        « Solde annuel » se déduisent du solde de congé annuel ; les autres restent demandables.
      </p>
```

- [ ] **Step 4 : vérifier**

Run: `npm run typecheck && npx eslint "src/app/(app)/parametres/types-conges-admin.tsx" "src/app/(app)/parametres/typeconge-actions.ts" "src/app/(app)/parametres/page.tsx"`
Expected: sans erreur.

À l'écran (`/parametres`, section Types de congé) : cocher « solde » sur un type, Enregistrer, recharger → coche visible ; créer un type avec la case cochée → coche visible ; décocher, Enregistrer → tiret.

- [ ] **Step 5 : commit**

```bash
git add "src/app/(app)/parametres/types-conges-admin.tsx" "src/app/(app)/parametres/typeconge-actions.ts" "src/app/(app)/parametres/page.tsx"
git commit -m "feat(paramètres): case « Solde annuel » sur les types de congé

La Direction décide quels types se déduisent du solde, dans l'écran qu'elle
utilise déjà — plus jamais dans le code.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : « Solde de congé annuel », partout

**Files:**
- Modify: `src/app/espace/conges/page.tsx:62,88`
- Modify: `src/app/espace/page.tsx:61`
- Modify: `src/app/(app)/employes/[id]/page.tsx:665`

- [ ] **Step 1 : les trois libellés**

`src/app/espace/conges/page.tsx` ligne 62 :
```tsx
        <StatConge n={solde} label="Solde de congé annuel" accent />
```
et ligne 88, le rappel sous le bouton d'envoi :
```tsx
            <span className="ml-3 text-xs text-muted-foreground">Seul le congé annuel se déduit de ce solde.</span>
```

`src/app/espace/page.tsx` ligne 61 :
```tsx
        <Carte titre="Solde de congé annuel" valeur={`${solde} j`} sousTitre="jours disponibles" icone="parasol" href="/espace/conges" />
```

`src/app/(app)/employes/[id]/page.tsx` ligne 665 :
```tsx
          <Stat label="Solde de congé annuel" value={soldeConges} />
```

- [ ] **Step 2 : vérifier qu'aucun autre libellé ne traîne**

Run: `grep -rn "Jours disponibles\|Solde de congés\"" src/app --include="*.tsx"`
Expected: rien.

- [ ] **Step 3 : commit**

```bash
git add src/app/espace/conges/page.tsx src/app/espace/page.tsx "src/app/(app)/employes/[id]/page.tsx"
git commit -m "feat(congés): « Solde de congé annuel » partout où le solde s'affiche

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : preuve du `UPDATE` de la migration

**Files:**
- Create: `prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.integration.test.ts`

Le Postgres embarqué des tests applique le **schéma** (`prisma db push`), pas les migrations : la colonne existe, à `false`. Ce test exécute le `UPDATE` **lu dans le fichier de migration** — jamais recopié — et vérifie qu'il ne coche que ce qu'il doit.

- [ ] **Step 1 : écrire le test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le UPDATE de la migration coche « compte dans le solde » sur les types dont le nom contient
// « annuel », et SEULEMENT ceux-là. Lu dans migration.sql : si quelqu'un modifie la migration,
// ce test change avec elle.
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");
const UPDATE = SQL.split("\n").find((l) => l.trim().startsWith("UPDATE "));

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  await prisma.typeConge.createMany({
    data: [
      { nom: "Congé annuel", ordre: 1, systeme: true },
      { nom: "Congé maladie", ordre: 2 },
      { nom: "Repos compensateur", ordre: 3 },
      { nom: "CONGÉ ANNUEL ANTICIPÉ", ordre: 4 },
    ],
  });
}, 120_000);

afterAll(async () => { await fermer(); });

describe("migration typeconge_compte_dans_solde", () => {
  it("la migration contient bien un UPDATE", () => {
    expect(UPDATE).toBeDefined();
  });
  it("ne coche que les types dont le nom contient « annuel », quelle que soit la casse", async () => {
    await prisma.$executeRawUnsafe(UPDATE!);
    const types = await prisma.typeConge.findMany({ orderBy: { ordre: "asc" }, select: { nom: true, compteDansSolde: true } });
    expect(types).toEqual([
      { nom: "Congé annuel", compteDansSolde: true },
      { nom: "Congé maladie", compteDansSolde: false },
      { nom: "Repos compensateur", compteDansSolde: false },
      { nom: "CONGÉ ANNUEL ANTICIPÉ", compteDansSolde: true },
    ]);
  });
});
```

- [ ] **Step 2 : lancer**

Run: `npx vitest run prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.integration.test.ts`
Expected: PASS, 2 tests.

(`vitest.config.ts` n'a pas d'`include` : le motif par défaut `**/*.test.ts` ramasse ce fichier sous `prisma/`.)

- [ ] **Step 3 : commit**

```bash
git add prisma/migrations/20260922090000_typeconge_compte_dans_solde/migration.integration.test.ts
git commit -m "test(congés): le UPDATE de la migration ne coche que les types « annuel »

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : suite complète, lint, relecture, fusion

**Files:** aucun nouveau.

- [ ] **Step 1 : suite complète et typecheck**

Run: `npm run typecheck && npm test`
Expected: tout vert (68+ fichiers ; les nouveaux fichiers de test inclus).

- [ ] **Step 2 : lint des fichiers touchés**

Run: `npx eslint $(git diff --name-only main -- '*.ts' '*.tsx')`
Expected: 0 erreur ; les seuls avertissements sont ceux qui existaient déjà (`jsx-a11y/alt-text` dans `lib/pdf`).

- [ ] **Step 3 : relecture par le testeur**

Dispatcher l'agent `testeur` sur `git diff main` avec ces consignes : (1) aucun montant ni nombre de jours enregistré ne change pour un formulaire identique ; (2) l'ancienne règle et la nouvelle donnent le même solde sur une base où seul « Congé annuel » est coché ET aucun type de la liste de mots-clés n'a jamais eu `tauxPct = 0` — sinon, lister précisément les types dont le comportement change, pour que la Direction le sache avant déploiement ; (3) le refus serveur ne peut pas être contourné en omettant le champ ; (4) les six appelants sont bien tous convertis. Verdict « fusionnable » exigé avant l'étape suivante.

- [ ] **Step 4 : fusion et déploiement**

```bash
git checkout main && git merge --no-ff feat/conges-jours-ouvrables -m "Merge branch 'feat/conges-jours-ouvrables'"
npm test
git push origin main
npm run deployer
```

Après le déploiement : ouvrir `/parametres` en production et **vérifier que « Congé annuel » est bien coché** — c'est la seule action métier de ce lot, et si aucun type ne contenait « annuel », c'est là qu'on le voit.
