import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { envoyerPush } from "@/lib/push";
import { genererMatricule } from "@/lib/matricule";
import { enregistrerSalaireEmbauche } from "@/lib/historique-salaire";
import { MAX_MOTIF_REFUS } from "@/lib/conges-liste";
import { fichesProches, libelleMotif, memeNom, JOURNAL_DOUBLON_ECARTE, type IdentiteFiche } from "@/lib/employe-doublon";
import { controlerDonneesCreation, donneesPourEcriture, lignesCreation, type DonneesCreation } from "@/lib/creation-fiche-donnees";
import { estDirection, LIEN_SECTION, type Acteur, type RapportFiche } from "@/lib/demandes-fiche";
import { jourKinshasa } from "@/lib/heure-kinshasa";

// CRÉATION D'UNE FICHE SALARIÉ SOUS VALIDATION (2026-10-13, décision de Sacha : « la création passe par la
// validation également »).
//  - Direction : création directe, comme avant (`creerFicheTx`).
//  - Autre rôle (RH) : une `DemandeCreationFiche` — RIEN n'est créé dans `Employee` avant l'approbation :
//    la demande vit dans sa propre table, aucune liste de salariés, paie, présences ni planning ne la voit.
//  - Approuver crée la fiche dans UNE transaction, sous un verrou global de création : matricule, identifiant
//    de pointeuse et anti-doublon sont REVÉRIFIÉS à ce moment (un doublon apparu entre-temps = refus lisible,
//    rien n'est créé). Refuser exige un motif ; l'auteur est prévenu.

type Tx = Prisma.TransactionClient;
type Db = { employee: Tx["employee"] };

const VERROU_CREATION = "creation-fiche";
async function verrouillerCreations(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${VERROU_CREATION}))::text AS verrou`;
}

/** Erreur d'unicité de la base (course entre deux enregistrements) → message lisible. */
export function lisibleSiDoublon(e: unknown): never {
  if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
    throw new Error("Ce matricule (ou cet identifiant) vient d'être pris par une autre fiche. Rien n'a été enregistré : vérifiez et réessayez.");
  }
  throw e;
}

/**
 * Unicité lisible (au lieu de l'erreur brute de la base) : matricule non vide et libre ; identifiant
 * de pointeuse IVMS libre — ni l'ID IVMS d'un autre, ni le matricule d'un autre (l'import apparie
 * aussi par matricule : la pointeuse confondrait les deux salariés).
 */
export async function exigerIdentifiantsLibres(db: Db, p: { matricule: string; idExterneIVMS: string | null }, exclureId?: string): Promise<void> {
  const autres = exclureId ? { id: { not: exclureId } } : {};
  if (p.matricule) {
    const pris = await db.employee.findFirst({ where: { matricule: p.matricule, ...autres }, select: { nom: true } });
    if (pris) throw new Error(`Le matricule « ${p.matricule} » est déjà celui de ${pris.nom}. Rien n'a été enregistré.`);
  }
  if (p.idExterneIVMS) {
    const autre = await db.employee.findFirst({
      where: { OR: [{ idExterneIVMS: p.idExterneIVMS }, { matricule: p.idExterneIVMS }], ...autres },
      select: { nom: true, matricule: true, idExterneIVMS: true },
    });
    if (autre) {
      const comment = autre.idExterneIVMS === p.idExterneIVMS ? "est déjà l'identifiant de pointeuse de" : "est le matricule de";
      throw new Error(`L'identifiant IVMS « ${p.idExterneIVMS} » ${comment} ${autre.nom} (${autre.matricule}) : la pointeuse confondrait les deux. Rien n'a été enregistré.`);
    }
  }
}

const SELECT_IDENTITE = { id: true, nom: true, matricule: true, telephone: true, dateNaissance: true, actif: true, poste: true, dateEmbauche: true, photoUrl: true } as const;

/**
 * Fiches proches de la saisie (actives et inactives) qui n'ont pas été tranchées (`vus` = « c'est une autre personne »).
 * Réembauche explicite : l'ancienne fiche (celle dont on prend la suite) n'est PAS un doublon.
 */
export async function doublonsNonTranches(db: Db, saisie: IdentiteFiche, vus: ReadonlySet<string>, ancienneFicheId?: string | null) {
  const fiches = await db.employee.findMany({ select: SELECT_IDENTITE, orderBy: { nom: "asc" } });
  return fichesProches(saisie, fiches, { exclureId: ancienneFicheId ?? undefined }).filter((p) => !vus.has(p.fiche.id));
}

