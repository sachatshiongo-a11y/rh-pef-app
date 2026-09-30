import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : TOUT CHEMIN QUI ÉCRIT UN ARTICLE OU UN STOCK EST CONNU, ET CLASSÉ.
 *
 * Règle de Sacha (2026-09-30) : hors Direction, un article de l'inventaire (désignation, prix,
 * seuils, catégorie…) et sa quantité hors flux normal ne changent qu'après validation de la
 * Direction. Le jour où quelqu'un ajoute un nouvel écran qui écrit `ArticleStock` ou `Stock`, rien
 * ne l'obligerait à y penser : ce test parcourt `src/` À CHAQUE PASSAGE, trouve les fichiers qui
 * écrivent ces tables (appel Prisma ou SQL brut), et exige que chacun soit CLASSÉ ci-dessous avec
 * son sort. Un fichier nouveau non classé fait échouer ; un classement devenu faux (fichier
 * disparu) aussi ; et si l'énumération ne trouve presque plus rien, c'est elle qui est cassée.
 *
 * Ce qu'il ne couvre PAS : il prouve que le fichier est classé, pas que chaque action du fichier
 * respecte son sort — ce sont les tests d'intégration (a-valider/*.integration.test.ts) qui
 * vérifient qu'un compte non-Direction ne passe pas.
 *
 * Et : les CŒURS d'écriture partagés (reglement.ts, comptage.ts, article.ts, demandes.ts) ne doivent
 * JAMAIS être exportés d'un fichier « use server » — ils y deviendraient des actions serveur
 * appelables par n'importe quel compte, sans garde.
 */

const SRC = path.join(__dirname, "..", "..");

type Sort = "DIRECTION_SEULE" | "PROPOSITION_HORS_DIRECTION" | "FLUX_NORMAL" | "COEUR_PARTAGE";

const CLASSEMENT: Record<string, { sort: Sort; pourquoi: string }> = {
  "app/(stock)/stock/catalogue/actions.ts": { sort: "PROPOSITION_HORS_DIRECTION", pourquoi: "modifierArticle + actions groupées : proposition hors Direction ; fusion et correction des stocks négatifs : Direction seule ; création : permise, signalée, sans stock initial." },
  "app/(stock)/stock/entree/actions.ts": { sort: "FLUX_NORMAL", pourquoi: "Liste d'achat : entrée de stock (flux normal) ; article créé à la volée permis et signalé." },
  "app/(stock)/stock/factures/actions.ts": { sort: "FLUX_NORMAL", pourquoi: "Facture avec lignes : entrée de stock (flux normal) ; suppression (reprise du stock) : Direction seule." },
  "app/(stock)/stock/mouvements/actions.ts": { sort: "FLUX_NORMAL", pourquoi: "Entrées/sorties manuelles (flux normal) ; suppression de mouvements : Direction seule." },
  "app/(stock)/stock/fiches/import-bar-actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import des fiches du bar (crée/complète des articles) : requireRole ADMIN." },
  "app/(stock)/stock/journalier/import-commande-actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import du classeur Commande (rang, rubrique, nom court) : requireRole ADMIN." },
  "app/(stock)/stock/fournisseurs/actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Fusion de fournisseurs (réaffecte les articles) : garde ADMIN du fichier." },
  "lib/import-inventaire.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import d'inventaire : appelé seulement par imports/actions.ts (gardeDirection)." },
  "lib/import-mouvements.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import de mouvements : appelé seulement par imports/actions.ts (gardeDirection)." },
  "lib/validations-stock/article.ts": { sort: "COEUR_PARTAGE", pourquoi: "Écriture d'un patch d'article : geste direct de la Direction ou proposition validée." },
  "lib/validations-stock/comptage.ts": { sort: "COEUR_PARTAGE", pourquoi: "Écriture d'un comptage : Direction, comptage sans écart, ou réconciliation validée." },
};

