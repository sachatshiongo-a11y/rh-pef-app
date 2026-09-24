// Garde-fou : les tableurs intégrés passent TOUS par la case partagée `CelluleNombre`, et plus
// aucun n'a de champ `type=number` (flèches d'incrément, molette et ↑/↓ qui changent la valeur —
// demande de la Direction du 2026-09-24). La liste est vérifiée par le dépôt dans les deux sens :
// un tableur recensé qui régresse fait échouer le test, un NOUVEAU tableau à saisie numérique
// qui n'est pas recensé aussi.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "../../..");
const SRC = path.join(RACINE, "src");

/** Les tableurs (grilles lignes × colonnes à saisie numérique, enregistrées case par case). */
const TABLEURS: Record<string, string> = {
  "src/app/(stock)/stock/journalier/commande-grid.tsx": "Stock → Conso. journalière → Commande (articles × 7 jours)",
  "src/app/(stock)/stock/restaurant/restaurant-client.tsx": "Stock → Restaurant (stock de base + comptage par jour)",
  "src/app/(stock)/stock/reconciliation/reconciliation-client.tsx": "Stock → Inventaire (comptage physique par article)",
  "src/app/(stock)/stock/catalogue/catalogue-table.tsx": "Stock → Catalogue (stock min., prix, unités/carton)",
  "src/app/(app)/presences/temps-grid.tsx": "Présences & heures (heures par employé, vue mobile ; menu et actions groupées)",
  "src/app/(app)/planning/besoins-manager.tsx": "Planning → Effectifs requis (poste × jour, par shift)",
  // Formulaires à lignes passés au comportement « Excel » (décision de la Direction, 2026-09-24).
  "src/app/(stock)/stock/commandes/nouveau/nouveau-client.tsx": "Stock → Nouveau bon de commande (quantité, prix des lignes)",
  "src/app/(stock)/stock/factures/nouveau/nouveau-client.tsx": "Stock → Nouvelle facture (quantité, prix des lignes)",
};

/**
 * Tableaux de FORMULAIRE restés hors périmètre (décision de la Direction du 2026-09-24 : seuls
 * le bon de commande et la facture passent au comportement « Excel ») : lignes d'une fiche
 * technique ; un formulaire par type de congé. Tant qu'ils sont ici, ils gardent leurs champs
 * `type=number`.
 */
const FORMULAIRES_HORS_PERIMETRE: Record<string, string> = {
  "src/app/(stock)/stock/fiches/[id]/editer-fiche.tsx": "lignes d'une fiche technique",
  "src/app/(app)/parametres/types-conges-admin.tsx": "un formulaire « Enregistrer » par type de congé",
};

const TYPE_NUMBER = /type=["']number["']/;

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(RACINE, p).split(path.sep).join("/");
const lire = (r: string) => readFileSync(path.join(RACINE, r), "utf8");

/** Un champ `type=number` à l'intérieur d'une ligne de tableau (<tr> … </tr>) : signature d'un tableur. */
function aUnChampNombreDansUneLigne(source: string): boolean {
  for (const m of source.matchAll(/<tr[\s>]/g)) {
    const fin = source.indexOf("</tr>", m.index!);
    if (fin > 0 && TYPE_NUMBER.test(source.slice(m.index!, fin))) return true;
  }
  return false;
}

describe("garde-fou des tableurs", () => {
  it.each(Object.entries(TABLEURS))("%s — aucun type=number, cases partagées", (fichier) => {
    expect(existsSync(path.join(RACINE, fichier)), `${fichier} a disparu : mettre la liste à jour`).toBe(true);
    const source = lire(fichier);
    expect(source).not.toMatch(TYPE_NUMBER);
    expect(source).toContain('from "@/components/tableur/cellule-nombre"');
    expect(source).toMatch(/<CelluleNombre\b/);
  });

  it("la case partagée est un champ texte au pavé décimal, sans type=number", () => {
    const source = lire("src/components/tableur/cellule-nombre.tsx");
    expect(source).not.toMatch(TYPE_NUMBER);
    expect(source).toMatch(/type="text"/);
    expect(source).toMatch(/inputMode="decimal"/);
  });

  it("aucun tableau à saisie numérique hors de la liste (nouveau tableur = case partagée)", () => {
    const suspects = fichiers(SRC).map(rel).filter((f) => aUnChampNombreDansUneLigne(readFileSync(path.join(RACINE, f), "utf8")));
    expect(suspects.filter((f) => !(f in FORMULAIRES_HORS_PERIMETRE))).toEqual([]);
  });

  it("toute grille marquée data-tableur est recensée", () => {
    const marquees = fichiers(SRC).map(rel)
      .filter((f) => !f.startsWith("src/components/tableur/"))
      .filter((f) => /data-tableur=/.test(readFileSync(path.join(RACINE, f), "utf8")));
    expect(marquees.filter((f) => !(f in TABLEURS))).toEqual([]);
  });

  it("les exceptions déclarées existent encore et ont encore des champs type=number (sinon, les retirer)", () => {
    for (const f of Object.keys(FORMULAIRES_HORS_PERIMETRE)) {
      expect(existsSync(path.join(RACINE, f)), f).toBe(true);
      expect(aUnChampNombreDansUneLigne(lire(f)), f).toBe(true);
    }
  });

  it("l'heuristique reconnaît un champ nombre dans une ligne, et seulement là", () => {
    expect(aUnChampNombreDansUneLigne('<tr><td><input type="number" /></td></tr>')).toBe(true);
    expect(aUnChampNombreDansUneLigne('<tr className="x">\n<td>\n<input\n type="number"\n/></td></tr>')).toBe(true);
    expect(aUnChampNombreDansUneLigne('<div><input type="number" /></div><tr><td>1</td></tr>')).toBe(false);
    expect(aUnChampNombreDansUneLigne('<tr><td><CelluleNombre /></td></tr>')).toBe(false);
  });
});
