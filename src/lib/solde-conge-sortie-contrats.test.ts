import { describe, it, expect } from "vitest";
import { bilansParAnnee, calculerSoldeAnneeCivile, repartirCongeParJour } from "./solde-conge-salarie";
import { periodesSansConges } from "./conges-periodes";

const j = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const c = (type: string, debut: string, fin: string | null = null) => ({ type, dateDebut: j(debut), dateFin: fin ? j(fin) : null });
const conge = (debut: string, fin: string, n: number) => repartirCongeParJour({ dateDebut: j(debut), dateFin: j(fin), nbJours: n }, new Set());
const base = { droitsAnnuels: 18, prisParJour: [] as { date: Date; jours: number }[] };

// Décisions de la Direction du 2026-10-12 : (1) la date de sortie arrête l'acquisition ; (2) le régime « sans
// congés » se lit par période de contrat. Embauche le 1er du mois → un mois s'achève chaque 1er (+1,5 j).

describe("date de sortie : l'acquisition s'arrête", () => {
  it("départ en milieu d'année : 3 mois révolus (4,5 j) au lieu de 9 (13,5 j) ; l'acquisition ne reprend pas", () => {
    const parti = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2026-01-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2026-04-15") });
    // Crédits le 01/02, 01/03, 01/04 ; plus rien après le 15/04.
    expect(parti).toMatchObject({ annee: 2026, acquisAnnee: 4.5, acquis: 4.5, solde: 4.5, report: 0, pris: 0 });
    const reste = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2026-01-01"), aujourdhui: j("2026-10-12") });
    expect(reste).toMatchObject({ acquisAnnee: 13.5, solde: 13.5 });
  });

  it("le solde ne bouge plus après la sortie : même résultat un mois, un an après", () => {
    const a = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-03-01"), aujourdhui: j("2025-10-15"), dateSortie: j("2025-09-10") });
    const b = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-03-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2025-09-10") });
    expect(b).toEqual(a);
    expect(a).toMatchObject({ annee: 2025, acquisAnnee: 9, solde: 9 }); // 01/04 … 01/09 : 6 mois
  });

  it("le mois qui s'achève le jour de la sortie est révolu : embauché le 01/03, parti le 30/09 → 7 mois (10,5 j)", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-03-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2025-09-30") });
    expect(r).toMatchObject({ annee: 2025, acquisAnnee: 10.5, solde: 10.5 });
  });

  it("le mois NON achevé à la sortie ne compte pas : parti le 29/09 → 6 mois (9 j)", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-03-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2025-09-29") });
    expect(r).toMatchObject({ acquisAnnee: 9, solde: 9 });
  });

  it("sortie le 31 décembre : le 12e mois est crédité dans l'année de la sortie (18 j), pas au 1er janvier d'après", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-01-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2025-12-31") });
    expect(r).toMatchObject({ annee: 2025, solde: 18, acquisAnnee: 18 });
  });

  it("l'embauche tardive reste la règle : embauché le 20/03, parti le 19/09 → 6 mois (9 j)", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-03-20"), aujourdhui: j("2026-10-12"), dateSortie: j("2025-09-19") });
    expect(r).toMatchObject({ acquisAnnee: 9, solde: 9 });
  });

  it("les jours pris avant la sortie se décomptent : 2 j pris en mars → 2,5 j à la sortie du 15/04", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2026-01-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2026-04-15"), prisParJour: conge("2026-03-09", "2026-03-10", 2) });
    expect(r).toMatchObject({ acquisAnnee: 4.5, pris: 2, solde: 2.5 });
  });

  it("une sortie ANNONCÉE (date future) ne gèle rien aujourd'hui, puis arrête l'acquisition à son jour", () => {
    const e = { ...base, dateEmbauche: j("2026-01-01"), dateSortie: j("2026-12-15") };
    expect(calculerSoldeAnneeCivile({ ...e, aujourdhui: j("2026-06-10") }).solde).toBe(7.5); // 5 mois
    expect(calculerSoldeAnneeCivile({ ...e, aujourdhui: j("2027-03-01") })).toMatchObject({ annee: 2026, acquisAnnee: 16.5, solde: 16.5 }); // 11 mois, rien en 2027
  });
});

