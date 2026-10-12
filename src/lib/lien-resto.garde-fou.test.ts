import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GARDE-FOU DE SOURCE — le lien « article du restaurant → articles du catalogue » vit dans la table de
// liaison `ArticleRestoStock` (relation `ArticleResto.liens`, 2026-10-12). L'ancienne colonne
// `ArticleResto.articleStockId` (et sa relation `articleStock`, `ArticleStock.articlesResto`) n'est gardée
// que le temps du déploiement : AUCUN code ne la lit ni ne l'écrit. Un code qui la relirait ignorerait
// toutes les marques sauf la première, et celles rattachées depuis le déploiement.

const RACINE = join(__dirname, "..");
function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((n) => {
    const p = join(dossier, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const sources = fichiers(RACINE).map((p) => ({ rel: relative(RACINE, p).replace(/\\/g, "/"), code: readFileSync(p, "utf-8") }));

// Une requête sur `articleResto` ou `articlesResto` qui nomme `articleStockId` / `articleStock:` sans passer par `liens`.
const ANCIEN_LIEN = [
  /\barticleResto\.\w+\(\s*\{\s*where:\s*\{[^}]*\barticleStockId\b/, // filtre sur l'ancienne colonne
  /\barticleResto\.(?:update|updateMany|upsert)\([^;]*\bdata:\s*\{\s*articleStockId\b/, // écriture de l'ancienne colonne
  /\barticlesResto\s*:\s*(?:\{|true)/, // ancienne relation inverse d'ArticleStock
];

describe("lien article du restaurant ↔ catalogue : la table de liaison seule", () => {
  it("aucun code (hors tests) n'utilise l'ancienne colonne articleStockId d'ArticleResto ni la relation articlesResto", () => {
    const fautifs = sources.flatMap((f) => ANCIEN_LIEN.filter((re) => re.test(f.code)).map((re) => `${f.rel} : ${re}`));
    expect(fautifs).toEqual([]);
  });

  it("le motif attrape bien l'ancien usage (contrôle du garde-fou lui-même)", () => {
    const vieux = [
      "await tx.articleResto.update({ where: { id }, data: { articleStockId } });",
      "prisma.articleResto.findMany({ where: { articleStockId: { not: null } } })",
      "tx.articleResto.updateMany({ where: { id }, data: { articleStockId: null } })",
      "articlesResto: { where: { actif: true } }",
      "select: { articlesResto: true }",
    ];
    for (const v of vieux) expect([v, ANCIEN_LIEN.some((re) => re.test(v))]).toEqual([v, true]);
    expect(ANCIEN_LIEN.some((re) => re.test("tx.articleResto.create({ data: { designation, liens: { create: { articleStockId } } } })"))).toBe(false);
  });
});
