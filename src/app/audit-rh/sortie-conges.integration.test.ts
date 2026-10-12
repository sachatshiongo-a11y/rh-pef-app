// Décisions de la Direction du 2026-10-12 sur le solde de congés : (1) une DATE DE SORTIE arrête l'acquisition et
// elle est obligatoire quand le salarié part ; (2) le régime « sans congés » (stage, intérim) se lit PAR PÉRIODE de contrat.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, p) => { const v = (H.client as unknown as Record<string | symbol, unknown>)[p]; return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v; } }),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  verifySession: async () => A.user,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé"); },
  invaliderProfil: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
vi.mock("@/lib/storage", () => ({ televerserFichier: async (c: string) => `/fichiers/${c}`, lireFichier: async () => null }));

const RH = await import("@/app/(app)/employes/actions");
const DOSSIER = await import("@/app/(app)/employes/[id]/dossier-actions");
const FICHE = await import("@/app/(app)/a-valider/fiche-actions");
const SOLDE = await import("@/lib/solde-conge-salarie");
const SORTIE = await import("@/lib/sortie-salarie");
const { datesDeSortie } = await import("@/lib/salaries-sortis");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { direction: "", rh: "" };
let n = 0;
const MAINTENANT = new Date("2026-10-12T10:00:00Z");
const j = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function emp(o: { embauche: string; contrat?: "CDI" | "STAGE"; actif?: boolean; dateSortie?: string }) {
  n++;
  return (await prisma.employee.create({
    data: {
      matricule: `SC${n}-PEF`, nom: `Salarié Sortie ${n}`, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 300, dateEmbauche: j(o.embauche), contrat: o.contrat ?? "CDI", actif: o.actif ?? true, dateSortie: o.dateSortie ? j(o.dateSortie) : null,
    },
  })).id;
}
const contrat = (employeeId: string, type: "CDI" | "CDD" | "STAGE", debut: string, fin: string | null = null) =>
  prisma.contrat.create({ data: { employeeId, type, dateDebut: j(debut), dateFin: fin ? j(fin) : null, salaireMensuel: 300, poste: "Commis", statut: fin ? "EXPIRE" : "ACTIF" } });
