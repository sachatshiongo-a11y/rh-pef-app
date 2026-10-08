import { describe, it, expect, vi } from "vitest";
import { avantApres, jjmm, jjmmaaaa, lireNouvelleDateSortie, natureNonSortie, nomsBornes } from "./date-sortie";

// Règles pures du changement de date d'une sortie (2026-10-08) : lecture de la date (jour civil de
// Kinshasa, jamais dans le futur), libellés du refus et de la notification.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

describe("lireNouvelleDateSortie", () => {
  const midi = new Date("2026-10-08T11:00:00Z");
  it("un jour du calendrier, passé ou d'aujourd'hui : accepté tel quel", () => {
    expect(lireNouvelleDateSortie("2026-10-01", midi)).toBe("2026-10-01");
    expect(lireNouvelleDateSortie(" 2026-10-08 ", midi)).toBe("2026-10-08");
  });
  it("vide, illisible, hors calendrier, non-texte : refus lisible (jamais « aujourd'hui » par défaut)", () => {
    expect(() => lireNouvelleDateSortie("", midi)).toThrow("Choisissez la nouvelle date de la sortie.");
    expect(() => lireNouvelleDateSortie(undefined, midi)).toThrow("Choisissez la nouvelle date de la sortie.");
    expect(() => lireNouvelleDateSortie("08/10/2026", midi)).toThrow(/Date invalide/);
    expect(() => lireNouvelleDateSortie("2026-02-30", midi)).toThrow(/Date invalide/);
    expect(() => lireNouvelleDateSortie(20261001, midi)).toThrow("Choisissez la nouvelle date de la sortie.");
    expect(() => lireNouvelleDateSortie("0026-10-01", midi)).toThrow("Date invalide : 01/10/0026 est antérieure au 01/01/2020 (année mal saisie ?). Rien n'a été modifié.");
    expect(lireNouvelleDateSortie("2020-01-01", midi)).toBe("2020-01-01");
  });
  it("futur : refus, « aujourd'hui » lu à Kinshasa (UTC+1)", () => {
    expect(() => lireNouvelleDateSortie("2026-10-09", midi)).toThrow("La date d'une sortie ne peut pas être dans le futur (aujourd'hui à Kinshasa : 08/10/2026). Rien n'a été modifié.");
    // 23 h 30 UTC le 7 = 0 h 30 le 8 à Kinshasa : le 8 est déjà « aujourd'hui ».
    expect(lireNouvelleDateSortie("2026-10-08", new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-08");
    expect(() => lireNouvelleDateSortie("2026-10-08", new Date("2026-10-07T22:30:00Z"))).toThrow(/futur/);
  });
});

describe("libellés", () => {
  it("dates courtes et longues d'une date pure", () => {
    expect(jjmm(new Date("2026-10-03T00:00:00Z"))).toBe("03/10");
    expect(jjmmaaaa("2026-10-03")).toBe("03/10/2026");
  });
  it("avant → après : anciennes dates triées sans doublon, bornées au-delà de 4", () => {
    expect(avantApres([new Date("2026-10-03T00:00:00Z")], "2026-10-01")).toBe("03/10 → 01/10");
    expect(avantApres(["2026-10-04", "2026-10-03", "2026-10-04"], "2026-10-01")).toBe("03/10, 04/10 → 01/10");
    expect(avantApres(["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"], "2026-10-01")).toBe("02/10, 03/10, 04/10, 05/10… (5 dates) → 01/10");
  });
  it("nature d'un mouvement refusé : ajustement, facture, réception, entrée", () => {
    expect(natureNonSortie({ type: "AJUSTEMENT" })).toBe("ajustement de comptage");
    expect(natureNonSortie({ type: "ENTREE", factureId: "f" })).toBe("entrée par facture");
    expect(natureNonSortie({ type: "ENTREE", receptionId: "r" })).toBe("réception de bon de commande");
    expect(natureNonSortie({ type: "ENTREE" })).toBe("entrée");
  });
  it("noms bornés", () => {
    expect(nomsBornes(["a", "b"])).toBe("a, b");
    expect(nomsBornes(["a", "b", "c", "d"], 2)).toBe("a, b et 2 autres");
    expect(nomsBornes(["a", "b", "c"], 2)).toBe("a, b et 1 autre");
  });
});

describe("notification « Date de sortie changée » (texteGeste)", async () => {
  const { texteGeste } = await import("@/lib/validations-stock/geste-notifie");
  const s = (designation: string, ancienne: string, categorieSortie: string | null = "LIVRAISON_RESTAURANT", articleId = designation) =>
    ({ articleId, designation, unite: "kg", quantite: 1, ancienne: new Date(`${ancienne}T00:00:00Z`), categorieSortie });
  const nouvelle = new Date("2026-10-01T00:00:00Z");
  it("une sortie : article, avant → après, lien sur son article et son motif", () => {
    const t = texteGeste("Jean", { genre: "DATE_SORTIE", nouvelle, sorties: [s("Riz", "2026-10-03", "PERTE", "riz")] });
    expect(t.message).toBe("Date d'une sortie changée par Jean : 03/10 → 01/10 — Riz");
    expect(t.lien).toBe("/stock/mouvements?mois=2026-10&motif=perte&articleId=riz");
    expect(t.titre).toBe("Date de sortie changée");
    expect(t.cle).toBeNull(); // jamais regroupée avec une rafale de saisies
  });
  it("plusieurs : « Date de 2 sorties changée par Jean : 03/10 → 01/10 — Riz, Sel » ; motifs mêlés : pas de filtre motif", () => {
    const t = texteGeste("Jean", { genre: "DATE_SORTIE", nouvelle, sorties: [s("Riz", "2026-10-03"), s("Sel", "2026-10-03", "PERTE")] });
    expect(t.message).toBe("Date de 2 sorties changée par Jean : 03/10 → 01/10 — Riz, Sel");
    expect(t.lien).toBe("/stock/mouvements?mois=2026-10");
  });
});
