import { describe, it, expect } from "vitest";
import {
  classerContrats,
  libelleTypeContrat,
  LIBELLE_TYPE_CONTRAT,
  type ContratClassable,
} from "./contrats-classement";

// Le classement d'un contrat est DÉRIVÉ, comme l'état de signature : rien n'est écrit en base.
// L'espace salarié et les écrans de la Direction lisent la même fonction — un CDD dont la date de
// fin est passée ne peut pas être « en vigueur » d'un côté et « expiré » de l'autre.

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const c = (p: Partial<ContratClassable> & { id: string }): ContratClassable => ({
  type: "CDI",
  statut: "ACTIF",
  dateDebut: jour("2026-01-01"),
  dateFin: null,
  createdAt: new Date("2026-01-01T08:00:00Z"),
  ...p,
});
const MIDI_KIN = new Date("2026-09-28T11:00:00Z"); // 12 h à Kinshasa

describe("classerContrats", () => {
  it("contrat en vigueur signé → EN_VIGUEUR", () => {
    const r = classerContrats([c({ id: "a" })], new Map([["a", "SIGNE"]]), MIDI_KIN);
    expect(r.get("a")).toEqual({ categorie: "EN_VIGUEUR", motif: null, expireNonMarque: false });
  });

  it("contrat en vigueur jamais signé → A_SIGNER (absent de la carte des états)", () => {
    const r = classerContrats([c({ id: "a" })], new Map(), MIDI_KIN);
    expect(r.get("a")?.categorie).toBe("A_SIGNER");
  });

  it("contrat en vigueur modifié après signature → A_SIGNER", () => {
    const r = classerContrats([c({ id: "a" })], new Map([["a", "A_RESIGNER"]]), MIDI_KIN);
    expect(r.get("a")?.categorie).toBe("A_SIGNER");
  });

  it("CDD resté ACTIF dont la fin est passée → ANCIEN « expiré le … », même signé", () => {
    const r = classerContrats(
      [c({ id: "a", type: "CDD", dateFin: jour("2026-08-31") })],
      new Map([["a", "SIGNE"]]),
      MIDI_KIN,
    );
    expect(r.get("a")).toEqual({ categorie: "ANCIEN", motif: "expiré le 31/08/2026", expireNonMarque: true });
  });

  it("stage dont la fin est passée → expiré", () => {
    const r = classerContrats([c({ id: "a", type: "STAGE", dateFin: jour("2026-09-27") })], new Map(), MIDI_KIN);
    expect(r.get("a")?.motif).toBe("expiré le 27/09/2026");
  });

  it("statut EXPIRE posé par la Direction → expiré, sans le compter comme « à marquer »", () => {
    const r = classerContrats([c({ id: "a", type: "CDD", statut: "EXPIRE", dateFin: jour("2026-08-31") })], new Map(), MIDI_KIN);
    expect(r.get("a")).toEqual({ categorie: "ANCIEN", motif: "expiré le 31/08/2026", expireNonMarque: false });
  });

  it("la date de fin elle-même est encore un jour de contrat", () => {
    const r = classerContrats([c({ id: "a", type: "CDD", dateFin: jour("2026-09-28") })], new Map([["a", "SIGNE"]]), MIDI_KIN);
    expect(r.get("a")?.categorie).toBe("EN_VIGUEUR");
  });

  it("« aujourd'hui » est le jour de KINSHASA : 23 h 30 UTC le 28 = déjà le 29 à Kinshasa", () => {
    const contrats = [c({ id: "a", type: "CDD", dateFin: jour("2026-09-28") })];
    const avantMinuitKin = new Date("2026-09-28T22:30:00Z"); // 23 h 30 à Kinshasa, le 28
    const apresMinuitKin = new Date("2026-09-28T23:30:00Z"); // 0 h 30 à Kinshasa, le 29 — encore le 28 en UTC
    expect(classerContrats(contrats, new Map([["a", "SIGNE"]]), avantMinuitKin).get("a")?.categorie).toBe("EN_VIGUEUR");
    expect(classerContrats(contrats, new Map([["a", "SIGNE"]]), apresMinuitKin).get("a")?.motif).toBe("expiré le 28/09/2026");
  });

  it("deux contrats ACTIF : le plus ancien est « remplacé par le contrat du … »", () => {
    const r = classerContrats(
      [c({ id: "ancien", dateDebut: jour("2025-01-01") }), c({ id: "recent", dateDebut: jour("2026-07-01") })],
      new Map([["ancien", "SIGNE"], ["recent", "SIGNE"]]),
      MIDI_KIN,
    );
    expect(r.get("recent")?.categorie).toBe("EN_VIGUEUR");
    expect(r.get("ancien")).toEqual({ categorie: "ANCIEN", motif: "remplacé par le contrat du 01/07/2026", expireNonMarque: false });
  });

  it("même date de début : le plus récemment CRÉÉ l'emporte", () => {
    const r = classerContrats(
      [
        c({ id: "premier", createdAt: new Date("2026-07-01T08:00:00Z") }),
        c({ id: "second", createdAt: new Date("2026-07-01T09:00:00Z") }),
      ],
      new Map(),
      MIDI_KIN,
    );
    expect(r.get("second")?.categorie).toBe("A_SIGNER");
    expect(r.get("premier")?.categorie).toBe("ANCIEN");
  });

  it("résilié, transformé : le motif suit le statut, jamais le signe « expiré »", () => {
    const r = classerContrats(
      [
        c({ id: "r", statut: "RESILIE", type: "CDD", dateFin: jour("2026-03-31") }),
        c({ id: "t", statut: "TRANSFORME", type: "CDD", dateFin: jour("2026-12-31") }),
      ],
      new Map(),
      MIDI_KIN,
    );
    expect(r.get("r")).toEqual({ categorie: "ANCIEN", motif: "résilié", expireNonMarque: false });
    expect(r.get("t")).toEqual({ categorie: "ANCIEN", motif: "transformé", expireNonMarque: false });
  });

  it("un contrat résilié n'est jamais « en vigueur » et ne remplace personne", () => {
    const r = classerContrats(
      [c({ id: "actif", dateDebut: jour("2025-01-01") }), c({ id: "resilie", statut: "RESILIE", dateDebut: jour("2026-07-01") })],
      new Map([["actif", "SIGNE"]]),
      MIDI_KIN,
    );
    expect(r.get("actif")?.categorie).toBe("EN_VIGUEUR");
  });
});