const finContrat = (employeeId: string, dateFin: string) =>
  prisma.finContrat.create({ data: { employeeId, motif: "DEMISSION", dateFin: j(dateFin), salaireJournalierUSD: 10, creeParId: ids.direction } });
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function erreur(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) {
    const u = (e as { url?: string }).url;
    if (u !== undefined) { const m = decodeURIComponent(u).match(/erreur=(.*)$/); return m ? m[1] : `REDIRECT ${u}`; }
    return (e as Error).message;
  }
}
const comme = (qui: "ADMIN" | "MANAGER") => { A.user = { ...A.user, id: qui === "ADMIN" ? ids.direction : ids.rh, nom: qui === "ADMIN" ? "Direction" : "Esther RH", role: qui }; };
const soldeDe = (id: string) => SOLDE.chargerSoldeCongeSalarie(prisma, id, MAINTENANT);
async function formulaire(id: string, o: Record<string, string> = {}) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
  return fd({
    matricule: e.matricule, nom: e.nom, sexe: e.sexe, etatCivil: e.etatCivil, poste: e.poste, secteur: e.secteur, categorie: e.categorie, categorieProfessionnelle: "",
    salaireMensuel: String(Number(e.salaireMensuel)), transportJourCDF: "0", transportMoisCDF: "0", transportMoisUSD: "0", cnssMontant: "0", enfants: "0",
    type: "NATIONAL", dateEmbauche: e.dateEmbauche.toISOString().slice(0, 10), contrat: e.contrat, heuresParJour: "8", heuresHebdomadaires: "48",
    fraisMedicauxMoisCourant: "0", modePaiement: "ESPECES", banque: "", compteBancaire: "", mobileMoney: "", telephone: "", email: "", adresse: "", dateNaissance: "", idExterneIVMS: "", ...o,
  });
}

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.rh = (await prisma.user.create({ data: { email: "rh@pef.test", nom: "Esther RH", role: "MANAGER" } })).id;
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("le solde s'arrête à la date de sortie — un seul calcul pour l'en-tête, le bilan, l'unité et le lot", () => {
  it("départ par FIN DE CONTRAT : la date de FinContrat est reprise (jamais recopiée) et arrête l'acquisition", async () => {
    const id = await emp({ embauche: "2026-01-01", actif: false });
    await finContrat(id, "2026-04-15");
    const s = await soldeDe(id);
    expect(s).toMatchObject({ annee: 2026, acquisAnnee: 4.5, solde: 4.5 }); // 3 mois, pas 9
    // Même chiffre dans le bilan par année, dans le chargement en lot et dans le solde à la sortie.
    const { bilans, dateSortie, sortieInconnue } = await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT);
    expect(bilans.map((b) => b.annee)).toEqual([2026]);
    expect(bilans[0].solde).toBe(s.solde);
    expect(dateSortie?.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(sortieInconnue).toBe(false);
    expect((await SOLDE.chargerSoldesCongeSalaries(prisma, [id], MAINTENANT)).soldes.get(id)).toEqual(s);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie).toBeNull(); // pas de seconde date
  });

  it("départ sans fin de contrat, date saisie sur la fiche : elle arrête l'acquisition ; les années d'après n'ont plus de bilan", async () => {
    const id = await emp({ embauche: "2024-06-01", actif: false, dateSortie: "2025-09-20" });
    const { bilans } = await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT);
    expect(bilans.map((b) => b.annee)).toEqual([2024, 2025]);
    expect(await soldeDe(id)).toMatchObject({ annee: 2025, solde: 18, plafonne: true });
    expect(bilans.at(-1)!.solde).toBe(18);
  });

  it("l'indemnité de congés proposée au solde de tout compte s'arrête à la date de sortie CHOISIE", async () => {
    const id = await emp({ embauche: "2026-01-01" }); // encore actif, on prépare son départ
    expect((await soldeDe(id)).solde).toBe(13.5); // aujourd'hui : 9 mois
    comme("ADMIN");
    // L'ancienneté (indemnité de licenciement) suit la même date de sortie : 3 mois au 15/04, 6 au 30/06.
    expect(await DOSSIER.proposerSoldeConges(id, "2026-04-15")).toEqual({ jours: 4.5, annee: 2026, ancienneteMois: 3, prisApresSortie: 0 });
    expect(await DOSSIER.proposerSoldeConges(id, "2026-06-30")).toEqual({ jours: 9, annee: 2026, ancienneteMois: 6, prisApresSortie: 0 }); // 01/02 … 30/06 : 6 mois
    expect(await DOSSIER.proposerSoldeConges(id, "")).toMatchObject({ erreur: expect.stringContaining("obligatoire") });
    comme("MANAGER");
    await expect(DOSSIER.proposerSoldeConges(id, "2026-04-15")).rejects.toThrow("Accès refusé");
  });

  it("salarié INACTIF sans date de sortie : signalé (rien n'est deviné, le solde court encore)", async () => {
    const id = await emp({ embauche: "2026-01-01", actif: false });
    const { sortieInconnue, dateSortie } = await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT);
    expect(sortieInconnue).toBe(true);
    expect(dateSortie).toBeNull();
    expect((await soldeDe(id)).solde).toBe(13.5);
    expect(await SORTIE.chargerSortieFiche(prisma, id)).toEqual({ dateSortie: null, source: null, inconnue: true });
    // Un salarié actif n'est jamais « à compléter », et la fiche avec date non plus.
    expect((await SORTIE.chargerSortieFiche(prisma, await emp({ embauche: "2026-01-01" }))).inconnue).toBe(false);
    const avec = await emp({ embauche: "2026-01-01", actif: false, dateSortie: "2026-03-31" });
    expect(await SORTIE.chargerSortieFiche(prisma, avec)).toMatchObject({ source: "FICHE", inconnue: false });
  });

  it("la grille Présences et l'import lisent la MÊME date (fin de contrat ou date de la fiche)", async () => {
    const a = await emp({ embauche: "2026-01-01", actif: false, dateSortie: "2026-03-31" });
    const b = await emp({ embauche: "2026-01-01", actif: false });
    await finContrat(b, "2026-05-10");
    const c = await emp({ embauche: "2026-01-01", actif: false });
    expect([...await datesDeSortie(prisma, [a, b, c])].sort()).toEqual([[a, "2026-03-31"], [b, "2026-05-10"]].sort());
  });
});

