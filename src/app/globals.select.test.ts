import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

/**
 * Une liste déroulante ne doit jamais élargir la page.
 *
 * La largeur intrinsèque d'un <select> est celle de son option la plus longue.
 * Dans une grille ou une barre flex, cette largeur devient le plancher de la
 * piste : la carte déborde, puis la page défile latéralement sur téléphone.
 *
 * Mesuré au navigateur à 375 px sur les deux structures réelles de l'app
 * (formulaire en grille + barre de filtres), témoin à 436 px :
 *   - règle sur le select seule ....... 399 px (la grille déborde encore)
 *   - règle sur le label seule ........ 436 px (la barre déborde encore)
 *   - les deux ........................ 375 px
 * Les deux moitiés sont donc nécessaires. Ce test échoue si l'une disparaît.
 *
 * Il compile la feuille par la VRAIE chaîne PostCSS du projet : une règle
 * présente dans la source mais mangée par le build ne passerait pas.
 */
const RACINE = path.join(__dirname, "../..");
const FEUILLE = path.join(RACINE, "src/app/globals.css");

async function compiler(): Promise<string> {
  const source = fs.readFileSync(FEUILLE, "utf8");
  const res = await postcss([tailwind()]).process(source, { from: FEUILLE });
  return res.css.replace(/\s+/g, " ");
}

describe("globals.css — le garde-fou des listes déroulantes", () => {
  it("compile, et garde les DEUX moitiés de la règle", async () => {
    const css = await compiler();

    // Moitié 1 : le select lui-même peut rétrécir et ne dépasse pas son conteneur.
    const surLeSelect = /(^|})[^{}]*\bselect\b[^{}]*\{[^}]*min-width: *0[^}]*\}/.test(css);
    expect(surLeSelect, "la règle sur `select` (min-width:0) a disparu du CSS compilé").toBe(true);
    expect(/(^|})[^{}]*\bselect\b[^{}]*\{[^}]*max-width: *100%[^}]*\}/.test(css)).toBe(true);

    // Moitié 2 : le label qui contient un select cesse d'imposer un plancher.
    const surLeLabel = /label:has\( *select *\) *\{[^}]*min-width: *0[^}]*\}/.test(css);
    expect(surLeLabel, "la règle sur `label:has(select)` a disparu — la barre de filtres redéborde").toBe(true);
  }, 60_000);
});