/**
 * RÉEMBAUCHE (décision du 2026-10-12 n°10) : une nouvelle fiche prend la suite d'une fiche ARCHIVÉE. Refus lisibles :
 * ancienne fiche introuvable, encore ACTIVE (une personne en poste n'est pas « réembauchée »), ou déjà réembauchée
 * (une seule suite par fiche). Renvoie l'ancienne fiche.
 */
export async function verifierReembauche(db: Db, ancienneFicheId: string) {
  const ancienne = await db.employee.findUnique({
    where: { id: ancienneFicheId },
    select: { id: true, nom: true, matricule: true, actif: true, reembauches: { select: { nom: true, matricule: true }, take: 1 } },
  });
  if (!ancienne) throw new Error("La fiche à réembaucher n'existe plus. Rien n'a été enregistré.");
  if (ancienne.actif) throw new Error(`La fiche de « ${ancienne.nom} » (${ancienne.matricule}) est encore ACTIVE : on ne réembauche qu'une personne dont la fiche est archivée (inactive). Rien n'a été enregistré.`);
  const suite = ancienne.reembauches[0];
  if (suite) throw new Error(`« ${ancienne.nom} » a déjà été réembauché(e) : voir la fiche ${suite.matricule}. Rien n'a été enregistré.`);
  return ancienne;
}

/**
 * LE chemin d'une création de fiche (Direction directe, ou approbation d'une demande) : matricule attribué s'il
 * est vide, unicité, création, doublons écartés tracés, checklist d'intégration. Dans la transaction de l'appelant.
 */
export async function creerFicheTx(tx: Tx, saisie: DonneesCreation, ecartes: string[], userId: string) {
  const data = { ...saisie, ancienneFicheId: saisie.ancienneFicheId || null };
  // Réembauche : revérifiée ICI, dans la transaction de création (Direction directe comme approbation).
  if (data.ancienneFicheId) await verifierReembauche(tx, data.ancienneFicheId);
  if (!data.matricule) {
    const existants = await tx.employee.findMany({ where: { categorie: data.categorie }, select: { matricule: true } });
    data.matricule = genererMatricule(data.nom, data.categorie, existants.map((e) => e.matricule));
  }
  await exigerIdentifiantsLibres(tx, data);
  const nouvel = await tx.employee.create({ data: data as Prisma.EmployeeUncheckedCreateInput });
  if (data.ancienneFicheId) {
    await journaliser(tx, { entite: "Employee", entiteId: nouvel.id, champ: "reembauche", nouvelleValeur: `Réembauche : nouvelle fiche, suite de la fiche archivée ${data.ancienneFicheId}`, userId });
  }
  // Première ligne de l'historique salarial (décision de Sacha, 2026-10-13) : « Salaire d'embauche », à la date d'embauche.
  await enregistrerSalaireEmbauche(tx, { employeeId: nouvel.id, salaire: nouvel.salaireMensuel, poste: nouvel.poste, dateEmbauche: nouvel.dateEmbauche, userId });
  // « C'est une autre personne » : décision tracée, et la paire ne se représente plus (liste des doublons probables).
  if (ecartes.length > 0) {
    await journaliser(tx, { entite: "Employee", entiteId: nouvel.id, champ: JOURNAL_DOUBLON_ECARTE, nouvelleValeur: ecartes.join(","), userId });
  }
  // Checklist d'intégration : copie du modèle d'onboarding pour le nouvel employé.
  const modele = await tx.modeleTacheOnboarding.findMany({ orderBy: { ordre: "asc" } });
  if (modele.length > 0) {
    await tx.tacheOnboarding.createMany({ data: modele.map((m) => ({ employeeId: nouvel.id, libelle: m.libelle, ordre: m.ordre })) });
  }
  return nouvel;
}

