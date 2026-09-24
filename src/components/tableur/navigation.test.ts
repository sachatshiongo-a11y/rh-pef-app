import { describe, it, expect } from "vitest";
import {
  analyserCollage, bilanCollage, decisionSortie, deplacer, estCollageMultiple, intentionClavier, planCollage,
  MESSAGE_COLLAGE_CATEGORIE, type Grille,
} from "./navigation";
import { ecrireSaisieNombre, lireSaisieNombre } from "@/lib/nombre";

// Grille de référence (3 colonnes) :
//   l0 : [x] [x] [x]
//   l1 : [x] [ ] [x]     ← case du milieu désactivée
//   l2 : [ ] [ ] [ ]     ← ligne entièrement désactivée (ex. article en lecture seule)
//   l3 : [x] [x]         ← ligne plus courte (pas de 3e colonne)
const G: Grille = [
  [true, true, true],
  [true, false, true],
  [false, false, false],
  [true, true],
];

describe("deplacer — Entrée / flèches verticales", () => {
  it("Entrée descend d'une ligne dans la même colonne", () => {
    expect(deplacer(G, { l: 0, c: 0 }, "bas")).toEqual({ l: 1, c: 0 });
  });
  it("saute les cases désactivées et les lignes sans case navigable", () => {
    expect(deplacer(G, { l: 0, c: 1 }, "bas")).toEqual({ l: 3, c: 1 }); // l1 et l2 sautées
    expect(deplacer(G, { l: 1, c: 0 }, "bas")).toEqual({ l: 3, c: 0 }); // l2 sautée
  });
  it("Maj+Entrée remonte, en sautant de même", () => {
    expect(deplacer(G, { l: 3, c: 1 }, "haut")).toEqual({ l: 0, c: 1 });
  });
  it("au bord de la grille : null (on reste dans la case)", () => {
    expect(deplacer(G, { l: 3, c: 0 }, "bas")).toBeNull();
    expect(deplacer(G, { l: 0, c: 2 }, "haut")).toBeNull();
    expect(deplacer(G, { l: 1, c: 2 }, "bas")).toBeNull(); // l3 n'a pas de 3e colonne
  });
});

describe("deplacer — flèches horizontales et Tab", () => {
  it("→ et ← passent à la case voisine en sautant les désactivées, sans changer de ligne", () => {
    expect(deplacer(G, { l: 1, c: 0 }, "droite")).toEqual({ l: 1, c: 2 });
    expect(deplacer(G, { l: 1, c: 2 }, "gauche")).toEqual({ l: 1, c: 0 });
    expect(deplacer(G, { l: 0, c: 2 }, "droite")).toBeNull();
    expect(deplacer(G, { l: 0, c: 0 }, "gauche")).toBeNull();
  });
  it("Tab passe à droite, puis à la première case de la ligne suivante au bout de la ligne", () => {
    expect(deplacer(G, { l: 0, c: 1 }, "suivante")).toEqual({ l: 0, c: 2 });
    expect(deplacer(G, { l: 0, c: 2 }, "suivante")).toEqual({ l: 1, c: 0 });
    expect(deplacer(G, { l: 1, c: 2 }, "suivante")).toEqual({ l: 3, c: 0 }); // l2 sautée
    expect(deplacer(G, { l: 3, c: 1 }, "suivante")).toBeNull(); // fin de grille : on sort
  });
  it("Maj+Tab passe à gauche, puis à la dernière case de la ligne précédente", () => {
    expect(deplacer(G, { l: 3, c: 0 }, "precedente")).toEqual({ l: 1, c: 2 });
    expect(deplacer(G, { l: 1, c: 0 }, "precedente")).toEqual({ l: 0, c: 2 });
    expect(deplacer(G, { l: 0, c: 0 }, "precedente")).toBeNull();
  });
  it("grille vide ou position hors grille : null, sans exception", () => {
    expect(deplacer([], { l: 0, c: 0 }, "bas")).toBeNull();
    expect(deplacer(G, { l: 9, c: 9 }, "droite")).toBeNull();
  });
});

