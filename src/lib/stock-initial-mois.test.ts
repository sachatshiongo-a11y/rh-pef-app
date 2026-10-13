import { describe, expect, it } from "vitest";
import {
  additionner, calculerStockInitial, debutMoisKinshasa, ecartAvecCloture, jourDebutMois, moisPrecedent, quantiteInitiale,
  resoudreAjustements, SANS_MOUVEMENT, stockInitialArticle, type DonneesStockInitial, type MouvementsAgreges,
} from "./stock-initial-mois";
import { jourCivilKinshasa } from "./heure-kinshasa";

const OCT = debutMoisKinshasa(2026, 10);
const mv = (entrees: number, sorties: number, net: number | null = 0, nb = net === 0 ? 0 : 1): MouvementsAgreges => ({ entrees, sorties, ajustements: { nb, net } });
const initial = (stockFin: number | null, mouvements: MouvementsAgreges, plus: object = {}) => calculerStockInitial({ stockFin, mouvements, debutMois: OCT, ...plus });

describe("la règle : stock de fin − entrées + sorties − ajustements nets", () => {
  it("exemple chiffré : 100 kg au bout du mois, 30 entrés et 50 sortis → 120 kg au 1er", () => {
    expect(initial(100, mv(30, 50))).toEqual({ etat: "ok", quantite: 120 });
  });

  it("les entrées d'un mois ne s'ajoutent pas au stock initial et ses sorties ne le diminuent pas (sens inverse)", () => {
    expect(quantiteInitiale(initial(10, mv(10, 0)))).toBe(0); // tout est entré en cours de mois : 0 au 1er, article ancien
    expect(quantiteInitiale(initial(0, mv(0, 8)))).toBe(8);
  });

  it("un ajustement SIGNÉ : +5 compté en plus au comptage → il y avait 5 de moins au 1er ; −5 → 5 de plus", () => {
    expect(quantiteInitiale(initial(100, mv(30, 50, 5)))).toBe(115);
    expect(quantiteInitiale(initial(100, mv(30, 50, -5)))).toBe(125);
  });

  it("décimaux exacts : 0,1 + 0,2 de sorties sur un stock de 0,3 → 0,6 au 1er", () => {
    expect(quantiteInitiale(initial(0.3, { entrees: "0", sorties: "0.3", ajustements: { nb: 0, net: 0 } }))).toBe(0.6);
  });

  it("les mouvements des MOIS SUIVANTS sont retirés aussi : stock d'aujourd'hui (novembre inclus) ramené au 1er octobre", () => {
    // Fin : 90. Octobre : +40 −10. Novembre (daté d'avance ou stock actuel d'un mois ancien) : +20 −5.
    const d: DonneesStockInitial = {
      annee: 2026, mois: 10, debut: OCT, dansMois: new Map([["a", mv(40, 10)]]), apresMois: new Map([["a", mv(20, 5)]]),
      crees: new Map(), avecMouvementAvant: new Set(), horsMouvement: new Map(),
    };
    const r = stockInitialArticle(d, "a", 90);
    expect(r.initial).toEqual({ etat: "ok", quantite: 90 - 40 + 10 - 20 + 5 }); // 45
    expect(r).toMatchObject({ entrees: 40, sorties: 10, apres: 15 });
  });
});

