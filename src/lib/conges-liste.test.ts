import { describe, it, expect } from "vitest";
import {
  ETATS, clauseConges, clausePeriode, clauseSection, etatActif, filtreActif, hrefConges, libelleJours, libellePeriode, lireFiltresConges, lireJourParametre,
  sectionDe, triSection, bornesDuMois,
} from "./conges-liste";

const J = new Date(Date.UTC(2026, 9, 9)); // « aujourd'hui » : le 9 octobre 2026 (jour civil de Kinshasa)
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("lireFiltresConges", () => {
  it("rien dans l'adresse : aucun filtre, regroupement par état", () => {
    const f = lireFiltresConges({});
    expect(f).toMatchObject({ statut: null, statutInconnu: false, type: null, q: "", quand: null, mois: null, du: null, au: null, groupe: "etat" });
    expect(filtreActif(f)).toBe(false);
  });
  it("lit statut, type, recherche (rognée), quand, regroupement", () => {
    const f = lireFiltresConges({ statut: "APPROUVE", type: "Congé annuel", q: "  rachel ", quand: "en-cours", groupe: "mois" });
    expect(f).toMatchObject({ statut: "APPROUVE", type: "Congé annuel", q: "rachel", quand: "en-cours", groupe: "mois" });
    expect(filtreActif(f)).toBe(true);
  });
  it("une valeur illisible est ignorée, sauf un statut inconnu (aucune demande, comme avant)", () => {
    const f = lireFiltresConges({ statut: "N_IMPORTE_QUOI", quand: "demain", mois: "2026-13", du: "2026-02-30", au: "pas une date", groupe: "x" });
    expect(f).toMatchObject({ statut: null, statutInconnu: true, quand: null, mois: null, du: null, au: null, groupe: "etat" });
    expect(clauseConges(f, J)).toEqual({ AND: [{ id: { in: [] } }] });
  });
  it("un mois prime sur une plage", () => {
    const f = lireFiltresConges({ mois: "2026-11", du: "2026-01-01", au: "2026-01-31" });
    expect(f.mois).toBe("2026-11");
    expect(f.du).toBeNull();
    expect(f.au).toBeNull();
  });
  it("lireJourParametre : seulement une vraie date AAAA-MM-JJ", () => {
    expect(lireJourParametre("2026-10-09")?.toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(lireJourParametre("2026-02-30")).toBeNull();
    expect(lireJourParametre("09/10/2026")).toBeNull();
    expect(lireJourParametre(undefined)).toBeNull();
  });
});

describe("période : la demande CHEVAUCHE la période", () => {
  it("un mois : début ≤ dernier jour ET fin ≥ premier jour", () => {
    const b = bornesDuMois("2026-02");
    expect(b.du.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(b.au.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(clausePeriode(lireFiltresConges({ mois: "2026-02" }))).toEqual({ AND: [{ dateDebut: { lte: d("2026-02-28") } }, { dateFin: { gte: d("2026-02-01") } }] });
  });
  it("une plage ouverte d'un côté ne pose qu'une borne ; sans période, pas de clause", () => {
    expect(clausePeriode(lireFiltresConges({ du: "2026-10-01" }))).toEqual({ AND: [{ dateFin: { gte: d("2026-10-01") } }] });
    expect(clausePeriode(lireFiltresConges({ au: "2026-10-31" }))).toEqual({ AND: [{ dateDebut: { lte: d("2026-10-31") } }] });
    expect(clausePeriode(lireFiltresConges({}))).toBeNull();
  });
});

describe("sections : chaque demande dans UNE section", () => {
  const cas: [string, { statut: string; dateDebut: Date; dateFin: Date }, string][] = [
    ["en attente, à venir → à traiter", { statut: "EN_ATTENTE", dateDebut: d("2026-11-01"), dateFin: d("2026-11-05") }, "A_TRAITER"],
    ["en attente, déjà passée → à traiter quand même", { statut: "EN_ATTENTE", dateDebut: d("2026-01-01"), dateFin: d("2026-01-05") }, "A_TRAITER"],
    ["approuvée, commence aujourd'hui → en cours", { statut: "APPROUVE", dateDebut: d("2026-10-09"), dateFin: d("2026-10-12") }, "EN_COURS"],
    ["approuvée, finit aujourd'hui → en cours (du 12 au 12)", { statut: "APPROUVE", dateDebut: d("2026-10-05"), dateFin: d("2026-10-09") }, "EN_COURS"],
    ["approuvée, commence demain → à venir", { statut: "APPROUVE", dateDebut: d("2026-10-10"), dateFin: d("2026-10-12") }, "A_VENIR"],
    ["approuvée, finie hier → passée", { statut: "APPROUVE", dateDebut: d("2026-10-01"), dateFin: d("2026-10-08") }, "PASSES"],
    ["refusée, à venir → passée (clôturée)", { statut: "REFUSE", dateDebut: d("2026-12-01"), dateFin: d("2026-12-05") }, "PASSES"],
  ];
  it.each(cas)("%s", (_nom, demande, attendu) => expect(sectionDe(demande, J)).toBe(attendu));

  it("les clauses de lecture reprennent la même répartition", () => {
    expect(clauseSection("A_TRAITER", J)).toEqual({ statut: "EN_ATTENTE" });
    expect(clauseSection("EN_COURS", J)).toEqual({ statut: "APPROUVE", dateDebut: { lte: J }, dateFin: { gte: J } });
    expect(clauseSection("A_VENIR", J)).toEqual({ statut: "APPROUVE", dateDebut: { gt: J } });
    expect(clauseSection("PASSES", J)).toEqual({ OR: [{ statut: "REFUSE" }, { statut: "APPROUVE", dateFin: { lt: J } }] });
  });
  it("l'urgent d'abord, les passés du plus récent au plus ancien", () => {
    expect(triSection("A_TRAITER")[0]).toEqual({ dateDebut: "asc" });
    expect(triSection("EN_COURS")[0]).toEqual({ dateFin: "asc" });
    expect(triSection("PASSES")[0]).toEqual({ dateDebut: "desc" });
  });
});

describe("pastilles d'état et compteurs", () => {
  it("les clauses de compteur ignorent l'état choisi (« sans etat ») mais gardent recherche, période et type", () => {
    const f = lireFiltresConges({ statut: "REFUSE", q: "rachel", type: "Congé annuel", mois: "2026-10" });
    const sans = clauseConges(f, J, "etat") as { AND: unknown[] };
    expect(JSON.stringify(sans)).not.toContain("REFUSE");
    expect(JSON.stringify(sans)).toContain("rachel");
    expect(JSON.stringify(sans)).toContain("Congé annuel");
    const sansType = JSON.stringify(clauseConges(f, J, "type"));
    expect(sansType).not.toContain("Congé annuel");
    expect(sansType).toContain("REFUSE");
  });
  it("sans aucun filtre, la clause est vide (tout l'ensemble)", () => {
    expect(clauseConges(lireFiltresConges({}), J)).toEqual({});
  });
  it("la pastille allumée suit statut + quand", () => {
    expect(etatActif(lireFiltresConges({}))).toBe("tous");
    expect(etatActif(lireFiltresConges({ statut: "EN_ATTENTE" }))).toBe("EN_ATTENTE");
    expect(etatActif(lireFiltresConges({ statut: "APPROUVE" }))).toBe("APPROUVE");
    expect(etatActif(lireFiltresConges({ statut: "APPROUVE", quand: "en-cours" }))).toBe("en-cours");
    expect(etatActif(lireFiltresConges({ statut: "APPROUVE", quand: "a-venir" }))).toBe("a-venir");
    expect(etatActif(lireFiltresConges({ statut: "REFUSE" }))).toBe("REFUSE");
  });
  it("l'ordre des pastilles : anciennes cartes d'abord (En attente, En congé aujourd'hui, À venir, Approuvés)", () => {
    expect(ETATS.map((e) => e.cle)).toEqual(["tous", "EN_ATTENTE", "en-cours", "a-venir", "APPROUVE", "REFUSE"]);
  });
});

describe("hrefConges", () => {
  it("garde les filtres, applique le changement, repart à la page 1 et garde la taille", () => {
    expect(hrefConges({ statut: "APPROUVE", q: "ra", page: "3", par: "100" }, { type: "Congé annuel" })).toBe("/conges?statut=APPROUVE&q=ra&par=100&type=Cong%C3%A9+annuel");
  });
  it("une valeur vide ou absente retire le paramètre ; rien à garder : adresse nue", () => {
    expect(hrefConges({ statut: "APPROUVE", quand: "a-venir" }, { statut: undefined, quand: undefined })).toBe("/conges");
    expect(hrefConges({ q: "x" }, { q: "" })).toBe("/conges");
  });
  it("ignore les paramètres inconnus (erreurs de décision, vue…)", () => {
    expect(hrefConges({ statut: "REFUSE", ...({ erreurDecision: "Boum", vue: "calendrier" } as object) })).toBe("/conges?statut=REFUSE");
  });
});

describe("libellés", () => {
  it("période : année à la fin, omise quand tout tient dans l'année en cours", () => {
    expect(libellePeriode(d("2026-09-28"), d("2027-01-20"), 2026)).toBe("28 sept. → 20 janv. 2027");
    expect(libellePeriode(d("2026-10-14"), d("2026-10-21"), 2026)).toBe("14 oct. → 21 oct.");
    expect(libellePeriode(d("2025-03-05"), d("2025-03-09"), 2026)).toBe("5 mars → 9 mars 2025");
    expect(libellePeriode(d("2026-10-12"), d("2026-10-12"), 2026)).toBe("12 oct.");
  });
  it("jours : virgule décimale", () => {
    expect(libelleJours(98)).toBe("98 j");
    expect(libelleJours(0.5)).toBe("0,5 j");
  });
});