describe("intentionClavier", () => {
  const vide = { debut: 0, fin: 0, longueur: 0 };
  const toutSelectionne = { debut: 0, fin: 3, longueur: 3 };
  const auMilieu = { debut: 1, fin: 1, longueur: 3 };
  const auDebut = { debut: 0, fin: 0, longueur: 3 };
  const aLaFin = { debut: 3, fin: 3, longueur: 3 };

  it("Entrée ↓, Maj+Entrée ↑ ; au bord, on reste", () => {
    expect(intentionClavier({ key: "Enter" }, vide)).toEqual({ type: "deplacer", vers: "bas", auBord: "rester" });
    expect(intentionClavier({ key: "Enter", shiftKey: true }, vide)).toEqual({ type: "deplacer", vers: "haut", auBord: "rester" });
  });
  it("Tab →, Maj+Tab ← ; au bout de la grille, on sort", () => {
    expect(intentionClavier({ key: "Tab" }, vide)).toEqual({ type: "deplacer", vers: "suivante", auBord: "sortir" });
    expect(intentionClavier({ key: "Tab", shiftKey: true }, vide)).toEqual({ type: "deplacer", vers: "precedente", auBord: "sortir" });
  });
  it("↑ et ↓ changent TOUJOURS de case (jamais de valeur)", () => {
    expect(intentionClavier({ key: "ArrowDown" }, auMilieu)).toEqual({ type: "deplacer", vers: "bas", auBord: "rester" });
    expect(intentionClavier({ key: "ArrowUp" }, auMilieu)).toEqual({ type: "deplacer", vers: "haut", auBord: "rester" });
  });
  it("← et → ne changent de case qu'au bord du texte (ou texte entièrement sélectionné)", () => {
    expect(intentionClavier({ key: "ArrowLeft" }, auMilieu)).toBeNull();
    expect(intentionClavier({ key: "ArrowRight" }, auMilieu)).toBeNull();
    expect(intentionClavier({ key: "ArrowLeft" }, aLaFin)).toBeNull();
    expect(intentionClavier({ key: "ArrowRight" }, auDebut)).toBeNull();
    expect(intentionClavier({ key: "ArrowLeft" }, auDebut)?.type).toBe("deplacer");
    expect(intentionClavier({ key: "ArrowRight" }, aLaFin)?.type).toBe("deplacer");
    expect(intentionClavier({ key: "ArrowLeft" }, toutSelectionne)).toMatchObject({ vers: "gauche" });
    expect(intentionClavier({ key: "ArrowRight" }, toutSelectionne)).toMatchObject({ vers: "droite" });
    expect(intentionClavier({ key: "ArrowLeft" }, vide)).toMatchObject({ vers: "gauche" });
    expect(intentionClavier({ key: "ArrowRight" }, vide)).toMatchObject({ vers: "droite" });
  });
  it("Échap annule", () => {
    expect(intentionClavier({ key: "Escape" }, auMilieu)).toEqual({ type: "annuler" });
  });
  it("raccourcis, sélection au clavier, composition et frappe ordinaire : comportement normal", () => {
    expect(intentionClavier({ key: "Enter", ctrlKey: true }, vide)).toBeNull();
    expect(intentionClavier({ key: "ArrowDown", metaKey: true }, vide)).toBeNull();
    expect(intentionClavier({ key: "ArrowLeft", shiftKey: true }, auDebut)).toBeNull();
    expect(intentionClavier({ key: "ArrowDown", shiftKey: true }, auDebut)).toBeNull();
    expect(intentionClavier({ key: "Enter", isComposing: true }, vide)).toBeNull();
    expect(intentionClavier({ key: "5" }, vide)).toBeNull();
    expect(intentionClavier({ key: "Backspace" }, vide)).toBeNull();
  });
});

