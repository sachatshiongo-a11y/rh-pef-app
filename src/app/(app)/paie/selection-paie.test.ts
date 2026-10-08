import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleSelection, lignesSelectionnees, messageEcartes, partagerPourPaiement, messageEcarteesPaiement } from "./selection-paie";

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

describe("« Marquer payé » par la RH : les lignes non validées sont écartées et nommées", () => {
  const lignes = [
    { id: "a", nom: "Ada", statutPaiement: "VALIDE" },
    { id: "b", nom: "Béatrice", statutPaiement: "PAS_VALIDE" },
    { id: "c", nom: "Clarisse", statutPaiement: "PAYE" },
    { id: "d", nom: "Dieudonné", statutPaiement: "VALIDE" },
  ];

  it("seules les lignes validées partent ; les autres sont nommées avec leur raison", () => {
    const { aPayer, ecartees } = partagerPourPaiement(lignes, ["a", "b", "c", "d"]);
    expect(aPayer).toEqual(["a", "d"]);
    expect(ecartees).toEqual([
      { nom: "Béatrice", raison: "pas encore validé par la Direction" },
      { nom: "Clarisse", raison: "déjà payé" },
    ]);
    expect(messageEcarteesPaiement(ecartees, aPayer.length)).toBe(
      "Seuls les bulletins validés par la Direction sont payés. Écartés du lot :\n• Béatrice (pas encore validé par la Direction)\n• Clarisse (déjà payé)\n\nMarquer payés les 2 bulletins validés ?",
    );
  });

  it("rien d'écarté → pas de boîte", () => {
    const { aPayer, ecartees } = partagerPourPaiement(lignes, ["a"]);
    expect(aPayer).toEqual(["a"]);
    expect(messageEcarteesPaiement(ecartees, 1)).toBeNull();
  });
});

// Relecture du 2026-10-08 : « À valider » liste les bulletins validés de TOUS les mois depuis que la
// clôture fait passer au mois suivant. Un même salarié peut y avoir septembre ET octobre.
describe("sélection : un salarié sur deux mois", () => {
  const lignes = [
    { id: "sept", employeeId: "ada", periode: "septembre 2026" },
    { id: "oct", employeeId: "ada", periode: null },
  ];
  it("cocher septembre ne coche pas octobre (et l'inverse)", () => {
    expect(lignesSelectionnees(lignes, new Set([cleSelection(lignes[0])])).ids).toEqual(["sept"]);
    expect(lignesSelectionnees(lignes, new Set([cleSelection(lignes[1])])).ids).toEqual(["oct"]);
  });
  it("le mois courant garde la clé « salarié » (stable d'un recalcul à l'autre)", () => {
    expect(cleSelection({ employeeId: "ada" })).toBe("ada");
    expect(cleSelection(lignes[1])).toBe("ada");
  });
});
