// Garde-fou (audit du 10/10/2026, ergonomie 10 et 11) : le nom d'un salarié ou d'un fournisseur mène à sa fiche,
// dans les listes où il manquait (À valider : shifts et bons brouillons ; Paie : cartes de validation et éléments de
// rémunération ; Planning : liste du téléphone ; liste des bons de commande).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const lire = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("noms cliquables", () => {
  const CAS: [string, RegExp][] = [
    ["app/(app)/a-valider/shifts-inbox.tsx", /href=\{`\/employes\/\$\{e\.id\}`\}/],
    ["app/(app)/paie/bulletins-validation.tsx", /href=\{`\/employes\/\$\{r\.employeeId\}`\}/],
    ["app/(app)/paie/remuneration-elements.tsx", /href=\{`\/employes\/\$\{x\.employeeId\}`\}/],
    ["app/(app)/planning/planning-semaine.tsx", /<Link href=\{`\/employes\/\$\{e\.id\}`\}[^>]*>\{e\.nom\}<\/Link><\/div>/],
    ["app/(stock)/stock/a-valider/page.tsx", /href=\{`\/stock\/fournisseurs\/\$\{bc\.fournisseur\.id\}`\}/],
    ["app/(stock)/stock/commandes/commandes-liste.tsx", /href=\{`\/stock\/fournisseurs\/\$\{c\.fournisseurId\}`\}/], // les bons validés (ex-Archives) vivent ici
  ];
  for (const [fichier, motif] of CAS) {
    it(`${fichier} : lien vers la fiche`, () => {
      expect(lire(fichier)).toMatch(motif);
    });
  }
});