describe("lireSaisieNombre — saisie à la française", () => {
  it("virgule et point", () => {
    expect(lireSaisieNombre("2,5")).toEqual({ ok: true, valeur: 2.5 });
    expect(lireSaisieNombre("2.5")).toEqual({ ok: true, valeur: 2.5 });
    expect(lireSaisieNombre(",5")).toEqual({ ok: true, valeur: 0.5 });
    expect(lireSaisieNombre("3,")).toEqual({ ok: true, valeur: 3 });
    expect(lireSaisieNombre("-1,25")).toEqual({ ok: true, valeur: -1.25 });
  });
  it("espaces tolérés, y compris insécables et fines (copiés d'Excel ou d'un montant formaté)", () => {
    expect(lireSaisieNombre(" 12 ")).toEqual({ ok: true, valeur: 12 });
    expect(lireSaisieNombre("1 250,5")).toEqual({ ok: true, valeur: 1250.5 });
    expect(lireSaisieNombre("1 250")).toEqual({ ok: true, valeur: 1250 });
    expect(lireSaisieNombre("1 250")).toEqual({ ok: true, valeur: 1250 });
  });
  it("espaces : seulement par groupes de 3 chiffres (« 1 250 » oui, « 1 5 » et « 2 5 » non)", () => {
    expect(lireSaisieNombre("12 500 000")).toEqual({ ok: true, valeur: 12500000 });
    for (const s of ["1 5", "2 5", "12 50", "1 2500", "1  250"]) expect(lireSaisieNombre(s), s).toEqual({ ok: false, raison: "illisible" });
  });
  it("« 1,250 » / « 1.250 » : ambigu — lu décimal et signalé par défaut, refusé sur demande", () => {
    for (const s of ["1,250", "1.250", "12,500", "250.000", "-1,250"]) {
      expect(lireSaisieNombre(s), s).toMatchObject({ ok: true, ambigu: true });
      expect(lireSaisieNombre(s, { ambigu: "refuser" }), s).toEqual({ ok: false, raison: "ambigu" });
    }
    expect(lireSaisieNombre("1,250")).toEqual({ ok: true, valeur: 1.25, ambigu: true });
    // Pas ambigus : autre nombre de décimales, zéro devant, ou milliers déjà marqués par des espaces.
    for (const [s, v] of [["1,25", 1.25], ["1,2500", 1.25], ["0,250", 0.25], ["1250", 1250], ["1 250,500", 1250.5], ["1234,567", 1234.567]] as const) {
      expect(lireSaisieNombre(s, { ambigu: "refuser" }), s).toEqual({ ok: true, valeur: v });
    }
  });
  it("vide = effacer (valeur null), pas zéro", () => {
    expect(lireSaisieNombre("")).toEqual({ ok: true, valeur: null });
    expect(lireSaisieNombre("   ")).toEqual({ ok: true, valeur: null });
  });
  it("invalide : signalé, jamais lu comme zéro", () => {
    for (const s of ["abc", "2,5,1", "1.250,5", "2..5", "1e3", "0x10", "Infinity", "12a", "-", ",", "5 kg"]) {
      expect(lireSaisieNombre(s), s).toEqual({ ok: false, raison: "illisible" });
    }
  });
  it("écriture relisible : virgule, sans exposant ni bruit de flottant", () => {
    expect(ecrireSaisieNombre(2.5)).toBe("2,5");
    expect(ecrireSaisieNombre(1250)).toBe("1250");
    expect(ecrireSaisieNombre(0.1 + 0.2)).toBe("0,3");
    expect(ecrireSaisieNombre(1e-7)).toBe("0,0000001");
    expect(ecrireSaisieNombre(null)).toBe("");
    for (const n of [0, 3, 2.5, 1250.125, 0.001, 1e-7]) expect(lireSaisieNombre(ecrireSaisieNombre(n))).toMatchObject({ ok: true, valeur: n });
  });
});

describe("decisionSortie — enregistrer seulement ce qui a changé", () => {
  it("même valeur, autre écriture : rien à enregistrer", () => {
    expect(decisionSortie("2,50", 2.5)).toEqual({ type: "inchange" });
    expect(decisionSortie(" 2.5", 2.5)).toEqual({ type: "inchange" });
    expect(decisionSortie("", null)).toEqual({ type: "inchange" });
  });
  it("valeur nouvelle ou case vidée : à enregistrer", () => {
    expect(decisionSortie("3", 2.5)).toEqual({ type: "enregistrer", valeur: 3 });
    expect(decisionSortie("", 2.5)).toEqual({ type: "enregistrer", valeur: null });
    expect(decisionSortie("0", null)).toEqual({ type: "enregistrer", valeur: 0 });
  });
  it("colonnes entières ou de quantité : « 1,250 » refusé comme ambigu ; ailleurs lu décimal et marqué", () => {
    expect(decisionSortie("1,250", null, { quantite: true })).toMatchObject({ type: "invalide", message: expect.stringMatching(/ambigu \(1,25 ou 1250 \?\)/) });
    expect(decisionSortie("1.250", null, { entier: true })).toMatchObject({ type: "invalide" });
    expect(decisionSortie("1,250", null)).toEqual({ type: "enregistrer", valeur: 1.25, ambigu: true });
    // … mais l'écriture même d'une valeur enregistrée (1,125 kg) n'est jamais refusée.
    expect(decisionSortie("1,125", 1.125, { quantite: true })).toEqual({ type: "inchange" });
    expect(decisionSortie("1,1250", null, { quantite: true })).toEqual({ type: "enregistrer", valeur: 1.125 });
  });
  it("illisible ou hors bornes : refusé, avec un message", () => {
    expect(decisionSortie("abc", 1)).toMatchObject({ type: "invalide" });
    expect(decisionSortie("-1", 1, { min: 0 })).toEqual({ type: "invalide", message: "Minimum : 0." });
    expect(decisionSortie("25", 1, { max: 24 })).toEqual({ type: "invalide", message: "Maximum : 24." });
    expect(decisionSortie("1,5", 1, { entier: true })).toEqual({ type: "invalide", message: "Nombre entier attendu." });
    expect(decisionSortie("", 1, { min: 0, entier: true })).toEqual({ type: "enregistrer", valeur: null }); // vider reste permis
  });
});

