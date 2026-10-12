// Création de fiche salarié : la RH saisit, la Direction valide (décision de Sacha, 2026-10-13).
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
vi.mock("@/lib/pdf/contrat-buffer", () => ({ genererContratPdf: async () => null }));
vi.mock("@/lib/contrats-notification", () => ({ notifierContratASigner: async () => {}, notifierSiContratARevoir: async () => {}, etatSignatureContrat: async () => "NON_SIGNE" }));

const RH = await import("@/app/(app)/employes/actions");
const FICHE = await import("@/app/(app)/a-valider/fiche-actions");
const { creationsEnAttente } = await import("@/lib/creation-fiche");
const { chargerSoldeCongeSalarie } = await import("@/lib/solde-conge-salarie");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { direction: "", rh: "" };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function url(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { const u = (e as { url?: string }).url; if (u !== undefined) return decodeURIComponent(u); throw e; }
}
const comme = (qui: "ADMIN" | "MANAGER") => { A.user = { ...A.user, id: qui === "ADMIN" ? ids.direction : ids.rh, nom: qui === "ADMIN" ? "Direction" : "Esther RH", role: qui }; };
/** Le formulaire « Nouvel employé », tel que l'écran l'envoie. */
const nouveau = (o: Record<string, string> = {}) => fd({
  matricule: "", nom: "Jean Mukendi", sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", categorieProfessionnelle: "",
  salaireMensuel: "320", transportJourCDF: "3000", transportMoisCDF: "0", transportMoisUSD: "0", cnssMontant: "0", enfants: "2",
  type: "NATIONAL", dateEmbauche: "2026-10-01", contrat: "CDD", heuresParJour: "8", heuresHebdomadaires: "48", fraisMedicauxMoisCourant: "0",
  modePaiement: "VIREMENT", banque: "BGFI", compteBancaire: "05100-77", mobileMoney: "", telephone: "0990001111", email: "", adresse: "", dateNaissance: "1995-04-02", idExterneIVMS: "", ...o,
});
const nbEmployes = () => prisma.employee.count();
const enAttente = () => prisma.demandeCreationFiche.findMany({ where: { statut: "EN_ATTENTE" } });

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.rh = (await prisma.user.create({ data: { email: "rh@pef.test", nom: "Esther RH", role: "MANAGER" } })).id;
  await prisma.modeleTacheOnboarding.create({ data: { libelle: "Remettre l'uniforme", ordre: 1 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("la RH crée une fiche : rien n'est créé, une demande part à la Direction", () => {
  it("aucune fiche (ni dans les listes), une demande avec toutes les valeurs, la Direction prévenue, message à l'écran", async () => {
    comme("MANAGER");
    const avant = await nbEmployes();
    expect(await url(RH.creerEmploye(nouveau()))).toBe("/employes?creation=envoyee");
    expect(await nbEmployes()).toBe(avant);
    expect(await prisma.employee.count({ where: { nom: "Jean Mukendi" } })).toBe(0);
    const [d] = await enAttente();
    expect([d.nom, d.auteurNom, d.employeeId]).toEqual(["Jean Mukendi", "Esther RH", null]);
    expect(d.donnees).toMatchObject({ salaireMensuel: 320, contrat: "CDD", banque: "BGFI", compteBancaire: "05100-77", enfants: 2 });
    const notif = await prisma.notification.findFirstOrThrow({ where: { refId: d.id } });
    expect(notif.lien).toBe("/a-valider#modifications-fiches");
    expect((await creationsEnAttente()).map((c) => c.nom)).toEqual(["Jean Mukendi"]);
    expect((await creationsEnAttente())[0].lignes).toEqual(expect.arrayContaining(["Salaire mensuel : 320,00 $", "Type de contrat : CDD", "Compte bancaire : 05100-77"]));
  });

  it("valeur hors liste, date illisible, même personne déjà en attente, matricule pris : refus lisibles, rien n'est enregistré", async () => {
    comme("MANAGER");
    const n = (await enAttente()).length;
    expect(await url(RH.creerEmploye(nouveau({ nom: "Autre Personne", categorie: "CHEF" })))).toContain("n'est pas une valeur admise");
    expect(await url(RH.creerEmploye(nouveau({ nom: "Autre Personne", modePaiement: "CHEQUE" })))).toContain("n'est pas une valeur admise");
    expect(await url(RH.creerEmploye(nouveau({ nom: "Autre Personne", dateEmbauche: "" })))).toContain("Date d'embauche invalide");
    expect(await url(RH.creerEmploye(nouveau({ nom: "Jean Mukendi", telephone: "0970000000", dateNaissance: "1980-01-01" })))).toContain("est déjà en attente de validation");
    expect(await enAttente()).toHaveLength(n);
    await prisma.employee.create({ data: { matricule: "PRIS-1", nom: "Quelqu Un", sexe: "M", etatCivil: "Célibataire", poste: "x", secteur: "x", categorie: "BRIGADE", salaireMensuel: 1, dateEmbauche: new Date("2020-01-01"), contrat: "CDI" } });
    expect(await url(RH.creerEmploye(nouveau({ nom: "Troisième Personne", matricule: "PRIS-1", telephone: "0971", dateNaissance: "1970-02-02" })))).toContain("est déjà celui de");
    expect(await enAttente()).toHaveLength(n);
  });

  it("la RH ne peut ni approuver ni refuser une création", async () => {
    comme("MANAGER");
    const [d] = await enAttente();
    await expect(FICHE.approuverModifsFiche([d.id])).rejects.toThrow("Accès refusé");
    await expect(FICHE.refuserModifsFiche([d.id], "non")).rejects.toThrow("Accès refusé");
  });
});

describe("la Direction décide", () => {
  it("approuve : la fiche est créée avec exactement les valeurs saisies, checklist copiée, auteur prévenu avec le lien vers la fiche", async () => {
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Marie Kabongo", telephone: "0991112222", dateNaissance: "1990-05-05", dateEmbauche: "2026-12-31", enfants: "3" })));
    const d = (await enAttente()).find((x) => x.nom === "Marie Kabongo")!;
    comme("ADMIN");
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r).toMatchObject({ traitees: 1, echecs: [] });
    const e = await prisma.employee.findFirstOrThrow({ where: { nom: "Marie Kabongo" } });
    expect([Number(e.salaireMensuel), e.contrat, e.banque, e.compteBancaire, e.modePaiement, e.enfants, e.categorie]).toEqual([320, "CDD", "BGFI", "05100-77", "VIREMENT", 3, "BRIGADE"]);
    expect([e.dateEmbauche.toISOString().slice(0, 10), e.dateNaissance?.toISOString().slice(0, 10)]).toEqual(["2026-12-31", "1990-05-05"]);
    expect(e.matricule).toMatch(/-PEF$/i);
    expect(await prisma.tacheOnboarding.count({ where: { employeeId: e.id } })).toBe(1);
    const apres = await prisma.demandeCreationFiche.findUniqueOrThrow({ where: { id: d.id } });
    expect([apres.statut, apres.employeeId, apres.decideurId]).toEqual(["VALIDEE", e.id, ids.direction]);
    const n = await prisma.notification.findFirstOrThrow({ where: { destinataireUserId: ids.rh, refId: `decision:${d.id}` } });
    expect(n.lien).toBe(`/employes/${e.id}`);
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0);
    expect(await prisma.journalAudit.count({ where: { entiteId: e.id, champ: "creation" } })).toBe(1);
  });

  it("un doublon apparu entre-temps : refus lisible à l'approbation, aucune fiche créée, la demande reste en attente", async () => {
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Pierre Tshimanga", telephone: "0993334444", dateNaissance: "1988-08-08" })));
    const d = (await enAttente()).find((x) => x.nom === "Pierre Tshimanga")!;
    // Entre-temps, une fiche proche (même nom) est créée.
    await prisma.employee.create({ data: { matricule: "DBL-1", nom: "Pierre Tshimanga", sexe: "M", etatCivil: "Célibataire", poste: "x", secteur: "x", categorie: "BRIGADE", salaireMensuel: 1, dateEmbauche: new Date("2020-01-01"), contrat: "CDI" } });
    comme("ADMIN");
    const avant = await nbEmployes();
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r.traitees).toBe(0);
    expect(r.echecs.join(" ")).toContain("Une fiche proche existe");
    expect(await nbEmployes()).toBe(avant);
    expect((await prisma.demandeCreationFiche.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
    // Le matricule saisi, lui, pris entre-temps.
  });

  it("matricule saisi puis pris entre-temps : refus lisible, rien n'est créé", async () => {
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Paul Ilunga", matricule: "PAUL-1", telephone: "0995556666", dateNaissance: "1991-01-01" })));
    const d = (await enAttente()).find((x) => x.nom === "Paul Ilunga")!;
    await prisma.employee.create({ data: { matricule: "PAUL-1", nom: "Zoé Lunda", sexe: "F", etatCivil: "Célibataire", poste: "x", secteur: "x", categorie: "BRIGADE", salaireMensuel: 1, dateEmbauche: new Date("2020-01-01"), contrat: "CDI" } });
    comme("ADMIN");
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r.echecs.join(" ")).toContain("Le matricule « PAUL-1 » est déjà celui de Zoé Lunda");
    expect(await prisma.employee.count({ where: { nom: "Paul Ilunga" } })).toBe(0);
  });

  it("refus : motif obligatoire, la demande est refusée, aucune fiche, l'auteur est prévenu du motif", async () => {
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Rose Mbuyi", telephone: "0997778888", dateNaissance: "1993-03-03" })));
    const d = (await enAttente()).find((x) => x.nom === "Rose Mbuyi")!;
    comme("ADMIN");
    expect((await FICHE.refuserModifsFiche([d.id], " ")).echecs[0]).toContain("motif est obligatoire");
    expect((await FICHE.refuserModifsFiche([d.id], "Pas de poste ouvert")).traitees).toBe(1);
    expect(await prisma.employee.count({ where: { nom: "Rose Mbuyi" } })).toBe(0);
    const n = await prisma.notification.findFirstOrThrow({ where: { destinataireUserId: ids.rh, refId: `decision:${d.id}` } });
    expect(n.message).toContain("est refusée : Pas de poste ouvert");
  });

  it("actions groupées : une création et une modification de fiche approuvées ensemble", async () => {
    comme("ADMIN");
    const e = await prisma.employee.create({ data: { matricule: "MIX-1", nom: "Lot Mixte", sexe: "M", etatCivil: "Célibataire", poste: "x", secteur: "x", categorie: "BRIGADE", salaireMensuel: 100, dateEmbauche: new Date("2020-01-01"), contrat: "CDI" } });
    const modif = await prisma.demandeModifFiche.create({ data: { employeeId: e.id, origine: "MODIFIER", changements: [{ champ: "enfants", avant: "0", apres: "4" }], auteurId: ids.rh, auteurNom: "Esther RH" } });
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Sylvie Kalala", telephone: "0998889999", dateNaissance: "1992-02-02" })));
    const cre = (await enAttente()).find((x) => x.nom === "Sylvie Kalala")!;
    comme("ADMIN");
    const r = await FICHE.approuverModifsFiche([modif.id, cre.id]);
    expect(r).toMatchObject({ traitees: 2, echecs: [] });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: e.id } })).enfants).toBe(4);
    expect(await prisma.employee.count({ where: { nom: "Sylvie Kalala" } })).toBe(1);
  });
});