describe("contrat qui commence plus tard", () => {
  it("l'ancien reste EN VIGUEUR jusqu'au début du nouveau, qui est à signer et « à venir »", () => {
    // Un CDI remplacé par un nouveau CDI (autres conditions) à partir du 1er novembre.
    const contrats = [c({ id: "cdd", dateDebut: jour("2026-01-01") }), c({ id: "cdi", dateDebut: jour("2026-11-01") })];
    const r = classerContrats(contrats, new Map([["cdd", "SIGNE"]]), MIDI_KIN);
    expect(r.get("cdd")?.categorie).toBe("EN_VIGUEUR");
    expect(r.get("cdi")).toEqual({ categorie: "A_SIGNER", motif: "commence le 01/11/2026", expireNonMarque: false, aVenir: true });
    // Le jour du début, le nouveau prend la place : l'ancien est remplacé.
    const r2 = classerContrats(contrats, new Map([["cdd", "SIGNE"]]), new Date("2026-11-01T10:00:00Z"));
    expect(r2.get("cdd")?.motif).toBe("remplacé par le contrat du 01/11/2026");
    expect(r2.get("cdi")?.aVenir).toBeUndefined();
  });
});

describe("libellés du type de contrat", () => {
  it("chaque type s'écrit en clair", () => {
    expect(libelleTypeContrat("CDI")).toBe("CDI — durée indéterminée");
    expect(libelleTypeContrat("CDD")).toBe("CDD — durée déterminée");
    expect(libelleTypeContrat("STAGE")).toBe("Stage");
    expect(libelleTypeContrat("INTERIM")).toBe("Intérim");
    expect(libelleTypeContrat("JOURNALIER")).toBe("Journalier");
  });

  it("aucune valeur brute ne sort, même pour un type inconnu", () => {
    expect(libelleTypeContrat("NOUVEAU_TYPE")).toBe("Autre contrat");
    for (const libelle of Object.values(LIBELLE_TYPE_CONTRAT)) expect(libelle).not.toMatch(/^[A-Z_]+$/);
  });
});