// Union PLATE de deux détections indépendantes (ne pas « simplifier » en une seule) : l'appel Prisma
// et le SQL brut. L'une ne voit pas l'autre.
const ECRIT_PRISMA = /\b(?:articleStock|stock)\.(?:update|updateMany|upsert|create|createMany|delete|deleteMany)\s*\(/;
const ECRIT_SQL = /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"stock"\."(?:Stock|ArticleStock)"/i;

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const ecrivains = () => fichiers(SRC).filter((p) => { const s = fs.readFileSync(p, "utf8"); return ECRIT_PRISMA.test(s) || ECRIT_SQL.test(s); }).map(rel).sort();

describe("chemins d'écriture des articles et des stocks", () => {
  it("chaque fichier qui écrit ArticleStock/Stock est classé (aucun oubli)", () => {
    expect(ecrivains().filter((f) => !(f in CLASSEMENT))).toEqual([]);
  });
  it("aucun classement périmé (le fichier écrit toujours)", () => {
    const trouves = new Set(ecrivains());
    expect(Object.keys(CLASSEMENT).filter((f) => !trouves.has(f))).toEqual([]);
  });
  it("plancher anti-silence : l'énumération trouve bien les écrivains connus", () => {
    expect(ecrivains().length).toBeGreaterThanOrEqual(10);
  });
  it("la détection reconnaît les deux formes (falsification en sens inverse inclus)", () => {
    expect(ECRIT_PRISMA.test("await tx.stock.upsert({")).toBe(true);
    expect(ECRIT_PRISMA.test("prisma.articleStock.updateMany({")).toBe(true);
    expect(ECRIT_SQL.test('UPDATE "stock"."Stock" AS s SET')).toBe(true);
    expect(ECRIT_PRISMA.test("prisma.stock.findMany({")).toBe(false);
    expect(ECRIT_SQL.test('SELECT "id" FROM "stock"."Stock" FOR UPDATE')).toBe(false);
  });
});

// ── Même principe pour l'ARGENT des factures fournisseurs : « payer = Direction ». ──────────────
// Tout fichier qui écrit FactureFournisseur ou Paiement est classé ; un nouvel écran qui réglerait une
// facture sans passer par reglement.ts (donc sans demande hors Direction) fait échouer ce test.
const CLASSEMENT_ARGENT: Record<string, { sort: Sort; pourquoi: string }> = {
  "app/(stock)/stock/factures/actions.ts": { sort: "PROPOSITION_HORS_DIRECTION", pourquoi: "Règlements : demande hors Direction (demandes.ts), cœur reglement.ts pour la Direction ; création sans montant réglé hors Direction ; suppressions Direction seule." },
  "app/(stock)/stock/fournisseurs/actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Fusion de fournisseurs : rattache les factures (ni montant ni statut), garde ADMIN." },
  "lib/import-factures.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import du suivi des factures : imports/actions.ts (gardeDirection)." },
  "lib/import-inventaire.ts": { sort: "DIRECTION_SEULE", pourquoi: "Annulation d'un import (supprime les factures importées) : imports/actions.ts (gardeDirection)." },
  "lib/validations-stock/reglement.ts": { sort: "COEUR_PARTAGE", pourquoi: "Cœur des règlements : geste direct de la Direction ou demande validée." },
};
const ECRIT_ARGENT_PRISMA = /\b(?:factureFournisseur|paiement)\.(?:update|updateMany|upsert|create|createMany|delete|deleteMany)\s*\(/;
const ECRIT_ARGENT_SQL = /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"stock"\."(?:FactureFournisseur|Paiement)"/i;
const ecrivainsArgent = () => fichiers(SRC).filter((p) => { const s = fs.readFileSync(p, "utf8"); return ECRIT_ARGENT_PRISMA.test(s) || ECRIT_ARGENT_SQL.test(s); }).map(rel).sort();

describe("chemins d'écriture des factures et paiements", () => {
  it("chaque fichier qui écrit FactureFournisseur/Paiement est classé", () => {
    expect(ecrivainsArgent().filter((f) => !(f in CLASSEMENT_ARGENT))).toEqual([]);
  });
  it("aucun classement périmé", () => {
    const trouves = new Set(ecrivainsArgent());
    expect(Object.keys(CLASSEMENT_ARGENT).filter((f) => !trouves.has(f))).toEqual([]);
  });
  it("plancher anti-silence et détection des deux formes", () => {
    expect(ecrivainsArgent().length).toBeGreaterThanOrEqual(5);
    expect(ECRIT_ARGENT_PRISMA.test("tx.paiement.create({")).toBe(true);
    expect(ECRIT_ARGENT_SQL.test('INSERT INTO "stock"."Paiement" ("id"')).toBe(true);
    expect(ECRIT_ARGENT_PRISMA.test("prisma.paiement.findMany({")).toBe(false);
  });
});

describe("cœurs d'écriture jamais exposés comme actions serveur", () => {
  const COEURS = ["reglerFactureTx", "reglerLotTx", "ecrireComptageTx", "appliquerPatchArticleTx", "validerDemande", "refuserDemande", "retirerDemande", "demanderPaiement", "proposerModifications", "appliquerOuDemanderComptage", "verrouillerFacture"];
  it("aucun fichier « use server » ne ré-exporte un cœur", () => {
    const fautifs: string[] = [];
    for (const p of fichiers(path.join(SRC, "app"))) {
      const s = fs.readFileSync(p, "utf8");
      if (!/^\s*["']use server["']/.test(s)) continue;
      for (const c of COEURS) {
        if (new RegExp(`export\\s*\\{[^}]*\\b${c}\\b|export\\s+(?:async\\s+)?(?:function|const)\\s+${c}\\b`).test(s)) fautifs.push(`${rel(p)} → ${c}`);
      }
    }
    expect(fautifs).toEqual([]);
  });
});
