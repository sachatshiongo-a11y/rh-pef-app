// GARDE-FOU (Direction, 13/10/2026) : la pastille « À valider » doit être À JOUR TOUT DE SUITE après chaque décision.
//
// Les compteurs de la file RH (congés, acomptes, attestations, demandes de fiche, échanges, changements de shift,
// bulletins à valider / à payer) sont mis en cache 20 s (`a-valider-chargeurs.ts`). Seules les actions de paie
// vidaient ce cache : approuver un congé laissait la pastille inchangée jusqu'à 20 s.
//
// RÈGLE : toute fonction de premier niveau du code applicatif qui ÉCRIT dans une table comptée par le cache doit appeler
// `reinitialiserCacheAValider()` (ou figurer, avec sa raison, dans EXCEPTIONS). Les fonctions qui appellent un
// assistant « dans la transaction de l'appelant » (`creerDemandeFicheTx`, `recopierContratSurFicheTx`, `appliquerTransitionPaie`) y sont soumises
// aussi : l'assistant ne peut pas vider le cache lui-même, il tourne avant le COMMIT.
//
// LIMITE ASSUMÉE : le test prouve que l'appel EXISTE dans la fonction qui écrit, pas qu'il vient après le COMMIT ni
// que la table est écrite par un chemin que le motif ne voit pas (SQL brut, écriture imbriquée). Il attrape l'oubli
// pur — le défaut observé —, la relecture reste juge du reste. La preuve de comportement (la pastille baisse
// immédiatement) est dans `a-valider-cache.integration.test.ts`.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

/** Tables comptées par le CACHE (`chargerElementsAValiderRH`). */
const TABLES_EN_CACHE = [
  "leaveRequest", "acompteSalaire", "attestation", "demandeModifFiche", "demandeCreationFiche",
  "echangeCreneau", "demandeChangementShift", "payrollLine",
];
/**
 * Tables comptées par « À valider » mais LUES EN DIRECT (aucun cache) : leurs écritures n'ont rien à vider.
 * Cette affirmation est vérifiée plus bas (le cache est unique, ces chargeurs n'y touchent pas) ; si quelqu'un met
 * un cache sur le Stock ou l'Exploitation, le test l'exige et ces tables passent dans TABLES_EN_CACHE.
 */
const TABLES_LUES_EN_DIRECT: Record<string, string> = {
  bonDeCommande: "Stock : `chargerAValiderStock` compte les bons en BROUILLON à chaque lecture (aucun cache).",
  demandeValidationStock: "Stock : `chargerAValiderStock` compte les demandes en attente à chaque lecture (aucun cache).",
  demandeRatiosRubrique: "Exploitation : `compterDemandesRatiosEnAttente` compte à chaque lecture (aucun cache).",
};
/** Appels qui écrivent dans la transaction de l'appelant : l'appelant doit vider le cache APRÈS le COMMIT. */
const ASSISTANTS_TX = ["creerDemandeFicheTx", "recopierContratSurFicheTx", "appliquerTransitionPaie"];

/** Fonctions qui écrivent dans une table en cache SANS que la pastille bouge — avec la raison. Liste fermée. */
const EXCEPTIONS: Record<string, string> = {
  "lib/demandes-fiche.ts#creerDemandeFicheTx": "Assistant exécuté DANS la transaction de l'appelant : vider avant le COMMIT laisserait un lecteur remettre l'ancien chiffre en cache. Chaque appelant vide après la transaction (garde ci-dessous).",
  "lib/demandes-fiche.ts#recopierContratSurFicheTx": "Idem : assistant dans la transaction de l'appelant (il appelle `creerDemandeFicheTx`) ; les trois actions de contrat qui l'appellent vident après le COMMIT.",
  "app/(app)/paie/actions.ts#appliquerTransitionPaie": "Assistant exécuté DANS la transaction de l'appelant (transition d'un bulletin) : les actions de paie qui l'appellent vident le cache après le COMMIT (garde ci-dessous).",
  "lib/conges-feries.ts#recalerCongesSurFerie": "Recalcule seulement `nbJours` de demandes existantes : ni statut ni nombre de demandes en attente ne changent.",
  "lib/solde-conge-fige.ts#figerSoldesApprobation": "N'écrit que l'instantané du solde d'une demande déjà approuvée dans la même transaction (l'appelant vide, voir approuverConge / approuverCongesEnLot / demanderConge).",
  "lib/attestations.ts#figerAttestation": "N'écrit que l'adresse du PDF (`pdfUrl`) d'une attestation déjà délivrée : le statut ne change pas.",
};

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const sansCommentaires = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

type Decl = { nom: string; corps: string };
/** Déclarations de premier niveau (colonne 0), chacune jusqu'à la suivante. */
export function declarations(src: string): Decl[] {
  const lignes = sansCommentaires(src).split("\n");
  const debuts: { nom: string; i: number }[] = [];
  lignes.forEach((l, i) => {
    const m = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*[=:]/.exec(l);
    if (m) debuts.push({ nom: m[1] ?? m[2], i });
  });
  return debuts.map((d, k) => ({ nom: d.nom, corps: lignes.slice(d.i, debuts[k + 1]?.i ?? lignes.length).join("\n") }));
}

const ECRITURE = (tables: string[]) => new RegExp(`\\b(?:${tables.join("|")})\\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\\s*\\(`);
const APPEL_ASSISTANT = new RegExp(`(?<!function\\s)\\b(?:${ASSISTANTS_TX.join("|")})\\s*\\(`);
const VIDE = /\breinitialiserCacheAValider\s*\(\s*\)/;