describe("collage d'un bloc Excel", () => {
  it("lignes par retours à la ligne (Windows ou non), colonnes par tabulations, retour final ignoré", () => {
    expect(analyserCollage("1\t2\r\n3\t4\r\n")).toEqual([["1", "2"], ["3", "4"]]);
    expect(analyserCollage("1\n2\n3")).toEqual([["1"], ["2"], ["3"]]);
    expect(analyserCollage("5")).toEqual([["5"]]);
    expect(analyserCollage("1\t\t3")).toEqual([["1", "", "3"]]); // case vide conservée à sa place
  });
  it("une seule valeur = collage ordinaire ; plusieurs = collage de bloc", () => {
    expect(estCollageMultiple(analyserCollage("5\r\n"))).toBe(false);
    expect(estCollageMultiple(analyserCollage("5\t6"))).toBe(true);
    expect(estCollageMultiple(analyserCollage("5\n6"))).toBe(true);
  });
  const GROUPES = ["A", "A", "A", "B"]; // l3 est dans une autre catégorie
  it("remplit à partir de la case active, sans décaler sur les désactivées ; colonnes en trop ignorées", () => {
    const plan = planCollage(G, GROUPES, { l: 0, c: 1 }, analyserCollage("a\tb\tc\ne\tf\n"));
    expect(plan).toEqual({
      type: "ok",
      cibles: [{ l: 0, c: 1, texte: "a" }, { l: 0, c: 2, texte: "b" }, { l: 1, c: 2, texte: "f" }],
      vides: 0,
      horsGrille: 2, // « c » dépasse la grille, « e » tombe sur la case désactivée (pas décalé)
    });
  });
  it("REFUSÉ s'il traverse une catégorie (export Excel : une ligne par catégorie)", () => {
    expect(planCollage(G, GROUPES, { l: 1, c: 0 }, analyserCollage("1\n2\n3\n"))).toEqual({ type: "refus", message: MESSAGE_COLLAGE_CATEGORIE });
    expect(MESSAGE_COLLAGE_CATEGORIE).toMatch(/^Le bloc collé traverse une catégorie : collez catégorie par catégorie/);
  });
  it("REFUSÉ s'il compte plus de lignes qu'il n'en reste sous la case active", () => {
    const plan = planCollage(G, [undefined, undefined, undefined, undefined], { l: 2, c: 0 }, analyserCollage("1\n2\n3"));
    expect(plan).toMatchObject({ type: "refus" });
    expect(plan.type === "refus" && plan.message).toMatch(/3 lignes.*il n'en reste que 2/);
  });
  it("une case vide du bloc n'efface jamais rien : ignorée et comptée", () => {
    const plan = planCollage(G, GROUPES, { l: 0, c: 0 }, analyserCollage("\t5\t\n"));
    expect(plan).toEqual({ type: "ok", cibles: [{ l: 0, c: 1, texte: "5" }], vides: 2, horsGrille: 0 });
  });
  it("bilan lisible : remplacées, 0 effacée, ignorées avec le détail, ambiguës signalées", () => {
    expect(bilanCollage({ vides: 2, horsGrille: 1 }, ["remplacee", "ambigue", "illisible", "inchangee"])).toBe(
      "Collage : 2 cases remplacées, 0 effacée, 4 ignorées (2 vides — une case vide n'efface rien, 1 hors grille ou non modifiable, 1 refusée (illisible ou ambiguë, signalée ci-dessous)). 1 case déjà à la bonne valeur. 1 valeur ambiguë (ex. « 1,250 ») lue comme décimale : vérifiez."
    );
    expect(bilanCollage({ vides: 0, horsGrille: 0 }, ["remplacee"])).toBe("Collage : 1 case remplacée, 0 effacée, 0 ignorée.");
  });
});
