import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lireFiltreMouvements, whereMouvements, whereColonne, libelleFiltre, optionsMoisMouvements, FILTRES_MOTIF, type CleMotif } from "./filtre-mouvements";

// Le filtre de l'écran Mouvements (mois, produit, motif) est construit par UNE fonction, partagée
// par la page et par les actions « tout le filtre » : chaque combinaison est vérifiée ici, et
// l'intégration (`tout-le-filtre.integration.test.ts`) vérifie les mêmes combinaisons sur une vraie base.

const MAINTENANT = new Date("2026-09-29T10:00:00Z");
const SEPT = { gte: new Date("2026-09-01T00:00:00Z"), lt: new Date("2026-10-01T00:00:00Z") };

describe("mois courant du filtre — celui de Kinshasa", () => {
  it("le 1er octobre à 00 h 30 (23 h 30 UTC la veille) : octobre par défaut ; le 31 à 23 h 30 : octobre aussi", () => {
    expect(lireFiltreMouvements({}, new Date("2026-09-30T23:30:00Z")).mois).toBe("2026-10");
    expect(lireFiltreMouvements({}, new Date("2026-10-31T22:30:00Z")).mois).toBe("2026-10");
  });
  it("la liste des 12 derniers mois commence au mois courant de Kinshasa", () => {
    expect(optionsMoisMouvements(new Date("2026-09-30T23:30:00Z"), undefined)[0]).toEqual({ val: "2026-10", label: "Octobre 2026" });
    expect(optionsMoisMouvements(new Date("2026-10-31T22:30:00Z"), undefined)[0]).toEqual({ val: "2026-10", label: "Octobre 2026" });
  });
});

describe("lireFiltreMouvements — normalisation d'un filtre brut (URL ou argument d'action, non fiable)", () => {
  it.each([
    [undefined, "2026-9"], ["", "2026-9"], ["n'importe quoi", "2026-9"], ["2026-13", "2026-9"], ["2026-0", "2026-9"],
    ["tous", "tous"], ["2026-7", "2026-7"], ["2026-07", "2026-7"], ["2025-12", "2025-12"], [42, "2026-9"],
  ])("mois %j → %s", (mois, attendu) => {
    expect(lireFiltreMouvements({ mois }, MAINTENANT).mois).toBe(attendu);
  });

  it("produit : vide ou non textuel → aucun ; motif : seulement une clé connue (pas une clé héritée)", () => {
    expect(lireFiltreMouvements({ articleId: "" }, MAINTENANT).articleId).toBeNull();
    expect(lireFiltreMouvements({ articleId: 12 }, MAINTENANT).articleId).toBeNull();
    expect(lireFiltreMouvements({ articleId: "a1" }, MAINTENANT).articleId).toBe("a1");
    expect(lireFiltreMouvements({ motif: "toString" }, MAINTENANT).motif).toBeNull();
    expect(lireFiltreMouvements({ motif: "autre" }, MAINTENANT).motif).toBeNull();
    for (const k of Object.keys(FILTRES_MOTIF)) expect(lireFiltreMouvements({ motif: k }, MAINTENANT).motif).toBe(k);
    expect(lireFiltreMouvements(null, MAINTENANT)).toEqual({ mois: "2026-9", articleId: null, motif: null });
  });
});

