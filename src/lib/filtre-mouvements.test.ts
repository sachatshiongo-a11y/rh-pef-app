import { describe, it, expect } from "vitest";
import { lireFiltreMouvements, whereMouvements, whereColonne, libelleFiltre, FILTRES_MOTIF, type CleMotif } from "./filtre-mouvements";

// Le filtre de l'écran Mouvements (mois, produit, motif) est construit par UNE fonction, partagée
// par la page et par les actions « tout le filtre » : chaque combinaison est vérifiée ici, et
// l'intégration (`tout-le-filtre.integration.test.ts`) vérifie les mêmes combinaisons sur une vraie base.

const MAINTENANT = new Date("2026-09-29T10:00:00Z");
const SEPT = { gte: new Date("2026-09-01T00:00:00Z"), lt: new Date("2026-10-01T00:00:00Z") };

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
  const MOTIFS: (CleMotif | null)[] = [null, "livraison", "perte", "sans"];
  const CAT: Record<CleMotif, string | null> = { livraison: "LIVRAISON_RESTAURANT", perte: "PERTE", sans: null };
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