describe("les trois états : jamais 0 pour une valeur inconnue", () => {
  it("article créé après le 1er : « absent », pas 0", () => {
    const r = initial(12, mv(12, 0), { creeLe: new Date("2026-10-05T08:00:00Z") });
    expect(r.etat).toBe("absent");
    expect(quantiteInitiale(r)).toBeNull();
  });

  it("…sauf s'il porte un mouvement daté d'AVANT le 1er (historique importé) : il existait, le calcul s'applique", () => {
    expect(initial(12, mv(2, 0), { creeLe: new Date("2026-10-05T08:00:00Z"), mouvementAvantDebut: true })).toEqual({ etat: "ok", quantite: 10 });
  });

  it("borne de minuit à Kinshasa : 23 h 59 le 30/09 existait ; 00 h 00 le 1er/10 (= 23 h UTC) est créé « dans » le mois", () => {
    expect(debutMoisKinshasa(2026, 10).toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(initial(5, SANS_MOUVEMENT, { creeLe: new Date("2026-09-30T22:59:59.999Z") }).etat).toBe("ok");
    expect(initial(5, SANS_MOUVEMENT, { creeLe: new Date("2026-09-30T23:00:00.000Z") }).etat).toBe("absent");
  });

  it("la borne d'instant et la borne de date pure désignent le même jour civil de Kinshasa", () => {
    expect(jourCivilKinshasa(debutMoisKinshasa(2026, 10)).getTime()).toBe(jourDebutMois(2026, 10).getTime());
    expect(jourCivilKinshasa(new Date(debutMoisKinshasa(2026, 10).getTime() - 1)).toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(moisPrecedent(2026, 1)).toEqual({ annee: 2025, mois: 12 });
  });

  it("aucun stock enregistré → inconnu (pas 0)", () => {
    expect(initial(null, mv(1, 0)).etat).toBe("inconnu");
  });

  it("ajustement dont le sens n'est pas établi → inconnu, avec la raison", () => {
    const r = initial(100, mv(0, 0, null, 2));
    expect(r.etat).toBe("inconnu");
    expect(r).toMatchObject({ raison: expect.stringContaining("sens") });
  });

  it("stock posé hors mouvement (import d'inventaire) → inconnu avec la raison", () => {
    expect(initial(100, mv(1, 1), { stockModifieHorsMouvement: "stock posé par un import d'inventaire (03/10/2026)" })).toMatchObject({ etat: "inconnu", raison: expect.stringContaining("import") });
  });

  it("un calcul négatif n'est jamais affiché comme un stock : inconnu", () => {
    expect(initial(0, mv(5, 0))).toMatchObject({ etat: "inconnu", raison: expect.stringContaining("négatif") });
  });
});

describe("sens des ajustements (comptage)", () => {
  it("lignes de comptage appariées une à une aux mouvements : somme signée", () => {
    expect(resoudreAjustements([{ quantite: "3" }, { quantite: "2" }], [{ ecart: "-3" }, { ecart: "2" }])).toEqual({ nb: 2, net: "-1" });
  });
  it("un mouvement sans ligne (ou l'inverse) : sens inconnu, pas de supposition", () => {
    expect(resoudreAjustements([{ quantite: "3" }], [])).toEqual({ nb: 1, net: null });
    expect(resoudreAjustements([{ quantite: "3" }], [{ ecart: "-3" }, { ecart: "1" }])).toEqual({ nb: 1, net: null });
    expect(resoudreAjustements([{ quantite: "3" }], [{ ecart: "4" }])).toEqual({ nb: 1, net: null });
  });
  it("aucun ajustement : net 0, connu", () => {
    expect(resoudreAjustements([], [])).toEqual({ nb: 0, net: 0 });
  });
  it("additionner garde l'inconnu : une fenêtre au sens inconnu rend la somme inconnue", () => {
    expect(additionner(mv(1, 2, 3), mv(1, 1, null, 1)).ajustements).toEqual({ nb: 2, net: null });
  });
});

// Simulateur de registre : applique des opérations dans l'ordre où elles sont SAISIES (pas celui des dates), comme l'application.
type Op = { type: "ENTREE" | "SORTIE" | "COMPTAGE"; q: number; jour: number };
function simuler(stock0: number, ops: Op[]) {
  let stock = stock0;
  const lignes: { jour: number; ecart: number }[] = [];
  for (const o of ops) {
    if (o.type === "ENTREE") stock += o.q;
    else if (o.type === "SORTIE") stock -= o.q;
    else { lignes.push({ jour: o.jour, ecart: o.q - stock }); stock = o.q; } // comptage : stock POSÉ, écart signé gardé à part
  }
  return { fin: stock, lignes };
}
// Générateur déterministe (pas de hasard : le test doit être rejouable).
function suite(graine: number) { let s = graine; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

describe("égalité : stock initial + mouvements du mois = stock de fin (sur des registres simulés)", () => {
  let verifies = 0;
  for (const graine of [1, 7, 42, 2026, 99991, 31337, 5]) {
    it(`registre simulé n° ${graine} (entrées, sorties, comptages, saisies antidatées, mois suivants)`, () => {
      const alea = suite(graine);
      const stock0 = Math.round(alea() * 200);
      // Jours : ≤ 0 = septembre, 1-31 = octobre, 32+ = novembre (mois suivant). Un comptage a lieu le jour où on le saisit (≥ 1).
      const ops: Op[] = [];
      for (let i = 0; i < 25; i++) {
        const t = alea();
        const type = t < 0.4 ? "ENTREE" : t < 0.8 ? "SORTIE" : "COMPTAGE";
        ops.push({ type, q: Math.round(alea() * 400) / 4, jour: type === "COMPTAGE" ? 1 + Math.floor(alea() * 60) : Math.floor(alea() * 70) - 9 });
      }
      // Un registre réel ne descend pas sous 0 : une sortie trop forte est ramenée à ce qui reste.
      let courant = stock0;
      for (const o of ops) {
        if (o.type === "SORTIE") o.q = Math.min(o.q, courant);
        courant = o.type === "ENTREE" ? courant + o.q : o.type === "SORTIE" ? courant - o.q : o.q;
      }
      const { fin, lignes } = simuler(stock0, ops);
      // L'état du registre « au 1er » par définition : le stock de départ et les seules opérations DATÉES d'avant le 1er.
      const attendu = stock0 + ops.filter((o) => o.jour <= 0).reduce((t, o) => t + (o.type === "ENTREE" ? o.q : -o.q), 0);
      const dans = (j: number) => j >= 1 && j <= 31, apres = (j: number) => j > 31;
      const fenetre = (f: (j: number) => boolean): MouvementsAgreges => ({
        entrees: ops.filter((o) => f(o.jour) && o.type === "ENTREE").reduce((t, o) => t + o.q, 0),
        sorties: ops.filter((o) => f(o.jour) && o.type === "SORTIE").reduce((t, o) => t + o.q, 0),
        ajustements: { nb: lignes.filter((l) => f(l.jour)).length, net: lignes.filter((l) => f(l.jour)).reduce((t, l) => t + l.ecart, 0) },
      });
      const d: DonneesStockInitial = {
        annee: 2026, mois: 10, debut: OCT, dansMois: new Map([["a", fenetre(dans)]]), apresMois: new Map([["a", fenetre(apres)]]),
        crees: new Map(), avecMouvementAvant: new Set(), horsMouvement: new Map(),
      };
      const r = stockInitialArticle(d, "a", fin);
      if (attendu < 0) { expect(r.initial.etat).toBe("inconnu"); return; } // sortie antidatée plus forte que le stock d'alors : refusé, jamais affiché
      expect(r.initial.etat).toBe("ok");
      verifies++;
      const initialQ = quantiteInitiale(r.initial)!;
      expect(initialQ).toBeCloseTo(attendu, 3);
      // L'identité de l'écran et de l'Excel : début + entrées − sorties + ajustements + après = fin.
      expect(initialQ + r.entrees - r.sorties + (r.ajustements ?? NaN) + (r.apres ?? NaN)).toBeCloseTo(fin, 3);
    });
  }
  it("la simulation n'est pas vide : la plupart des registres ont été vérifiés (pas rejetés comme négatifs)", () => {
    expect(verifies).toBeGreaterThanOrEqual(4);
  });
});

describe("écart avec la clôture du mois précédent (signalé, jamais corrigé)", () => {
  const base = (cloture: DonneesStockInitial["cloturePrecedente"]): DonneesStockInitial => ({
    annee: 2026, mois: 10, debut: OCT, dansMois: new Map([["a", mv(40, 10)]]), apresMois: new Map(),
    crees: new Map(), avecMouvementAvant: new Set(), horsMouvement: new Map(), cloturePrecedente: cloture,
  });

  it("la clôture de septembre (instantané du 3/10) ramenée au 1er donne 116 ; le stock actuel donne 108 → écart de −8 signalé", () => {
    // Instantané 108 le 3/10, dont 8 de sorties datées d'octobre déjà enregistrées : 116 au 1er selon la clôture.
    const d = base({ annee: 2026, mois: 9, figeLe: new Date("2026-10-03T10:30:00Z"), stocks: new Map([["a", 108]]), mouvements: new Map([["a", mv(0, 8)]]) });
    const r = stockInitialArticle(d, "a", 108 + 40 - 10 - 8); // le stock actuel a perdu 16 hors mouvement (146 attendu)
    expect(r.initial).toEqual({ etat: "ok", quantite: 108 - 8 });
    expect(r.ecartCloture).toEqual({ cloture: 116, calcule: 100, ecart: -16 });
  });

  it("cohérent : même stock initial par les deux chemins → aucun écart", () => {
    // Clôture : instantané 108 le 3/10 contenant 8 de sorties d'octobre → 116 au 1er. Actuel : 116 + 40 − 10 − ... on construit l'actuel pour que ce soit cohérent.
    const clot = { annee: 2026, mois: 9, figeLe: new Date("2026-10-03T10:30:00Z"), stocks: new Map([["a", 108]]), mouvements: new Map([["a", mv(0, 8)]]) };
    const d = base(clot);
    const fin = 116 + 40 - 10; // 146 : 116 au 1er
    const r = stockInitialArticle(d, "a", fin);
    expect(r.initial).toEqual({ etat: "ok", quantite: 116 });
    expect(r.ecartCloture).toBeUndefined();
  });

  it("stock touché hors mouvement depuis la clôture (+4 non expliqué) → écart signalé de +4, stock initial non corrigé", () => {
    const clot = { annee: 2026, mois: 9, figeLe: new Date("2026-10-03T10:30:00Z"), stocks: new Map([["a", 108]]), mouvements: new Map([["a", mv(0, 8)]]) };
    const d = base(clot);
    const r = stockInitialArticle(d, "a", 116 + 40 - 10 + 4);
    expect(r.initial).toEqual({ etat: "ok", quantite: 120 }); // la valeur reconstituée reste la référence
    expect(r.ecartCloture).toEqual({ cloture: 116, calcule: 120, ecart: 4 });
  });

  it("pas de comparaison quand un des deux côtés est inconnu ou absent", () => {
    expect(ecartAvecCloture({ etat: "ok", quantite: 5 }, { etat: "inconnu", raison: "x" })).toBeNull();
    expect(ecartAvecCloture({ etat: "absent", raison: "x" }, { etat: "ok", quantite: 5 })).toBeNull();
    expect(ecartAvecCloture({ etat: "ok", quantite: 5 }, null)).toBeNull();
    expect(ecartAvecCloture({ etat: "ok", quantite: 5 }, { etat: "ok", quantite: 5 })).toBeNull();
  });
});