describe("la Direction crée directement, comme avant", () => {
  it("fiche créée tout de suite, aucune demande, matricule attribué, checklist copiée", async () => {
    comme("ADMIN");
    const avant = await prisma.demandeCreationFiche.count();
    expect(await url(RH.creerEmploye(nouveau({ nom: "Direct Ion", telephone: "0996667777", dateNaissance: "1985-07-07" })))).toBe("/employes");
    const e = await prisma.employee.findFirstOrThrow({ where: { nom: "Direct Ion" } });
    expect([Number(e.salaireMensuel), e.contrat]).toEqual([320, "CDD"]);
    expect(e.matricule).toMatch(/-PEF$/i);
    expect(await prisma.tacheOnboarding.count({ where: { employeeId: e.id } })).toBe(1);
    expect(await prisma.demandeCreationFiche.count()).toBe(avant);
  });
});

describe("double approbation", () => {
  it("deux approbations simultanées de la même demande : UNE seule fiche, l'autre reçoit « déjà traitée »", async () => {
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Double Clic", telephone: "0994443333", dateNaissance: "1989-09-09" })));
    const d = (await enAttente()).find((x) => x.nom === "Double Clic")!;
    comme("ADMIN");
    const [a, b] = await Promise.all([FICHE.approuverModifsFiche([d.id]), FICHE.approuverModifsFiche([d.id])]);
    expect(a.traitees + b.traitees).toBe(1);
    expect([...a.echecs, ...b.echecs].join(" ")).toContain("déjà traitée");
    expect(await prisma.employee.count({ where: { nom: "Double Clic" } })).toBe(1);
    expect(await prisma.tacheOnboarding.count({ where: { employee: { nom: "Double Clic" } } })).toBe(1);
  });
});

