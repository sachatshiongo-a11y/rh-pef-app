import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Demande de la Direction (2026-09-28) : les pages de l'espace Stock prennent toute la largeur
// disponible — plus de conteneur de page borné (max-w-3xl…7xl). Et le menu « Fiche … (PDF) »,
// posé à gauche de la page, s'ouvre vers la DROITE (ouvert vers la gauche, il passait sous le menu).
//
// Plan d'ergonomie V9 (2026-10-12) : même règle pour les pages TABLEAU de la RH et de l'Exploitation.
// Les FORMULAIRES restent étroits : ils figurent dans `ETROITES_A_DESSEIN`, avec la raison.
const pagesDe = (racine: string): string[] =>
  (readdirSync(racine, { recursive: true }) as string[]).filter((f) => f.endsWith("page.tsx")).map((f) => join(racine, f));

// Un conteneur de page borné : un <div> dont la PREMIÈRE classe est max-w-2xl…7xl (les paragraphes, les
// boîtes de dialogue et les champs ont leurs propres bornes, qui ne sont pas des conteneurs de page).
const CONTENEUR_BORNE = /<div className="(?:mx-auto )?max-w-[2-7]xl[ "]/;

describe("espace Stock en pleine largeur", () => {
  const racine = "src/app/(stock)/stock";
  const pages = pagesDe(racine);
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

// Pages qui restent étroites À DESSEIN (formulaires, fiches) — toute nouvelle entrée se justifie ici.
const ETROITES_A_DESSEIN: Record<string, string> = {
  "src/app/(app)/parametres/page.tsx": "formulaires de réglage, rubrique après rubrique",
  "src/app/(app)/employes/[id]/page.tsx": "fiche salarié : retouchée par le lot V12 (autre branche) ; à relire quand elle sera fusionnée",
  "src/app/(exploitation)/exploitation/plan-comptable/page.tsx": "édition en ligne de quatre champs de ratio par rubrique : un formulaire",
  "src/app/(exploitation)/exploitation/cloture/page.tsx": "liste de douze mois à cocher et un bouton : un formulaire court",
};

describe.each([
  ["RH", "src/app/(app)"],
  ["Exploitation", "src/app/(exploitation)/exploitation"],
])("espace %s en pleine largeur pour les tableaux (plan d'ergonomie V9)", (_nom, racine) => {
  // `ecran-suivi.tsx` n'est pas une page.tsx mais porte le conteneur de /pointer (suivi des pointages).
  const fichiers = [...pagesDe(racine), ...(racine === "src/app/(app)" ? ["src/app/(app)/pointer/ecran-suivi.tsx"] : [])];
  it("trouve les pages", () => {
    expect(fichiers.length).toBeGreaterThan(8);
  });
  it.each(fichiers.filter((p) => !(p in ETROITES_A_DESSEIN)))("%s : pas de conteneur de page borné", (p: string) => {
    expect(readFileSync(p, "utf8")).not.toMatch(CONTENEUR_BORNE);
  });
  it("chaque exception étroite existe encore (liste à jour)", () => {
    for (const p of Object.keys(ETROITES_A_DESSEIN).filter((x) => x.startsWith(racine))) {
      expect(readFileSync(p, "utf8"), p).toMatch(CONTENEUR_BORNE);
    }
  });
});
