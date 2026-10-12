// @vitest-environment happy-dom
//
// Pastilles d'un mouvement : UNE source pour l'écran Mouvements et la fiche article (2026-10-16). Rendu des
// pastilles (couleur + libellé), et garde de source : les deux écrans les importent, aucun ne redéfinit les siennes.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { MOTIF_CHIP, PastilleMotif, PastilleType, TYPE_PASTILLE } from "./pastille-mouvement";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rendre = (el: Parameters<typeof h>[0] extends never ? never : ReturnType<typeof h>) => {
  const c = document.createElement("div");
  document.body.appendChild(c);
  const r = createRoot(c);
  act(() => r.render(el));
  return { c, fin: () => { act(() => r.unmount()); c.remove(); } };
};

describe("pastilles de mouvement", () => {
  it("type : Entrée vert, Sortie rouge, Ajustement neutre (gris) — le libellé accompagne toujours la couleur", () => {
    const { c, fin } = rendre(h("div", null, h(PastilleType, { type: "ENTREE" }), h(PastilleType, { type: "SORTIE" }), h(PastilleType, { type: "AJUSTEMENT" })));
    const p = [...c.querySelectorAll<HTMLElement>("[data-pastille-type]")];
    expect(p.map((x) => x.textContent)).toEqual(["Entrée", "Sortie", "Ajustement"]);
    expect(p[0].className).toContain("bg-emerald-50");
    expect(p[1].className).toContain("bg-red-50");
    expect(p[2].className).toContain("bg-slate-100"); // neutre : ni vert ni rouge
    fin();
  });

  it("motif : Perte, Livraison restaurant, et « sans motif » quand il manque (dit tel quel)", () => {
    const { c, fin } = rendre(h("div", null, h(PastilleMotif, { motif: "PERTE" }), h(PastilleMotif, { motif: "LIVRAISON_RESTAURANT" }), h(PastilleMotif, { motif: null })));
    expect([...c.querySelectorAll("[data-pastille-motif]")].map((x) => x.textContent)).toEqual(["Perte", "Livraison restaurant", "sans motif"]);
    expect(c.querySelector("[data-pastille-motif=PERTE]")!.className).toContain("bg-red-100");
    fin();
  });

  it("un type inconnu s'affiche tel quel, en neutre (jamais une pastille vide)", () => {
    const { c, fin } = rendre(h(PastilleType, { type: "TRANSFERT" }));
    expect(c.textContent).toBe("TRANSFERT");
    fin();
  });

  it("les pastilles de motif sont celles d'origine de l'écran Mouvements (mêmes classes)", () => {
    expect(MOTIF_CHIP.PERTE.classe).toBe("bg-red-100 text-red-900");
    expect(MOTIF_CHIP.LIVRAISON_RESTAURANT.classe).toBe("bg-sky-100 text-sky-900");
    expect(TYPE_PASTILLE.ENTREE.classe).toBe("bg-emerald-50 text-emerald-800"); // = colonne « Entrées » de l'écran Mouvements
    expect(TYPE_PASTILLE.SORTIE.classe).toBe("bg-red-50 text-red-800"); // = colonne « Sorties »
  });
});

describe("garde de source : mêmes composants sur les deux écrans", () => {
  const lire = (rel: string) => fs.readFileSync(path.join(__dirname, "..", "..", "..", rel), "utf8");
  const mouvements = lire("src/app/(stock)/stock/mouvements/mouvements-client.tsx");
  const fiche = lire("src/app/(stock)/stock/catalogue/[id]/page.tsx");
  it("l'écran Mouvements utilise PastilleMotif et ne définit plus ses propres couleurs de motif", () => {
    expect(mouvements).toContain('from "@/components/stock/pastille-mouvement"');
    expect(mouvements).toContain("<PastilleMotif");
    expect(mouvements).not.toMatch(/bg-sky-100|const MOTIF_CHIP/);
  });
  it("la fiche article affiche le type par PastilleType et le motif des sorties par PastilleMotif", () => {
    expect(fiche).toContain('from "@/components/stock/pastille-mouvement"');
    expect(fiche).toContain("<PastilleType type={m.type}");
    expect(fiche).toContain("<PastilleMotif");
    expect(fiche).not.toMatch(/"Livraison restaurant"/);
  });
});

describe("pastilles de FILTRE des mouvements (fiche article) : mêmes couleurs que les pastilles de type", () => {
  it("Entrées en vert, Sorties en rouge, Ajustements en neutre ; « Tous » garde la forme commune", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { PastillesFiltre } = await import("@/components/pastilles-filtre");
    const { TEINTE_FILTRE_MOUVEMENT } = await import("./pastille-mouvement");
    const html = renderToStaticMarkup(
      <PastillesFiltre
        libelle="Filtrer" actif="tous" effectifs={{ entrees: 1, sorties: 1, ajustements: 0, tous: 2 }} lien={(v) => `?f=${v}`}
        valeurs={[["entrees", "Entrées"], ["sorties", "Sorties"], ["ajustements", "Ajustements"], ["tous", "Tous"]] as const}
        teintes={TEINTE_FILTRE_MOUVEMENT}
      />,
    );
    const lien = (texte: string) => html.split("<a").find((a) => a.includes(texte)) ?? "";
    expect(lien("Entrées")).toContain("emerald");
    expect(lien("Sorties")).toContain("red");
    expect(lien("Ajustements")).toContain("slate");
    expect(lien("Tous")).not.toMatch(/emerald|red-|slate/);
    expect(lien("Tous")).toContain("border-primary");
  });
});
