import { describe, it, expect } from "vitest";
import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { BARRE_DU_BAS, GROUPES_ESPACE, LIENS_ESPACE, lienActif } from "./navigation";

// La navigation de l'espace salarié (lot 6) : une barre du bas courte, un menu rangé, et aucune
// page oubliée — une page nouvelle sans entrée de menu serait introuvable pour le salarié.
const racine = __dirname;

/** Écrans de l'espace (dossiers qui portent un page.tsx), hors formulaire de mot de passe. */
function ecrans(dir = racine): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (!statSync(p).isDirectory() || n.startsWith("[")) continue;
    if (existsSync(path.join(p, "page.tsx"))) out.push("/espace/" + path.relative(racine, p).split(path.sep).join("/"));
    out.push(...ecrans(p));
  }
  return out;
}

describe("navigation de l'espace salarié", () => {
  it("la barre du bas tient sur un téléphone : 4 écrans + le bouton Menu, libellés courts", () => {
    expect(BARRE_DU_BAS.map((l) => l.href)).toEqual(["/espace", "/espace/pointer", "/espace/planning", "/espace/conges"]);
    for (const l of BARRE_DU_BAS) expect(l.court!.length, l.court).toBeLessThanOrEqual(9);
  });

  it("chaque écran de l'espace a son entrée de menu (sauf le mot de passe, dans le bloc du compte)", () => {
    const menu = new Set(LIENS_ESPACE.map((l) => l.href));
    const oublies = ecrans().filter((e) => e !== "/espace/mot-de-passe" && !menu.has(e));
    expect(oublies).toEqual([]);
    for (const l of LIENS_ESPACE) expect(existsSync(path.join(racine, l.href.replace(/^\/espace\/?/, ""), "page.tsx")), l.href).toBe(true);
  });

  it("libellés uniques, groupes de 4 entrées au plus", () => {
    const labels = LIENS_ESPACE.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const g of GROUPES_ESPACE) expect(g.liens.length, g.titre).toBeLessThanOrEqual(4);
  });

  it("lien actif : l'Accueil seulement sur /espace, les autres sur leur préfixe exact", () => {
    expect(lienActif("/espace", "/espace")).toBe(true);
    expect(lienActif("/espace", "/espace/conges")).toBe(false);
    expect(lienActif("/espace/conges", "/espace/conges")).toBe(true);
    expect(lienActif("/espace/conges", "/espace/conges/demande/x")).toBe(true);
    expect(lienActif("/espace/contrat", "/espace/contrats")).toBe(false);
  });
});