describe("stagiaire passé en CDI, CDI passé en stage : le régime se lit par période de contrat", () => {
  it("stage → CDI : rien pendant le stage, 1,5 j par mois de CDI (le contrat actuel n'efface plus le passé)", async () => {
    const id = await emp({ embauche: "2026-01-01", contrat: "CDI" });
    await contrat(id, "STAGE", "2026-01-01", "2026-05-31");
    await contrat(id, "CDI", "2026-06-01");
    // Juin, juillet, août, septembre achevés au 01/10 : 4 mois = 6 j (avant : 9 mois = 13,5 j).
    expect(await soldeDe(id)).toMatchObject({ acquisAnnee: 6, solde: 6 });
    const { sansConges, periodesSansConges } = await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT);
    expect(sansConges).toBe(false);
    expect(periodesSansConges).toHaveLength(1);
  });

  it("CDI → stage : les mois de CDI sont conservés (avant : le stage actuel les effaçait)", async () => {
    const id = await emp({ embauche: "2026-01-01", contrat: "STAGE" });
    await contrat(id, "CDI", "2026-01-01", "2026-05-31");
    await contrat(id, "STAGE", "2026-06-01");
    expect(await soldeDe(id)).toMatchObject({ acquisAnnee: 7.5, solde: 7.5 }); // janvier → mai : 5 mois
  });

  it("mois partiel : stage jusqu'au 15/03 puis CDI → mars n'acquiert pas", async () => {
    const id = await emp({ embauche: "2026-01-01" });
    await contrat(id, "STAGE", "2026-01-01", "2026-03-15");
    await contrat(id, "CDI", "2026-03-16");
    expect(await soldeDe(id)).toMatchObject({ acquisAnnee: 9, solde: 9 }); // avril → septembre : 6 mois (mars, à cheval, n'acquiert pas ; sans la règle : 9 mois = 13,5 j)
  });

  it("trou entre deux contrats : signalé, et le régime précédent se poursuit", async () => {
    const id = await emp({ embauche: "2026-01-01" });
    await contrat(id, "STAGE", "2026-01-01", "2026-02-28");
    await contrat(id, "CDI", "2026-05-01");
    const { trous } = await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT);
    expect(trous.map((t) => [t.debut.toISOString().slice(0, 10), t.fin?.toISOString().slice(0, 10)])).toEqual([["2026-03-01", "2026-04-30"]]);
    expect(await soldeDe(id)).toMatchObject({ acquisAnnee: 7.5, solde: 7.5 }); // mars et avril (trou après un stage) n'acquièrent pas : mai → septembre = 5 mois
  });

  it("sans historique de contrat : le type de la fiche vaut pour toute la période, comme avant", async () => {
    const stagiaire = await emp({ embauche: "2026-01-01", contrat: "STAGE" });
    expect(await soldeDe(stagiaire)).toMatchObject({ acquisAnnee: 0, solde: 0 });
    expect((await SOLDE.chargerCongesParAnnee(prisma, stagiaire, MAINTENANT)).sansConges).toBe(true);
    expect((await soldeDe(await emp({ embauche: "2026-01-01" }))).solde).toBe(13.5);
  });
});

describe("fin de contrat : la date de sortie est obligatoire", () => {
  const solde = (extra: Record<string, string> = {}) => fd({ motif: "DEMISSION", dateFin: "2026-09-20", joursTravaillesMois: "13", joursCongesNonPris: "0", preavisJours: "0", indemniteLicenciementUSD: "0", autresUSD: "0", ...extra });

  it("sans date (vide, absente, illisible, inexistante) : refus lisible, rien d'écrit — fiche active, aucun solde archivé", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2025-01-06" });
    for (const dateFin of ["", "   ", "pas-une-date", "2026-02-30"]) {
      const e = await erreur(DOSSIER.terminerContrat(id, solde({ dateFin })));
      expect(e, dateFin).toMatch(/La date de sortie est obligatoire|Date de sortie invalide/);
    }
    const sansChamp = solde(); sansChamp.delete("dateFin");
    expect(await erreur(DOSSIER.terminerContrat(id, sansChamp))).toMatch(/La date de sortie est obligatoire/);
    expect(await prisma.finContrat.count({ where: { employeeId: id } })).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).actif).toBe(true);
  });

  it("date avant l'embauche : refus", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2025-01-06" });
    expect(await erreur(DOSSIER.terminerContrat(id, solde({ dateFin: "2024-12-31" })))).toMatch(/ne peut pas précéder la date d'embauche/);
    expect(await prisma.finContrat.count({ where: { employeeId: id } })).toBe(0);
  });

  it("avec une date : FinContrat.dateFin la porte, la fiche est désactivée, et le solde s'arrête à ce jour", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    expect(await erreur(DOSSIER.terminerContrat(id, solde({ dateFin: "2026-04-15" })))).toBeNull();
    expect((await prisma.finContrat.findFirstOrThrow({ where: { employeeId: id } })).dateFin.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).actif).toBe(false);
    expect(await soldeDe(id)).toMatchObject({ annee: 2026, solde: 4.5 });
  });
});