describe("whereMouvements / whereColonne — chaque combinaison mois × produit × motif × colonne", () => {
  const MOIS = ["tous", "2026-9"] as const;
  const PRODUITS = [null, "farine"] as const;
  type MotifSortie = Extract<CleMotif, "livraison" | "perte" | "sans">;
  const MOTIFS: (MotifSortie | null)[] = [null, "livraison", "perte", "sans"];
  const CAT: Record<MotifSortie, string | null> = { livraison: "LIVRAISON_RESTAURANT", perte: "PERTE", sans: null };
  const combinaisons = MOIS.flatMap((mois) => PRODUITS.flatMap((articleId) => MOTIFS.map((motif) => ({ mois, articleId, motif }))));

  it.each(combinaisons)("%j", (f) => {
    const attendu: Record<string, unknown> = {};
    if (f.articleId) attendu.articleId = f.articleId;
    if (f.motif) { attendu.type = "SORTIE"; attendu.categorieSortie = CAT[f.motif]; }
    if (f.mois !== "tous") attendu.date = SEPT;
    expect(whereMouvements(f)).toEqual(attendu);
    expect(whereColonne(f, "SORTIES")).toEqual({ AND: [attendu, { type: "SORTIE" }] });
    // Colonne Entrées : un AND, jamais un écrasement — un filtre de motif (type SORTIE) y donne l'ensemble vide.
    expect(whereColonne(f, "ENTREES")).toEqual({ AND: [attendu, { type: { not: "SORTIE" } }] });
  });

  it("motifs d'ENTRÉE (cartes « Entrées de stock ») : mois et produit s'ajoutent, la colonne Sorties est vide", () => {
    for (const motif of ["entrees", "achats", "factures", "autres"] as const) {
      const w = whereMouvements({ mois: "2026-9", articleId: "farine", motif });
      expect(w).toEqual({ articleId: "farine", ...FILTRES_MOTIF[motif].where, date: SEPT });
      expect(whereColonne({ mois: "2026-9", articleId: null, motif }, "SORTIES")).toEqual({ AND: [{ ...FILTRES_MOTIF[motif].where, date: SEPT }, { type: "SORTIE" }] });
    }
  });

  it("décembre : la borne haute passe à l'année suivante", () => {
    expect(whereMouvements({ mois: "2025-12", articleId: null, motif: null }).date).toEqual({ gte: new Date("2025-12-01T00:00:00Z"), lt: new Date("2026-01-01T00:00:00Z") });
  });
});

describe("libelleFiltre — le filtre nommé dans les confirmations", () => {
  it.each([
    [{ mois: "2026-9", articleId: null, motif: "sans" }, null, "septembre 2026, sans motif"],
    [{ mois: "2026-9", articleId: null, motif: null }, null, "septembre 2026"],
    [{ mois: "tous", articleId: "f", motif: "livraison" }, "Farine", "tous les mois, produit « Farine », motif Livraison restaurant"],
    [{ mois: "2026-7", articleId: "f", motif: "perte" }, "Farine", "juillet 2026, produit « Farine », motif Perte"],
  ] as const)("%j", (f, designation, attendu) => {
    expect(libelleFiltre(f, designation)).toBe(attendu);
  });
});

describe("optionsMoisMouvements — la liste « mois » garde le mois filtré", () => {
  it("12 derniers mois, du plus récent au plus ancien, libellés comme avant", () => {
    const o = optionsMoisMouvements(MAINTENANT, "2026-9");
    expect(o).toHaveLength(12);
    expect(o[0]).toEqual({ val: "2026-9", label: "Septembre 2026" });
    expect(o[11]).toEqual({ val: "2025-10", label: "Octobre 2025" });
  });
  it("mois filtré plus ancien (lien d'une carte) : ajouté, à sa place, pour rester sélectionné", () => {
    const o = optionsMoisMouvements(MAINTENANT, "2024-3");
    expect(o).toHaveLength(13);
    expect(o[12]).toEqual({ val: "2024-3", label: "Mars 2024" });
    // Même forme que la valeur lue par lireFiltreMouvements : la liste la sélectionne.
    expect(o.map((x) => x.val)).toContain(lireFiltreMouvements({ mois: "2024-03" }, MAINTENANT).mois);
  });
  it("mois futur : ajouté en tête ; « tous », absent ou invalide : rien d'ajouté", () => {
    expect(optionsMoisMouvements(MAINTENANT, "2026-11")[0]).toEqual({ val: "2026-11", label: "Novembre 2026" });
    for (const m of [undefined, "tous", "2026-13", "n'importe quoi"]) expect(optionsMoisMouvements(MAINTENANT, m)).toHaveLength(12);
  });
  it("la page Mouvements s'en sert (plus de liste à 12 mois écrite à la main)", () => {
    const src = readFileSync("src/app/(stock)/stock/mouvements/page.tsx", "utf8");
    expect(src).toMatch(/const moisOptions = optionsMoisMouvements\(now, mois\);/);
    expect(src).toMatch(/<select name="mois" defaultValue=\{mois \?\? "tous"\}/);
  });
});
