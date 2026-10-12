// Fiche salarié : la RH saisit les champs sensibles, la Direction valide (décision de Sacha, 2026-10-12).
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
const DOSSIER = await import("@/app/(app)/employes/[id]/dossier-actions");
const CONTRATS = await import("@/app/(app)/paie/contrat-actions");
const FICHE = await import("@/app/(app)/a-valider/fiche-actions");
const { originesDe } = await import("@/lib/fiche-sensible");
const { numeroMoisCourantKinshasa, anneeCouranteKinshasa } = await import("@/lib/heure-kinshasa");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { direction: "", rh: "" };
let n = 0;
async function emp() {
  n++;
  return (await prisma.employee.create({
    data: { matricule: `FV${n}-PEF`, nom: `Salarié Fiche ${n}`, sexe: "M", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2020-01-06"), contrat: "CDI" },
  })).id;
}
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
async function url(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { const u = (e as { url?: string }).url; if (u !== undefined) return decodeURIComponent(u); throw e; }
}
const comme = (qui: "ADMIN" | "MANAGER") => { A.user = { ...A.user, id: qui === "ADMIN" ? ids.direction : ids.rh, nom: qui === "ADMIN" ? "Direction" : "Esther RH", role: qui }; };
/** Le formulaire « Modifier » complet, tel que l'écran l'envoie (valeurs de la fiche par défaut). */
async function formulaire(id: string, o: Record<string, string> = {}) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
  return fd({
    matricule: e.matricule, nom: e.nom, sexe: e.sexe, etatCivil: e.etatCivil, poste: e.poste, secteur: e.secteur, categorie: e.categorie, categorieProfessionnelle: "",
    salaireMensuel: String(Number(e.salaireMensuel)), transportJourCDF: "0", transportMoisCDF: "0", transportMoisUSD: "0", cnssMontant: "0", enfants: "0",
    type: "NATIONAL", dateEmbauche: e.dateEmbauche.toISOString().slice(0, 10), contrat: e.contrat, heuresParJour: "8", heuresHebdomadaires: "48",
    fraisMedicauxMoisCourant: "0", modePaiement: "ESPECES", banque: "", compteBancaire: "", mobileMoney: "", telephone: "", email: "", adresse: "", dateNaissance: "", idExterneIVMS: "", ...o,
  });
}
const enAttente = (id: string) => prisma.demandeModifFiche.findMany({ where: { employeeId: id, statut: "EN_ATTENTE" } });

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest()); H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.rh = (await prisma.user.create({ data: { email: "rh@pef.test", nom: "Esther RH", role: "MANAGER" } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("la RH saisit un champ sensible : rien n'est appliqué, une demande part à la Direction", () => {
  it("salaire, transport et enfants : fiche inchangée, une demande (avant → après), la Direction prévenue ; le poste s'enregistre", async () => {
    comme("MANAGER");
    const id = await emp();
    const r = await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "350", transportJourCDF: "3000", enfants: "2", poste: "Chef de partie" })));
    expect(r).toBe(`/employes/${id}`);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), Number(e.transportJourCDF), e.enfants, e.poste]).toEqual([300, 0, 0, "Chef de partie"]);
    const [d] = await enAttente(id);
    expect(d.changements).toEqual([
      { champ: "salaireMensuel", avant: "300", apres: "350" },
      { champ: "transportJourCDF", avant: "0", apres: "3000" },
      { champ: "enfants", avant: "0", apres: "2" },
    ]);
    expect(d.auteurNom).toBe("Esther RH");
    const notif = await prisma.notification.findFirstOrThrow({ where: { refId: d.id } });
    expect(notif.lien).toBe("/a-valider#modifications-fiches");
    expect(await prisma.historiqueSalaire.count({ where: { employeeId: id } })).toBe(0);
  });

  it("une 2e demande sur un champ déjà en attente est refusée : rien n'est enregistré (pas même le poste)", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "350" })));
    const r = await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "360", poste: "Plongeur" })));
    expect(r).toContain("erreur=Salaire mensuel : une modification est déjà en attente de validation");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).poste).toBe("Commis");
    expect(await enAttente(id)).toHaveLength(1);
    // Un AUTRE champ reste demandable à part.
    expect(await url(RH.modifierEmploye(id, await formulaire(id, { enfants: "1" })))).toBe(`/employes/${id}`);
    expect(await enAttente(id)).toHaveLength(2);
  });

  it("appel direct de « Changer le salaire » par la RH : demande (salaire + poste), jamais d'écriture", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(DOSSIER.changerSalaire(id, fd({ nouveauSalaire: "420", nouveauPoste: "Second", motif: "Promotion" })));
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.poste]).toEqual([300, "Commis"]);
    const [d] = await enAttente(id);
    expect([d.origine, d.motif]).toEqual(["CHANGER_SALAIRE", "Promotion"]);
    comme("ADMIN");
    const rapport = await FICHE.approuverModifsFiche([d.id]);
    expect(rapport.traitees).toBe(1);
    const h = await prisma.historiqueSalaire.findFirstOrThrow({ where: { employeeId: id } });
    expect([Number(h.ancienSalaire), Number(h.nouveauSalaire), h.ancienPoste, h.nouveauPoste, h.decideParId]).toEqual([300, 420, "Commis", "Second", ids.direction]);
  });

  it("la RH ne peut ni approuver ni refuser", async () => {
    comme("MANAGER");
    await expect(FICHE.approuverModifsFiche(["x"])).rejects.toThrow("Accès refusé");
    await expect(FICHE.refuserModifsFiche(["x"], "non")).rejects.toThrow("Accès refusé");
  });
});

