import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { bilansParAnnee, calculerSoldeAnneeCivile, repartirCongeParJour, type DemandeCongeFiche } from "@/lib/solde-conge-salarie";
import { CongesParAnnee } from "./conges-par-annee";

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");

// Le cas qui compte : un report (0,5 j de 2025 vers 2026) et un congé à cheval sur deux années (3 j en 2025, 4 j en 2026).
const FERIES = new Set(["2026-01-01"]);
const DEMANDES_APPROUVEES = [
  { id: "d1", type: "Congé annuel", dateDebut: jour("2025-11-03"), dateFin: jour("2025-11-14"), nbJours: 10 },
  { id: "d2", type: "Congé annuel", dateDebut: jour("2025-12-29"), dateFin: jour("2026-01-06"), nbJours: 7 },
  { id: "d3", type: "Congé annuel", dateDebut: jour("2026-08-03"), dateFin: jour("2026-08-06"), nbJours: 4 },
];
const prisParJour = DEMANDES_APPROUVEES.flatMap((d) => repartirCongeParJour(d, FERIES));
const ENTREES = { dateEmbauche: jour("2025-03-20"), aujourdhui: jour("2026-10-12"), droitsAnnuels: 18, sansConges: false, prisParJour };
const BILANS = bilansParAnnee(ENTREES);
const DEMANDES: DemandeCongeFiche[] = [
  ...DEMANDES_APPROUVEES.map((d) => {
    const joursParAnnee: Record<number, number> = {};
    for (const x of repartirCongeParJour(d, FERIES)) joursParAnnee[x.date.getUTCFullYear()] = (joursParAnnee[x.date.getUTCFullYear()] ?? 0) + x.jours;
    return { ...d, statut: "APPROUVE", motifRefus: null, entameLeSolde: true, joursParAnnee };
  }),
  { id: "d4", type: "Maladie", dateDebut: jour("2026-05-04"), dateFin: jour("2026-05-05"), nbJours: 2, statut: "APPROUVE", motifRefus: null, entameLeSolde: false, joursParAnnee: {} },
  { id: "d5", type: "Congé annuel", dateDebut: jour("2026-11-02"), dateFin: jour("2026-11-04"), nbJours: 3, statut: "EN_ATTENTE", motifRefus: null, entameLeSolde: true, joursParAnnee: {} },
].sort((a, b) => b.dateDebut.getTime() - a.dateDebut.getTime());

const rendu = (annee: number, over: Partial<Parameters<typeof CongesParAnnee>[0]> = {}) =>
  renderToStaticMarkup(<CongesParAnnee employeeId="e1" annee={annee} anneeCourante={2026} bilans={BILANS} demandes={DEMANDES} sansConges={false} {...over} />);
const bilanTexte = (html: string) => texte(html.slice(html.indexOf("data-bilan-conges"), html.indexOf("</dl>", html.indexOf("data-bilan-conges"))));

describe("congés par année — pastilles et année par défaut", () => {
  it("les années depuis l'embauche, avec le nombre de demandes qui les touchent (le congé à cheval compte dans les deux)", () => {
    const html = rendu(2026);
    expect(texte(html)).toContain("2026 (4) 2025 (2)"); // 2026 : d2, d3, d4, d5 ; 2025 : d1, d2
    expect(html).toContain('href="/employes/e1?tab=conges&amp;annee=2025"');
    expect(html).toMatch(/aria-current="page"[^>]*>2026 \(4\)/);
  });
});

describe("congés par année — le bilan de l'année est celui de calculerSoldeAnneeCivile", () => {
  it("2026 (en cours) : report 0,5 j, acquis 13,5 j, pris 8 j (4 du congé à cheval + 4), solde à date 6 j", () => {
    const b = bilanTexte(rendu(2026));
    expect(b).toContain("Report de 2025 0,5 j");
    expect(b).toContain("Acquis en 2026 13,5 j");
    expect(b).toContain("Pris en 2026 8 j");
    expect(b).toContain("Perdus au plafond 0 j");
    expect(b).toContain("Solde à date 6 j");
    const direct = calculerSoldeAnneeCivile(ENTREES);
    expect([direct.report, direct.acquisAnnee, direct.pris, direct.perdu, direct.solde]).toEqual([0.5, 13.5, 8, 0, 6]);
  });

  it("2025 (close) : report 0, pris 13 j (10 + 3 du congé à cheval), solde au 31 décembre 0,5 j", () => {
    const b = bilanTexte(rendu(2025));
    expect(b).toContain("Report de 2024 0 j");
    expect(b).toContain("Pris en 2025 13 j");
    expect(b).toContain("Solde au 31 décembre 2025 0,5 j");
    expect(b).not.toContain("Solde à date");
  });

  it("le congé à cheval figure dans les deux années, avec la part décomptée de chacune", () => {
    expect(texte(rendu(2025))).toContain("à cheval sur deux années : 3 j décomptés en 2025");
    expect(texte(rendu(2026))).toContain("à cheval sur deux années : 4 j décomptés en 2026");
  });

  it("la liste de l'année ne montre que ses demandes ; un congé d'un type non décompté le dit", () => {
    const h2025 = texte(rendu(2025));
    expect(h2025).not.toContain("Maladie");
    const h2026 = texte(rendu(2026));
    expect(h2026).toContain("Maladie");
    expect(h2026).toContain("non décompté du solde");
    expect(h2026).toContain("En attente");
  });

  it("année sans demande : état vide qui nomme l'année", () => {
    expect(texte(rendu(2025, { demandes: [] }))).toContain("Aucune demande de congé en 2025.");
  });
});