type Ecrivain = { cle: string; vide: boolean };
function ecrivains(): Ecrivain[] {
  const motif = ECRITURE(TABLES_EN_CACHE);
  const out: Ecrivain[] = [];
  for (const f of fichiers(SRC)) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    if (rel === "lib/a-valider-chargeurs.ts") continue;
    for (const d of declarations(readFileSync(f, "utf8"))) {
      if (motif.test(d.corps) || APPEL_ASSISTANT.test(d.corps)) out.push({ cle: `${rel}#${d.nom}`, vide: VIDE.test(d.corps) });
    }
  }
  return out;
}

describe("pastille « À valider » : chaque écriture d'un élément compté vide le cache", () => {
  const liste = ecrivains();

  it("le scan voit les écrivains connus (sinon le garde-fou ne garde rien)", () => {
    const cles = liste.map((e) => e.cle);
    for (const attendu of [
      "app/(app)/conges/actions.ts#approuverConge", "app/(app)/conges/actions.ts#refuserCongesEnLot", "app/(app)/paie/remuneration-actions.ts#deciderAcompte",
      "app/espace/actions.ts#demanderMonAcompte", "app/(app)/planning/actions.ts#refuserChangementShift", "lib/attestations.ts#refuserAttestation",
      "lib/demandes-fiche.ts#approuverUne", "lib/creation-fiche.ts#creerDemandeCreation", "app/(app)/employes/actions.ts#modifierEmploye",
      "app/(app)/paie/actions.ts#" + (cles.find((c) => c.startsWith("app/(app)/paie/actions.ts#"))?.split("#")[1] ?? "?"),
    ]) expect(cles, attendu).toContain(attendu);
    expect(liste.length).toBeGreaterThan(30);
  });

  it("toute fonction qui écrit dans une table comptée appelle reinitialiserCacheAValider() — ou figure aux exceptions motivées", () => {
    const oublis = liste.filter((e) => !e.vide && !(e.cle in EXCEPTIONS)).map((e) => e.cle);
    expect(oublis, "ces fonctions écrivent un élément compté dans « À valider » sans vider le cache (la pastille resterait périmée jusqu'à 20 s)").toEqual([]);
  });

  it("chaque exception désigne une fonction qui écrit encore — et qui ne vide pas déjà (sinon l'exception est périmée)", () => {
    const parCle = new Map(liste.map((e) => [e.cle, e]));
    const perimees = Object.keys(EXCEPTIONS).filter((k) => (!parCle.has(k) || parCle.get(k)!.vide));
    expect(perimees).toEqual([]);
    for (const [k, motif] of Object.entries(EXCEPTIONS)) expect(motif.length, k).toBeGreaterThan(30);
  });

  it("le cache est UNIQUE et ne couvre que la file RH : le Stock et l'Exploitation sont lus en direct", () => {
    const src = sansCommentaires(readFileSync(path.join(SRC, "lib/a-valider-chargeurs.ts"), "utf8"));
    // Un seul état mémoire (le cache RH, sur globalThis) : ni `let` ni `var` au premier niveau, un seul nom d'état global.
    // Tout autre état serait un second cache à garder.
    expect([...src.matchAll(/^(?:let|var)\s+(\w+)/gm)].map((m) => m[1])).toEqual([]);
    expect([...new Set([...src.matchAll(/__aValider\w+/g)].map((m) => m[0]))]).toEqual(["__aValiderCacheRH"]);
    const decl = declarations(src);
    for (const nom of ["chargerAValiderStock", "chargerAValiderExploitation"]) {
      const corps = decl.find((d) => d.nom === nom)?.corps ?? "";
      expect(corps, nom).not.toBe("");
      expect(/cache/i.test(corps), `${nom} ne doit pas passer par un cache (sinon ses tables passent dans TABLES_EN_CACHE)`).toBe(false);
    }
    const ratios = readFileSync(path.join(SRC, "lib/exploitation/demandes-ratios.ts"), "utf8");
    const compter = declarations(ratios).find((d) => d.nom === "compterDemandesRatiosEnAttente")?.corps ?? "";
    expect(compter).not.toBe("");
    expect(/cache/i.test(compter)).toBe(false);
    for (const [t, motif] of Object.entries(TABLES_LUES_EN_DIRECT)) expect(motif.length, t).toBeGreaterThan(30);
  });

  it("les tables lues en direct ne sont pas aussi dans le cache (une table, un seul régime)", () => {
    for (const t of Object.keys(TABLES_LUES_EN_DIRECT)) expect(TABLES_EN_CACHE).not.toContain(t);
  });

  it("le motif d'écriture voit bien une écriture et ignore une lecture (contre-épreuve du scan)", () => {
    const m = ECRITURE(TABLES_EN_CACHE);
    expect(m.test("await tx.leaveRequest.updateMany({ where })")).toBe(true);
    expect(m.test("await prisma.acompteSalaire.create({ data })")).toBe(true);
    expect(m.test("await prisma.leaveRequest.findMany({ where })")).toBe(false);
    expect(m.test("await prisma.leaveRequest.count({ where })")).toBe(false);
    expect(APPEL_ASSISTANT.test("return creerDemandeFicheTx(tx, {})")).toBe(true);
    expect(APPEL_ASSISTANT.test("export async function creerDemandeFicheTx(\n tx")).toBe(false);
    expect(declarations("export async function a() {\n x()\n}\nexport const b = actionLisible(async () => {\n y()\n});").map((d) => d.nom)).toEqual(["a", "b"]);
  });
});