describe("la Direction décide", () => {
  it("approuve : fiche + historique du salaire + journal ; l'auteur est prévenu", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "350", contrat: "CDD", dateEmbauche: "2019-05-02" })));
    const [d] = await enAttente(id);
    comme("ADMIN");
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r).toMatchObject({ traitees: 1, echecs: [] });
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.contrat, e.dateEmbauche.toISOString().slice(0, 10)]).toEqual([350, "CDD", "2019-05-02"]);
    const h = await prisma.historiqueSalaire.findMany({ where: { employeeId: id } });
    expect(h.map((x) => [Number(x.ancienSalaire), Number(x.nouveauSalaire)])).toEqual([[300, 350]]);
    expect(await prisma.journalAudit.count({ where: { entiteId: id, champ: { in: ["salaireMensuel", "contrat", "dateEmbauche"] } } })).toBe(3);
    expect((await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("VALIDEE");
    expect(await prisma.notification.count({ where: { destinataireUserId: ids.rh, refId: `decision:${d.id}` } })).toBe(1);
    expect(await prisma.notification.count({ where: { refId: d.id } })).toBe(0); // la notification de la Direction est retirée
  });

  it("demande périmée (la fiche a changé depuis) : refusée à l'approbation, rien n'est écrit", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "400" })));
    const [d] = await enAttente(id);
    comme("ADMIN");
    await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "380" }))); // écriture directe de la Direction
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r.traitees).toBe(0);
    expect(r.echecs.join(" ")).toContain("Demande périmée : Salaire mensuel vaut maintenant 380,00 $ (300,00 $ au moment de la demande)");
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(380);
    expect((await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
  });

  it("la date d'embauche demandée est appliquée au jour près ; compte, banque et Mobile Money suivent l'approbation, pas la demande", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { dateEmbauche: "2021-12-31", modePaiement: "MOBILE_MONEY", mobileMoney: "0990000000", banque: "BGFI", compteBancaire: "05100-1" })));
    const avant = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([avant.mobileMoney, avant.banque, avant.compteBancaire, avant.modePaiement]).toEqual([null, null, null, "ESPECES"]);
    const [d] = await enAttente(id);
    comme("ADMIN");
    expect((await FICHE.approuverModifsFiche([d.id])).traitees).toBe(1);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([e.dateEmbauche.toISOString().slice(0, 10), e.modePaiement, e.mobileMoney, e.banque, e.compteBancaire]).toEqual(["2021-12-31", "MOBILE_MONEY", "0990000000", "BGFI", "05100-1"]);
    // Rien d'autre n'a bougé.
    expect([e.nom, e.poste, Number(e.salaireMensuel), e.enfants, e.contrat, e.categorie]).toEqual([avant.nom, avant.poste, 300, 0, "CDI", "BRIGADE"]);
  });

  it("refus : motif obligatoire ; avec motif, la demande est refusée et l'auteur prévenu du motif", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { compteBancaire: "05100-999" })));
    const [d] = await enAttente(id);
    comme("ADMIN");
    expect((await FICHE.refuserModifsFiche([d.id], "  ")).echecs[0]).toContain("motif est obligatoire");
    expect((await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: d.id } })).statut).toBe("EN_ATTENTE");
    expect((await FICHE.refuserModifsFiche([d.id], "RIB non fourni")).traitees).toBe(1);
    const apres = await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: d.id } });
    expect([apres.statut, apres.motifRefus]).toEqual(["REFUSEE", "RIB non fourni"]);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).compteBancaire).toBeNull();
    const n2 = await prisma.notification.findFirstOrThrow({ where: { destinataireUserId: ids.rh, refId: `decision:${d.id}` } });
    expect(n2.message).toContain("est refusée : RIB non fourni");
  });

  it("deux approbations simultanées de la même demande : appliquée une seule fois (une ligne d'historique)", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "360", enfants: "2" })));
    const [d] = await enAttente(id);
    comme("ADMIN");
    const [a, b] = await Promise.all([FICHE.approuverModifsFiche([d.id]), FICHE.approuverModifsFiche([d.id])]);
    expect(a.traitees + b.traitees).toBe(1);
    expect([...a.echecs, ...b.echecs].join(" ")).toContain("Demande déjà traitée");
    expect(await prisma.historiqueSalaire.count({ where: { employeeId: id } })).toBe(1);
    expect(await prisma.journalAudit.count({ where: { entiteId: id, champ: "enfants" } })).toBe(1);
  });

  it("la Direction écrit directement (salaire historisé), sans demande", async () => {
    comme("ADMIN");
    const id = await emp();
    expect(await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "320", enfants: "3" })))).toBe("/employes");
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.enfants]).toEqual([320, 3]);
    expect(await prisma.historiqueSalaire.count({ where: { employeeId: id } })).toBe(1);
    expect(await prisma.journalAudit.count({ where: { entiteId: id, champ: "enfants" } })).toBe(1);
    expect(await prisma.demandeModifFiche.count({ where: { employeeId: id } })).toBe(0);
  });

  it("paie du mois validée : la fiche change, la décision dit que le bulletin figé ne change pas", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(RH.modifierEmploye(id, await formulaire(id, { salaireMensuel: "333" })));
    const [d] = await enAttente(id);
    await prisma.payrollRun.create({ data: { mois: numeroMoisCourantKinshasa(), annee: anneeCouranteKinshasa(), statut: "VALIDE", tauxChangeUtilise: 2800 } });
    comme("ADMIN");
    const r = await FICHE.approuverModifsFiche([d.id]);
    expect(r.traitees).toBe(1);
    expect(r.avertissements.join(" ")).toContain("est validée : ses bulletins figés ne changent pas");
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(333);
    expect((await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: d.id } })).noteDecision).toContain("bulletins figés");
  });
});

