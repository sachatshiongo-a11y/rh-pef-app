import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : LE MOIS COURANT DE L'ESPACE RH NE S'ÉCRIT QU'À UN SEUL ENDROIT (2026-10-08).
 *
 * `Config.moisCourant` / `Config.anneeCourante` changent par deux gestes — Paramètres (Direction) et
 * la clôture de la paie (passage automatique au mois suivant) — qui partagent UN cœur,
 * `changerMoisCourant` (lib/changement-mois.ts) : refus de quitter un mois clôturé qui garde un
 * bulletin rouvert en attente, Config verrouillée, journal. Un troisième chemin qui écrirait le mois
 * directement sauterait ce refus (lignes devenues « hors calcul » en silence) et le journal.
 *
 * Tout fichier de src/ (hors tests) qui écrit dans Config (Prisma ou SQL brut) en y mettant le mois
 * ou l'année courants est signalé, sauf le cœur lui-même.
 */

const SRC = path.join(__dirname, "..");
const CŒUR = "lib/changement-mois.ts";

function lister(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? lister(p) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}
const sansCommentaires = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

/** Écritures de Config (Prisma : update/upsert/create/updateMany ; SQL : UPDATE/INSERT « Config ») qui portent le mois. */
const ECRIT_CONFIG = /\bconfig\.(?:update|updateMany|upsert|create|createMany)\s*\(\s*\{[\s\S]{0,600}?\}\s*\)|(?:UPDATE|INSERT\s+INTO)\s+(?:"public"\.)?"Config"[\s\S]{0,300}/g;
const PORTE_LE_MOIS = /\b(?:moisCourant|anneeCourante)\b/;

export function ecrivainsDuMois(fichiers: { rel: string; source: string }[]): string[] {
  return fichiers
    .filter((f) => f.rel !== CŒUR)
    .filter((f) => [...sansCommentaires(f.source).matchAll(ECRIT_CONFIG)].some((m) => PORTE_LE_MOIS.test(m[0])))
    .map((f) => f.rel)
    .sort();
}

describe("garde-fou : le mois courant RH ne s'écrit que par le cœur partagé", () => {
  it("aucun fichier de src/ n'écrit Config.moisCourant / anneeCourante hors lib/changement-mois.ts", () => {
    const fichiers = lister(SRC).map((p) => ({ rel: rel(p), source: fs.readFileSync(p, "utf8") }));
    expect(fichiers.some((f) => f.rel === CŒUR)).toBe(true);
    expect(ecrivainsDuMois(fichiers)).toEqual([]);
  });

  it("le détecteur attrape une écriture directe (Prisma et SQL), et laisse passer les autres champs de Config", () => {
    const f = (rel: string, source: string) => ({ rel, source });
    expect(ecrivainsDuMois([
      f("a.ts", `await prisma.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF, moisCourant } });`),
      f("b.ts", `await tx.config.upsert({ where: { id: "singleton" }, create: { anneeCourante: 2026 }, update: {} });`),
      f("c.ts", 'await tx.$executeRaw`UPDATE "public"."Config" SET "moisCourant" = ${m}`;'),
      f("d.ts", `await tx.config.update({ where: { id: "singleton" }, data: { tauxChangeCDF, jourPaie } });`),
      f("e.ts", `const c = await prisma.config.findUnique({ where: { id: "singleton" } }); const m = c.moisCourant;`),
      f(CŒUR, `await tx.config.update({ where: { id: "singleton" }, data: { moisCourant: 1, anneeCourante: 2027 } });`),
    ])).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
