import { describe, it, expect } from "vitest";
import {
  analyserCollage, ciblesCollage, decisionSortie, deplacer, estCollageMultiple, intentionClavier,
  type Grille,
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
  it("vide = effacer (valeur null), pas zéro", () => {
    expect(lireSaisieNombre("")).toEqual({ ok: true, valeur: null });
    expect(lireSaisieNombre("   ")).toEqual({ ok: true, valeur: null });
  });
  it("invalide : signalé, jamais lu comme zéro", () => {
    for (const s of ["abc", "2,5,1", "1.250,5", "2..5", "1e3", "0x10", "Infinity", "12a", "-", ",", "5 kg"]) {
      expect(lireSaisieNombre(s), s).toEqual({ ok: false });
    }
  });
  it("écriture relisible : virgule, sans exposant ni bruit de flottant", () => {
    expect(ecrireSaisieNombre(2.5)).toBe("2,5");
    expect(ecrireSaisieNombre(1250)).toBe("1250");
    expect(ecrireSaisieNombre(0.1 + 0.2)).toBe("0,3");
    expect(ecrireSaisieNombre(1e-7)).toBe("0,0000001");
    expect(ecrireSaisieNombre(null)).toBe("");
    for (const n of [0, 3, 2.5, 1250.125, 0.001, 1e-7]) expect(lireSaisieNombre(ecrireSaisieNombre(n))).toEqual({ ok: true, valeur: n });
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
  it("remplit à partir de la case active, dans la limite de la grille, sans décaler sur les désactivées", () => {
    const bloc = analyserCollage("a\tb\tc\td\ne\tf\tg\th\ni\tj\tk\tl\nm\tn\to\tp\nq\tr\ts\tt\n");
    expect(ciblesCollage(G, { l: 0, c: 1 }, bloc)).toEqual([
      { l: 0, c: 1, texte: "a" }, { l: 0, c: 2, texte: "b" }, // c, d : hors grille
      /* l1 c1 désactivée : « e » perdu, pas décalé */ { l: 1, c: 2, texte: "f" },
      /* l2 entièrement désactivée */
      { l: 3, c: 1, texte: "m" }, // l3 n'a pas de 3e colonne ; la 5e ligne du bloc sort de la grille
    ]);
  });
});