// RELECTURE 2026-10-12 : les actions de CONTRAT recopient contrat / poste / salaire sur la fiche
// (Employee) — un 2e chemin vers les champs sensibles, ouvert à la RH. Il doit passer par la demande.
describe("la RH ne contourne pas la validation par les actions de contrat", () => {
  const contratActif = (employeeId: string, o: { salaire?: number } = {}) =>
    prisma.contrat.create({ data: { employeeId, type: "CDD", dateDebut: new Date("2029-06-01"), dateFin: new Date("2030-06-30"), heuresHebdo: 48, salaireMensuel: o.salaire ?? 300, devise: "USD", poste: "Commis", statut: "ACTIF" } });
  const corriger = (contratId: string, o: Record<string, string> = {}) =>
    CONTRATS.modifierContrat(contratId, fd({ type: "CDD", poste: "Commis", dateDebut: "2029-06-01", dateFin: "2030-06-30", salaireMensuel: "300", heuresHebdo: "48", devise: "USD", retour: "/paie", ...o }));

  it("« Corriger le contrat » par la RH : le salaire de la fiche ne bouge pas, une demande part à la Direction", async () => {
    comme("MANAGER");
    const id = await emp();
    const c = await contratActif(id);
    expect(await url(corriger(c.id, { salaireMensuel: "9999", poste: "Directeur" }))).toBeNull();
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.contrat]).toEqual([300, "CDI"]);
    const [d] = await enAttente(id);
    expect(d.changements).toEqual(expect.arrayContaining([{ champ: "salaireMensuel", avant: "300", apres: "9999" }, { champ: "contrat", avant: "CDI", apres: "CDD" }]));
    comme("ADMIN");
    expect((await FICHE.approuverModifsFiche([d.id])).traitees).toBe(1);
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(9999);
    expect(await prisma.historiqueSalaire.count({ where: { employeeId: id } })).toBe(1);
  });

  it("« Transformer le contrat » par la RH : le type de contrat de la fiche attend la Direction", async () => {
    comme("MANAGER");
    const id = await emp();
    const c = await contratActif(id);
    await url(CONTRATS.transformerContrat(c.id, fd({ type: "CDI", retour: "/paie" })));
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).contrat).toBe("CDI"); // déjà CDI à l'origine : voir la demande
    const id2 = await emp();
    await prisma.employee.update({ where: { id: id2 }, data: { contrat: "CDD" } });
    const c2 = await contratActif(id2);
    await url(CONTRATS.transformerContrat(c2.id, fd({ type: "STAGE", dateFin: "2031-01-01", retour: "/paie" })));
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: id2 } })).contrat).toBe("CDD");
    expect((await enAttente(id2))[0].changements).toEqual([{ champ: "contrat", avant: "CDD", apres: "STAGE" }]);
  });

  it("« Ajouter un contrat » par la RH : le type de contrat de la fiche attend la Direction", async () => {
    comme("MANAGER");
    const id = await emp();
    await url(DOSSIER.ajouterContrat(id, fd({ type: "JOURNALIER", poste: "Commis", dateDebut: "2029-07-01", dateFin: "2030-07-01", heuresHebdo: "48", salaireMensuel: "300", devise: "USD", coutJourUSD: "0" })));
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).contrat).toBe("CDI");
    expect((await enAttente(id))[0].changements).toEqual([{ champ: "contrat", avant: "CDI", apres: "JOURNALIER" }]);
  });

  it("la Direction garde l'écriture directe par les actions de contrat", async () => {
    comme("ADMIN");
    const id = await emp();
    const c = await contratActif(id);
    expect(await url(corriger(c.id, { salaireMensuel: "410" }))).toBeNull();
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.contrat]).toEqual([410, "CDD"]);
    expect(await enAttente(id)).toHaveLength(0);
  });
});

