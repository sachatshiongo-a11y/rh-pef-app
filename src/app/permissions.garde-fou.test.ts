import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * GARDE-FOU : LES PERMISSIONS PAR PERSONNE SONT FAITES RESPECTER CÔTÉ SERVEUR (lib/permissions.ts).
 *
 * Masquer une entrée de menu ne protège rien : ce test vérifie que chaque endroit où le rôle RH (MANAGER)
 * agissait déjà porte AUSSI sa permission — action serveur, page, route —, pour qu'un futur ajout ne
 * contourne pas, sans le vouloir, ce que la Direction a retiré à une personne.
 */

const APP = __dirname;

function fichiers(dir: string, filtre: (nom: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fichiers(p, filtre, out);
    else if (filtre(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(APP, p).split(path.sep).join("/");
const sansTest = (n: string) => !/\.test\./.test(n);

describe("actions RH : chaque requireRole ouvert au rôle RH est suivi de sa permission", () => {
  const actions = fichiers(path.join(APP, "(app)"), (n) => /actions?\.ts$/.test(n) && sansTest(n))
    .filter((p) => /^\s*["']use server["']/.test(fs.readFileSync(p, "utf8")));

  it("le parcours trouve les fichiers d'actions", () => {
    expect(actions.length).toBeGreaterThan(15);
  });

  it.each(actions.map(rel))("%s", (r) => {
    const lignes = fs.readFileSync(path.join(APP, r), "utf8").split("\n");
    const manquants: number[] = [];
    lignes.forEach((l, i) => {
      if (/^\s*requireRole\(.*"MANAGER"/.test(l) && !/requirePermission\(/.test(lignes[i + 1] ?? "")) manquants.push(i + 1);
    });
    expect(manquants, `${r} : requireRole(… "MANAGER") sans requirePermission à la ligne suivante`).toEqual([]);
  });
});

describe("pages et routes RH : les espaces à permission la citent", () => {
  // Écrans communs à tout compte RH (accueil, demandes à trancher, journal, réglages) : sans permission réglable.
  const COMMUNS = ["accueil/", "a-valider/", "dashboard/", "historique/", "parametres/", "pointer/page.tsx"];
  const pages = fichiers(path.join(APP, "(app)"), (n) => n === "page.tsx" || n === "route.ts").map(rel);

  it.each(pages.filter((r) => !COMMUNS.some((c) => r.replace("(app)/", "").startsWith(c))))("%s", (r) => {
    const src = fs.readFileSync(path.join(APP, r), "utf8");
    if (!/exigerPageRH\(|exigerEspaceRH\(/.test(src)) return; // autre garde (salarié…)
    expect(src, `${r} : la garde RH doit citer une permission`).toMatch(/exigerPageRH\("rh\.\w+"\)|exigerEspaceRH\(\{[^}]*permission: "rh\.\w+"/);
  });

  it("routes d'export du Stock : permission « exports » (hors factures, hors clôture)", () => {
    const routes = fichiers(path.join(APP, "(stock)"), (n) => n === "route.ts").map(rel)
      .filter((r) => !r.includes("/factures/") && !r.includes("/cloture/"));
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) expect(fs.readFileSync(path.join(APP, r), "utf8"), r).toContain('permission: "stock.exports"');
  });
});

describe("actions Stock : validation d'un bon", () => {
  it("valider un bon (seul ou en lot) exige la permission « valider », plus le rôle ADMIN en dur", () => {
    const src = fs.readFileSync(path.join(APP, "(stock)/stock/commandes/actions.ts"), "utf8");
    for (const nom of ["validerBonCommande", "validerBonsEnLot"]) {
      const i = src.indexOf(nom);
      const corps = src.slice(i, i + 400);
      expect(corps, nom).toContain('requirePermission(user, "stock.bon_valider")');
      expect(corps, nom).not.toContain('requireRole(user, ["ADMIN"])');
    }
  });
});
