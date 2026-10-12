import "server-only";

import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { journaliser } from "@/lib/audit";
import { creerNotification, supprimerNotificationsPour } from "@/lib/notifications";
import { envoyerPush } from "@/lib/push";
import { enregistrerChangementSalaire } from "@/lib/historique-salaire";
import { MAX_MOTIF_REFUS } from "@/lib/conges-liste";
import { MOIS_FR } from "@/lib/dates-fr";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa, jourKinshasa } from "@/lib/heure-kinshasa";
import { canonique, libelleChamp, libelleValeur, ligneChangement, lireChangements, versDonnee, type Changement } from "@/lib/fiche-sensible";

// DEMANDES DE MODIFICATION DE FICHE SALARIÉ (2026-10-12) — création, approbation, refus.
//
//  - Un rôle autre que la Direction (RH = MANAGER) qui change un champ SENSIBLE (lib/fiche-sensible)
//    crée une demande : rien n'est appliqué à la fiche.
//  - UNE seule demande EN ATTENTE par champ et par salarié : une 2e demande qui touche un champ déjà
//    en attente est REFUSÉE (en le nommant) — jamais un remplacement silencieux d'une demande que la
//    Direction a peut-être déjà ouverte. Tenu sous verrou transactionnel par salarié.
//  - Approuver applique la demande dans UNE transaction : chaque champ doit valoir encore ce qu'il
//    valait à la demande, sinon la demande est PÉRIMÉE et rien n'est écrit (la Direction la refuse).
//    Le salaire passe par le chemin historisé de « Changer le salaire ». Paie du mois validée : la
//    fiche change, le bulletin figé non — c'est dit (`noteDecision`), jamais recalculé en silence.
//  - Refuser exige un motif ; l'auteur est prévenu (cloche personnelle + push).

type Tx = Prisma.TransactionClient;
export type Acteur = { id: string; nom: string; role: Role };
export const estDirection = (u: { role: Role }) => u.role === "ADMIN";
export const LIEN_SECTION = "/a-valider#modifications-fiches";

/** Demande périmée : l'appliquer écraserait une valeur que la demande n'a pas vue. Rien n'est écrit. */
export class DemandePerimee extends Error {
  constructor(detail: string) { super(`Demande périmée : ${detail} — rien n'a été appliqué ; refusez-la (l'auteur pourra en refaire une à jour).`); }
}

export async function verrouillerFiche(tx: Tx, employeeId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fiche:${employeeId}`}))::text AS verrou`;
}

const jj = (d: Date) => jourKinshasa(d);

/** Crée la demande dans la transaction de l'appelant (qui enregistre aussi les champs non sensibles). */
export async function creerDemandeFicheTx(
  tx: Tx,
  p: { employeeId: string; changements: Changement[]; origine: "MODIFIER" | "CHANGER_SALAIRE"; motif?: string | null; auteur: Acteur },
) {
  if (p.changements.length === 0) throw new Error("Aucun changement à soumettre.");
  await verrouillerFiche(tx, p.employeeId);
  const enAttente = await tx.demandeModifFiche.findMany({ where: { employeeId: p.employeeId, statut: "EN_ATTENTE" }, orderBy: { createdAt: "asc" } });
  const voulus = new Set(p.changements.map((c) => c.champ));
  for (const d of enAttente) {
    const communs = lireChangements(d.changements).filter((c) => voulus.has(c.champ));
    if (communs.length > 0) {
      throw new Error(`${communs.map((c) => libelleChamp(c.champ)).join(", ")} : une modification est déjà en attente de validation (demandée par ${d.auteurNom} le ${jj(d.createdAt)}). Attendez la décision de la Direction — rien n'a été enregistré.`);
    }
  }
  const d = await tx.demandeModifFiche.create({
    data: {
      employeeId: p.employeeId, origine: p.origine, changements: p.changements as unknown as Prisma.InputJsonValue,
      motif: p.motif?.trim().slice(0, 500) || null, auteurId: p.auteur.id, auteurNom: p.auteur.nom,
    },
  });
  await journaliser(tx, { entite: "DemandeModifFiche", entiteId: d.id, champ: "creation", nouvelleValeur: p.changements.map(ligneChangement).join(" ; ").slice(0, 1000), userId: p.auteur.id });
  return d;
}