// RELECTURE 2026-10-12 (2) : formulaire périmé et valeurs admises.
describe("formulaire périmé : seuls les champs réellement changés comptent", () => {
  /** Le formulaire tel qu'ouvert MAINTENANT : valeurs de la fiche + valeurs d'origine en champ caché. */
  async function ouvert(id: string, o: Record<string, string> = {}) {
    const f = await formulaire(id, o);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    f.set("originesFiche", originesDe(e as unknown as Record<string, unknown>));
    return f;
  }
  /** Même formulaire, rempli par l'utilisateur APRÈS ce qui lui est arrivé entre-temps. */
  const saisie = (f: FormData, o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

  it("350 → 300 : la RH enregistre un autre champ avec un formulaire ouvert avant la hausse : aucune demande, le salaire reste 350", async () => {
    comme("MANAGER");
    const id = await emp();
    const f = await ouvert(id); // ouvert quand le salaire valait 300
    await prisma.employee.update({ where: { id }, data: { salaireMensuel: 350 } }); // la Direction l'a relevé entre-temps
    expect(await url(RH.modifierEmploye(id, saisie(f, { poste: "Chef de partie" })))).toBe("/employes");
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.poste]).toEqual([350, "Chef de partie"]);
    expect(await enAttente(id)).toHaveLength(0);
  });

  it("la RH change le salaire sur un formulaire périmé : refus lisible, rien n'est enregistré", async () => {
    comme("MANAGER");
    const id = await emp();
    const f = await ouvert(id);
    await prisma.employee.update({ where: { id }, data: { salaireMensuel: 350 } });
    const r = await url(RH.modifierEmploye(id, saisie(f, { salaireMensuel: "320", poste: "Plongeur" })));
    expect(r).toContain("La fiche a changé depuis l'ouverture du formulaire (Salaire mensuel vaut maintenant 350,00 $)");
    expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).poste).toBe("Commis");
    expect(await enAttente(id)).toHaveLength(0);
  });

  it("la Direction : pas d'écrasement silencieux d'une valeur changée entre-temps, mais ses vrais changements passent", async () => {
    comme("ADMIN");
    const id = await emp();
    const f = await ouvert(id);
    await prisma.employee.update({ where: { id }, data: { salaireMensuel: 350 } });
    expect(await url(RH.modifierEmploye(id, saisie(f, { enfants: "2" })))).toBe("/employes"); // salaire non touché
    const e = await prisma.employee.findUniqueOrThrow({ where: { id } });
    expect([Number(e.salaireMensuel), e.enfants]).toEqual([350, 2]);
    const g = await ouvert(id);
    await prisma.employee.update({ where: { id }, data: { salaireMensuel: 400 } });
    expect(await url(RH.modifierEmploye(id, saisie(g, { salaireMensuel: "360" })))).toContain("La fiche a changé depuis l'ouverture");
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(400);
    expect(await prisma.historiqueSalaire.count({ where: { employeeId: id } })).toBe(0);
  });

  it("« Changer le salaire » sur un formulaire périmé : refusé pour la RH comme pour la Direction", async () => {
    for (const qui of ["MANAGER", "ADMIN"] as const) {
      comme(qui);
      const id = await emp();
      await prisma.employee.update({ where: { id }, data: { salaireMensuel: 350 } });
      const r = await url(DOSSIER.changerSalaire(id, fd({ origineSalaire: "300", originePoste: "Commis", nouveauSalaire: "320", nouveauPoste: "Commis", motif: "Ajustement" })));
      expect(r, qui).toContain("La fiche a changé depuis l'ouverture");
      expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id } })).salaireMensuel)).toBe(350);
      expect(await enAttente(id)).toHaveLength(0);
    }
  });
});