describe("bilan par année : les années après le départ n'existent plus", () => {
  const e = { ...base, dateEmbauche: j("2024-06-01"), dateSortie: j("2025-09-20"), aujourdhui: j("2026-10-12") };
  it("de l'embauche à l'année de la sortie, pas une de plus", () => {
    const b = bilansParAnnee(e);
    expect(b.map((x) => x.annee)).toEqual([2024, 2025]);
    expect(b.every((x) => !x.enCours)).toBe(true);
  });
  it("le dernier bilan est exactement le solde de l'en-tête (un seul calcul)", () => {
    const b = bilansParAnnee(e);
    const { enCours, ...dernier } = b[b.length - 1];
    expect(enCours).toBe(false);
    expect(dernier).toEqual(calculerSoldeAnneeCivile(e));
  });
  it("2024 : 6 mois (01/07 → 01/12) = 9 j ; 2025 : report 9 puis 9 mois de plus, plafonné à 18, et plus rien après la sortie", () => {
    const [a, b] = bilansParAnnee(e);
    expect(a).toMatchObject({ annee: 2024, acquisAnnee: 9, solde: 9 });
    expect(b).toMatchObject({ annee: 2025, report: 9, acquisAnnee: 13.5, solde: 18, plafonne: true, perdu: 4.5 }); // 9 + 13,5 = 22,5 → 18
  });
  it("sans date de sortie, rien ne change : les bilans courent jusqu'à l'année en cours", () => {
    expect(bilansParAnnee({ ...e, dateSortie: null }).map((x) => x.annee)).toEqual([2024, 2025, 2026]);
  });
});

describe("stagiaire passé en CDI, CDI passé en stage : le régime se lit par période", () => {
  const avec = (contrats: ReturnType<typeof c>[], typeFiche: string, o: { aujourdhui: string; embauche?: string; dateSortie?: string }) =>
    calculerSoldeAnneeCivile({
      ...base, dateEmbauche: j(o.embauche ?? "2025-01-01"), aujourdhui: j(o.aujourdhui), dateSortie: o.dateSortie ? j(o.dateSortie) : null,
      periodesSansConges: periodesSansConges(contrats, typeFiche),
    });

  it("stage 01/01 → 30/06 puis CDI : rien pendant le stage, 1,5 j par mois de CDI (5 mois au 15/12 = 7,5 j)", () => {
    // Avant la correction : le contrat actuel (CDI) valait pour tout le passé → 11 mois = 16,5 j.
    const r = avec([c("STAGE", "2025-01-01", "2025-06-30"), c("CDI", "2025-07-01")], "CDI", { aujourdhui: "2025-12-15" });
    expect(r).toMatchObject({ acquisAnnee: 7.5, solde: 7.5 });
  });

  it("CDI 01/01 → 31/08 puis stage : 8 mois de CDI (12 j) conservés, rien ensuite", () => {
    // Avant la correction : le contrat actuel (stage) effaçait tout → 0.
    const r = avec([c("CDI", "2025-01-01", "2025-08-31"), c("STAGE", "2025-09-01")], "STAGE", { aujourdhui: "2025-12-15" });
    expect(r).toMatchObject({ acquisAnnee: 12, solde: 12 });
  });

  it("MOIS PARTIEL : stage jusqu'au 15/03, CDI dès le 16/03 → mars n'acquiert pas (3 mois sur 6 au 01/07 = 4,5 j)", () => {
    const r = avec([c("STAGE", "2025-01-01", "2025-03-15"), c("CDI", "2025-03-16")], "CDI", { aujourdhui: "2025-07-01" });
    expect(r).toMatchObject({ acquisAnnee: 4.5, solde: 4.5 }); // avril, mai, juin
  });

  it("frontières nettes : stage jusqu'au 28/02, CDI dès le 01/03 → mars acquiert (4 mois = 6 j)", () => {
    const r = avec([c("STAGE", "2025-01-01", "2025-02-28"), c("CDI", "2025-03-01")], "CDI", { aujourdhui: "2025-07-01" });
    expect(r).toMatchObject({ acquisAnnee: 6, solde: 6 });
  });

  it("MOIS PARTIEL dans l'autre sens : CDI jusqu'au 15/03 puis stage → mars n'acquiert pas (2 mois = 3 j)", () => {
    const r = avec([c("CDI", "2025-01-01", "2025-03-15"), c("STAGE", "2025-03-16")], "STAGE", { aujourdhui: "2025-07-01" });
    expect(r).toMatchObject({ acquisAnnee: 3, solde: 3 });
  });

  it("TROU entre deux contrats : le régime du précédent se poursuit (CDD → trou → CDI : les mois du trou acquièrent)", () => {
    const r = avec([c("CDD", "2025-01-01", "2025-03-31"), c("CDI", "2025-06-01")], "CDI", { aujourdhui: "2025-07-01" });
    expect(r).toMatchObject({ acquisAnnee: 9, solde: 9 }); // 6 mois
  });

  it("TROU après un stage : il reste sans congés (stage → trou → CDI : avril et mai n'acquièrent pas)", () => {
    const r = avec([c("STAGE", "2025-01-01", "2025-03-31"), c("CDI", "2025-06-01")], "CDI", { aujourdhui: "2025-07-01" });
    expect(r).toMatchObject({ acquisAnnee: 1.5, solde: 1.5 }); // juin seul (crédité le 01/07)
  });

  it("stage puis CDI ET départ : les deux règles se composent (stage → 30/06, CDI, sortie 31/10 → 4 mois de CDI = 6 j)", () => {
    const r = avec([c("STAGE", "2025-01-01", "2025-06-30"), c("CDI", "2025-07-01")], "CDI", { aujourdhui: "2026-10-12", dateSortie: "2025-10-31" });
    expect(r).toMatchObject({ annee: 2025, acquisAnnee: 6, solde: 6 });
  });

  it("un stagiaire en cours de stage depuis l'embauche reste sans congés (rien d'acquis, le pris se décompte)", () => {
    const r = avec([c("STAGE", "2026-01-01")], "STAGE", { embauche: "2026-01-01", aujourdhui: "2026-10-12" });
    expect(r).toMatchObject({ acquisAnnee: 0, solde: 0 });
  });

  it("l'ancien paramètre sansConges (fiche sans historique) joue toujours", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-01-01"), aujourdhui: j("2025-07-01"), sansConges: true, prisParJour: conge("2025-05-05", "2025-05-05", 1) });
    expect(r).toMatchObject({ acquisAnnee: 0, pris: 1, solde: -1 });
  });
});

