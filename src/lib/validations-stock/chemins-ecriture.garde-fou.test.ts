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
  "app/(stock)/stock/entree/actions.ts": { sort: "FLUX_NORMAL", pourquoi: "Liste d'achat : vrai achat (fournisseur, montant), libre — décision du 2026-10-01 ; article créé à la volée permis et signalé." },
  "app/(stock)/stock/factures/actions.ts": { sort: "FLUX_NORMAL", pourquoi: "Facture avec lignes : entrée de stock (flux normal) ; suppression (reprise du stock) : Direction seule." },
  "app/(stock)/stock/mouvements/actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Suppression de mouvements (reprise du stock) : Direction seule. Les entrées/sorties manuelles passent par lib/validations-stock/mouvement.ts (appliquerMouvementManuel)." },
  "app/(stock)/stock/fiches/import-bar-actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import des fiches du bar (crée/complète des articles) : requireRole ADMIN." },
  "app/(stock)/stock/journalier/import-commande-actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import du classeur Commande (rang, rubrique, nom court) : requireRole ADMIN." },
  "app/(stock)/stock/fournisseurs/actions.ts": { sort: "DIRECTION_SEULE", pourquoi: "Fusion de fournisseurs (réaffecte les articles) : garde ADMIN du fichier." },
  "lib/import-inventaire.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import d'inventaire : appelé seulement par imports/actions.ts (gardeDirection)." },
  "lib/import-mouvements.ts": { sort: "DIRECTION_SEULE", pourquoi: "Import de mouvements : appelé seulement par imports/actions.ts (gardeDirection)." },
  "lib/validations-stock/article.ts": { sort: "COEUR_PARTAGE", pourquoi: "Écriture d'un patch d'article : geste direct de la Direction ou proposition validée." },
  "lib/validations-stock/mouvement.ts": { sort: "COEUR_PARTAGE", pourquoi: "Entrées/sorties manuelles : libres pour tout compte Stock et notifiées à la Direction (décision du 2026-10-07) ; validation des ANCIENNES demandes MOUVEMENT_MANUEL encore en attente." },
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
  const COEURS = ["reglerFactureTx", "reglerLotTx", "ecrireComptageTx", "appliquerPatchArticleTx", "validerDemande", "refuserDemande", "retirerDemande", "demanderPaiement", "proposerModifications", "appliquerOuDemanderComptage", "verrouillerFacture", "ecrireMouvementsTx", "appliquerMouvementManuel", "notifierGesteStock", "convertirFrancs", "rattacherAutomatiquement"];
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

// ── GESTES NOTIFIÉS À LA DIRECTION (décision de Sacha, 2026-10-07) ─────────────────────────────────
// « je veux juste recevoir les notifications lorsqu'un mouvement est fait, lorsqu'une facture est
// enregistrée, quand un achat est fait ou tout autre entrée de stock ». Tout fichier qui CRÉE un
// mouvement de stock, un achat de légumes, une facture fournisseur ou une réception de bon de commande
// est classé : soit ses actions ouvertes aux comptes non-Direction (nommées) appellent la notification
// de la Direction, soit le fichier est une exception NOMMÉE (Direction seule, ajustement d'inventaire).
// Un nouvel écran d'entrée de stock qui oublierait la Direction fait échouer ce test.
type SortNotifie =
  | { sort: "NOTIFIE"; actions: { nom: string; appel: string }[]; pourquoi: string }
  | { sort: "EXCEPTION"; pourquoi: string };