/** Crée la demande (hors Direction). Refuse un doublon de demande en attente. Rien n'est créé dans `Employee`. */
export async function creerDemandeCreation(p: { donnees: DonneesCreation; ecartes: string[]; auteur: Acteur }) {
  const ctrl = controlerDonneesCreation(p.donnees);
  if (ctrl) throw new Error(`${ctrl} Rien n'a été enregistré.`);
  return prisma.$transaction(async (tx) => {
    await verrouillerCreations(tx);
    const d = p.donnees;
    if (d.ancienneFicheId) await verifierReembauche(tx, d.ancienneFicheId);
    // Une même personne ne part pas deux fois : même nom, même matricule ou même identifiant de pointeuse déjà en attente.
    const pendantes = await tx.demandeCreationFiche.findMany({ where: { statut: "EN_ATTENTE" } });
    for (const x of pendantes) {
      const autre = donneesPourEcriture(x.donnees);
      const memeMat = d.matricule && autre.matricule === d.matricule;
      const memeIvms = d.idExterneIVMS && (autre.idExterneIVMS === d.idExterneIVMS || autre.matricule === d.idExterneIVMS);
      const memeAncienne = d.ancienneFicheId && autre.ancienneFicheId === d.ancienneFicheId;
      if (memeMat || memeIvms || memeNom(d.nom, x.nom) || memeAncienne) {
        throw new Error(`Une création de fiche « ${x.nom} » est déjà en attente de validation (demandée par ${x.auteurNom} le ${jourKinshasa(x.createdAt)}). Attendez la décision de la Direction — rien n'a été enregistré.`);
      }
    }
    const cree = await tx.demandeCreationFiche.create({
      data: {
        nom: d.nom, matricule: d.matricule || null, donnees: JSON.parse(JSON.stringify(d)) as Prisma.InputJsonValue,
        doublonsEcartes: p.ecartes.join(","), auteurId: p.auteur.id, auteurNom: p.auteur.nom,
      },
    });
    await journaliser(tx, { entite: "DemandeCreationFiche", entiteId: cree.id, champ: "creation", nouvelleValeur: `Nouvelle fiche : ${d.nom}`, userId: p.auteur.id });
    return cree;
  });
}

/** Cloche à la Direction, APRÈS la transaction. */
export async function notifierNouvelleCreation(d: { id: string; nom: string; auteurNom: string }) {
  try {
    await creerNotification({ type: "AUTRE", message: `Nouvelle fiche à valider — ${d.nom} (${d.auteurNom})`.slice(0, 480), lien: LIEN_SECTION, refId: d.id });
  } catch (e) { console.error("[creation-fiche] notification en échec :", e); }
}

async function notifierAuteur(d: { id: string; auteurId: string }, message: string, lien: string) {
  try {
    await prisma.notification.create({ data: { domaine: "RH", destinataireUserId: d.auteurId, type: "AUTRE", message: message.slice(0, 480), lien, refId: `decision:${d.id}` } });
    await envoyerPush([d.auteurId], { title: "Création de fiche traitée par la Direction", body: message.slice(0, 180), url: lien, tag: `decision-${d.id}` });
  } catch (e) { console.error("[creation-fiche] notification de l'auteur en échec :", e); }
}

async function approuverUne(id: string, decideur: Acteur, maintenant: Date) {
  return prisma.$transaction(async (tx) => {
    await verrouillerCreations(tx);
    const d = await tx.demandeCreationFiche.findUnique({ where: { id } });
    if (!d) throw new Error("Demande introuvable.");
    if (d.statut !== "EN_ATTENTE") throw new Error("Demande déjà traitée.");
    const donnees = donneesPourEcriture(d.donnees);
    const ctrl = controlerDonneesCreation(donnees);
    if (ctrl) throw new Error(`${ctrl} Rien n'a été créé ; refusez la demande.`);
    // Anti-doublon revérifié : une fiche proche apparue depuis la demande (et non tranchée à la saisie) bloque la création.
    const vus = new Set(d.doublonsEcartes.split(",").filter(Boolean));
    const proches = await doublonsNonTranches(tx, donnees, vus, donnees.ancienneFicheId);
    if (proches.length > 0) {
      const liste = proches.map((p) => `« ${p.fiche.nom} »${p.fiche.actif === false ? " (inactive)" : ""} — ${p.motifs.map((m) => libelleMotif(m, p.memeNom)).join(", ")}`).join(" ; ");
      throw new Error(`${proches.length > 1 ? "Des fiches proches existent" : "Une fiche proche existe"} : ${liste}. Rien n'a été créé : refusez la demande, ou créez la fiche vous-même depuis « Nouvel employé » en confirmant « C'est une autre personne ».`);
    }
    const nouvel = await creerFicheTx(tx, donnees, [...vus], decideur.id).catch(lisibleSiDoublon);
    await tx.demandeCreationFiche.update({ where: { id }, data: { statut: "VALIDEE", decideurId: decideur.id, decideurNom: decideur.nom, decideLe: maintenant, employeeId: nouvel.id } });
    await journaliser(tx, { entite: "Employee", entiteId: nouvel.id, champ: "creation", nouvelleValeur: `Fiche créée (demande ${id} de ${d.auteurNom}, validée)`, userId: decideur.id });
    await journaliser(tx, { entite: "DemandeCreationFiche", entiteId: id, champ: "statut", nouvelleValeur: "VALIDEE", userId: decideur.id });
    return { d, nouvel };
  }, { timeout: 15_000 });
}