describe("désactiver une fiche : la date de sortie est demandée, ou prise de la fin de contrat", () => {
  it("sans fin de contrat : date obligatoire (refus sans elle), puis écrite avec la désactivation", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    expect(await erreur(RH.desactiverEmploye(id, fd({})))).toMatch(/La date de sortie est obligatoire/);
    expect(await erreur(RH.desactiverEmploye(id, fd({ dateSortie: "2025-12-31" })))).toMatch(/ne peut pas précéder/);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).actif).toBe(true);
    expect(await erreur(RH.desactiverEmploye(id, fd({ dateSortie: "2026-03-31" })))).toBe("REDIRECT /employes");
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([e.actif, e.dateSortie?.toISOString().slice(0, 10)]).toEqual([false, "2026-03-31"]);
    expect(await soldeDe(id)).toMatchObject({ solde: 4.5 }); // crédits du 01/02, du 01/03 et du 31/03 (mois achevé le jour de la sortie) : 3 mois
  });

  it("avec une fin de contrat déjà enregistrée : sa date est reprise, aucune date n'est redemandée ni recopiée", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    await finContrat(id, "2026-04-15");
    expect(await erreur(RH.desactiverEmploye(id, fd({})))).toBe("REDIRECT /employes");
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([e.actif, e.dateSortie]).toEqual([false, null]);
  });

  it("réservé à la Direction", async () => {
    comme("MANAGER");
    const id = await emp({ embauche: "2026-01-01" });
    expect(await erreur(RH.desactiverEmploye(id, fd({ dateSortie: "2026-03-31" })))).toBe("Accès refusé");
  });
});

describe("la RH saisit une date de sortie : elle passe par « À valider » comme les autres changements de fiche", () => {
  it("fiche inactive sans date : la RH propose, rien n'est appliqué ; la Direction approuve, la date et le solde suivent", async () => {
    comme("MANAGER");
    const id = await emp({ embauche: "2026-01-01", actif: false });
    const r = await erreur(RH.modifierEmploye(id, await formulaire(id, { dateSortie: "2026-04-15" })));
    expect(r).toBe(`REDIRECT /employes/${id}`);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie).toBeNull();
    const [d] = await prisma.demandeModifFiche.findMany({ where: { employeeId: id, statut: "EN_ATTENTE" } });
    expect(d.changements).toEqual([{ champ: "dateSortie", avant: null, apres: "2026-04-15" }]);
    expect((await soldeDe(id)).solde).toBe(13.5); // pas encore appliquée

    comme("ADMIN");
    expect((await FICHE.approuverModifsFiche([d.id])).traitees).toBe(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie?.toISOString().slice(0, 10)).toBe("2026-04-15");
    expect((await soldeDe(id)).solde).toBe(4.5);
  });

  it("la Direction l'applique directement ; une date avant l'embauche est refusée", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01", actif: false });
    expect(await erreur(RH.modifierEmploye(id, await formulaire(id, { dateSortie: "2025-06-01" })))).toMatch(/ne peut pas précéder la date d'embauche/);
    expect(await erreur(RH.modifierEmploye(id, await formulaire(id, { dateSortie: "2026-04-15" })))).toBe("REDIRECT /employes");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie?.toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  it("une date effacée s'efface vraiment (null), et la fiche redevient « à compléter »", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01", actif: false, dateSortie: "2026-04-15" });
    expect(await erreur(RH.modifierEmploye(id, await formulaire(id, { dateSortie: "" })))).toBe("REDIRECT /employes");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie).toBeNull();
    expect((await SORTIE.chargerSortieFiche(prisma, id)).inconnue).toBe(true);
  });

  it("fiche ACTIVE : refus (on part par « Fin de contrat ») ; fin de contrat existante : sa date fait foi, pas de seconde date", async () => {
    comme("ADMIN");
    const actif = await emp({ embauche: "2026-01-01" });
    expect(await erreur(RH.modifierEmploye(actif, await formulaire(actif, { dateSortie: "2026-04-15" })))).toMatch(/se saisit sur une fiche désactivée/);
    const parti = await emp({ embauche: "2026-01-01", actif: false });
    await finContrat(parti, "2026-05-10");
    expect(await erreur(RH.modifierEmploye(parti, await formulaire(parti, { dateSortie: "2026-04-15" })))).toMatch(/Une fin de contrat est enregistrée au 10\/05\/2026/);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: parti } })).dateSortie).toBeNull();
  });

  it("demande devenue incohérente avant l'approbation (fin de contrat arrivée entre-temps) : refusée à l'approbation, rien d'écrit", async () => {
    comme("MANAGER");
    const id = await emp({ embauche: "2026-01-01", actif: false });
    await erreur(RH.modifierEmploye(id, await formulaire(id, { dateSortie: "2026-04-15" })));
    await finContrat(id, "2026-05-10");
    comme("ADMIN");
    const [d] = await prisma.demandeModifFiche.findMany({ where: { employeeId: id, statut: "EN_ATTENTE" } });
    const rapport = await FICHE.approuverModifsFiche([d.id]);
    expect(rapport.traitees).toBe(0);
    expect(rapport.echecs[0]).toContain("Une fin de contrat est enregistrée au 10/05/2026");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie).toBeNull();
  });
});