const NOTIFIE = "notifierGesteStock(";
const CLASSEMENT_NOTIFIE: Record<string, SortNotifie> = {
  "app/(stock)/stock/entree/actions.ts": { sort: "NOTIFIE", actions: [{ nom: "entreeListeAchat", appel: NOTIFIE }], pourquoi: "Liste d'achat : un achat = une notification." },
  "app/(stock)/stock/legumes/actions.ts": { sort: "NOTIFIE", actions: [{ nom: "creerAchatsLegumes", appel: NOTIFIE }], pourquoi: "Achats de légumes frais : une saisie = une notification." },
  "app/(stock)/stock/factures/actions.ts": { sort: "NOTIFIE", actions: [{ nom: "creerFactureAvecLignes", appel: NOTIFIE }], pourquoi: "Facture enregistrée (avec ou sans entrée en stock) ; importerFacturesExcel : Direction seule (requireRole ADMIN)." },
  "app/(stock)/stock/commandes/actions.ts": { sort: "NOTIFIE", actions: [{ nom: "receptionnerBonCommande", appel: NOTIFIE }], pourquoi: "Réception d'un bon de commande (arrivée de marchandise)." },
  "lib/validations-stock/mouvement.ts": { sort: "NOTIFIE", actions: [{ nom: "appliquerMouvementManuel", appel: NOTIFIE }], pourquoi: "Entrées/sorties manuelles (cœur) ; ecrireMouvementsTx sert aussi à valider une ancienne demande — geste de la Direction, rien à notifier." },
  "app/(stock)/stock/catalogue/actions.ts": { sort: "EXCEPTION", pourquoi: "Correction des stocks négatifs (entrée « mise à 0 ») : Direction seule." },
  "lib/import-inventaire.ts": { sort: "EXCEPTION", pourquoi: "Import d'inventaire / légumes : imports/actions.ts (gardeDirection)." },
  "lib/import-mouvements.ts": { sort: "EXCEPTION", pourquoi: "Import de mouvements : imports/actions.ts (gardeDirection)." },
  "lib/import-factures.ts": { sort: "EXCEPTION", pourquoi: "Import du suivi des factures : imports/actions.ts (gardeDirection)." },
  "lib/validations-stock/comptage.ts": { sort: "EXCEPTION", pourquoi: "AJUSTEMENTS d'un comptage (ni entrée ni sortie) : réconciliation avec écart validée par la Direction." },
};
// Le geste manuel passe par le cœur : l'action de l'écran Mouvements doit l'appeler (jamais ecrireMouvementsTx en direct).
const VIA_COEUR: Record<string, { nom: string; appel: string }[]> = {
  "app/(stock)/stock/mouvements/actions.ts": [{ nom: "mouvementManuel", appel: "appliquerMouvementManuel(" }],
};

