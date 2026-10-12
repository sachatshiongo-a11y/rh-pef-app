import { describe, it, expect } from "vitest";
import { moisOuvreDroit, periodesSansConges, trousDeContrat, typeSansConges, typeSelonHistorique } from "./conges-periodes";

const j = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const c = (type: string, debut: string, fin: string | null = null) => ({ type, dateDebut: j(debut), dateFin: fin ? j(fin) : null });
const plage = (p: { debut: Date | null; fin: Date | null }) => [p.debut?.toISOString().slice(0, 10) ?? null, p.fin?.toISOString().slice(0, 10) ?? null];

describe("typeSansConges", () => {
  it("stage et intérim n'ouvrent pas de droit ; CDI, CDD et journalier si", () => {
    expect(["STAGE", "INTERIM"].map(typeSansConges)).toEqual([true, true]);
    expect(["CDI", "CDD", "JOURNALIER", null, undefined].map(typeSansConges)).toEqual([false, false, false, false, false]);
  });
});

describe("periodesSansConges — le régime se lit PAR PÉRIODE de contrat", () => {
  it("stage puis CDI : seule la période du stage est sans congés (le CDI actuel ne l'efface plus)", () => {
    const p = periodesSansConges([c("STAGE", "2025-01-01", "2025-06-30"), c("CDI", "2025-07-01")], "CDI");
    expect(p.map(plage)).toEqual([[null, "2025-06-30"]]); // depuis l'embauche : la tête de période suit le premier contrat
  });

  it("CDI puis stage : seule la période du stage est sans congés", () => {
    const p = periodesSansConges([c("CDI", "2025-01-01", "2025-08-31"), c("STAGE", "2025-09-01")], "STAGE");
    expect(p.map(plage)).toEqual([["2025-09-01", null]]);
  });

  it("un contrat « transformé » sans date de fin est relayé par le contrat suivant (le plus récent commence l'emporte)", () => {
    const p = periodesSansConges([c("STAGE", "2025-01-01"), c("CDI", "2025-04-01")], "CDI");
    expect(p.map(plage)).toEqual([[null, "2025-03-31"]]);
  });

  it("deux stages qui se touchent forment une seule période ; intérim compris", () => {
    const p = periodesSansConges([c("STAGE", "2025-01-01", "2025-02-28"), c("INTERIM", "2025-03-01", "2025-04-30"), c("CDD", "2025-05-01")], "CDD");
    expect(p.map(plage)).toEqual([[null, "2025-04-30"]]);
  });

  it("sans AUCUN contrat enregistré : le type de la fiche vaut pour toute la période (ancien comportement)", () => {
    expect(periodesSansConges([], "STAGE").map(plage)).toEqual([[null, null]]);
    expect(periodesSansConges([], "CDI")).toEqual([]);
  });

  it("TROU entre deux contrats : le régime du contrat précédent se poursuit (stage → trou → CDI)", () => {
    const contrats = [c("STAGE", "2025-01-01", "2025-03-31"), c("CDI", "2025-06-01")];
    expect(periodesSansConges(contrats, "CDI").map(plage)).toEqual([[null, "2025-05-31"]]);
    expect(trousDeContrat(contrats).map(plage)).toEqual([["2025-04-01", "2025-05-31"]]);
  });

  it("TROU après un CDD : le CDD ouvre des droits, le trou aussi", () => {
    const contrats = [c("CDD", "2025-01-01", "2025-03-31"), c("CDI", "2025-06-01")];
    expect(periodesSansConges(contrats, "CDI")).toEqual([]);
    expect(trousDeContrat(contrats)).toHaveLength(1);
  });

  it("la tête de période (avant le premier contrat) n'est pas un trou", () => {
    expect(trousDeContrat([c("CDI", "2025-01-01")])).toEqual([]);
  });
});

describe("moisOuvreDroit — un mois n'ouvre droit que s'il est ENTIÈREMENT avec congés", () => {
  const stageJusquAu15Mars = [{ debut: null, fin: j("2025-03-15"), type: "STAGE" }];
  it("mois entièrement avec congés : oui", () => expect(moisOuvreDroit(j("2025-04-01"), j("2025-04-30"), stageJusquAu15Mars)).toBe(true));
  it("mois entièrement en stage : non", () => expect(moisOuvreDroit(j("2025-02-01"), j("2025-02-28"), stageJusquAu15Mars)).toBe(false));
  it("mois à cheval sur la fin du stage : non (un mois révolu s'acquiert entier ou pas du tout)", () => {
    expect(moisOuvreDroit(j("2025-03-01"), j("2025-03-31"), stageJusquAu15Mars)).toBe(false);
  });
  it("le dernier jour du stage touche le mois qui commence ce jour-là", () => {
    expect(moisOuvreDroit(j("2025-03-15"), j("2025-04-14"), stageJusquAu15Mars)).toBe(false);
    expect(moisOuvreDroit(j("2025-03-16"), j("2025-04-15"), stageJusquAu15Mars)).toBe(true);
  });
  it("aucune période sans congés : toujours oui", () => expect(moisOuvreDroit(j("2025-01-01"), j("2025-01-31"), [])).toBe(true));
});

describe("typeSelonHistorique — repère une fiche que l'historique contredit (relecture du 2026-10-12)", () => {
  it("stage terminé, aucun CDI enregistré : l'historique dit encore « stage » après la fin (règle du trou)", () => {
    // Fiche passée en CDI à la main sans contrat CDI : solde à zéro depuis le stage — d'où le signalement à l'écran.
    expect(typeSelonHistorique([c("STAGE", "2025-01-01", "2025-06-30")], j("2026-10-12"))).toBe("STAGE");
  });
  it("le contrat qui couvre le jour l'emporte ; sans contrat : null", () => {
    expect(typeSelonHistorique([c("STAGE", "2025-01-01"), c("CDI", "2025-07-01")], j("2026-10-12"))).toBe("CDI");
    expect(typeSelonHistorique([c("STAGE", "2025-01-01"), c("CDI", "2025-07-01")], j("2025-03-01"))).toBe("STAGE");
    expect(typeSelonHistorique([], j("2026-10-12"))).toBeNull();
  });
});