describe("valeurs admises des champs à liste fermée", () => {
  it("catégorie, national/expatrié, moyen de paiement, contrat hors liste : refus lisible, rien n'est enregistré (RH comme Direction)", async () => {
    for (const qui of ["MANAGER", "ADMIN"] as const) {
      comme(qui);
      const id = await emp();
      for (const [champ, valeur] of [["categorie", "CHEF"], ["type", "ETRANGER"], ["modePaiement", "CHEQUE"], ["contrat", "CDX"]]) {
        const r = await url(RH.modifierEmploye(id, await formulaire(id, { [champ]: valeur, poste: "Ne doit pas passer" })));
        expect(r, `${qui} ${champ}`).toContain("n'est pas une valeur admise");
      }
      expect((await prisma.employee.findUniqueOrThrow({ where: { id } })).poste).toBe("Commis");
      expect(await enAttente(id)).toHaveLength(0);
    }
  });

  it("à l'approbation, une valeur hors liste ou illisible est dite en clair (jamais l'erreur brute de la base), la demande reste en attente", async () => {
    comme("ADMIN");
    const id = await emp();
    const forgee = (changements: object[]) => prisma.demandeModifFiche.create({ data: { employeeId: id, origine: "MODIFIER", changements, auteurId: ids.rh, auteurNom: "Esther RH" } });
    const d1 = await forgee([{ champ: "categorie", avant: "BRIGADE", apres: "CHEF" }]);
    const r1 = await FICHE.approuverModifsFiche([d1.id]);
    expect(r1.echecs.join(" ")).toContain("n'est pas une valeur admise");
    const d2 = await forgee([{ champ: "enfants", avant: "0", apres: "beaucoup" }]);
    const r2 = await FICHE.approuverModifsFiche([d2.id]);
    expect(r2.echecs.join(" ")).toContain("la base a refusé la modification");
    expect(r2.echecs.join(" ")).not.toContain("Invalid `prisma");
    expect((await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: d2.id } })).statut).toBe("EN_ATTENTE");
  });
});
