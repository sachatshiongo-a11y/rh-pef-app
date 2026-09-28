import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Demande de la Direction (2026-09-28) : les pages de l'espace Stock prennent toute la largeur
// disponible — plus de conteneur de page borné (max-w-3xl…7xl). Et le menu « Fiche … (PDF) »,
// posé à gauche de la page, s'ouvre vers la DROITE (ouvert vers la gauche, il passait sous le menu).
const racine = "src/app/(stock)/stock";
const pages: string[] = (readdirSync(racine, { recursive: true }) as string[])
  .filter((f) => f.endsWith("page.tsx"))
  .map((f) => join(racine, f));

describe("espace Stock en pleine largeur", () => {
  it("trouve les pages", () => {
    expect(pages.length).toBeGreaterThan(20);
  });
  it.each(pages)("%s : pas de conteneur de page borné", (p: string) => {
    expect(readFileSync(p, "utf8")).not.toMatch(/<div className="(?:mx-auto )?max-w-[2-7]xl space-y-/);
  });
  it("le menu des fiches PDF s'ouvre vers la droite", () => {
    const s = readFileSync("src/app/(stock)/stock/_print/menu-fiche-pdf.tsx", "utf8");
    expect(s).toMatch(/absolute left-0/);
    expect(s).not.toMatch(/absolute right-0/);
  });
});