describe("relecture du 2026-10-12 : l'indemnité de congés du solde de tout compte, à la date de sortie", () => {
  const solde = (extra: Record<string, string> = {}) => fd({ motif: "DEMISSION", dateFin: "2026-06-30", joursTravaillesMois: "0", joursCongesNonPris: "0", preavisJours: "0", indemniteLicenciementUSD: "0", autresUSD: "0", ...extra });

  it("un congé approuvé APRÈS la sortie n'ampute pas l'indemnité : il est signalé, pas déduit", async () => {
    comme("ADMIN");
    await prisma.typeConge.upsert({ where: { nom: "Congé annuel" }, update: {}, create: { nom: "Congé annuel", compteDansSolde: true, ordre: 1 } });
    const id = await emp({ embauche: "2026-01-01" });
    // 10 jours approuvés du lundi 13 au vendredi 24 juillet 2026 ; le salarié part le 30 juin.
    await prisma.leaveRequest.create({ data: { employeeId: id, type: "Congé annuel", dateDebut: j("2026-07-13"), dateFin: j("2026-07-24"), nbJours: 10, statut: "APPROUVE" } });
    // Avant la correction : 9 − 10 = −1 j proposé (ramené à 0) — 9 j × salaire journalier perdus.
    expect(await DOSSIER.proposerSoldeConges(id, "2026-06-30")).toEqual({ jours: 9, annee: 2026, ancienneteMois: 6, prisApresSortie: 10 });
    // Départ annoncé APRÈS le congé : il se prend avant de partir, il se déduit.
    expect(await DOSSIER.proposerSoldeConges(id, "2026-07-31")).toMatchObject({ jours: 0.5, prisApresSortie: 0 }); // 7 mois (10,5 j) − 10
  });

  it("proposition de l'écran (« 0 ») : le serveur la revérifie au solde À LA DATE DE SORTIE — une proposition périmée est refusée", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    // L'écran portait encore le solde d'aujourd'hui (13,5 j) : la date a été choisie puis le formulaire envoyé aussitôt.
    expect(await erreur(DOSSIER.terminerContrat(id, solde({ joursCongesNonPris: "13,5", congesSaisisMain: "0" })))).toMatch(/Le solde de congés au 30\/06\/2026 \(date de sortie\) est de 9 j/);
    expect(await prisma.finContrat.count({ where: { employeeId: id } })).toBe(0);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).actif).toBe(true);
    // La bonne proposition passe.
    expect(await erreur(DOSSIER.terminerContrat(id, solde({ joursCongesNonPris: "9", congesSaisisMain: "0" })))).toBeNull();
    expect(Number((await prisma.finContrat.findFirstOrThrow({ where: { employeeId: id } })).joursCongesNonPris)).toBe(9);
  });

  it("saisie retouchée à la main (« 1 ») : elle fait foi, la Direction tranche", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    expect(await erreur(DOSSIER.terminerContrat(id, solde({ joursCongesNonPris: "12", congesSaisisMain: "1" })))).toBeNull();
    expect(Number((await prisma.finContrat.findFirstOrThrow({ where: { employeeId: id } })).joursCongesNonPris)).toBe(12);
  });
});