/** Cloche + e-mail + push à la Direction, APRÈS la transaction (jamais l'annonce d'une demande annulée). */
export async function notifierNouvelleDemandeFiche(d: { id: string; auteurNom: string; changements: unknown }, nomSalarie: string) {
  try {
    const ch = lireChangements(d.changements);
    await creerNotification({
      type: "AUTRE",
      message: `Modification de fiche à valider — ${nomSalarie} : ${ch.map((c) => libelleChamp(c.champ)).join(", ")} (${d.auteurNom})`.slice(0, 480),
      lien: LIEN_SECTION,
      refId: d.id,
    });
  } catch (e) { console.error("[demandes-fiche] notification en échec :", e); }
}

async function notifierAuteur(d: { id: string; auteurId: string; employeeId: string }, message: string) {
  try {
    await prisma.notification.create({ data: { domaine: "RH", destinataireUserId: d.auteurId, type: "AUTRE", message: message.slice(0, 480), lien: `/employes/${d.employeeId}`, refId: `decision:${d.id}` } });
    await envoyerPush([d.auteurId], { title: "Modification de fiche traitée par la Direction", body: message.slice(0, 180), url: `/employes/${d.employeeId}`, tag: `decision-${d.id}` });
  } catch (e) { console.error("[demandes-fiche] notification de l'auteur en échec :", e); }
}