describe("congés par année — récapitulatif de toutes les années", () => {
  it("une ligne par année (la plus récente d'abord), mêmes chiffres que les bilans, l'année en cours « à date »", () => {
    const html = rendu(2026);
    const recap = html.slice(html.indexOf('aria-label="Congés, toutes les années"'));
    const t = texte(recap);
    expect(t).toContain("Année Report Acquis Pris Perdus Solde");
    expect(t.indexOf("2026")).toBeLessThan(t.indexOf("2025"));
    expect(t).toContain("2026 (à date) 0,5 j 13,5 j 8 j 0 j 6 j");
    expect(t).toContain("2025 0 j 13,5 j 13 j 0 j 0,5 j");
    expect(recap).toContain('href="/employes/e1?tab=conges&amp;annee=2025"'); // l'année est cliquable
  });

  it("le report d'une ligne est le solde de la précédente", () => {
    expect(BILANS[1].report).toBe(BILANS[0].solde);
  });

  it("tableau normal : pas de défilement interne ; une seule année : pas de récapitulatif", () => {
    expect(rendu(2026)).toContain("tableau-normal");
    expect(rendu(2026)).not.toMatch(/max-h-|overflow-y-auto|overflow-auto/);
    expect(rendu(2026, { bilans: [BILANS[1]] })).not.toContain("Toutes les années");
  });
});

describe("congés par année — cas limites", () => {
  it("contrat sans congés : rien d'acquis (« — »), les jours pris restent comptés ; report et solde chiffrés comme l'en-tête", () => {
    const sans = bilansParAnnee({ ...ENTREES, sansConges: true });
    const b = bilanTexte(rendu(2026, { bilans: sans, sansConges: true }));
    // Relecture 2026-10-12 : l'en-tête de la fiche affiche ce solde (négatif : 13 j pris en 2025, 8 en 2026) ;
    // le bilan disait « — » et contredisait l'en-tête.
    const enTete = calculerSoldeAnneeCivile({ ...ENTREES, sansConges: true });
    expect([enTete.report, enTete.solde]).toEqual([-13, -21]);
    expect(b).toContain("Report de 2025 -13 j");
    expect(b).toContain("Acquis en 2026 —");
    expect(b).toContain("Perdus au plafond —");
    expect(b).toContain("Solde à date -21 j");
    expect(b).toContain("Pris en 2026 8 j");
    expect(texte(rendu(2026, { bilans: sans, sansConges: true }))).toContain("Contrat sans congés");
  });

  it("report négatif (congé pris par anticipation) : en rouge", () => {
    const bilans = bilansParAnnee({
      dateEmbauche: jour("2025-10-01"), aujourdhui: jour("2026-03-15"), droitsAnnuels: 18, sansConges: false,
      prisParJour: repartirCongeParJour({ dateDebut: jour("2025-12-15"), dateFin: jour("2025-12-19"), nbJours: 5 }, new Set()),
    });
    const html = rendu(2026, { bilans, demandes: [] });
    expect(bilanTexte(html)).toContain("Report de 2025 -2 j");
    expect(html).toContain("text-red-600");
  });

  it("« C » posés sans demande : signalés pour l'année affichée", () => {
    const bilans = bilansParAnnee({ ...ENTREES, cSansDemande: [jour("2026-02-03")] });
    expect(texte(rendu(2026, { bilans }))).toContain("1 jour(s) C posé(s) sans demande dans la grille Présences en 2026");
    expect(texte(rendu(2025, { bilans }))).not.toContain("C sans demande");
  });

  it("année à venir (demande déjà posée) : pastille, pas de bilan inventé", () => {
    const futur: DemandeCongeFiche = { id: "d9", type: "Congé annuel", dateDebut: jour("2027-01-11"), dateFin: jour("2027-01-15"), nbJours: 5, statut: "APPROUVE", motifRefus: null, entameLeSolde: true, joursParAnnee: { 2027: 5 } };
    const html = rendu(2027, { demandes: [...DEMANDES, futur] });
    expect(texte(html)).toContain("2027 (1) 2026");
    expect(texte(html)).toContain("Pas de bilan pour 2027 : cette année n'a pas encore commencé.");
  });
});