describe("relecture du 2026-10-12 : après le dernier contrat terminé, la fiche fait foi ; un contrat en cours qui la contredit est signalé", () => {
  it("fiche CDI, seul contrat = un stage TERMINÉ le 30/06/2025 : acquisition dès le 01/07/2025, aucun écart signalé", async () => {
    const id = await emp({ embauche: "2025-01-01", contrat: "CDI" });
    await contrat(id, "STAGE", "2025-01-01", "2025-06-30");
    const r = await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT);
    expect(r.ecartFiche).toBeNull();
    expect(r.trous).toEqual([]); // l'après-dernier-contrat n'est pas un trou
    expect(r.bilans.map((b) => [b.annee, b.acquisAnnee, b.solde])).toEqual([[2025, 7.5, 7.5], [2026, 15, 18]]); // crédits du 01/08 au 01/12/2025 : 5 mois ; 2026 (01/01 → 01/10) : 10 mois, plafonné à 18
    expect((await soldeDe(id)).solde).toBe(18);
  });

  it("fiche CDI, stage SANS date de fin : rien ne s'acquiert et l'écart est signalé ; le stage clos, l'acquisition reprend", async () => {
    const id = await emp({ embauche: "2025-01-01", contrat: "CDI" });
    const stage = await contrat(id, "STAGE", "2025-01-01");
    expect((await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT)).ecartFiche).toEqual({ typeFiche: "CDI", typeHistorique: "STAGE" });
    expect((await soldeDe(id)).solde).toBe(0);
    await prisma.contrat.update({ where: { id: stage.id }, data: { dateFin: j("2025-06-30") } });
    expect((await SOLDE.chargerCongesParAnnee(prisma, id, MAINTENANT)).ecartFiche).toBeNull();
    expect((await soldeDe(id)).solde).toBe(18);
  });
});

describe("relecture du 2026-10-12 : réactiver puis désactiver ne perd ni ne double aucune date", () => {
  it("sortie par fin de contrat : réactivée, le solde reprend son cours ; redésactivée, la date de la fin de contrat revient, sans copie", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    expect(await erreur(DOSSIER.terminerContrat(id, fd({ motif: "DEMISSION", dateFin: "2026-04-15", joursTravaillesMois: "0", joursCongesNonPris: "4,5", preavisJours: "0", indemniteLicenciementUSD: "0", autresUSD: "0" })))).toBeNull();
    expect((await soldeDe(id)).solde).toBe(4.5);
    await RH.reactiverEmploye(id);
    expect((await soldeDe(id)).solde).toBe(13.5); // fiche active : pas de sortie, l'acquisition court
    expect(await erreur(RH.desactiverEmploye(id, fd({})))).toBe("REDIRECT /employes");
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([e.actif, e.dateSortie]).toEqual([false, null]);
    expect(await prisma.finContrat.count({ where: { employeeId: id } })).toBe(1);
    expect((await soldeDe(id)).solde).toBe(4.5);
  });

  it("sortie saisie sur la fiche : réactivée, la date reste en base ; redésactivée, la nouvelle date la remplace (l'ancienne reste au journal)", async () => {
    comme("ADMIN");
    const id = await emp({ embauche: "2026-01-01" });
    expect(await erreur(RH.desactiverEmploye(id, fd({ dateSortie: "2026-03-31" })))).toBe("REDIRECT /employes");
    await RH.reactiverEmploye(id);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie?.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(await erreur(RH.desactiverEmploye(id, fd({ dateSortie: "2026-06-30" })))).toBe("REDIRECT /employes");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).dateSortie?.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect((await soldeDe(id)).solde).toBe(9);
    const journal = await prisma.journalAudit.findMany({ where: { entiteId: id, champ: "actif" }, orderBy: { date: "asc" }, select: { nouvelleValeur: true } });
    expect(journal.map((l) => l.nouvelleValeur)).toEqual(["false — sortie le 31/03/2026", "true", "false — sortie le 30/06/2026"]);
  });
});