/** Ce que la décision doit dire de la paie : mois validé (bulletin figé inchangé) ou en cours (recalculé). */
async function notePaie(tx: Tx, maintenant: Date): Promise<string | null> {
  const mois = numeroMoisCourantKinshasa(maintenant);
  const annee = anneeCouranteKinshasa(maintenant);
  const prec = mois === 1 ? { mois: 12, annee: annee - 1 } : { mois: mois - 1, annee };
  const runs = await tx.payrollRun.findMany({ where: { OR: [{ mois, annee }, prec] }, select: { mois: true, annee: true, statut: true } });
  const parts: string[] = [];
  for (const r of runs.sort((a, b) => a.annee * 100 + a.mois - (b.annee * 100 + b.mois))) {
    const nom = `${MOIS_FR[r.mois - 1]} ${r.annee}`;
    parts.push(r.statut === "VALIDE"
      ? `La paie de ${nom} est validée : ses bulletins figés ne changent pas, la modification vaut pour les paies suivantes.`
      : `La paie de ${nom} n'est pas validée : elle sera recalculée avec ces valeurs.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

export type RapportFiche = { traitees: number; echecs: string[]; avertissements: string[] };

/** Applique UNE demande (Direction). Lève `DemandePerimee` / une erreur lisible ; rien n'est écrit alors. */
async function approuverUne(id: string, decideur: Acteur, maintenant: Date) {
  return prisma.$transaction(async (tx) => {
    const d = await tx.demandeModifFiche.findUnique({ where: { id }, include: { employee: { select: { nom: true } } } });
    if (!d) throw new Error("Demande introuvable.");
    await verrouillerFiche(tx, d.employeeId);
    if (d.statut !== "EN_ATTENTE") throw new Error("Demande déjà traitée.");
    const fiche = await tx.employee.findUniqueOrThrow({ where: { id: d.employeeId } });
    const ch = lireChangements(d.changements);
    for (const c of ch) {
      const actuel = canonique(c.champ, (fiche as Record<string, unknown>)[c.champ]);
      if (actuel !== c.avant) {
        throw new DemandePerimee(`${libelleChamp(c.champ)} vaut maintenant ${libelleValeur(c.champ, actuel)} (${libelleValeur(c.champ, c.avant)} au moment de la demande)`);
      }
    }
    const salaire = ch.find((c) => c.champ === "salaireMensuel");
    const poste = ch.find((c) => c.champ === "poste");
    if (salaire || poste) {
      // Le salaire (et le poste qui l'accompagne) : même chemin historisé que « Changer le salaire ».
      await enregistrerChangementSalaire(tx, {
        employeeId: d.employeeId,
        ancienSalaire: fiche.salaireMensuel,
        nouveauSalaire: salaire ? Number(versDonnee("salaireMensuel", salaire.apres)) : Number(fiche.salaireMensuel),
        ancienPoste: fiche.poste,
        nouveauPoste: poste?.apres ?? fiche.poste,
        motif: `${d.motif || "Modification de la fiche"} (demandée par ${d.auteurNom}, validée par la Direction)`,
        userId: decideur.id,
      });
    }
    const autres = ch.filter((c) => c.champ !== "salaireMensuel" && c.champ !== "poste");
    if (autres.length > 0) {
      await tx.employee.update({ where: { id: d.employeeId }, data: Object.fromEntries(autres.map((c) => [c.champ, versDonnee(c.champ, c.apres)])) });
      for (const c of autres) {
        await journaliser(tx, { entite: "Employee", entiteId: d.employeeId, champ: c.champ, ancienneValeur: libelleValeur(c.champ, c.avant), nouvelleValeur: `${libelleValeur(c.champ, c.apres)} (demande ${d.id} de ${d.auteurNom}, validée)`, userId: decideur.id });
      }
    }
    const note = await notePaie(tx, maintenant);
    await tx.demandeModifFiche.update({ where: { id }, data: { statut: "VALIDEE", decideurId: decideur.id, decideurNom: decideur.nom, decideLe: maintenant, noteDecision: note } });
    await journaliser(tx, { entite: "DemandeModifFiche", entiteId: id, champ: "statut", nouvelleValeur: "VALIDEE", userId: decideur.id });
    return { d, ch, note };
  }, { timeout: 15_000 });
}

/** Approuve des demandes (Direction) : chacune dans sa transaction ; un échec est NOMMÉ et ne bloque pas les autres. */
export async function approuverDemandesFiche(ids: string[], decideur: Acteur, maintenant: Date = new Date()): Promise<RapportFiche> {
  if (!estDirection(decideur)) throw new Error("Réservé à la Direction.");
  const r: RapportFiche = { traitees: 0, echecs: [], avertissements: [] };
  for (const id of [...new Set(ids)]) {
    try {
      const { d, ch, note } = await approuverUne(id, decideur, maintenant);
      r.traitees++;
      if (note) r.avertissements.push(`${d.employee.nom} : ${note}`);
      await supprimerNotificationsPour(id);
      await notifierAuteur(d, `Votre modification de la fiche de ${d.employee.nom} est validée : ${ch.map(ligneChangement).join(" ; ")}.`);
    } catch (e) {
      const nom = (await prisma.demandeModifFiche.findUnique({ where: { id }, include: { employee: { select: { nom: true } } } }))?.employee.nom ?? "Demande";
      r.echecs.push(`${nom} : ${e instanceof Error ? e.message : "erreur inattendue"}`);
    }
  }
  return r;
}

/** Refuse des demandes (Direction) avec UN motif obligatoire ; l'auteur est prévenu. */
export async function refuserDemandesFiche(ids: string[], motifBrut: unknown, decideur: Acteur, maintenant: Date = new Date()): Promise<RapportFiche> {
  if (!estDirection(decideur)) throw new Error("Réservé à la Direction.");
  const motif = typeof motifBrut === "string" ? motifBrut.trim() : "";
  if (!motif) return { traitees: 0, echecs: ["Un motif est obligatoire pour refuser une modification de fiche."], avertissements: [] };
  if (motif.length > MAX_MOTIF_REFUS) return { traitees: 0, echecs: [`Le motif du refus est trop long (${motif.length} caractères, ${MAX_MOTIF_REFUS} au plus).`], avertissements: [] };
  const r: RapportFiche = { traitees: 0, echecs: [], avertissements: [] };
  for (const id of [...new Set(ids)]) {
    const d = await prisma.demandeModifFiche.findUnique({ where: { id }, include: { employee: { select: { nom: true } } } });
    if (!d) continue;
    const { count } = await prisma.demandeModifFiche.updateMany({
      where: { id, statut: "EN_ATTENTE" },
      data: { statut: "REFUSEE", decideurId: decideur.id, decideurNom: decideur.nom, decideLe: maintenant, motifRefus: motif },
    });
    if (count === 0) { r.echecs.push(`${d.employee.nom} : demande déjà traitée.`); continue; }
    await journaliser(prisma, { entite: "DemandeModifFiche", entiteId: id, champ: "statut", nouvelleValeur: `REFUSEE — ${motif}`, userId: decideur.id });
    r.traitees++;
    await supprimerNotificationsPour(id);
    const ch = lireChangements(d.changements);
    await notifierAuteur(d, `Votre modification de la fiche de ${d.employee.nom} (${ch.map((c) => libelleChamp(c.champ)).join(", ")}) est refusée : ${motif}`);
  }
  return r;
}

/** Demandes en attente d'un salarié (bandeau de la fiche). */
export async function demandesFicheEnAttente(employeeId: string) {
  const ds = await prisma.demandeModifFiche.findMany({ where: { employeeId, statut: "EN_ATTENTE" }, orderBy: { createdAt: "asc" } });
  return ds.map((d) => ({ id: d.id, auteurNom: d.auteurNom, le: jj(d.createdAt), motif: d.motif, lignes: lireChangements(d.changements).map(ligneChangement) }));
}
