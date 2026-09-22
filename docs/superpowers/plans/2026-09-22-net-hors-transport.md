# Le salaire net ne contient pas le transport — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Partout où le logiciel montre un « net » de salarié — bulletin, écrans, exports, attestation, plafond d'acompte — ce nombre est le salaire net HORS transport ; la somme remise au salarié s'appelle « Total versé ». Aucun montant stocké ni calculé ne change.

**Architecture:** Un module pur `lib/paie-net.ts` dérive `salaireNet = salNetUSD − transportUSD` et `totalVerse = salNetUSD` ; chaque consommateur l'importe au lieu de lire `salNetUSD` en direct. Le bulletin PDF affiche trois lignes (SALAIRE NET / Indemnité de transport / TOTAL VERSÉ). Un garde-fou de source refuse toute lecture directe de `salNetUSD` hors moteur.

**Tech Stack:** Next.js App Router, Prisma (colonnes `Decimal`), @react-pdf/renderer, pdf-parse (extraction de texte des PDF en test), vitest, xlsx via `classeurExcel`.

**Spec :** `docs/superpowers/specs/2026-09-22-net-hors-transport-design.md`

## Global Constraints

- Dépôt `~/Projects/rh-pef-app`, branche `fix/net-hors-transport` (créée, contient la spec). ⚠️ `.env` = base de PRODUCTION : jamais `prisma migrate` ni `db push` ; aucune écriture en base depuis ce lot. Il n'y a de toute façon ni migration ni changement de schéma.
- **Aucun montant calculé ou stocké ne change** : `payroll.ts`, `paie-batch.ts`, `bulletin-live` et leurs tests ne sont PAS modifiés. Si un test du moteur devait changer, le lot a débordé — STOP.
- Définitions, copiées de la spec : **Salaire net** = `salNetUSD − transportUSD` (inclut allocations familiales et frais médicaux, diminué de l'acompte et du prêt) ; **Total versé** = `salNetUSD`. En CDF : `(salNetUSD − transportUSD) × taux`, avec `taux = Number(run.tauxChangeUtilise)` pour une ligne stockée, et le taux des paramètres avec lequel l'aperçu a été calculé pour une ligne d'aperçu — jamais `salNetCDF / salNetUSD`.
- Libellés, copiés de la spec : **« Salaire net »** (jamais « Net à payer », jamais « Net » seul dans un en-tête qui a la place), **« Total versé »**, **« Masse salariale nette »** (hors transport). Bulletin : `SALAIRE NET`, `Indemnité de transport`, `TOTAL VERSÉ`.
- Formatage des nombres destinés aux PDF : `formaterNombre` / helpers existants — jamais `toLocaleString("fr-FR")` nu dans un fichier qui alimente un PDF (garde-fou `lib/pdf/glyphes-manquants.test.ts`).
- Commits conventionnels en français, terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commentaires en français.
- Commandes : `npx vitest run <fichier>` ; `npm run typecheck` ; `npx eslint <fichiers touchés>` ; suite complète `npm test` seulement en Task 7.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| **Créer** `src/lib/paie-net.ts` | `salaireNetUSD`, `salaireNetCDF`, `totalVerseUSD`. Sans dépendance. |
| **Créer** `src/lib/paie-net.test.ts` | Tests purs + garde-fou de source (Task 7). |
| Modifier `src/lib/pdf/bulletin.tsx` | Bloc du bas : trois lignes. |
| **Créer** `src/lib/pdf/bulletin.render.test.ts` | Rendu réel + texte extrait (pdf-parse). |
| Modifier `src/lib/pdf/attestation-paie.tsx` | Utilise le module (texte inchangé). |
| Modifier `src/lib/acompte-plafond.ts` + `.test.ts` + `.integration.test.ts` | Plafond sur le salaire net. |
| Modifier `src/app/(app)/employes/[id]/page.tsx`, `fiche/route.ts`, `apercu-bulletin.tsx`, `src/app/(app)/historique/[id]/page.tsx` | Vues par salarié. |
| Modifier `src/app/(app)/paie/page.tsx`, `paie-bulk.tsx`, `bulletins-validation.tsx`, `src/app/(app)/a-valider/page.tsx`, `src/app/(app)/documents/page.tsx`, `src/app/espace/documents/page.tsx` | Onglet Paie et listes de bulletins. |
| Modifier `src/app/(app)/paie/export/route.ts`, `export-pdf/route.ts`, `src/app/(app)/accueil/page.tsx`, `src/app/(app)/paie/historique-paie.tsx`, `src/app/api/cron/rapport-mensuel/route.ts`, `src/app/(app)/employes/simulation-salaire.tsx`, `employes/nouveau/page.tsx`, `employes/[id]/modifier/page.tsx` | Exports, masses, simulation. |

---

### Task 1 : le module `paie-net`

**Files:**
- Create: `src/lib/paie-net.ts`
- Create: `src/lib/paie-net.test.ts`

**Interfaces:**
- Produces:
  - `type LigneNet = { salNetUSD: Decimal | number | string; transportUSD: Decimal | number | string }` (tout ce que Prisma ou le moteur renvoie ; `Decimal` = `@prisma/client/runtime/library` — utiliser `{ toString(): string }` structurel pour rester sans dépendance).
  - `salaireNetUSD(l: LigneNet): number`
  - `salaireNetCDF(l: LigneNet, tauxChangeCDF: number): number`
  - `totalVerseUSD(l: LigneNet): number`

- [ ] **Step 1 : tests qui échouent**

```ts
import { describe, it, expect } from "vitest";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "./paie-net";

// Ligne RÉELLE de la paie de septembre 2026 (Aimée Mutita) : 368,50 versés dont 114,78 de transport.
const aimee = { salNetUSD: 368.5, transportUSD: 114.78 };

describe("paie-net — salaire net = total versé − transport", () => {
  it("salaire net hors transport", () => {
    expect(salaireNetUSD(aimee)).toBeCloseTo(253.72, 2);
  });
  it("total versé = ce qui est remis, transport compris", () => {
    expect(totalVerseUSD(aimee)).toBeCloseTo(368.5, 2);
  });
  it("sans transport, salaire net = total versé", () => {
    expect(salaireNetUSD({ salNetUSD: 164, transportUSD: 0 })).toBe(164);
    expect(totalVerseUSD({ salNetUSD: 164, transportUSD: 0 })).toBe(164);
  });
  it("en CDF, au taux du bulletin", () => {
    expect(salaireNetCDF(aimee, 2800)).toBeCloseTo(253.72 * 2800, 0);
  });
  it("accepte les Decimal de Prisma (objets à toString) et les chaînes", () => {
    const dec = (v: string) => ({ toString: () => v });
    expect(salaireNetUSD({ salNetUSD: dec("368.50"), transportUSD: dec("114.78") })).toBeCloseTo(253.72, 2);
    expect(salaireNetUSD({ salNetUSD: "368.50", transportUSD: "114.78" })).toBeCloseTo(253.72, 2);
  });
  it("un transport supérieur au versé (donnée incohérente) donne un net négatif, jamais NaN", () => {
    expect(salaireNetUSD({ salNetUSD: 10, transportUSD: 25 })).toBe(-15);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec** — `npx vitest run src/lib/paie-net.test.ts` → module introuvable.

- [ ] **Step 3 : écrire le module**

```ts
/**
 * SALAIRE NET ET TOTAL VERSÉ — la seule soustraction du dépôt (décision Direction 2026-09-22).
 *
 * `PayrollLine.salNetUSD` porte, depuis le 2026-07-22, le TOTAL VERSÉ au salarié : salaire net
 * + indemnité de transport. C'est le montant réellement payé sur des mois clos et imprimé sur les
 * bulletins émis — on ne le réécrit pas. Le SALAIRE NET (ce que le salarié gagne, hors
 * remboursement de frais) se DÉRIVE ici, et nulle part ailleurs : `salNetUSD − transportUSD`.
 *
 * Il inclut les allocations familiales et les frais médicaux remboursés, et il est diminué de
 * l'acompte et de l'échéance de prêt — comme le net stocké. Seul le transport en sort.
 *
 * Module sans dépendance : importé par les composants client (simulation de salaire) comme par
 * les routes, les exports et les documents PDF.
 */

/** Ce que Prisma (`Decimal`), le moteur (`number`) ou une API (`string`) peuvent fournir. */
type Montant = number | string | { toString(): string };
export type LigneNet = { salNetUSD: Montant; transportUSD: Montant };

const n = (v: Montant): number => (typeof v === "number" ? v : Number(v.toString()));

/** Salaire net = total versé − transport. */
export function salaireNetUSD(l: LigneNet): number {
  return n(l.salNetUSD) - n(l.transportUSD);
}

/**
 * Le même, en CDF, au taux du bulletin. Le taux est PASSÉ (`run.tauxChangeUtilise`), jamais déduit
 * de `salNetCDF / salNetUSD` : un net nul donnerait NaN.
 */
export function salaireNetCDF(l: LigneNet, tauxChangeCDF: number): number {
  return salaireNetUSD(l) * tauxChangeCDF;
}

/** Total versé = salaire net + transport = la somme remise en main propre. */
export function totalVerseUSD(l: LigneNet): number {
  return n(l.salNetUSD);
}
```

- [ ] **Step 4 : vérifier** — `npx vitest run src/lib/paie-net.test.ts && npm run typecheck` → 6 tests verts.

- [ ] **Step 5 : commit**

```bash
git add src/lib/paie-net.ts src/lib/paie-net.test.ts
git commit -m "feat(paie): module paie-net — salaire net hors transport, total versé

La seule soustraction du dépôt : salNetUSD (total versé, inchangé en base)
moins transportUSD. Sans dépendance, importable partout.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : le bulletin PDF — SALAIRE NET / Indemnité de transport / TOTAL VERSÉ

**Files:**
- Modify: `src/lib/pdf/bulletin.tsx` (styles ~114-131 ; bloc ~439-452)
- Create: `src/lib/pdf/bulletin.render.test.ts`

**Interfaces:**
- Consumes: `salaireNetUSD`, `totalVerseUSD` (Task 1) ; `BulletinDocument(props: BulletinProps)` avec `employee`, `ligne`, `run`, `devise`, `congesPeriode`, `feries?`, `primes?`, `codesParJour?`, `entreprise?`, `logo?`, `params?` ; `renderPdfBuffer` de `./fonts` ; `pdf-parse` (dépendance directe, idiome : `const { PDFParse } = await import("pdf-parse"); const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText(); const texte = pages.map((p) => p.text).join("\n")`).

- [ ] **Step 1 : test de rendu qui échoue**

```ts
import { describe, it, expect } from "vitest";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { BulletinDocument } from "./bulletin";

/**
 * Le bas du bulletin dit le SALAIRE NET (hors transport), l'indemnité de transport à part, puis le
 * TOTAL VERSÉ — décision Direction 2026-09-22. Avant, « SALAIRE NET À PAYER » portait le total
 * versé et le net de la fiche ne s'y retrouvait jamais. Ligne réelle : Aimée Mutita, sept. 2026.
 */
async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

const employee = {
  id: "e1", matricule: "PEF-007", nom: "Aimée Mutita", sexe: "F", poste: "Cuisinière", secteur: "Cuisine",
  categorie: "BRIGADE", contrat: "CDD", enfants: 0, salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"),
  heuresHebdomadaires: 48, transportJourCDF: 10000,
} as unknown as Employee;

const run = { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "BROUILLON" } as unknown as PayrollRun;

function ligne(surcharges: Partial<Record<keyof PayrollLine, unknown>> = {}): PayrollLine {
  return {
    id: "l1", employeeId: "e1", payrollRunId: "r1", statutPaiement: "PAS_VALIDE",
    remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 1.96,
    heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 1, heuresSupp60: 0, heuresSupp100: 0,
    joursPayes100: 26, joursPayes2_3: 0, joursNonPayes: 0, joursPayesNonTravailles: 0, joursCongePris: 0,
    indemniteCongesUSD: 0, fraisMedicauxUSD: 0, transportUSD: 114.78, primesUSD: 0, avantagesNatureUSD: 0,
    acompteUSD: 0, retenuePretUSD: 0, salBrutUSD: 418.51, cnssSalarieUSD: 15.19, netImposableUSD: 288.54,
    iprCalculeUSD: 34.83, allocFamilialeUSD: 0, salNetUSD: 368.5, salNetCDF: 368.5 * 2800,
    cnssPatronalUSD: 36.46, inppUSD: 9.11, onemUSD: 0.61, coutEmployeurUSD: 464.69, coutEmployeurCDF: 464.69 * 2800,
    datePaiement: null, modePaiement: null, payeParId: null,
    ...surcharges,
  } as unknown as PayrollLine;
}

const rendre = (l: PayrollLine, devise: "USD" | "CDF" = "USD") =>
  renderPdfBuffer(BulletinDocument({ employee, ligne: l, run, devise, congesPeriode: [], feries: [], primes: [], codesParJour: {} }));

describe("bulletin — le bas de page distingue salaire net, transport et total versé", () => {
  it("avec transport : SALAIRE NET 253,72 $, Indemnité de transport 114,78 $, TOTAL VERSÉ 368,50 $", async () => {
    const t = await texteDu(await rendre(ligne()));
    expect(t).toMatch(/SALAIRE NET\s*253,72 \$/);
    expect(t).toMatch(/Indemnité de transport\s*114,78 \$/);
    expect(t).toMatch(/TOTAL VERSÉ\s*368,50 \$/);
    expect(t).not.toContain("NET À PAYER");
    expect(t).not.toContain("versé au net");
  }, 60_000);

  it("sans transport : pas de ligne transport, et le total versé égale le salaire net", async () => {
    const t = await texteDu(await rendre(ligne({ transportUSD: 0, salNetUSD: 253.72, salBrutUSD: 303.73 })));
    expect(t).toMatch(/SALAIRE NET\s*253,72 \$/);
    expect(t).not.toContain("Indemnité de transport");
    expect(t).toMatch(/TOTAL VERSÉ\s*253,72 \$/);
  }, 60_000);

  it("en CDF, les trois montants sont au taux du bulletin", async () => {
    const t = await texteDu(await rendre(ligne(), "CDF"));
    expect(t).toMatch(/SALAIRE NET\s*710 416 FC/); // 253,72 × 2 800
    expect(t).toMatch(/TOTAL VERSÉ\s*1 031 800 FC/); // 368,50 × 2 800
  }, 60_000);
});
```

Si le format CDF du bulletin diffère (« CDF » au lieu de « FC », arrondi), lire `formatCDF` dans `lib/pdf/theme.ts` et le `m()` du bulletin, puis ajuster les DEUX chaînes attendues à ce format — sans changer les nombres.

- [ ] **Step 2 : lancer, vérifier l'échec** — `npx vitest run src/lib/pdf/bulletin.render.test.ts` → le premier test échoue sur `SALAIRE NET 253,72` (le PDF dit encore « SALAIRE NET À PAYER 368,50 »).

- [ ] **Step 3 : le bloc du bas**

Dans `src/lib/pdf/bulletin.tsx`, ajouter à l'import de `@/lib/…` : `import { salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";`

Dans `StyleSheet.create`, après `totalValue`, ajouter :
```ts
  // Sous le SALAIRE NET : l'indemnité de transport à part, puis le TOTAL VERSÉ — la somme remise.
  verseRow: { marginTop: 3, paddingHorizontal: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  verseLabel: { fontSize: 8, color: pdfColors.textMuted },
  verseValue: { fontSize: 8, color: pdfColors.text },
  verseTotalLabel: { fontSize: 9, fontWeight: 700, color: pdfColors.brownDark },
  verseTotalValue: { fontSize: 10.5, fontWeight: 700, color: pdfColors.brownDark },
```

Remplacer le bloc (de `<View style={styles.totalBox}>` jusqu'à la fin du `{Number(ligne.transportUSD) > 0 && (…)}` qui suit `coutRow`) par :
```tsx
      {/* Le SALAIRE NET est hors transport (décision Direction 2026-09-22) : c'est le nombre qui se
          compare à la fiche. Le transport, remboursement de frais, s'affiche à part ; le TOTAL VERSÉ
          est la somme remise en main propre. Les nombres viennent de `lib/paie-net`, seule
          soustraction du dépôt — le montant stocké (`salNetUSD`) reste le total versé. */}
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>SALAIRE NET</Text>
        <Text style={styles.totalValue}>{m(salaireNetUSD(ligne))}</Text>
      </View>
      {Number(ligne.transportUSD) > 0 && (
        <View style={styles.verseRow}>
          <Text style={styles.verseLabel}>Indemnité de transport (non imposable, non cotisable)</Text>
          <Text style={styles.verseValue}>{m(Number(ligne.transportUSD))}</Text>
        </View>
      )}
      <View style={styles.verseRow}>
        <Text style={styles.verseTotalLabel}>TOTAL VERSÉ</Text>
        <Text style={styles.verseTotalValue}>{m(totalVerseUSD(ligne))}</Text>
      </View>
      <View style={styles.coutRow}>
        <Text style={styles.coutText}>Coût total employeur (charges patronales comprises)</Text>
        <Text style={styles.coutText}>{m(Number(ligne.coutEmployeurUSD))}</Text>
      </View>
```
`m()` est le formateur du bulletin (USD ou CDF selon `devise`, via le taux du run) : il convertit déjà — ne pas multiplier soi-même.

- [ ] **Step 4 : vérifier** — `npx vitest run src/lib/pdf/bulletin.render.test.ts src/lib/pdf/glyphes-manquants.test.ts && npm run typecheck && npx eslint src/lib/pdf/bulletin.tsx src/lib/pdf/bulletin.render.test.ts` → 3 + 5 tests verts.

- [ ] **Step 5 : regarder le PDF** — dans le test, écrire temporairement le buffer dans le scratchpad et l'ouvrir (ou `sips -s format png`) : les trois lignes alignées à droite, le SALAIRE NET dans son pavé doré, rien qui chevauche la case de signature. Retirer l'écriture du fichier avant de commiter.

- [ ] **Step 6 : commit**

```bash
git add src/lib/pdf/bulletin.tsx src/lib/pdf/bulletin.render.test.ts
git commit -m "fix(bulletin): SALAIRE NET hors transport, indemnité à part, TOTAL VERSÉ

Le net en bas de page est celui qui se compare à la fiche. Le transport,
remboursement de frais, s'affiche sur sa ligne ; la somme remise garde son
nom. Rendu réel vérifié par extraction de texte (pdf-parse).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : attestation de paie et plafond d'acompte passent par le module

**Files:**
- Modify: `src/lib/pdf/attestation-paie.tsx:65-71`
- Modify: `src/lib/acompte-plafond.ts:39-63,147-162`
- Modify: `src/lib/acompte-plafond.test.ts`, `src/lib/acompte-plafond.integration.test.ts`

- [ ] **Step 1 : attestation — la soustraction locale disparaît, le texte ne bouge pas**

Ajouter `import { salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";` puis remplacer :
```ts
  const salNetUSD = Number(ligne.salNetUSD);
  const salNetCDF = Number(ligne.salNetCDF);
  const taux = Number(run.tauxChangeUtilise) || 1;
  const transportUSD = Number(ligne.transportUSD);
  // Le net perçu inclut le transport : on isole le net « salaire seul » pour l'afficher à côté du
  // transport, sans double compter (2026-07-22, demande client : « juste le net et le transport »).
  const salaireNetHorsTransportUSD = salNetUSD - transportUSD;
```
par :
```ts
  // Salaire net (hors transport) et total versé : `lib/paie-net`, seule soustraction du dépôt —
  // l'attestation la faisait localement depuis le 2026-07-22 ; le bulletin l'a rejointe le 2026-09-22.
  const salNetUSD = totalVerseUSD(ligne);
  const salNetCDF = Number(ligne.salNetCDF);
  const taux = Number(run.tauxChangeUtilise) || 1;
  const transportUSD = Number(ligne.transportUSD);
  const salaireNetHorsTransportUSD = salaireNetUSD(ligne);
```
Le JSX qui suit reste identique.

- [ ] **Step 2 : plafond d'acompte — test qui échoue**

Dans `src/lib/acompte-plafond.integration.test.ts`, repérer le test qui crée une `payrollLine` du mois précédent et vérifie `source: "NET_MOIS_PRECEDENT"` ; ajouter un cas :
```ts
  it("le plafond est le SALAIRE NET du mois précédent — le transport n'en fait pas partie", async () => {
    // Même patron que le test précédent : une ligne du mois précédent avec salNetUSD 368.5 et
    // transportUSD 114.78 → plafond 253.72, pas 368.5.
    /* créer employé + run du mois précédent + ligne {salNetUSD: 368.5, transportUSD: 114.78} comme
       les tests voisins le font, puis : */
    const p = await chargerPlafondAcompte(prisma, { employeeId, mois, annee });
    expect(p.source).toBe("NET_MOIS_PRECEDENT");
    expect(p.plafondUSD).toBeCloseTo(253.72, 2);
  });
```
(Recopier la mécanique de création du test voisin — employé, run, ligne — sans la modifier.)

Run: `npx vitest run src/lib/acompte-plafond.integration.test.ts` → le nouveau cas échoue (plafond 368,50).

- [ ] **Step 3 : plafond — implémentation**

Dans `src/lib/acompte-plafond.ts` : `import { salaireNetUSD } from "@/lib/paie-net";` ; dans `chargerPlafondAcompte`, la requête `payrollLine.findFirst` sélectionne `{ salNetUSD: true, transportUSD: true }` et l'appel devient
`netMoisPrecedentUSD: lignePrecedente ? salaireNetUSD(lignePrecedente) : null,`.
Dans le doc-comment de `calculerPlafondAcompte`, `/** Net du bulletin du mois précédent … */` devient `/** SALAIRE NET (hors transport) du bulletin du mois précédent, ou null … — une avance se prend sur le salaire, pas sur un remboursement de frais. */`.

- [ ] **Step 4 : vérifier** — `npx vitest run src/lib/acompte-plafond src/lib/pdf/glyphes-manquants.test.ts && npm run typecheck && npx eslint src/lib/pdf/attestation-paie.tsx src/lib/acompte-plafond.ts src/lib/acompte-plafond.integration.test.ts` → verts.

- [ ] **Step 5 : commit**

```bash
git add src/lib/pdf/attestation-paie.tsx src/lib/acompte-plafond.ts src/lib/acompte-plafond.integration.test.ts
git commit -m "fix(paie): attestation et plafond d'acompte sur le salaire net du module

L'attestation renonce à sa soustraction locale ; le plafond d'acompte se
calcule sur le salaire net du mois précédent, transport exclu.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : les vues par salarié

**Files:**
- Modify: `src/app/(app)/employes/[id]/page.tsx:683-712` (tableau « Historique de paie »)
- Modify: `src/app/(app)/employes/[id]/fiche/route.ts:106-114`
- Modify: `src/app/(app)/employes/[id]/apercu-bulletin.tsx:75-82`
- Modify: `src/app/(app)/historique/[id]/page.tsx:40-70`

Chaque fichier : `import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";` (n'importer que ce qui sert). Le taux d'une ligne stockée = `Number(l.payrollRun.tauxChangeUtilise)` (ou `run.tauxChangeUtilise` quand la page tient le run) — vérifier que la requête inclut `payrollRun` ; c'est déjà le cas dans `employes/[id]/page.tsx` et `fiche/route.ts` (`include: { payrollRun: true }`).

- [ ] **Step 1 : fiche employé, tableau des paies** — en-tête : `Salaire net $` / `Salaire net CDF` restent, et une colonne `Total versé $` s'ajoute après « Salaire net CDF » ; cellules :
```tsx
                <td className="px-3 py-2 text-right">{formatMoney(salaireNetUSD(l))}</td>
                <td className="px-3 py-2 text-right">
                  {formaterNombre(Math.round(salaireNetCDF(l, Number(l.payrollRun.tauxChangeUtilise))))} CDF
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">{formatMoney(totalVerseUSD(l))}</td>
```
(`formaterNombre` de `@/lib/montant` — la page l'importe déjà ; sinon l'ajouter.) Mettre `min-w-[36rem]` à `min-w-[42rem]` sur la table.

- [ ] **Step 2 : export PDF de la fiche** — dans `paies: payrollLines.map(...)` : `netUSD: usd(salaireNetUSD(l))`, `netCDF: … formaterNombre(salaireNetCDF(l, Number(l.payrollRun.tauxChangeUtilise)), { maximumFractionDigits: 0 }) …`, et ajouter `verseUSD: usd(totalVerseUSD(l))`. Ouvrir `src/lib/pdf/fiche-employe.tsx`, trouver le tableau `paies` (colonnes `netUSD`/`netCDF`) : en-têtes « Salaire net $ » / « Salaire net CDF », ajouter une colonne « Total versé $ » liée à `verseUSD`, et étendre le type de la ligne. Rééquilibrer les largeurs pour que la somme reste 100 %.

- [ ] **Step 3 : aperçu bulletin** — le bloc du bas :
```tsx
      <div className="border-t bg-primary/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Salaire net</span>
          <span className="text-right">
            <span className="text-lg font-bold">{fmtUSD(salaireNetUSD(l))}</span>
            <span className="ml-2 text-sm text-muted-foreground">{fmtCDF(salaireNetCDF(l, t))}</span>
          </span>
        </div>
        {Number(l.transportUSD) > 0 && (
          <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
            <span>Total versé (transport compris)</span>
            <span>{fmtUSD(totalVerseUSD(l))}</span>
          </div>
        )}
      </div>
```
(`t` est le taux déjà utilisé par `<Ligne taux={t} …>` dans ce composant.)

- [ ] **Step 4 : historique d'un run** — en-têtes `Salaire net $` / `Salaire net CDF` inchangés, colonne `Total versé $` ajoutée après ; cellules avec `salaireNetUSD(l)`, `salaireNetCDF(l, Number(run.tauxChangeUtilise))`, `totalVerseUSD(l)` (la page tient `run`).

- [ ] **Step 5 : vérifier** — `npm run typecheck && npx eslint "src/app/(app)/employes/[id]/page.tsx" "src/app/(app)/employes/[id]/fiche/route.ts" "src/app/(app)/employes/[id]/apercu-bulletin.tsx" "src/app/(app)/historique/[id]/page.tsx" src/lib/pdf/fiche-employe.tsx && npx vitest run src/lib/pdf/glyphes-manquants.test.ts`.

- [ ] **Step 6 : commit** — `fix(paie): vues par salarié — salaire net hors transport, total versé à part` (+ Co-Authored-By).

---

### Task 5 : l'onglet Paie et les listes de bulletins

**Files:**
- Modify: `src/app/(app)/paie/page.tsx:75-110,130-155,445-492`
- Modify: `src/app/(app)/paie/paie-bulk.tsx:15-25,218-230` (+ tout autre usage de `salNetUSD`/`salNetCDF` dans ce fichier)
- Modify: `src/app/(app)/paie/bulletins-validation.tsx:74,101-103,164`
- Modify: `src/app/(app)/a-valider/page.tsx:90-97`
- Modify: `src/app/(app)/documents/page.tsx:195,264,271`
- Modify: `src/app/espace/documents/page.tsx:74`

**Interfaces:**
- `PaieRow` (défini dans `paie-bulk.tsx`) : les champs `salNetUSD: number; salNetCDF: number;` sont **remplacés** par `salaireNetUSD: number; salaireNetCDF: number; totalVerseUSD: number;`. Les composants client (`paie-bulk`, `bulletins-validation`) ne lisent plus que ces trois champs ; la page serveur les calcule avec le module.

- [ ] **Step 1 : `paie/page.tsx`** — importer le module. Dans le premier `map` (lignes stockées) :
```ts
        salaireNetUSD: salaireNetUSD(l),
        salaireNetCDF: salaireNetCDF(l, Number(run.tauxChangeUtilise)),
        totalVerseUSD: totalVerseUSD(l),
```
à la place de `salNetUSD`/`salNetCDF`. Dans le second `map` (aperçu, `l.data`) : trouver comment `apercu` est calculé (`bulletin-live` / `paie-batch`, appelé plus haut dans ce fichier avec les paramètres de paie) et utiliser le taux de CES paramètres : `salaireNetCDF(l.data, parametres.tauxChangeCDF)` — si le nom de la variable de paramètres diffère, l'adapter ; **ne jamais** dériver le taux de `salNetCDF / salNetUSD`. Même chose pour le troisième bloc (`net: Number(l.salNetUSD)` → `net: salaireNetUSD(l)` et `net: l.data.salNetUSD` → `net: salaireNetUSD(l.data)`).

`ApercuGroupe` : `const totalNet = rows.reduce((s, r) => s + r.salaireNetUSD, 0); const totalVerse = rows.reduce((s, r) => s + r.totalVerseUSD, 0);` ; le pied : `<span …>Salaire net total {usd(totalNet)} · Total versé {usd(totalVerse)}</span>` ; en-têtes `Net USD` → `Salaire net $`, `Net CDF` → `Salaire net CDF` ; cellules `r.salaireNetUSD` / `r.salaireNetCDF`.

- [ ] **Step 2 : `paie-bulk.tsx`** — type `PaieRow` comme ci-dessus ; en-têtes de colonnes « Net » → « Salaire net $ » / « Salaire net CDF » (repérer les `<th>` correspondants) ; cellules `money(l.salaireNetUSD)` et `l.salaireNetCDF`. Tout autre usage de `salNetUSD` dans ce fichier (tri, totaux) → `salaireNetUSD`.

- [ ] **Step 3 : `bulletins-validation.tsx`** — les trois lectures : `money(r.salaireNetUSD)`, `formaterNombre(Math.round(r.salaireNetCDF))`, et le libellé `L.net` : ouvrir `src/lib/bulletin-format.ts`, vérifier que `LBL_BULLETIN.net` vaut « Salaire net » (sinon le mettre — c'est le libellé partagé) ; ajouter sous la ligne `L.net` une `MiniLigne label="Total versé" usd={r.totalVerseUSD}` uniquement si `r.transportUSD > 0` (`PaieRow.transportUSD` existe).

- [ ] **Step 4 : `a-valider/page.tsx`** — `montant: money(salaireNetUSD(l))` (importer le module ; vérifier que la requête sélectionne `transportUSD` — sinon l'ajouter au `select`/`include`).

- [ ] **Step 5 : `documents/page.tsx` et `espace/documents/page.tsx`** — les trois affichages : `formaterNombre(salaireNetUSD(b), { minimumFractionDigits: 2 })} $` (remplace le `toLocaleString` nu au passage) ; l'en-tête `"Net $"` du `Thead` → `"Salaire net $"` ; côté salarié `Net : …` → `Salaire net : …`. Vérifier que les requêtes de ces pages sélectionnent `transportUSD`.

- [ ] **Step 6 : vérifier** — `npm run typecheck && npx eslint <les six fichiers> && npx vitest run src/lib/pdf/glyphes-manquants.test.ts src/lib/paie-etats.test.ts`.

- [ ] **Step 7 : commit** — `fix(paie): onglet Paie et listes de bulletins — salaire net hors transport` (+ Co-Authored-By).

---

### Task 6 : exports, masses salariales, simulation

**Files:**
- Modify: `src/app/(app)/paie/export/route.ts:31-53`
- Modify: `src/app/(app)/paie/export-pdf/route.ts:28-62`
- Modify: `src/app/(app)/accueil/page.tsx:70,96,117`
- Modify: `src/app/(app)/paie/historique-paie.tsx:71,109`
- Modify: `src/app/api/cron/rapport-mensuel/route.ts:58-70`
- Modify: `src/app/(app)/employes/simulation-salaire.tsx:154-159,169,179`
- Modify: `src/app/(app)/employes/nouveau/page.tsx:18,24`, `src/app/(app)/employes/[id]/modifier/page.tsx:33,44,48`

- [ ] **Step 1 : livre de paie Excel** — en-tête : `"Salaire net $", "Salaire net CDF", "Total versé $", "Total versé CDF", "Statut"` ; lignes : `Number(salaireNetUSD(l).toFixed(2)), Number(salaireNetCDF(l, taux).toFixed(0)), Number(totalVerseUSD(l).toFixed(2)), Number(Number(l.salNetCDF).toFixed(0)), LIBELLE_STATUT[…]` avec `const taux = Number(run.tauxChangeUtilise)` (le `run` est chargé en tête de route).

- [ ] **Step 2 : livre de paie PDF** — colonnes : `{ header: "Salaire net $", width: "11%", align: "right" }, { header: "Net CDF", width: "10%", align: "right" }, { header: "Versé $", width: "10%", align: "right" }` et réduire « Nom » à `16%`, « Matricule » à `10%` pour rester à 100 % (recalculer et vérifier la somme). Lignes et ligne TOTAL avec `salaireNetUSD(l)`, `salaireNetCDF(l, taux)`, `totalVerseUSD(l)`.

- [ ] **Step 3 : masses** — `accueil/page.tsx` : le `select` des lignes ajoute `transportUSD: true` ; `masseNette` et `historique[].net` = `reduce((a, l) => a + salaireNetUSD(l), 0)`. `historique-paie.tsx` : idem pour les deux `masseNette` (vérifier que la requête de la page qui l'alimente sélectionne `transportUSD`). `rapport-mensuel/route.ts` : `totalNet = somme((l) => salaireNetUSD(l))`, `totalTransport = somme((l) => Number(l.transportUSD))`, et la ligne `• Masse salariale nette : …` est suivie de `• Transport versé : ${usd(totalTransport)}`.

- [ ] **Step 4 : simulation** — `simulation-salaire.tsx` : le bloc « Net à payer (transport compris) » devient
```tsx
        <div className="border-t pt-1">
          <Ligne label="Salaire net" val={usd(salaireNetUSD(ligne))} gras vert />
          {transportUSD > 0 && <Ligne label="Total versé (transport compris)" val={usd(totalVerseUSD(ligne))} />}
          <p className="text-right text-[11px] text-muted-foreground">≈ {cdf(salaireNetCDF(ligne, params.tauxChangeCDF))}</p>
        </div>
```
(`ligne` est une `LignePaie` — vérifier qu'elle expose `transportUSD` ; sinon construire `{ salNetUSD: ligne.salNetUSD, transportUSD }` avec le `transportUSD` local déjà calculé dans ce composant. `params` : le nom de la variable des paramètres de paie dans ce composant.) L'impact : `deltaNet = salaireNetUSD(…) − impact.actuel.net` et le texte « Net de l'employé » → « Salaire net de l'employé ». `nouveau/page.tsx` et `modifier/page.tsx` : `select` ajoute `transportUSD: true` ; `netActuel` et `actuel.net` via `salaireNetUSD(l)`.

- [ ] **Step 5 : vérifier** — `npm run typecheck && npx eslint <les huit fichiers> && npx vitest run src/lib/pdf/glyphes-manquants.test.ts` ; ouvrir le livre de paie PDF rendu par le test s'il en existe un (`grep -rl "Livre de paie" src --include="*.test.*"`), sinon vérifier à l'écran après déploiement.

- [ ] **Step 6 : commit** — `fix(paie): exports, masses salariales et simulation — salaire net hors transport, total versé` (+ Co-Authored-By).

---

### Task 7 : garde-fou de source, suite complète, fusion

**Files:**
- Modify: `src/lib/paie-net.test.ts` (ajouter le garde-fou)

- [ ] **Step 1 : le garde-fou**

```ts
import fs from "node:fs";
import path from "node:path";

describe("règle : hors moteur, personne ne lit salNetUSD sans passer par paie-net", () => {
  // Le moteur et le lot de paie PRODUISENT salNetUSD ; tout le reste l'AFFICHE, et doit donc dire
  // lequel des deux nets il montre. Une lecture directe est un « net » qui a échappé à la règle.
  const PRODUCTEURS = new Set(["src/lib/payroll.ts", "src/lib/paie-batch.ts", "src/lib/paie-net.ts"]);
  it("tout fichier de src/ qui mentionne salNetUSD importe @/lib/paie-net (ou est producteur)", () => {
    const fautifs: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const rel = path.relative(process.cwd(), p);
          if (PRODUCTEURS.has(rel)) continue;
          const s = fs.readFileSync(p, "utf8");
          if (s.includes("salNetUSD") && !s.includes("@/lib/paie-net")) fautifs.push(rel);
        }
      }
    };
    parcourir(path.join(process.cwd(), "src"));
    expect(fautifs, "importer salaireNetUSD/totalVerseUSD de @/lib/paie-net").toEqual([]);
  });
});
```
Run: `npx vitest run src/lib/paie-net.test.ts`. S'il reste des fautifs (un fichier oublié par les tâches 4-6, ou un `select: { salNetUSD: true }` dans une requête d'un fichier qui ne l'affiche pas), les traiter : un fichier qui ne fait que **sélectionner** le champ pour le passer au module l'importe aussi (c'est justement ce qu'on veut lire) ; `bulletin-live.ts` ou équivalent, s'il produit des lignes, rejoint `PRODUCTEURS` avec un commentaire.

- [ ] **Step 2 : suite complète** — `npm run typecheck && npm test` → tout vert, `payroll.test.ts` inchangé (`git diff --stat main -- src/lib/payroll.ts src/lib/payroll.test.ts src/lib/paie-batch.ts` doit être vide).

- [ ] **Step 3 : lint** — `npx eslint $(git diff --name-only --diff-filter=AM main -- '*.ts' '*.tsx' | grep -v "^docs/")` → aucune erreur nouvelle (comparer aux erreurs préexistantes de `main` si besoin).

- [ ] **Step 4 : commit** — `test(paie): garde-fou — aucune lecture directe de salNetUSD hors moteur` (+ Co-Authored-By).

- [ ] **Step 5 : relecture, fusion, déploiement** — relecture finale (agent `testeur`, verdict « fusionnable » exigé, consignes : aucun montant calculé ne change ; chaque « net » affiché = hors transport ; chaque total versé nommé ; exports cohérents ligne/total), puis :
```bash
git checkout main && git merge --no-ff fix/net-hors-transport -m "Merge branch 'fix/net-hors-transport'"
npm test && git push origin main && npm run deployer
```
Après déploiement : ouvrir un bulletin de septembre (Aimée Mutita) — SALAIRE NET 253,72 $, Indemnité de transport 114,78 $, TOTAL VERSÉ 368,50 $ ; l'accueil : la masse salariale nette a baissé d'≈ 1 710 $ (le coût employeur, non).