describe("historique salarial : première ligne « Salaire d'embauche »", () => {
  const lignes = (employeeId: string) => prisma.historiqueSalaire.findMany({ where: { employeeId } });

  it("création directe par la Direction : une ligne (montant de la fiche, date d'embauche, sans ancien salaire, auteur = la Direction)", async () => {
    comme("ADMIN");
    await url(RH.creerEmploye(nouveau({ nom: "Histo Direct", telephone: "0980000001", dateNaissance: "1984-01-01", dateEmbauche: "2026-09-15", salaireMensuel: "410" })));
    const e = await prisma.employee.findFirstOrThrow({ where: { nom: "Histo Direct" } });
    const l = await lignes(e.id);
    expect(l).toHaveLength(1);
    expect([Number(l[0].nouveauSalaire), l[0].ancienSalaire, l[0].motif, l[0].decideParId, l[0].nouveauPoste, l[0].date.toISOString().slice(0, 10)])
      .toEqual([410, null, "Salaire d'embauche", ids.direction, "Commis", "2026-09-15"]);
  });

  it("approbation d'une demande RH : une ligne, auteur = la Direction qui approuve ; refus ou doublon : aucune ligne", async () => {
    comme("MANAGER");
    await url(RH.creerEmploye(nouveau({ nom: "Histo Approuvé", telephone: "0980000002", dateNaissance: "1983-02-02", dateEmbauche: "2026-08-03", salaireMensuel: "275,50" })));
    await url(RH.creerEmploye(nouveau({ nom: "Histo Refusé", telephone: "0980000003", dateNaissance: "1982-03-03" })));
    const dA = (await enAttente()).find((x) => x.nom === "Histo Approuvé")!;
    const dR = (await enAttente()).find((x) => x.nom === "Histo Refusé")!;
    const avant = await prisma.historiqueSalaire.count();
    comme("ADMIN");
    expect((await FICHE.refuserModifsFiche([dR.id], "Non")).traitees).toBe(1);
    expect(await prisma.historiqueSalaire.count()).toBe(avant); // refus : aucune ligne
    expect((await FICHE.approuverModifsFiche([dA.id])).traitees).toBe(1);
    const e = await prisma.employee.findFirstOrThrow({ where: { nom: "Histo Approuvé" } });
    const l = await lignes(e.id);
    expect(l).toHaveLength(1);
    expect([Number(l[0].nouveauSalaire), l[0].motif, l[0].decideParId, l[0].date.toISOString().slice(0, 10)]).toEqual([275.5, "Salaire d'embauche", ids.direction, "2026-08-03"]);
    expect(await prisma.historiqueSalaire.count()).toBe(avant + 1);
  });
});

