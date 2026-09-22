# Signature électronique du salarié — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le salarié signe son contrat, son bulletin validé et sa demande de congé approuvée en traçant au doigt dans un cadre — depuis son espace, ou sur l'appareil de la Direction qui le lui tend. Le tracé, l'horodatage serveur, le mode et une empreinte des données signées sont enregistrés ; le document imprime la vérité sur le geste.

**Architecture:** Une table `SignatureElectronique` (une ligne par document signé). Un module pur `lib/signature-document.ts` produit l'instantané canonique des données de chaque cible et son SHA-256. Un module serveur `lib/signature.ts` lit (en détectant l'obsolescence) et écrit. Un composant client `components/cadre-signature.tsx` produit le PNG. Deux actions serveur — espace salarié et Direction — décident le mode, jamais le navigateur. `PdfSignatureBox` affiche le tracé et la mention.

**Tech Stack:** Next.js App Router (server actions), Prisma + Postgres, React 19 (canvas + pointer events), @react-pdf/renderer, `node:crypto`, Supabase Storage (bucket privé `employes`), vitest (tests purs + Postgres embarqué `creerBaseTest` + rendu PDF via `pdf-parse`).

**Spec :** `docs/superpowers/specs/2026-09-22-signature-electronique-design.md`

## Global Constraints

