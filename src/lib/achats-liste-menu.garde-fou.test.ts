// Garde-fou du menu « Achats & mouvements » (décision Direction 2026-09-28) : UNE entrée de menu
// remplace « Liste d'achat », « Mouvements » et « Achats légumes frais » ; elle est active sur les
// trois pages, et chacune des trois pages affiche les sous-onglets. Vérifié dans le code du dépôt :
// un retour de l'ancienne entrée, ou une page qui perd ses sous-onglets, fait échouer ce test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENTREE_MENU_ACHATS, SOUS_ONGLETS_ACHATS } from "./achats-liste";

const RACINE = path.resolve(__dirname, "../..");
const lire = (r: string) => readFileSync(path.join(RACINE, r), "utf8");
const SHELL = "src/app/(stock)/stock-shell.tsx";
const PAGES: Record<string, string> = {
  "/stock/mouvements": "src/app/(stock)/stock/mouvements/page.tsx",
  "/stock/entree": "src/app/(stock)/stock/entree/page.tsx",
  "/stock/legumes": "src/app/(stock)/stock/legumes/page.tsx",
};

describe("menu Stock — « Achats & mouvements »", () => {
  const shell = lire(SHELL);
  const menu = shell.slice(shell.indexOf("const NAV_GROUPS"), shell.indexOf("export function StockShell"));

  it("une seule entrée, qui s'ouvre sur Mouvements", () => {
    expect(ENTREE_MENU_ACHATS).toMatchObject({ href: "/stock/mouvements", label: "Achats & mouvements" });
    expect(menu.match(/ENTREE_MENU_ACHATS/g)).toHaveLength(1);
  });

  it("les anciennes entrées ont disparu du menu (les routes, elles, restent)", () => {
    for (const o of SOUS_ONGLETS_ACHATS) expect(menu, `${o.href} encore au menu`).not.toContain(`href: "${o.href}"`);
    expect(menu).not.toContain("Achats légumes frais");
  });

  it("l'entrée est active sur ses trois sous-onglets", () => {
    expect(shell).toMatch(/href === ENTREE_MENU_ACHATS\.href \? sousOngletActif\(pathname\) !== null/);
  });

  it.each(Object.entries(PAGES))("%s affiche les sous-onglets", (_href, fichier) => {
    const source = lire(fichier);
    expect(source).toContain('import { OngletsAchats } from "../_achats/onglets-achats";');
    expect(source).toMatch(/<OngletsAchats \/>/);
  });
});