// RÉEMBAUCHE (décision du 2026-10-12 n°10) : nouvelle fiche liée à la fiche archivée.
describe("réembauche : nouvelle fiche, ancienne fiche archivée intacte", () => {
  let seqR = 0;
  /** Un ancien salarié : fiche INACTIVE, embauché en 2020, avec contrat résilié et historique. */
  async function ancien(o: { actif?: boolean } = {}) {
    seqR++;
    const e = await prisma.employee.create({ data: {
      matricule: `ANC${seqR}-PEF`, nom: ["", "Kasongo Mwamba", "Tshibola Ngoy", "Ilunga Kalenga", "Banza Mutombo", "Lubaba Kyungu", "Mulumba Zola", "Nkulu Kabeya"][seqR], sexe: "M", etatCivil: "Marié(e)", poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 280, dateEmbauche: new Date("2020-01-06"), contrat: "CDI", actif: o.actif ?? false, telephone: `09100000${seqR}`, dateNaissance: new Date(`198${seqR}-0${seqR}-1${seqR}`), banque: "Rawbank", compteBancaire: `RB-${seqR}`,
    } });
    await prisma.contrat.create({ data: { employeeId: e.id, type: "CDI", dateDebut: new Date("2020-01-06"), heuresHebdo: 48, salaireMensuel: 280, devise: "USD", poste: "Cuisinier", statut: "RESILIE" } });
    await prisma.historiqueSalaire.create({ data: { employeeId: e.id, ancienSalaire: 250, nouveauSalaire: 280, motif: "Ajustement" } });
    return e;
  }
  const memeIdentite = (a: { nom: string; telephone: string | null; dateNaissance: Date | null }, o: Record<string, string> = {}) =>
    nouveau({ nom: a.nom, telephone: a.telephone ?? "", dateNaissance: a.dateNaissance!.toISOString().slice(0, 10), sexe: "M", etatCivil: "Marié(e)", poste: "Cuisinier", dateEmbauche: "2026-10-12", salaireMensuel: "300", banque: "Rawbank", ...o });

  it("Direction : nouvelle fiche liée à l'ancienne (nouveau matricule, solde de congés à zéro, ligne « Salaire d'embauche »), ancienne intacte", async () => {
    comme("ADMIN");
    const a = await ancien();
    const avant = await prisma.employee.findUniqueOrThrow({ where: { id: a.id } });
    const soldeAvant = await chargerSoldeCongeSalarie(prisma as never, a.id, new Date("2026-10-13T08:00:00Z"));
    expect(soldeAvant.acquis).toBeGreaterThan(0);
    expect(await url(RH.creerEmploye(memeIdentite(a, { ancienneFicheId: a.id })))).toBe("/employes");
    const n = await prisma.employee.findFirstOrThrow({ where: { ancienneFicheId: a.id } });
    expect([n.actif, n.nom, n.ancienneFicheId, Number(n.salaireMensuel), n.dateEmbauche.toISOString().slice(0, 10)]).toEqual([true, a.nom, a.id, 300, "2026-10-12"]);
    expect(n.matricule).not.toBe(a.matricule);
    const soldeN = await chargerSoldeCongeSalarie(prisma as never, n.id, new Date("2026-10-13T08:00:00Z"));
    expect([soldeN.acquis, soldeN.report, soldeN.pris]).toEqual([0, 0, 0]);
    const h = await prisma.historiqueSalaire.findMany({ where: { employeeId: n.id } });
    expect(h.map((x) => x.motif)).toEqual(["Salaire d'embauche"]);
    // L'ancienne fiche n'a pas bougé (inactive, mêmes valeurs, même historique, même contrat, même solde).
    const apres = await prisma.employee.findUniqueOrThrow({ where: { id: a.id } });
    expect([apres.actif, apres.matricule, Number(apres.salaireMensuel), apres.updatedAt.getTime()]).toEqual([false, avant.matricule, 280, avant.updatedAt.getTime()]);
    expect(await prisma.historiqueSalaire.count({ where: { employeeId: a.id } })).toBe(1);
    expect(await prisma.contrat.count({ where: { employeeId: a.id, statut: "RESILIE" } })).toBe(1);
    expect((await chargerSoldeCongeSalarie(prisma as never, a.id, new Date("2026-10-13T08:00:00Z"))).acquis).toBe(soldeAvant.acquis);
    expect(await prisma.journalAudit.count({ where: { entiteId: n.id, champ: "reembauche" } })).toBe(1);
  });

  it("RH : une demande « Nouvelle fiche (réembauche) », rien n'est créé ; la Direction approuve : fiche liée", async () => {
    comme("MANAGER");
    const a = await ancien();
    const avant = await nbEmployes();
    expect(await url(RH.creerEmploye(memeIdentite(a, { ancienneFicheId: a.id })))).toBe("/employes?creation=envoyee");
    expect(await nbEmployes()).toBe(avant);
    const [d] = (await enAttente()).filter((x) => x.nom === a.nom);
    expect((await creationsEnAttente()).find((c) => c.id === d.id)).toMatchObject({ reembauche: true });
    expect((await creationsEnAttente()).find((c) => c.id === d.id)!.lignes[0]).toContain(`Réembauche de : ${a.nom} (${a.matricule})`);
    comme("ADMIN");
    expect((await FICHE.approuverModifsFiche([d.id])).traitees).toBe(1);
    const n = await prisma.employee.findFirstOrThrow({ where: { ancienneFicheId: a.id } });
    expect([n.actif, n.matricule === a.matricule]).toEqual([true, false]);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: a.id } })).actif).toBe(false);
  });

  it("ancienne fiche encore ACTIVE : refus (Direction comme RH) ; réactivée entre la demande et l'approbation : refus à l'approbation", async () => {
    const act = await ancien({ actif: true });
    const avant = await nbEmployes();
    comme("ADMIN");
    expect(await url(RH.creerEmploye(memeIdentite(act, { ancienneFicheId: act.id })))).toContain("encore ACTIVE");
    comme("MANAGER");
    expect(await url(RH.creerEmploye(memeIdentite(act, { ancienneFicheId: act.id })))).toContain("encore ACTIVE");
    expect(await nbEmployes()).toBe(avant);
    // Demande légitime, puis la Direction réactive l'ancienne fiche avant d'approuver.
    const a = await ancien();
    await url(RH.creerEmploye(memeIdentite(a, { ancienneFicheId: a.id })));
    const d = (await enAttente()).find((x) => x.nom === a.nom)!;
    await prisma.employee.update({ where: { id: a.id }, data: { actif: true } });
    comme("ADMIN");
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r.traitees).toBe(0);
    expect(r.echecs.join(" ")).toContain("encore ACTIVE");
    expect(await prisma.employee.count({ where: { ancienneFicheId: a.id } })).toBe(0);
  });

  it("sans réembauche explicite, la même identité reste un doublon refusé ; une fiche réembauchée ne l'est pas deux fois", async () => {
    comme("ADMIN");
    const a = await ancien();
    expect(await url(RH.creerEmploye(memeIdentite(a)))).toContain("fiche proche existe déjà");
    expect(await url(RH.creerEmploye(memeIdentite(a, { ancienneFicheId: a.id })))).toBe("/employes");
    expect(await url(RH.creerEmploye(memeIdentite(a, { ancienneFicheId: a.id, dateEmbauche: "2026-11-01" })))).toContain("déjà été réembauché");
    expect(await prisma.employee.count({ where: { ancienneFicheId: a.id } })).toBe(1);
  });

  it("« Modifier » n'efface jamais le lien de réembauche", async () => {
    comme("ADMIN");
    const a = await ancien();
    await url(RH.creerEmploye(memeIdentite(a, { ancienneFicheId: a.id })));
    const n = await prisma.employee.findFirstOrThrow({ where: { ancienneFicheId: a.id } });
    const f = fd({ matricule: n.matricule, nom: n.nom, sexe: n.sexe, etatCivil: n.etatCivil, poste: "Chef", secteur: n.secteur, categorie: "BRIGADE" });
    await url(RH.modifierEmploye(n.id, f));
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: n.id } })).ancienneFicheId).toBe(a.id);
  });
});