describe("après le dernier contrat terminé : la fiche fait foi (règle 3 bis), les mois partiels restent stricts", () => {
  const avec = (contrats: ReturnType<typeof c>[], typeFiche: string, aujourdhui: string) =>
    calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2025-01-01"), aujourdhui: j(aujourdhui), periodesSansConges: periodesSansConges(contrats, typeFiche) });

  it("fiche CDI, seul contrat = stage fini le 30/06/2025 : acquisition dès le 01/07 (5 mois au 15/12 = 7,5 j)", () => {
    // Avant cet ajustement : 0 j (le stage se poursuivait sans fin). Sur main : 16,5 j (stage compris, à tort).
    expect(avec([c("STAGE", "2025-01-01", "2025-06-30")], "CDI", "2025-12-15")).toMatchObject({ acquisAnnee: 7.5, solde: 7.5 });
  });
  it("même cas, stage fini le 15/03 : mars à cheval n'acquiert pas (strict), avril → juin oui (4,5 j au 01/07)", () => {
    expect(avec([c("STAGE", "2025-01-01", "2025-03-15")], "CDI", "2025-07-01")).toMatchObject({ acquisAnnee: 4.5, solde: 4.5 });
  });
  it("stage SANS date de fin sur une fiche CDI : rien ne s'acquiert (contradiction signalée, pas tranchée)", () => {
    expect(avec([c("STAGE", "2025-01-01")], "CDI", "2025-12-15")).toMatchObject({ acquisAnnee: 0, solde: 0 });
  });
});

describe("plafond de 18 j à tout instant", () => {
  it("stagiaire → CDI très ancien, rien pris : 18 j, jamais plus, à la fin de chaque année", () => {
    const e = { ...base, dateEmbauche: j("2020-01-01"), aujourdhui: j("2026-10-12"), periodesSansConges: periodesSansConges([c("STAGE", "2020-01-01", "2020-06-30"), c("CDI", "2020-07-01")], "CDI") };
    const bilans = bilansParAnnee(e);
    for (const b of bilans) expect(b.solde, String(b.annee)).toBeLessThanOrEqual(18);
    expect(bilans[0]).toMatchObject({ annee: 2020, acquisAnnee: 7.5, solde: 7.5 }); // juillet → novembre (crédités du 01/08 au 01/12) : 5 mois, rien pendant le stage
    expect(bilans[bilans.length - 1]).toMatchObject({ solde: 18, plafonne: true });
  });

  it("un salarié parti avec 18 j reportés puis des mois acquis garde 18 j (la part au-delà est perdue)", () => {
    const r = calculerSoldeAnneeCivile({ ...base, dateEmbauche: j("2020-03-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2026-03-10") });
    expect(r).toMatchObject({ annee: 2026, solde: 18, plafonne: true });
    expect(r.solde).toBeLessThanOrEqual(18);
  });

  it("jamais au-dessus de 18 même avec stage → CDI → départ", () => {
    const e = { ...base, dateEmbauche: j("2019-01-01"), aujourdhui: j("2026-10-12"), dateSortie: j("2024-05-31"), periodesSansConges: periodesSansConges([c("STAGE", "2019-01-01", "2019-12-31"), c("CDI", "2020-01-01")], "CDI") };
    for (const b of bilansParAnnee(e)) expect(b.solde, String(b.annee)).toBeLessThanOrEqual(18);
    expect(bilansParAnnee(e).map((b) => b.annee).at(-1)).toBe(2024);
  });
});
