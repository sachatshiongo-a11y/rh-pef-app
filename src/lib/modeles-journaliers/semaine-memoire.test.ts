import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { feuillesCommande, pdfModele } from "./index";
import { fichesCommandeEssai } from "./donnees-essai";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";

/**
 * « Commande journalière — Toute la semaine » en PDF (Stock → Conso. journalière → Commande).
 * Défaut du 12/10/2026 : les 14 feuilles de la semaine rendues d'un seul bloc dépassaient la mémoire
 * de l'instance de production (+256 Mo, contre +30 Mo pour un jour) : le processus était tué et le
 * téléchargement échouait. Le PDF est maintenant rendu deux feuilles à la fois, puis réuni.
 *
 * Le test du dossier s'exécute dans un processus enfant dont le tas est BORNÉ (192 Mo : un jour tient, la semaine
 * d'un seul bloc non, même à 224 Mo — constaté « JavaScript heap out of memory »).
 */
const DANS_L_ENFANT = process.env.SEMAINE_MEMOIRE_ENFANT === "1";
const SEMAINE = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

describe.skipIf(!DANS_L_ENFANT)("enfant : la semaine entière rendue sous un tas borné", () => {
  it("14 feuilles : PDF valide, toutes les pages, polices embarquées", async () => {
    const jours = await Promise.all(SEMAINE.map(async (date) => ({ date, fiches: await fichesCommandeEssai({ date }) })));
    const pdf = await pdfModele(await feuillesCommande(jours), "Commande journalière — semaine 40", "Sorties sans motif : essai.");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pages = await pagesDuPdf(pdf);
    const fiches = pages.filter((p) => /COMMANDE (CUISINE|BAR)/.test(p.plat));
    expect(fiches).toHaveLength(14);
    expect(pages.at(-1)!.plat).toContain("Sorties sans motif : essai.");
    expect(pages.slice(0, -1).some((p) => p.plat.includes("Sorties sans motif : essai."))).toBe(false); // le pied, une seule fois
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 300_000);
});

describe.skipIf(DANS_L_ENFANT)("PDF de la semaine", () => {
  it("tient dans un tas de 192 Mo (processus enfant)", () => {
    const sortie = execFileSync("npx", ["vitest", "run", "src/lib/modeles-journaliers/semaine-memoire.test.ts", "--maxWorkers=1", "--testTimeout=300000"], {
      env: { ...process.env, SEMAINE_MEMOIRE_ENFANT: "1", NODE_OPTIONS: "--max-old-space-size=192" },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 280_000,
    });
    expect(sortie).toMatch(/1 passed/);
  }, 300_000);
});