const CREE_PRISMA = /\b(?:mouvementStock|achatLegume|factureFournisseur|reception)\.(?:create|createMany|createManyAndReturn|upsert)\s*\(/;
const CREE_SQL = /INSERT\s+INTO\s+"stock"\."(?:MouvementStock|AchatLegume|FactureFournisseur|Reception)"/i;
const createurs = () => fichiers(SRC).filter((p) => { const s = fs.readFileSync(p, "utf8"); return CREE_PRISMA.test(s) || CREE_SQL.test(s); }).map(rel).sort();

/** Corps d'une action exportée (`export const nom =` / `export async function nom`) jusqu'à la suivante. */
function corps(source: string, nom: string): string | null {
  const m = new RegExp(`export\\s+(?:const\\s+${nom}\\s*=|async\\s+function\\s+${nom}\\s*\\()`).exec(source);
  if (!m) return null;
  const suite = source.slice(m.index + m[0].length);
  const fin = suite.search(/\nexport\s/);
  return fin < 0 ? suite : suite.slice(0, fin);
}

describe("gestes de stock notifiés à la Direction (2026-10-07)", () => {
  it("chaque fichier qui crée un mouvement, un achat, une facture ou une réception est classé", () => {
    expect(createurs().filter((f) => !(f in CLASSEMENT_NOTIFIE))).toEqual([]);
  });
  it("aucun classement périmé", () => {
    const trouves = new Set(createurs());
    expect(Object.keys(CLASSEMENT_NOTIFIE).filter((f) => !trouves.has(f))).toEqual([]);
  });
  it("chaque action classée NOTIFIE appelle la notification (et l'écran Mouvements passe par le cœur)", () => {
    const manques: string[] = [];
    const verifier = (f: string, a: { nom: string; appel: string }) => {
      const c = corps(fs.readFileSync(path.join(SRC, f), "utf8"), a.nom);
      if (c === null) manques.push(`${f} → ${a.nom} introuvable`);
      else if (!c.includes(a.appel)) manques.push(`${f} → ${a.nom} n'appelle pas ${a.appel}`);
    };
    for (const [f, c] of Object.entries(CLASSEMENT_NOTIFIE)) if (c.sort === "NOTIFIE") for (const a of c.actions) verifier(f, a);
    for (const [f, actions] of Object.entries(VIA_COEUR)) for (const a of actions) verifier(f, a);
    expect(manques).toEqual([]);
  });
  it("plancher anti-silence et détection (falsification en sens inverse incluse)", () => {
    expect(createurs().length).toBeGreaterThanOrEqual(9);
    expect(CREE_PRISMA.test("await tx.reception.create({")).toBe(true);
    expect(CREE_PRISMA.test("prisma.achatLegume.createMany({")).toBe(true);
    expect(CREE_SQL.test('INSERT INTO "stock"."MouvementStock" ("id"')).toBe(true);
    expect(CREE_PRISMA.test("prisma.mouvementStock.findMany({")).toBe(false);
    const src = "export const a = x(async () => {\n  await notifierGesteStock(u, g);\n});\nexport const b = x(async () => {\n  await rien();\n});\n";
    expect(corps(src, "a")).toContain(NOTIFIE);
    expect(corps(src, "b")).not.toContain(NOTIFIE);
    expect(corps(src, "c")).toBeNull();
  });
  it("plus aucune demande MOUVEMENT_MANUEL n'est créée (les anciennes restent décidables)", () => {
    // Une demande se crée par un OBJET qui porte sa nature ({ nature: "…", … }) ; une signature de
    // fonction (« lireCharge(nature: "MOUVEMENT_MANUEL", … ») n'en crée pas.
    const CREE_DEMANDE_MOUVEMENT = /[{,]\s*nature:\s*"MOUVEMENT_MANUEL"/;
    expect(CREE_DEMANDE_MOUVEMENT.test('creerDemandeTx(tx, { nature: "MOUVEMENT_MANUEL", resume')).toBe(true);
    expect(CREE_DEMANDE_MOUVEMENT.test('export function lireCharge(nature: "MOUVEMENT_MANUEL", brut')).toBe(false);
    // lib/test/ : les utilitaires de test qui reproduisent les demandes restées en attente en production.
    const fautifs = fichiers(SRC).map(rel).filter((f) => !f.startsWith("lib/test/") && CREE_DEMANDE_MOUVEMENT.test(fs.readFileSync(path.join(SRC, f), "utf8")));
    expect(fautifs).toEqual([]);
    // …mais leur décision existe toujours (validation et lecture de la charge).
    const demandes = fs.readFileSync(path.join(SRC, "lib/validations-stock/demandes.ts"), "utf8");
    expect(demandes).toMatch(/d\.nature === "MOUVEMENT_MANUEL"\) mouvement = await executerMouvementTx/);
  });
});

// ── MOTIF OBLIGATOIRE DE TOUTE SORTIE (décision de Sacha, 2026-10-07) ─────────────────────────────
// Tout fichier qui CRÉE un MouvementStock est classé selon la façon dont il garantit qu'une SORTIE
// porte un motif. Chaque appel de création du fichier est relu : il doit montrer cette garantie (type
// littéral « ENTREE »/« AJUSTEMENT », motif posé par categorieSortieImport, ou cœur gardé par
// exigerMotifSortie). Un nouveau chemin qui écrirait une sortie sans motif fait échouer ce test.
type SortMotif =
  | { sort: "ENTREE_SEULE" | "AJUSTEMENT_SEUL"; pourquoi: string }
  | { sort: "MOTIF_IMPORT"; pourquoi: string }
  | { sort: "COEUR_GARDE"; fonction: string; pourquoi: string };

const CLASSEMENT_MOTIF: Record<string, SortMotif> = {
  "app/(stock)/stock/entree/actions.ts": { sort: "ENTREE_SEULE", pourquoi: "Liste d'achat : entrées." },
  "app/(stock)/stock/factures/actions.ts": { sort: "ENTREE_SEULE", pourquoi: "Facture : entrées en stock." },
  "app/(stock)/stock/catalogue/actions.ts": { sort: "ENTREE_SEULE", pourquoi: "Correction d'un stock négatif : entrée." },
  "lib/validations-stock/comptage.ts": { sort: "AJUSTEMENT_SEUL", pourquoi: "Comptage : ajustements (ni entrée ni sortie)." },
  "lib/import-mouvements.ts": { sort: "MOTIF_IMPORT", pourquoi: "Import CSV : sortie = « Livraison restaurant », jamais sans motif (refus)." },
  "lib/import-inventaire.ts": { sort: "MOTIF_IMPORT", pourquoi: "Import du classeur : idem." },
  "lib/validations-stock/mouvement.ts": { sort: "COEUR_GARDE", fonction: "ecrireMouvementsTx", pourquoi: "Sorties manuelles (tous comptes) et validation des anciennes demandes : motif exigé dans le cœur." },
};

const CREE_MOUVEMENT = /\bmouvementStock\.(?:create|createMany|createManyAndReturn|upsert)\s*\(/g;
/** Chaque appel de création du fichier, avec ses données (jusqu'à la fermeture de l'appel). */
function appelsCreation(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(CREE_MOUVEMENT)) {
    let i = m.index! + m[0].length, prof = 1;
    while (i < source.length && prof > 0) { if (source[i] === "(") prof++; else if (source[i] === ")") prof--; i++; }
    out.push(source.slice(m.index!, i));
  }
  return out;
}
const createursMouvement = () => fichiers(SRC).filter((p) => { const s = fs.readFileSync(p, "utf8"); return /\bmouvementStock\.(?:create|createMany|createManyAndReturn|upsert)\s*\(/.test(s) || /INSERT\s+INTO\s+"stock"\."MouvementStock"/i.test(s); }).map(rel).sort();

/** Les fautes d'un fichier selon son classement (vide = la garantie se lit sur chaque appel). */
function fautesMotif(source: string, c: SortMotif): string[] {
  const appels = appelsCreation(source);
  if (/INSERT\s+INTO\s+"stock"\."MouvementStock"/i.test(source)) return ["INSERT SQL brut : motif illisible pour le garde-fou"];
  if (appels.length === 0) return ["aucun appel de création trouvé"];
  const fautes: string[] = [];
  for (const a of appels) {
    const ok = c.sort === "ENTREE_SEULE" ? /type:\s*"ENTREE"/.test(a)
      : c.sort === "AJUSTEMENT_SEUL" ? /type:\s*"AJUSTEMENT"/.test(a)
      : c.sort === "MOTIF_IMPORT" ? /categorieSortie:\s*categorieSortieImport\(/.test(a)
      : true;
    if (!ok) fautes.push(a.split("\n")[0].slice(0, 120));
  }
  if (c.sort === "COEUR_GARDE") {
    const b = corps(source, c.fonction);
    if (b === null || !/exigerMotifSortie\(\s*m\.type\s*,\s*m\.categorieSortie\s*\)/.test(b)) fautes.push(`${c.fonction} n'exige pas le motif`);
  }
  return fautes;
}

describe("toute sortie de stock porte un motif (2026-10-07)", () => {
  it("chaque fichier qui crée un mouvement est classé, sans classement périmé", () => {
    const trouves = createursMouvement();
    expect(trouves.filter((f) => !(f in CLASSEMENT_MOTIF))).toEqual([]);
    expect(Object.keys(CLASSEMENT_MOTIF).filter((f) => !trouves.includes(f))).toEqual([]);
    expect(trouves.length).toBeGreaterThanOrEqual(7);
  });
  it("chaque appel de création montre sa garantie de motif", () => {
    const fautes = Object.entries(CLASSEMENT_MOTIF).flatMap(([f, c]) => fautesMotif(fs.readFileSync(path.join(SRC, f), "utf8"), c).map((x) => `${f} → ${x}`));
    expect(fautes).toEqual([]);
  });
  it("le détecteur voit une sortie sans motif (falsification en sens inverse)", () => {
    const sans = 'await tx.mouvementStock.create({ data: { articleId, type: c.type, quantite: 1 } });';
    expect(fautesMotif(sans, { sort: "MOTIF_IMPORT", pourquoi: "" })).toHaveLength(1);
    expect(fautesMotif(sans, { sort: "ENTREE_SEULE", pourquoi: "" })).toHaveLength(1);
    expect(fautesMotif('tx.mouvementStock.create({ data: { type: "ENTREE", x: f(1) } })', { sort: "ENTREE_SEULE", pourquoi: "" })).toEqual([]);
    expect(fautesMotif("export async function ecrireMouvementsTx(tx, u, m) {\n  await tx.mouvementStock.create({ data: { type: m.type } });\n}\n", { sort: "COEUR_GARDE", fonction: "ecrireMouvementsTx", pourquoi: "" })).toHaveLength(1);
  });
});
