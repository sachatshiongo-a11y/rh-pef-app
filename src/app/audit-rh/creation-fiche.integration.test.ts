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