function messageLisible(e: unknown): string {
  const brute = e instanceof Error && /^PrismaClient/.test(e.name);
  if (e instanceof Error && !brute && !/\n/.test(e.message) && e.message.length < 600) return e.message;
  return "la base a refusé la création (valeur inattendue). Rien n'a été créé : refusez la demande, l'auteur pourra en refaire une.";
}

/** Parmi des identifiants, ceux qui sont des demandes de CRÉATION (le reste sont des modifications de fiche). */
export async function idsDemandesCreation(ids: string[]): Promise<Set<string>> {
  const l = await prisma.demandeCreationFiche.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(l.map((x) => x.id));
}

export async function approuverCreations(ids: string[], decideur: Acteur, maintenant: Date = new Date()): Promise<RapportFiche> {
  if (!estDirection(decideur)) throw new Error("Réservé à la Direction.");
  const r: RapportFiche = { traitees: 0, echecs: [], avertissements: [] };
  for (const id of [...new Set(ids)]) {
    try {
      const { d, nouvel } = await approuverUne(id, decideur, maintenant);
      r.traitees++;
      await supprimerNotificationsPour(id);
      await notifierAuteur(d, `Votre création de la fiche de ${nouvel.nom} est validée (matricule ${nouvel.matricule}).`, `/employes/${nouvel.id}`);
    } catch (e) {
      const nom = (await prisma.demandeCreationFiche.findUnique({ where: { id }, select: { nom: true } }))?.nom ?? "Demande";
      r.echecs.push(`Nouvelle fiche ${nom} : ${messageLisible(e)}`);
    }
  }
  return r;
}

export async function refuserCreations(ids: string[], motifBrut: unknown, decideur: Acteur, maintenant: Date = new Date()): Promise<RapportFiche> {
  if (!estDirection(decideur)) throw new Error("Réservé à la Direction.");
  const motif = typeof motifBrut === "string" ? motifBrut.trim() : "";
  if (!motif) return { traitees: 0, echecs: ["Un motif est obligatoire pour refuser une création de fiche."], avertissements: [] };
  if (motif.length > MAX_MOTIF_REFUS) return { traitees: 0, echecs: [`Le motif du refus est trop long (${motif.length} caractères, ${MAX_MOTIF_REFUS} au plus).`], avertissements: [] };
  const r: RapportFiche = { traitees: 0, echecs: [], avertissements: [] };
  for (const id of [...new Set(ids)]) {
    const d = await prisma.demandeCreationFiche.findUnique({ where: { id } });
    if (!d) continue;
    const { count } = await prisma.demandeCreationFiche.updateMany({
      where: { id, statut: "EN_ATTENTE" },
      data: { statut: "REFUSEE", decideurId: decideur.id, decideurNom: decideur.nom, decideLe: maintenant, motifRefus: motif },
    });
    if (count === 0) { r.echecs.push(`Nouvelle fiche ${d.nom} : demande déjà traitée.`); continue; }
    await journaliser(prisma, { entite: "DemandeCreationFiche", entiteId: id, champ: "statut", nouvelleValeur: `REFUSEE — ${motif}`, userId: decideur.id });
    r.traitees++;
    await supprimerNotificationsPour(id);
    await notifierAuteur(d, `Votre création de la fiche de ${d.nom} est refusée : ${motif}`, "/employes");
  }
  return r;
}

/** Créations en attente (liste des employés, « À valider »). */
export async function creationsEnAttente() {
  const ds = await prisma.demandeCreationFiche.findMany({ where: { statut: "EN_ATTENTE" }, orderBy: { createdAt: "asc" } });
  const anciennes = await nomsAnciennesFiches(ds.map((d) => d.donnees));
  return ds.map((d) => {
    const ancienneId = (d.donnees as { ancienneFicheId?: string | null }).ancienneFicheId ?? null;
    return { id: d.id, nom: d.nom, auteurNom: d.auteurNom, le: jourKinshasa(d.createdAt), reembauche: Boolean(ancienneId), lignes: lignesCreation(d.donnees, ancienneId ? anciennes.get(ancienneId) : null) };
  });
}

/** Noms des fiches archivées citées par des demandes de réembauche (id → nom). */
export async function nomsAnciennesFiches(donnees: unknown[]): Promise<Map<string, string>> {
  const ids = [...new Set(donnees.map((d) => (d as { ancienneFicheId?: string | null } | null)?.ancienneFicheId).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return new Map();
  const l = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, nom: true, matricule: true } });
  return new Map(l.map((e) => [e.id, `${e.nom} (${e.matricule})`]));
}