- Dépôt `~/Projects/rh-pef-app`, branche `feat/signature-electronique` (créée, contient la spec). ⚠️ `.env` = base de **PRODUCTION** : jamais `prisma migrate` ni `prisma db push` ; seuls `npx prisma generate` et `npx prisma validate` sont permis. La migration est écrite comme fichier, appliquée par le déploiement. Le Postgres embarqué des tests (`creerBaseTest`) est la seule base qu'on écrit.
- **Ce lot ne touche à AUCUN calcul** : `lib/payroll.ts`, `lib/paie-batch.ts`, `lib/paie-net.ts`, `lib/bulletin-live.ts` et leurs tests restent hors diff. Si l'un doit changer, le lot a débordé — STOP.
- **Le mode n'est jamais choisi par le client.** La garde serveur le décide : espace salarié → `ESPACE_SALARIE` + `presenteParId: null` ; Direction → `PRESENTIEL` + `presenteParId: user.id`. Un paramètre `mode` venant du navigateur est ignoré.
- **Horodatage serveur** (`new Date()` côté action), jamais une date fournie par le client.
- Les montants d'un instantané sont des **chaînes à 2 décimales** (`Number(v).toFixed(2)`) ; les dates, des `YYYY-MM-DD`. Clés triées. Jamais de nombre flottant brut dans l'empreinte.
- Mentions imprimées, mot pour mot (heure de Kinshasa, UTC+1) :
  - `ESPACE_SALARIE` : `Signé électroniquement par <nom> (matricule <matricule>) le <JJ/MM/AAAA> à <HH h MM>, depuis son espace salarié.`
  - `PRESENTIEL` : `Signé par <nom> (matricule <matricule>) le <JJ/MM/AAAA> à <HH h MM>, sur l'appareil de l'entreprise, en présence de <nom du responsable>.`
  - Contrat repris (sans tracé) : `Accepté électroniquement le <JJ/MM/AAAA> à <HH h MM>, sans signature tracée.`
  - Obsolète, en préfixe : `⚠ Document modifié après signature — à resigner. ` (le tracé n'est alors **pas** affiché)
- Commentaires en français. Commits conventionnels en français terminés par `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Commandes : `npx vitest run <fichier>` ; `npm run typecheck` ; `npx eslint <fichiers touchés>` ; `npm test` seulement en Task 8.
- Pas de `toLocaleString("fr-FR")` nu dans un fichier qui alimente un PDF (garde-fou `lib/pdf/glyphes-manquants.test.ts`) ; pas de lecture directe de `salNetUSD` hors module (garde-fou `lib/paie-net.test.ts`).

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| Modifier `prisma/schema.prisma` | enums `CibleSignature`/`ModeSignature`, modèle `SignatureElectronique`, relations inverses. |
| **Créer** `prisma/migrations/20260923090000_signature_electronique/migration.sql` | Types, table, index, reprise des contrats acceptés. |
| **Créer** `prisma/migrations/20260923090000_signature_electronique/migration.integration.test.ts` | Preuve de la reprise. |
| **Créer** `src/lib/signature-document.ts` + `.test.ts` | Instantanés canoniques + empreinte. Pur. |
| **Créer** `src/lib/signature.ts` + `.integration.test.ts` | `chargerSignature` (détecte l'obsolescence), `enregistrerSignature`. Serveur. |
| **Créer** `src/components/cadre-signature.tsx` | Le cadre tactile. Client. |
| **Créer** `src/app/espace/signature-actions.ts` + `.integration.test.ts` | Action salarié. |
| **Créer** `src/app/(app)/signature-actions.ts` + `.integration.test.ts` | Action Direction. |
| Modifier `src/lib/pdf/layout.tsx` | `PdfSignatureBox` : `image` + `mention`. |
| Modifier `src/lib/pdf/bulletin.tsx`, `demande-conge.tsx`, `contrat.tsx` | La case du salarié reçoit tracé et mention. |
| Modifier `src/lib/pdf/bulletin-buffer.ts`, `contrat-buffer.ts`, `src/app/(app)/conges/demande/[id]/route.ts`, `src/app/espace/bulletin/[id]/route.ts`, `src/app/espace/contrat/[id]/route.ts` | Chargent la signature et la passent au document. |
| **Créer** `src/lib/pdf/signature.render.test.ts` | Rendu réel des quatre mentions. |
| **Créer** `src/components/bouton-signer.tsx` | Le bouton + la boîte de dialogue, partagé par les deux côtés. |
| Modifier `src/app/espace/documents/page.tsx`, `src/app/espace/conges/page.tsx` | Points d'entrée salarié. |
| Modifier `src/app/(app)/employes/[id]/dossier.tsx`, `src/app/(app)/employes/[id]/page.tsx`, `src/app/(app)/documents/page.tsx`, `src/app/(app)/conges/page.tsx` | Points d'entrée Direction. |

---

### Task 1 : le modèle et la migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260923090000_signature_electronique/migration.sql`
- Create: `prisma/migrations/20260923090000_signature_electronique/migration.integration.test.ts`

**Interfaces:**
- Produces: `SignatureElectronique` (Prisma), enums `CibleSignature` (`CONTRAT`|`BULLETIN`|`DEMANDE_CONGE`) et `ModeSignature` (`ESPACE_SALARIE`|`PRESENTIEL`).

- [ ] **Step 1 : le schéma**

Dans `prisma/schema.prisma`, à côté des autres enums (`LeaveStatus`, `PaymentStatus`) :

```prisma
/// Les trois documents qu'un salarié signe (cf. docs/superpowers/specs/2026-09-22-signature-electronique-design.md).
enum CibleSignature {
  CONTRAT
  BULLETIN
  DEMANDE_CONGE

  @@schema("public")
}

/// Signature faite SEUL depuis l'espace salarié, ou recueillie sur l'appareil de l'entreprise en
/// présence d'un responsable. La distinction est IMPRIMÉE sur le document : on n'écrit jamais
/// « depuis son espace salarié » sur un geste qui a eu lieu sur la tablette du bureau.
enum ModeSignature {
  ESPACE_SALARIE
  PRESENTIEL

  @@schema("public")
}
```

Puis le modèle, à la suite de `VersionBulletin` :

```prisma
/// Une signature par document. Le tracé est la FORME ; ce qui rend la signature opposable est
/// enregistré avec lui : qui (employeeId), quand (signeLe, horodatage SERVEUR), et quoi
/// (`donnees` + `empreinte`). Un document modifié après coup passe `obsolete` — la signature
/// n'est jamais effacée.
model SignatureElectronique {
  id            String         @id @default(uuid())
  cible         CibleSignature
  cibleId       String // id du Contrat / PayrollLine / LeaveRequest
  employeeId    String
  employee      Employee       @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  /// PNG du tracé (bucket privé, `/fichiers/signatures/<cible>/<cibleId>.png`).
  /// NULL = contrat accepté au CLIC avant le 2026-09-22 : il n'y a jamais eu de tracé.
  traceUrl      String?
  signeLe       DateTime       @default(now())
  mode          ModeSignature
  /// Compte Direction qui a présenté l'appareil — obligatoire en PRESENTIEL, null sinon.
  presenteParId String?
  presentePar   User?          @relation("SignaturePresenteePar", fields: [presenteParId], references: [id])

  /// Instantané canonique des données signées, et son SHA-256.
  donnees       Json
  empreinte     String
  obsolete      Boolean        @default(false)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@unique([cible, cibleId])
  @@index([employeeId])
  @@schema("public")
}
```

Relations inverses : dans `model Employee`, à la suite de `avantagesNature`, ajouter
`signatures            SignatureElectronique[]` ; dans `model User`, à la suite de
`pushSubscriptions`, ajouter
`signaturesPresentees  SignatureElectronique[] @relation("SignaturePresenteePar")`.

Run: `npx prisma validate && npx prisma generate`
Expected: schéma valide, client régénéré.

- [ ] **Step 2 : la migration**

Créer `prisma/migrations/20260923090000_signature_electronique/migration.sql` :

```sql
-- Signature électronique du salarié : tracé au doigt, horodatage serveur, empreinte des données.
-- Les contrats DÉJÀ acceptés au clic (avant ce lot) sont repris sans tracé — on ne fabrique pas
-- rétroactivement un geste qui n'a pas eu lieu ; le document l'écrira tel quel.

-- CreateEnum
CREATE TYPE "public"."CibleSignature" AS ENUM ('CONTRAT', 'BULLETIN', 'DEMANDE_CONGE');

-- CreateEnum
CREATE TYPE "public"."ModeSignature" AS ENUM ('ESPACE_SALARIE', 'PRESENTIEL');

-- CreateTable
CREATE TABLE "public"."SignatureElectronique" (
    "id" TEXT NOT NULL,
    "cible" "public"."CibleSignature" NOT NULL,
    "cibleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "traceUrl" TEXT,
    "signeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" "public"."ModeSignature" NOT NULL,
    "presenteParId" TEXT,
    "donnees" JSONB NOT NULL,
    "empreinte" TEXT NOT NULL,
    "obsolete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureElectronique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureElectronique_cible_cibleId_key" ON "public"."SignatureElectronique"("cible", "cibleId");

-- CreateIndex
CREATE INDEX "SignatureElectronique_employeeId_idx" ON "public"."SignatureElectronique"("employeeId");

-- AddForeignKey
ALTER TABLE "public"."SignatureElectronique" ADD CONSTRAINT "SignatureElectronique_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureElectronique" ADD CONSTRAINT "SignatureElectronique_presenteParId_fkey" FOREIGN KEY ("presenteParId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise des contrats acceptés au clic : signature SANS tracé, à la date d'acceptation.
-- `donnees`/`empreinte` sont laissés vides à dessein : ces contrats n'ont pas été signés sur un
-- instantané, et prétendre le contraire serait faux. L'application traite l'empreinte vide comme
-- « non vérifiable » et n'affiche jamais « modifié après signature » pour eux.
INSERT INTO "public"."SignatureElectronique"
  ("id", "cible", "cibleId", "employeeId", "traceUrl", "signeLe", "mode", "presenteParId", "donnees", "empreinte", "obsolete", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'CONTRAT', c."id", c."employeeId", NULL, c."accepteLe", 'ESPACE_SALARIE', NULL, '{}'::jsonb, '', false, NOW(), NOW()
FROM "public"."Contrat" c
WHERE c."accepteLe" IS NOT NULL;
```

- [ ] **Step 3 : test de la reprise**

Créer `prisma/migrations/20260923090000_signature_electronique/migration.integration.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Le Postgres embarqué applique le SCHÉMA (prisma db push), pas les migrations : la table existe,
// vide. Ce test exécute l'INSERT lu dans migration.sql — jamais recopié — et vérifie qu'il reprend
// exactement les contrats acceptés au clic, sans tracé.
const SQL = fs.readFileSync(path.join(__dirname, "migration.sql"), "utf8");
const INSERT = SQL.slice(SQL.indexOf('INSERT INTO "public"."SignatureElectronique"'));

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
  const emp = await prisma.employee.create({
    data: {
      matricule: "SG01-PEF", nom: "Test Signature", sexe: "F", etatCivil: "Célibataire", poste: "Test",
      secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 200, dateEmbauche: new Date("2025-01-01"), contrat: "CDD",
    },
  });
  const base = { employeeId: emp.id, type: "CDD" as const, dateDebut: new Date("2026-01-01"), salaireMensuel: 200, poste: "Test" };
  await prisma.contrat.create({ data: { ...base, accepteLe: new Date("2026-07-20T09:40:00Z") } });
  await prisma.contrat.create({ data: { ...base } }); // jamais accepté
}, 120_000);

afterAll(async () => { await fermer(); });

describe("migration signature_electronique", () => {
  it("la migration contient bien l'INSERT de reprise", () => {
    expect(INSERT).toContain('FROM "public"."Contrat"');
  });

  it("reprend les contrats acceptés au clic, sans tracé, à leur date — et eux seuls", async () => {
    await prisma.$executeRawUnsafe(INSERT);
    const sigs = await prisma.signatureElectronique.findMany({
      select: { cible: true, traceUrl: true, mode: true, signeLe: true, empreinte: true },
    });
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({ cible: "CONTRAT", traceUrl: null, mode: "ESPACE_SALARIE", empreinte: "" });
    expect(sigs[0].signeLe.toISOString()).toBe("2026-07-20T09:40:00.000Z");
  });
});
```

Si `contrat.create` refuse un champ, lire `model Contrat` dans le schéma et n'utiliser que ses champs requis.

Run: `npx vitest run prisma/migrations/20260923090000_signature_electronique/migration.integration.test.ts && npm run typecheck`
Expected: PASS, 2 tests.

- [ ] **Step 4 : commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260923090000_signature_electronique
git commit -m "feat(signature): le modèle — une signature par document, tracé, mode et empreinte

Les contrats déjà acceptés au clic sont repris sans tracé : on ne fabrique pas
rétroactivement un geste qui n'a pas eu lieu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2 : l'instantané et son empreinte

**Files:**
- Create: `src/lib/signature-document.ts`
- Create: `src/lib/signature-document.test.ts`

**Interfaces:**
- Consumes: `CibleSignature` (Task 1).
- Produces:
  - `type Instantane = Record<string, string | number | null>`
  - `canonique(o: Instantane): string` — JSON à clés triées.
  - `empreinteDe(o: Instantane): string` — SHA-256 hex de `canonique(o)`.
  - `instantaneBulletin(l): Instantane`, `instantaneContrat(c): Instantane`, `instantaneDemandeConge(d): Instantane` — chacune prend l'objet Prisma (relations incluses précisées ci-dessous) et renvoie l'instantané.

- [ ] **Step 1 : les tests qui échouent**

Créer `src/lib/signature-document.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { canonique, empreinteDe, instantaneBulletin, instantaneContrat, instantaneDemandeConge } from "./signature-document";

const bulletin = {
  id: "l1",
  payrollRun: { mois: 9, annee: 2026, tauxChangeUtilise: 2800 },
  employee: { matricule: "PEF-007" },
  salBrutUSD: 418.51, cnssSalarieUSD: 15.19, iprCalculeUSD: 34.83, transportUSD: 114.78,
  primesUSD: 0, acompteUSD: 0, retenuePretUSD: 0, allocFamilialeUSD: 0, fraisMedicauxUSD: 0,
  salNetUSD: 368.5, statutPaiement: "VALIDE",
};

describe("canonique — l'ordre des clés ne change pas l'empreinte", () => {
  it("deux objets aux mêmes données, clés dans un autre ordre, donnent la même chaîne", () => {
    expect(canonique({ b: "2", a: "1" })).toBe(canonique({ a: "1", b: "2" }));
  });
  it("empreinteDe est un SHA-256 hexadécimal de 64 caractères", () => {
    expect(empreinteDe({ a: "1" })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("instantaneBulletin", () => {
  it("porte la période, le matricule, les montants et le statut", () => {
    const i = instantaneBulletin(bulletin as never);
    expect(i).toMatchObject({
      periode: "2026-09", matricule: "PEF-007", brut: "418.51", cnss: "15.19", ipr: "34.83",
      transport: "114.78", salaireNet: "253.72", totalVerse: "368.50", statutPaiement: "VALIDE",
    });
  });
  it("un montant qui change change l'empreinte", () => {
    const a = empreinteDe(instantaneBulletin(bulletin as never));
    const b = empreinteDe(instantaneBulletin({ ...bulletin, salNetUSD: 368.51 } as never));
    expect(a).not.toBe(b);
  });
  it("le statut de paiement fait partie de ce qui est signé (VALIDÉ ≠ PAYÉ)", () => {
    const a = empreinteDe(instantaneBulletin(bulletin as never));
    const b = empreinteDe(instantaneBulletin({ ...bulletin, statutPaiement: "PAYE" } as never));
    expect(a).not.toBe(b);
  });
  it("les montants sont des chaînes à 2 décimales : 368,5 et 368,50 donnent la même empreinte", () => {
    const a = empreinteDe(instantaneBulletin(bulletin as never));
    const b = empreinteDe(instantaneBulletin({ ...bulletin, salNetUSD: 368.5000001 } as never));
    expect(a).toBe(b);
  });
});

describe("instantaneContrat", () => {
  const contrat = {
    id: "c1", type: "CDD", poste: "Cuisinière", dateDebut: new Date("2026-01-06T00:00:00Z"),
    dateFin: new Date("2026-12-31T00:00:00Z"), finPeriodeEssai: null, salaireMensuel: 250,
    devise: "USD", heuresHebdo: 48, employee: { matricule: "PEF-007" },
  };
  it("porte les conditions économiques", () => {
    expect(instantaneContrat(contrat as never)).toMatchObject({
      type: "CDD", poste: "Cuisinière", dateDebut: "2026-01-06", dateFin: "2026-12-31",
      salaire: "250.00", devise: "USD", heuresHebdo: "48.00", matricule: "PEF-007",
    });
  });
  it("un salaire qui change change l'empreinte", () => {
    const a = empreinteDe(instantaneContrat(contrat as never));
    const b = empreinteDe(instantaneContrat({ ...contrat, salaireMensuel: 260 } as never));
    expect(a).not.toBe(b);
  });
});

describe("instantaneDemandeConge", () => {
  const demande = {
    id: "d1", type: "Congé annuel", dateDebut: new Date("2026-08-03T00:00:00Z"),
    dateFin: new Date("2026-08-08T00:00:00Z"), nbJours: 6, statut: "APPROUVE",
    approuveParId: "u1", employee: { matricule: "PEF-007" },
  };
  it("porte le type, les dates, les jours et le statut", () => {
    expect(instantaneDemandeConge(demande as never)).toMatchObject({
      type: "Congé annuel", dateDebut: "2026-08-03", dateFin: "2026-08-08", nbJours: "6",
      statut: "APPROUVE", matricule: "PEF-007",
    });
  });
  it("un nombre de jours qui change change l'empreinte", () => {
    const a = empreinteDe(instantaneDemandeConge(demande as never));
    const b = empreinteDe(instantaneDemandeConge({ ...demande, nbJours: 5 } as never));
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec** — `npx vitest run src/lib/signature-document.test.ts` → module introuvable.

- [ ] **Step 3 : le module**

Créer `src/lib/signature-document.ts` :

```ts
import { createHash } from "node:crypto";
import { salaireNetUSD, totalVerseUSD } from "@/lib/paie-net";

/**
 * CE QUI EST SIGNÉ — l'instantané canonique des DONNÉES d'un document, et son empreinte.
 *
 * L'empreinte porte sur les données, JAMAIS sur le PDF rendu : la refonte du bas de bulletin du
 * 2026-09-22 (trois lignes) n'a pas changé un centime, et une empreinte du PDF aurait invalidé
 * toutes les signatures d'hier sans qu'aucun montant ne bouge.
 *
 * Les montants sont des CHAÎNES à deux décimales et les dates des `AAAA-MM-JJ` : 368,5 et
 * 368,5000001 doivent donner la même empreinte, sinon une simple relecture de la paie ferait
 * « changer » un document qui n'a pas bougé.
 */
export type Instantane = Record<string, string | null>;

type Montant = number | string | { toString(): string };
const usd = (v: Montant | null | undefined): string => (v === null || v === undefined ? "0.00" : Number(v.toString()).toFixed(2));
const jour = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** JSON à clés triées : l'ordre dans lequel on a construit l'objet ne doit pas peser. */
export function canonique(o: Instantane): string {
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

export function empreinteDe(o: Instantane): string {
  return createHash("sha256").update(canonique(o)).digest("hex");
}

type LigneBulletin = {
  payrollRun: { mois: number; annee: number };
  employee: { matricule: string };
  salBrutUSD: Montant; cnssSalarieUSD: Montant; iprCalculeUSD: Montant; transportUSD: Montant;
  primesUSD: Montant; acompteUSD: Montant; retenuePretUSD: Montant; allocFamilialeUSD: Montant;
  fraisMedicauxUSD: Montant; salNetUSD: Montant; statutPaiement: string;
};

/** Le salarié signe des MONTANTS : tout ce qui les compose entre dans l'empreinte. */
export function instantaneBulletin(l: LigneBulletin): Instantane {
  return {
    periode: `${l.payrollRun.annee}-${String(l.payrollRun.mois).padStart(2, "0")}`,
    matricule: l.employee.matricule,
    brut: usd(l.salBrutUSD),
    cnss: usd(l.cnssSalarieUSD),
    ipr: usd(l.iprCalculeUSD),
    transport: usd(l.transportUSD),
    primes: usd(l.primesUSD),
    acompte: usd(l.acompteUSD),
    retenuePret: usd(l.retenuePretUSD),
    allocFamiliale: usd(l.allocFamilialeUSD),
    fraisMedicaux: usd(l.fraisMedicauxUSD),
    salaireNet: usd(salaireNetUSD(l)),
    totalVerse: usd(totalVerseUSD(l)),
    statutPaiement: l.statutPaiement,
  };
}

type ContratSigne = {
  type: string; poste: string; dateDebut: Date; dateFin: Date | null; finPeriodeEssai: Date | null;
  salaireMensuel: Montant; devise: string; heuresHebdo: Montant; employee: { matricule: string };
};

/** Les conditions économiques du contrat — ce que `pdfAccepteObsolete` garde déjà par ailleurs. */
export function instantaneContrat(c: ContratSigne): Instantane {
  return {
    matricule: c.employee.matricule,
    type: c.type,
    poste: c.poste,
    dateDebut: jour(c.dateDebut),
    dateFin: jour(c.dateFin),
    finPeriodeEssai: jour(c.finPeriodeEssai),
    salaire: usd(c.salaireMensuel),
    devise: c.devise,
    heuresHebdo: usd(c.heuresHebdo),
  };
}

type DemandeSignee = {
  type: string; dateDebut: Date; dateFin: Date; nbJours: Montant; statut: string;
  approuveParId: string | null; employee: { matricule: string };
};

export function instantaneDemandeConge(d: DemandeSignee): Instantane {
  return {
    matricule: d.employee.matricule,
    type: d.type,
    dateDebut: jour(d.dateDebut),
    dateFin: jour(d.dateFin),
    nbJours: String(Number(d.nbJours.toString())),
    statut: d.statut,
    approuvePar: d.approuveParId,
  };
}
```

- [ ] **Step 4 : vérifier** — `npx vitest run src/lib/signature-document.test.ts src/lib/paie-net.test.ts && npm run typecheck && npx eslint src/lib/signature-document.ts src/lib/signature-document.test.ts`
Expected: PASS (le garde-fou de `paie-net` accepte ce fichier : il importe bien le module).

- [ ] **Step 5 : commit**

```bash
git add src/lib/signature-document.ts src/lib/signature-document.test.ts
git commit -m "feat(signature): l'instantané canonique d'un document et son empreinte

L'empreinte porte sur les DONNÉES, jamais sur le PDF rendu : une refonte de mise
en page ne doit pas invalider une signature.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3 : lire et écrire une signature

**Files:**
- Create: `src/lib/signature.ts`
- Create: `src/lib/signature.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (modèle), Task 2 (instantanés).
- Produces, dans `src/lib/signature.ts` :
  - `type SignatureVue = { traceUrl: string | null; signeLe: Date; mode: ModeSignature; nomSalarie: string; matricule: string; nomPresentePar: string | null; obsolete: boolean }`
  - `instantaneDe(client, cible, cibleId): Promise<Instantane | null>` — relit le document et renvoie son instantané, `null` si introuvable.
  - `chargerSignature(client, cible, cibleId): Promise<SignatureVue | null>` — lit la signature, **recalcule l'instantané et persiste `obsolete: true`** si l'empreinte diffère (empreinte vide = contrat repris, jamais marqué obsolète).
  - `enregistrerSignature(client, params): Promise<void>` — écrit (upsert si l'ancienne est obsolète), refuse sinon.
  - `documentSignable(client, cible, cibleId): Promise<{ ok: true; employeeId: string } | { ok: false; raison: string }>` — état du document (bulletin VALIDE/PAYE, congé APPROUVE, contrat ACTIF).

- [ ] **Step 1 : le test d'intégration qui échoue**

Créer `src/lib/signature.integration.test.ts`, sur le patron de `src/lib/conges-couverture.integration.test.ts` (mock Proxy de `@/lib/prisma`, `creerBaseTest`, `beforeAll(…, 120_000)`). Les cas :

```
« un bulletin VALIDÉ est signable » → documentSignable ok, employeeId correct
« un bulletin en BROUILLON ne l'est pas » → ok: false, raison contient « validé »
« une demande EN_ATTENTE ne l'est pas » → ok: false, raison contient « approuvée »
« enregistrerSignature écrit le tracé, le mode et l'empreinte » → ligne créée, empreinte = empreinteDe(instantané)
« signer deux fois le même document est refusé » → rejette
« chargerSignature marque obsolète quand un montant a changé » →
   signer, puis prisma.payrollLine.update({ salNetUSD: +1 }), puis chargerSignature →
   obsolete true EN BASE, et la vue le dit
« une signature reprise (empreinte vide) n'est jamais marquée obsolète » →
   créer une ligne empreinte "" ; chargerSignature → obsolete reste false
```

- [ ] **Step 2 : lancer, vérifier l'échec** — module introuvable.

- [ ] **Step 3 : le module**

Créer `src/lib/signature.ts`. Points imposés :

- `import "server-only";`
- Un type `ClientSignature = Prisma.TransactionClient` — l'idiome exact de `lib/acompte-plafond.ts:127` (`type ClientLecture = Prisma.TransactionClient`), qui laisse les tests injecter le client du Postgres embarqué.
- `instantaneDe` charge avec les relations nécessaires : bulletin → `{ payrollRun: true, employee: { select: { matricule: true } } }` ; contrat et demande → `{ employee: { select: { matricule: true } } }`.
- `chargerSignature` : si `sig.empreinte === ""` → ne compare rien (contrat repris) ; sinon recalcule, et si différent et `!sig.obsolete` → `update({ obsolete: true })` **et** renvoie `obsolete: true`.
- `enregistrerSignature(client, { cible, cibleId, employeeId, traceUrl, mode, presenteParId })` : calcule l'instantané, refuse si le document n'est pas signable, refuse si une signature non obsolète existe déjà (`throw new Error("Ce document est déjà signé.")`), sinon `upsert` sur `[cible, cibleId]` avec `signeLe: new Date()`.
- `documentSignable` : bulletin → `statutPaiement in (VALIDE, PAYE)` sinon « Un bulletin doit être validé avant d'être signé. » ; congé → `statut === "APPROUVE"` sinon « Une demande de congé doit être approuvée avant d'être signée. » ; contrat → `statut === "ACTIF"` sinon « Ce contrat n'est plus actif. »

- [ ] **Step 4 : vérifier** — `npx vitest run src/lib/signature.integration.test.ts && npm run typecheck && npx eslint src/lib/signature.ts src/lib/signature.integration.test.ts`

- [ ] **Step 5 : commit** — `feat(signature): lire et écrire une signature, avec détection du document modifié` + trailer.

---

### Task 4 : le cadre de signature

**Files:**
- Create: `src/components/cadre-signature.tsx`

**Interfaces:**
- Produces: `CadreSignature({ onSigner, enCours, bandeau }: { onSigner: (pngDataUrl: string) => void; enCours: boolean; bandeau?: string })`.

- [ ] **Step 1 : le composant**

```tsx
"use client";

import { useRef, useState } from "react";

/**
 * LE CADRE DE SIGNATURE — on trace au doigt, on obtient un PNG.
 *
 * `touch-action: none` sur le canvas : sans lui, le geste fait défiler la page au lieu de tracer
 * (constaté sur téléphone). Le tracé est exporté à 2× pour rester net à l'impression, sur fond
 * TRANSPARENT (il se pose sur la ligne de signature du document).
 *
 * Le composant ne décide de rien : il rend un PNG. Qui signe, quand, et dans quel mode sont
 * décidés par la garde serveur — jamais ici.
 */
export function CadreSignature({
  onSigner,
  enCours,
  bandeau,
}: {
  onSigner: (pngDataUrl: string) => void;
  enCours: boolean;
  bandeau?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dernier = useRef<{ x: number; y: number } | null>(null);
  const [points, setPoints] = useState(0);

  const contexte = () => {
    const c = ref.current;
    if (!c) return null;
    // Taille RÉELLE du canvas = taille CSS × 2 (netteté). Fixée à la première interaction, quand
    // la boîte de dialogue a sa largeur définitive.
    if (c.width === 0) {
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * 2);
      c.height = Math.round(r.height * 2);
    }
    const ctx = c.getContext("2d");
    if (ctx) { ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111827"; }
    return ctx;
  };

  const position = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 };
  };

  const debut = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    contexte();
    dernier.current = position(e);
    setPoints((n) => n + 1);
  };

  const trace = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dernier.current) return;
    const ctx = contexte();
    if (!ctx) return;
    const p = position(e);
    ctx.beginPath();
    ctx.moveTo(dernier.current.x, dernier.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dernier.current = p;
    setPoints((n) => n + 1);
  };

  const fin = () => { dernier.current = null; };

  const effacer = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setPoints(0);
  };

  return (
    <div className="space-y-3">
      {bandeau && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{bandeau}</p>}
      <canvas
        ref={ref}
        onPointerDown={debut}
        onPointerMove={(e) => e.buttons === 1 && trace(e)}
        onPointerUp={fin}
        onPointerLeave={fin}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-input bg-background"
        aria-label="Cadre de signature — tracez votre signature avec le doigt"
      />
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={effacer} disabled={enCours} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50">
          Effacer
        </button>
        <button
          type="button"
          disabled={enCours || points < 8}
          onClick={() => { const c = ref.current; if (c) onSigner(c.toDataURL("image/png")); }}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {enCours ? "Enregistrement…" : "Signer"}
        </button>
      </div>
      {points > 0 && points < 8 && <p className="text-xs text-muted-foreground">Tracez votre signature dans le cadre.</p>}
    </div>
  );
}
```

- [ ] **Step 2 : vérifier** — `npm run typecheck && npx eslint src/components/cadre-signature.tsx`

- [ ] **Step 3 : regarder à l'écran** — pas de compte de test dans le dépôt et le `.env` de dev pointe la production : **ne pas tenter de se connecter**. Dire dans le rapport que la vérification visuelle est reportée. (Si une page de démonstration isolée est montée pour l'essai, la supprimer avant de commiter.)

- [ ] **Step 4 : commit** — `feat(signature): le cadre de signature — on trace au doigt, on obtient un PNG` + trailer.

---

### Task 5 : les deux actions serveur

**Files:**
- Create: `src/app/espace/signature-actions.ts` + `src/app/espace/signature-actions.integration.test.ts`
- Create: `src/app/(app)/signature-actions.ts` + `src/app/(app)/signature-actions.integration.test.ts`

**Interfaces:**
- Consumes: `enregistrerSignature`, `documentSignable` (Task 3) ; `televerserFichier` (`lib/storage`) ; `journaliser` (`lib/audit`) ; `creerNotification`, `notifierSalarie` (`lib/notifications`).
- Produces:
  - `signerMonDocument(cible: CibleSignature, cibleId: string, pngDataUrl: string): Promise<{ erreur: string } | void>` (espace salarié).
  - `faireSignerDocument(cible: CibleSignature, cibleId: string, pngDataUrl: string): Promise<{ erreur: string } | void>` (Direction).
  Les deux passent par `actionLisible` (`lib/action-lisible.ts` — lire son idiome).

- [ ] **Step 1 : le décodage du PNG, testé**

Le PNG arrive en `data:image/png;base64,…`. **Ne jamais faire confiance au client** : une fonction partagée, placée dans `src/lib/signature.ts` (Task 3) et testée dans `src/lib/signature-document.test.ts` ou un test dédié :

```ts
/** Décode le tracé envoyé par le navigateur. Refuse tout ce qui n'est pas un PNG plausible. */
export function decoderTrace(dataUrl: string): Buffer {
  const prefixe = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefixe)) throw new Error("Signature illisible.");
  const buf = Buffer.from(dataUrl.slice(prefixe.length), "base64");
  // En-tête PNG : 89 50 4E 47 0D 0A 1A 0A
  const enTete = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 100 || !buf.subarray(0, 8).equals(enTete)) throw new Error("Signature illisible.");
  if (buf.length > 400_000) throw new Error("Signature trop lourde.");
  return buf;
}
```
Tests : un PNG valide passe ; un `data:image/svg+xml` est refusé ; un base64 quelconque est refusé ; 500 ko est refusé.

- [ ] **Step 2 : les tests d'intégration qui échouent**

`src/app/espace/signature-actions.integration.test.ts` (patron : `src/app/(app)/planning/generation-feries.integration.test.ts` — `vi.hoisted` + Proxy sur `@/lib/prisma`, mock de `@/lib/auth`, de `next/cache`, de `@/lib/storage` (`televerserFichier` renvoie un chemin factice), de `@/lib/notifications`) :

```
« le salarié signe son bulletin validé » → ligne créée, mode ESPACE_SALARIE, presenteParId null,
   traceUrl = le chemin renvoyé par televerserFichier
