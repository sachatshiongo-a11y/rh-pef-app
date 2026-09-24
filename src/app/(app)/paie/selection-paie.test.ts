import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lignesSelectionnees, messageEcartes } from "./selection-paie";

// Chaque ouverture de /paie recrée les lignes non figées avec de NOUVEAUX identifiants, alors que la
// sélection de l'écran survit au nouveau rendu. Elle retient donc des salariés, et le lot part avec
// les identifiants des lignes affichées au moment du clic (correction 1, point 2).
const avant = [
  { id: "l-1", employeeId: "martine" },
  { id: "l-2", employeeId: "rachel" },
  { id: "l-3", employeeId: "esther" },
];
// Même mois, après un recalcul : mêmes salariés, identifiants neufs ; Esther n'a plus de ligne.
const apres = [
  { id: "n-9", employeeId: "martine" },
  { id: "n-8", employeeId: "rachel" },
];

describe("lignesSelectionnees", () => {
  it("après un recalcul, la sélection pointe les lignes COURANTES, jamais les identifiants disparus", () => {
    const selection = new Set(["martine", "rachel"]);
    expect(lignesSelectionnees(avant, selection)).toEqual({ ids: ["l-1", "l-2"], ecartes: 0 });
    expect(lignesSelectionnees(apres, selection)).toEqual({ ids: ["n-9", "n-8"], ecartes: 0 });
  });

  it("un salarié sélectionné sans ligne à l'écran est écarté, et compté", () => {
    const selection = new Set(["martine", "esther"]);
    expect(lignesSelectionnees(apres, selection)).toEqual({ ids: ["n-9"], ecartes: 1 });
    expect(messageEcartes(1)).toBe("1 salarié sélectionné n'a plus de ligne à l'écran : il est écarté du lot.");
    expect(messageEcartes(2)).toBe("2 salariés sélectionnés n'ont plus de ligne à l'écran : ils sont écartés du lot.");
    expect(messageEcartes(0)).toBeNull();
  });
});

describe("les deux écrans de lot sélectionnent des salariés et envoient les lignes affichées", () => {
  const src = (f: string) => readFileSync(join(__dirname, f), "utf8");
  for (const [ecran, fichier] of [["/paie", "paie-bulk.tsx"], ["À valider", "../a-valider/bulletins-inbox.tsx"]] as const) {
    it(`${ecran} : aucune case ne coche un identifiant de ligne, le lot part par lignesSelectionnees`, () => {
      const s = src(fichier);
      expect(s).toContain("lignesSelectionnees(");
      expect(s).toContain("messageEcartes(");
      // Jamais la sélection brute envoyée au serveur, jamais une case indexée par l'identifiant de ligne.
      expect(s).not.toMatch(/\[\.\.\.selection\]/);
      expect(s).not.toMatch(/selection\.has\((?:r|l)\.id\)/);
      expect(s).not.toMatch(/(?:add|delete|toggle|onToggle)\((?:r|l)\.id\)/);
      expect(s).not.toMatch(/rows\.map\(\(r\) => r\.id\)/);
    });
  }
});