« il ne peut pas signer le bulletin d'un collègue » → erreur, aucune ligne créée
« il ne peut pas signer un bulletin en brouillon » → erreur, aucune ligne créée
« il ne peut pas signer deux fois » → erreur
« un tracé qui n'est pas un PNG est refusé » → erreur « Signature illisible. »
```

`src/app/(app)/signature-actions.integration.test.ts` :

```
« la Direction fait signer » → mode PRESENTIEL, presenteParId = l'utilisateur connecté
« un compte VIEWER est refusé »
« le mode envoyé par le client est ignoré » → même si l'appel passe un mode, la ligne est PRESENTIEL
```

- [ ] **Step 3 : les actions**

Points imposés :
- Espace : `verifySession` → `estSalarie(user)` et `user.employeeId` ; `documentSignable` ; **vérifier que le document appartient à `user.employeeId`** (c'est `documentSignable` qui renvoie l'`employeeId` — comparer) ; `decoderTrace` ; `televerserFichier(\`signatures/${cible.toLowerCase()}/${cibleId}.png\`, buf, "image/png")` ; `enregistrerSignature` avec `mode: "ESPACE_SALARIE"`, `presenteParId: null` ; `journaliser` ; `creerNotification` (la Direction est prévenue) ; `revalidatePath` des pages concernées.
- Direction : `requireRole(user, ["ADMIN", "MANAGER"])` ; même suite, `mode: "PRESENTIEL"`, `presenteParId: user.id` ; `notifierSalarie` (le salarié voit que son document est signé) ; `journaliser`.
- Aucune des deux actions n'accepte un paramètre `mode` : la signature de fonction ne le porte pas.

- [ ] **Step 4 : vérifier** — les deux tests d'intégration + `npm run typecheck` + `npx eslint` sur les quatre fichiers.

- [ ] **Step 5 : commit** — `feat(signature): les deux actions — le mode est décidé par la garde, jamais par le navigateur` + trailer.

---

### Task 6 : sur le document

**Files:**
- Modify: `src/lib/pdf/layout.tsx` (`PdfSignatureBox`, styles ~50-65)
- Modify: `src/lib/pdf/bulletin.tsx` (bloc `styles.signatures`), `src/lib/pdf/demande-conge.tsx` (~195-199), `src/lib/pdf/contrat.tsx` (~213)
- Modify: `src/lib/pdf/bulletin-buffer.ts`, `src/lib/pdf/contrat-buffer.ts`, `src/app/(app)/conges/demande/[id]/route.ts`, `src/app/espace/bulletin/[id]/route.ts`, `src/app/espace/contrat/[id]/route.ts`
- Create: `src/lib/pdf/signature.render.test.ts`

**Interfaces:**
- Consumes: `chargerSignature` (Task 3), `lireFichier` (`lib/storage`).
- Produces:
  - `PdfSignatureBox({ label, signe, large, image, mention })` — `image?: string | { data: Buffer; format: "png" | "jpg" }`, `mention?: string`.
  - `mentionSignature(v: SignatureVue): string` dans `src/lib/signature.ts` — construit la phrase (les quatre formes des contraintes globales, heure de Kinshasa).
  - `type SignatureImprimable = { image: { data: Buffer; format: "png" } | null; mention: string }` — ce que les buffers passent aux documents.

- [ ] **Step 1 : le test de rendu qui échoue**

Créer `src/lib/pdf/signature.render.test.ts` sur le patron de `src/lib/pdf/bulletin.render.test.ts` (fixtures en mémoire, `renderPdfBuffer`, extraction par `pdf-parse`). Quatre cas, sur le bulletin :

```
espace salarié → le texte contient « Signé électroniquement par Aimée Mutita (matricule PEF-007) »
                 et « depuis son espace salarié »
présentiel     → « en présence de Dominique Tshiongo », et PAS « depuis son espace salarié »
obsolète       → « Document modifié après signature » ; le PDF ne contient AUCUNE image de tracé
                 (vérifier que le nombre d'objets image du PDF est celui d'un bulletin non signé)
non signé      → la case « Signature du salarié » est là, sans mention
```

Pour le cas « pas de tracé », la comparaison la plus simple est le **nombre d'occurrences de `/Subtype /Image`** dans le PDF : signé non obsolète > signé obsolète == non signé.

- [ ] **Step 2 : `PdfSignatureBox`**

```tsx
export function PdfSignatureBox({
  label,
  signe,
  large = false,
  image,
  mention,
}: {
  label: string;
  signe: boolean;
  large?: boolean;
  /** Tracé du salarié (PNG). La signature de la DIRECTRICE reste pilotée par `signe`. */
  image?: string | { data: Buffer; format: "png" | "jpg" };
  /** Ligne sous le trait : qui a signé, quand, et dans quelles conditions. */
  mention?: string;
}) {
  const aSignature = signe && signatureDirectriceDisponible();
  return (
    <View style={large ? styles.signatureBoxLarge : styles.signatureBox}>
      {image ? (
        <Image src={image} style={large ? styles.signatureImageLarge : styles.signatureImage} />
      ) : (
        aSignature && <Image src={SIGNATURE_DIRECTRICE_PATH} style={large ? styles.signatureImageLarge : styles.signatureImage} />
      )}
      <Text style={styles.signatureLine}>{label}</Text>
      {mention && <Text style={styles.signatureMention}>{mention}</Text>}
    </View>
  );
}
```
Ajouter le style : `signatureMention: { marginTop: 2, fontSize: 5.8, color: pdfColors.textMuted, lineHeight: 1.25 }`.
⚠️ La case du salarié grandit d'une à deux lignes : vérifier que `signatureBox` (`height: 60`) ne tronque pas la mention — la passer à `height: 74` si besoin, et regarder le rendu (Step 5).

- [ ] **Step 3 : les trois documents**

Chacun reçoit une propriété optionnelle `signatureSalarie?: SignatureImprimable` :
- `bulletin.tsx` : `<PdfSignatureBox label="Signature du salarié" signe={false} image={signatureSalarie?.image ?? undefined} mention={signatureSalarie?.mention} />`
- `demande-conge.tsx` : remplacer le `<View style={{ width: "45%" }}><Text …>Signature du salarié</Text></View>` par un `PdfSignatureBox` de même largeur, avec les mêmes propriétés.
- `contrat.tsx` : la ligne `{accepteLe && <Text style={styles.accepte}>Accepté numériquement le …</Text>}` **reste** (historique) ; la case de signature du salarié reçoit tracé et mention. Si le contrat n'a pas de case `PdfSignatureBox` pour le salarié, en ajouter une à côté de celle de la direction, même gabarit.

- [ ] **Step 4 : les buffers chargent la signature**

Dans `bulletin-buffer.ts`, `contrat-buffer.ts`, `conges/demande/[id]/route.ts` et les deux routes de l'espace : après avoir chargé le document,
```ts
const sig = await chargerSignature(prisma, "BULLETIN", ligne.id);
const trace = sig?.traceUrl && !sig.obsolete ? await lireFichier(sig.traceUrl) : null;
const signatureSalarie = sig ? { image: trace ? { data: trace, format: "png" as const } : null, mention: mentionSignature(sig) } : undefined;
```
et passer `signatureSalarie` au document. Les cinq points d'entrée doivent le faire — un bulletin ouvert depuis l'espace salarié et depuis la Direction doit montrer la même chose.

- [ ] **Step 5 : vérifier, et REGARDER le PDF** — lancer le test de rendu, puis écrire un bulletin signé dans le scratchpad, le convertir en PNG (`sips -s format png --resampleWidth 1600`) et le lire : le tracé est dans la case, la mention tient sur une ou deux lignes sans déborder, rien ne chevauche. Retirer l'écriture du fichier avant de commiter.

- [ ] **Step 6 : commit** — `feat(signature): le document porte le tracé et dit la vérité sur le geste` + trailer.

---

### Task 7 : les points d'entrée

**Files:**
- Create: `src/components/bouton-signer.tsx`
- Modify: `src/app/espace/documents/page.tsx`, `src/app/espace/conges/page.tsx`
- Modify: `src/app/(app)/employes/[id]/dossier.tsx`, `src/app/(app)/employes/[id]/page.tsx`, `src/app/(app)/documents/page.tsx`, `src/app/(app)/conges/page.tsx`

**Interfaces:**
- Consumes: `CadreSignature` (Task 4), les deux actions (Task 5), `chargerSignature` (Task 3).
- Produces: `BoutonSigner({ cible, cibleId, nomSalarie, cote, etat })` — `cote: "SALARIE" | "DIRECTION"` choisit l'action appelée et le bandeau ; `etat: "A_SIGNER" | "SIGNE" | "A_RESIGNER"` choisit le libellé.

- [ ] **Step 1 : le bouton et sa boîte de dialogue**

Composant client : un bouton (`Signer` / `Signé le …` / `À resigner`) qui ouvre une boîte de dialogue contenant `CadreSignature`. Côté Direction, le bandeau : `Remettez l'appareil à <nomSalarie>. En signant, il ou elle reconnaît avoir pris connaissance de ce document.` Le retour d'erreur de l'action s'affiche dans la boîte (idiome `estErreur` de `lib/action-lisible`, comme `types-conges-admin.tsx`). Rendu via portail dans `<body>` si la coquille de l'app coupe (idiome de `bulletin-viewer.tsx`).

- [ ] **Step 2 : l'espace salarié**

`espace/documents/page.tsx` : charger les signatures des bulletins et contrats affichés (une requête `signatureElectronique.findMany({ where: { cible: …, cibleId: { in: […] } } })`, pas une par ligne), et poser un `BoutonSigner` `cote="SALARIE"` sur chaque bulletin VALIDÉ/PAYÉ et chaque contrat actif. `espace/conges/page.tsx` : idem sur les demandes APPROUVÉES.

- [ ] **Step 3 : la Direction**

- `employes/[id]/dossier.tsx`, onglet Contrats : à côté de « Accepté par le salarié le … », un `BoutonSigner` `cote="DIRECTION"`.
- `employes/[id]/page.tsx`, historique de paie : une colonne « Signature » (état + bouton).
- `documents/page.tsx`, liste des bulletins : même colonne.
- `conges/page.tsx`, demandes approuvées : le bouton à côté du lien PDF.

Chaque écran affiche l'état : **À signer**, **Signé le JJ/MM/AAAA**, ou **À resigner** en orange.

- [ ] **Step 4 : vérifier** — `npm run typecheck` ; `npx eslint` sur les sept fichiers ; `npx vitest run src/lib/paie-net.test.ts` (le garde-fou : ces écrans lisent des lignes de paie). Vérification à l'écran impossible (pas de compte de test) : le dire.

- [ ] **Step 5 : commit** — `feat(signature): signer depuis l'espace salarié, ou sur l'appareil de la Direction` + trailer.

---

### Task 8 : suite complète, lint, relecture

**Files:** aucun nouveau (sauf correctifs).

- [ ] **Step 1 : suite complète** — `npm run typecheck && npm test` → tout vert. Puis vérifier que le lot n'a touché aucun calcul :
```bash
git diff --stat main -- src/lib/payroll.ts src/lib/payroll.test.ts src/lib/paie-batch.ts src/lib/paie-net.ts src/lib/bulletin-live.ts
```
doit être **vide**. Sinon STOP et rapporter.

- [ ] **Step 2 : lint** — `npx eslint $(git diff --name-only --diff-filter=AM main -- '*.ts' '*.tsx' | grep -v "^docs/")` ; les problèmes **préexistants sur `main`** ne sont pas les nôtres : le prouver fichier:ligne.

- [ ] **Step 3 : commit** s'il y a eu des correctifs ; sinon rien.

- [ ] **Step 4 : relecture finale** (contrôleur) — agent de relecture sur `git diff main`, consignes : aucun calcul touché ; le mode ne peut pas être forcé par le client ; un salarié ne peut signer que ses documents ; l'obsolescence est détectée et persistée ; le tracé n'est jamais affiché sur un document obsolète ; les quatre mentions sont exactes au mot près ; le PNG est validé côté serveur. Verdict « fusionnable » exigé.

- [ ] **Step 5 : fusion et déploiement** (contrôleur) —
```bash
git checkout main && git merge --no-ff feat/signature-electronique -m "Merge branch 'feat/signature-electronique'"
npm test && git push origin main && npm run deployer
```
Après déploiement : faire signer un bulletin depuis l'espace salarié et un autre depuis la Direction, ouvrir les deux PDF, vérifier les deux mentions ; puis recalculer la paie du mois et rouvrir le premier — il doit porter « Document modifié après signature » sans tracé.
