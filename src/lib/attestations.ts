import "server-only";

import { Prisma, type PrismaClient, type TypeAttestation } from "@prisma/client";
import { salaireNetUSD } from "@/lib/paie-net";
import { libelleTypeContrat } from "@/lib/contrats-classement";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { journaliser } from "@/lib/audit";
import { televerserFichier } from "@/lib/storage";
import { compteSalarieDe, creerNotification, notifierSalarie, supprimerNotificationsPour } from "@/lib/notifications";
import { rendreAttestationPdf } from "@/lib/pdf/attestation-buffer";
import { NOM_TYPE_ATTESTATION, numeroAttestation, type DonneesAttestation } from "@/lib/attestations-donnees";

// ATTESTATIONS — demande, délivrance numérotée, refus (spec 2026-09-28, lot 4).
//
// Le client Prisma est reçu en PARAMÈTRE (idiome de `lib/signature.ts`) : les tests d'intégration
// injectent leur base embarquée, et un test de concurrence peut passer DEUX clients.
//
// Les messages de refus sont des VALEURS (`{ ok: false, motif }`), jamais des exceptions : une
// délivrance en lot rend un message par ligne.

type Lecture = Prisma.TransactionClient;
export type Refus = { ok: false; motif: string };

const usd = (v: { toString(): string } | number) => Number(v.toString()).toFixed(2);
const jour = (d: Date) => new Date(d).toISOString().slice(0, 10);

/**
 * L'instantané de ce que l'attestation imprimera — ou le motif lisible pour lequel elle ne peut pas
 * être délivrée. Relu en base à chaque appel : c'est lui qui fait la vérification d'éligibilité au
 * moment de DÉLIVRER, pas au moment de la demande.
 */
export async function instantaneAttestation(
  db: Lecture,
  employeeId: string,
  type: TypeAttestation,
  maintenant: Date,
): Promise<{ ok: true; donnees: DonneesAttestation; payrollLineId: string | null } | Refus> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { nom: true, sexe: true, matricule: true, poste: true, contrat: true, actif: true, dateEmbauche: true },
  });
  if (!emp) return { ok: false, motif: "Salarié introuvable." };

  const contrats = await db.contrat.findMany({
    where: { employeeId },
    orderBy: [{ dateDebut: "desc" }, { createdAt: "desc" }],
    select: { type: true, poste: true, dateDebut: true, dateFin: true },
  });
  const dernier = contrats[0] ?? null;
  const typeContrat = dernier?.type ?? emp.contrat;

  if (!emp.dateEmbauche) return { ok: false, motif: "Date d'embauche inconnue : renseignez-la sur la fiche avant de délivrer l'attestation." };

  // Sorti : date de sortie (fin de contrat enregistrée), sinon fin du dernier contrat. Sans l'une
  // ni l'autre, on REFUSE plutôt que d'imprimer « jusqu'au — ».
  let dateSortie: string | null = null;
  if (!emp.actif) {
    const fin = await db.finContrat.findFirst({ where: { employeeId }, orderBy: { dateFin: "desc" }, select: { dateFin: true } });
    const d = fin?.dateFin ?? dernier?.dateFin ?? null;
    if (!d) {
      return { ok: false, motif: "Date de sortie inconnue : enregistrez la fin de contrat (ou sa date de fin) avant de délivrer l'attestation." };
    }
    dateSortie = jour(d);
  }

  const donnees: DonneesAttestation = {
    type,
    nom: emp.nom,
    sexe: emp.sexe,
    matricule: emp.matricule,
    poste: (dernier?.poste || emp.poste).trim(),
    typeContrat: libelleTypeContrat(typeContrat),
    dateEmbauche: jour(emp.dateEmbauche),
    enPoste: emp.actif,
    dateSortie,
  };

  if (type === "SALAIRE") {
    if (typeContrat === "STAGE" || typeContrat === "INTERIM") {
      return { ok: false, motif: "Pas d'attestation de salaire pour un stagiaire ou un intérimaire." };
    }
    // La DERNIÈRE paie arrêtée par la Direction : un brouillon plus récent n'est pas un salaire perçu.
    const ligne = await db.payrollLine.findFirst({
      where: { employeeId, statutPaiement: { in: ["VALIDE", "PAYE"] } },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
      include: { payrollRun: { select: { mois: true, annee: true, tauxChangeUtilise: true } } },
    });
    if (!ligne) {
      return { ok: false, motif: "Aucune paie validée : l'attestation de salaire reprend la dernière paie validée ou payée." };
    }
    donnees.salaire = {
      mois: ligne.payrollRun.mois,
      annee: ligne.payrollRun.annee,
      netUSD: usd(salaireNetUSD(ligne)),
      brutUSD: usd(ligne.salBrutUSD),
      allocationsUSD: usd(ligne.allocFamilialeUSD),
      tauxChange: usd(ligne.payrollRun.tauxChangeUtilise),
    };
    return { ok: true, donnees, payrollLineId: ligne.id };
  }

  if (type === "STAGE") {
    const stage = await db.contrat.findFirst({
      where: { employeeId, type: "STAGE" },
      orderBy: [{ dateDebut: "desc" }, { createdAt: "desc" }],
      select: { dateDebut: true, dateFin: true, poste: true },
    });
    if (!stage) return { ok: false, motif: "Aucun contrat de stage : pas d'attestation de stage." };
    donnees.stage = { debut: jour(stage.dateDebut), fin: stage.dateFin ? jour(stage.dateFin) : null };
    if (stage.poste?.trim()) donnees.poste = stage.poste.trim();
  }

  return { ok: true, donnees, payrollLineId: null };
}

/** Verrou de la ligne Employee : sérialise les demandes d'un même salarié. */
async function verrouillerEmploye(tx: Lecture, employeeId: string) {
  await tx.$queryRaw`SELECT "id" FROM "public"."Employee" WHERE "id" = ${employeeId} FOR UPDATE`;
}

/**
 * Le salarié DEMANDE une attestation. Une seule demande EN COURS par type : la règle est vérifiée
 * sous verrou de la ligne Employee — deux demandes simultanées (double clic, deux onglets) ne
 * peuvent pas passer toutes les deux la vérification.
 *
 * L'éligibilité est regardée dès la demande, pour dire tout de suite au salarié ce qui manque ; la
 * Direction la revérifie à la délivrance (la situation a pu changer entre-temps).
 */
export async function demanderAttestation(
  db: PrismaClient,
  p: { employeeId: string; type: TypeAttestation; motif: string | null; parId: string },
): Promise<{ ok: true; id: string } | Refus> {
  const r = await db.$transaction(async (tx): Promise<{ ok: true; id: string; nom: string } | Refus> => {
    await verrouillerEmploye(tx, p.employeeId);
    const enCours = await tx.attestation.findFirst({ where: { employeeId: p.employeeId, type: p.type, statut: "DEMANDEE" }, select: { id: true } });
    if (enCours) return { ok: false, motif: `Une demande d'${NOM_TYPE_ATTESTATION[p.type]} est déjà en cours.` };
    const eligible = await instantaneAttestation(tx, p.employeeId, p.type, new Date());
    if (!eligible.ok) return eligible;
    const a = await tx.attestation.create({
      data: { employeeId: p.employeeId, type: p.type, motif: p.motif?.trim() || null, demandeParId: p.parId },
    });
    await journaliser(tx, { entite: "Attestation", entiteId: a.id, champ: "demande", nouvelleValeur: p.type, userId: p.parId });
    return { ok: true, id: a.id, nom: eligible.donnees.nom };
  });
  if (!r.ok) return r;

  try {
    await creerNotification({
      type: "AUTRE",
      message: `${r.nom} demande une ${NOM_TYPE_ATTESTATION[p.type]}.`,
      lien: "/a-valider",
      refId: `attestation:${r.id}`,
    });
  } catch {
    // La demande est enregistrée ; elle apparaît dans « Demandes de validation » de toute façon.
  }
  return { ok: true, id: r.id };
}

/** Prochain rang de l'année — `INSERT … ON CONFLICT DO UPDATE … RETURNING` : la ligne reste verrouillée jusqu'au COMMIT. */
async function prochainRang(tx: Lecture, annee: number): Promise<number> {
  const [{ dernier }] = await tx.$queryRaw<{ dernier: number }[]>`
    INSERT INTO "public"."CompteurAttestation" ("annee", "dernier") VALUES (${annee}, 1)
    ON CONFLICT ("annee") DO UPDATE SET "dernier" = "CompteurAttestation"."dernier" + 1
    RETURNING "dernier"`;
  return Number(dernier);
}

export type ResultatDelivrance = { ok: true; id: string; numero: string } | (Refus & { refusee?: boolean });

/**
 * DÉLIVRE une attestation : une demande existante (`attestationId`) ou, directement par la
 * Direction depuis la fiche, une attestation neuve (`employeeId` + `type`).
 *
 * Dans UNE transaction : verrou de la demande, vérification d'éligibilité, numéro tiré de la
 * séquence de l'année (année de Kinshasa), instantané, journal. Une demande devenue inéligible est
 * REFUSÉE avec son motif (et `refusee: true`) ; une délivrance directe inéligible n'écrit rien.
 *
 * Après la transaction : l'exemplaire est rendu puis FIGÉ dans le stockage privé, et le salarié est
 * prévenu. Ni l'un ni l'autre n'annule la délivrance : sans exemplaire figé, le PDF se régénère à
 * l'identique depuis l'instantané (`donnees`), jamais depuis la fiche du jour.
 */
export async function delivrerAttestation(
  db: PrismaClient,
  p: { attestationId?: string; employeeId?: string; type?: TypeAttestation; parId: string; maintenant?: Date },
): Promise<ResultatDelivrance> {
  const maintenant = p.maintenant ?? new Date();
  const r = await db.$transaction(async (tx): Promise<
    | { ok: true; id: string; numero: string; donnees: DonneesAttestation; employeeId: string; type: TypeAttestation }
    | (Refus & { refusee?: boolean; employeeId?: string; type?: TypeAttestation; id?: string })
  > => {
    let employeeId: string;
    let type: TypeAttestation;
    if (p.attestationId) {
      await tx.$queryRaw`SELECT "id" FROM "public"."Attestation" WHERE "id" = ${p.attestationId} FOR UPDATE`;
      const a = await tx.attestation.findUnique({ where: { id: p.attestationId } });
      if (!a) return { ok: false, motif: "Demande introuvable." };
      if (a.statut !== "DEMANDEE") return { ok: false, motif: "Cette demande a déjà été traitée." };
      employeeId = a.employeeId;
      type = a.type;
    } else {
      if (!p.employeeId || !p.type) return { ok: false, motif: "Salarié ou type d'attestation manquant." };
      employeeId = p.employeeId;
      type = p.type;
      // Une demande du même type attend déjà : la délivrance directe la SATISFAIT plutôt que de
      // laisser une demande orpheline dans « Demandes de validation ».
      await verrouillerEmploye(tx, employeeId);
      const enAttente = await tx.attestation.findFirst({ where: { employeeId, type, statut: "DEMANDEE" }, select: { id: true } });
      if (enAttente) {
        await tx.$queryRaw`SELECT "id" FROM "public"."Attestation" WHERE "id" = ${enAttente.id} FOR UPDATE`;
        p = { ...p, attestationId: enAttente.id };
      }
    }

    const eligible = await instantaneAttestation(tx, employeeId, type, maintenant);
    if (!eligible.ok) {
      if (!p.attestationId) return eligible;
      await tx.attestation.update({ where: { id: p.attestationId }, data: { statut: "REFUSEE", motifRefus: eligible.motif, delivreeParId: p.parId } });
      await journaliser(tx, { entite: "Attestation", entiteId: p.attestationId, champ: "refus", nouvelleValeur: eligible.motif, userId: p.parId });
      return { ...eligible, refusee: true, employeeId, type, id: p.attestationId };
    }

    const numero = numeroAttestation(jourCivilKinshasa(maintenant).getUTCFullYear(), await prochainRang(tx, jourCivilKinshasa(maintenant).getUTCFullYear()));
    const data = {
      statut: "DELIVREE" as const,
      numero,
      delivreeLe: maintenant,
      delivreeParId: p.parId,
      payrollLineId: eligible.payrollLineId,
      donnees: eligible.donnees as unknown as Prisma.InputJsonValue,
    };
    const a = p.attestationId
      ? await tx.attestation.update({ where: { id: p.attestationId }, data })
      : await tx.attestation.create({ data: { ...data, employeeId, type, demandeLe: maintenant, demandeParId: p.parId } });
    await journaliser(tx, { entite: "Attestation", entiteId: a.id, champ: "delivrance", nouvelleValeur: numero, userId: p.parId });
    return { ok: true, id: a.id, numero, donnees: eligible.donnees, employeeId, type };
  });

  if (!r.ok) {
    if (r.refusee && r.id && r.employeeId && r.type) {
      await apresTraitement(r.id, r.employeeId, `Votre demande d'${NOM_TYPE_ATTESTATION[r.type]} a été refusée : ${r.motif}`);
      return { ok: false, motif: r.motif, refusee: true };
    }
    return { ok: false, motif: r.motif };
  }

  await figerAttestation(db, { id: r.id, donnees: r.donnees, numero: r.numero, delivreeLe: maintenant });
  await apresTraitement(r.id, r.employeeId, `Votre ${NOM_TYPE_ATTESTATION[r.type]} (${r.numero}) est disponible`);
  return { ok: true, id: r.id, numero: r.numero };
}

/** Rend et fige l'exemplaire. Silencieux en cas d'échec : l'instantané suffit à le régénérer. */
export async function figerAttestation(
  db: PrismaClient,
  a: { id: string; donnees: DonneesAttestation; numero: string; delivreeLe: Date },
): Promise<void> {
  try {
    const pdf = await rendreAttestationPdf(a);
    const url = await televerserFichier(`attestations/${a.id}-${a.delivreeLe.getTime()}.pdf`, pdf, "application/pdf");
    await db.attestation.update({ where: { id: a.id }, data: { pdfUrl: url } });
  } catch {
    // Stockage ou rendu en panne : la délivrance est acquise, le PDF sera régénéré à la lecture.
  }
}

/** Retire la notification de la Direction et prévient le salarié (cloche + push). Jamais bloquant. */
async function apresTraitement(attestationId: string, employeeId: string, message: string): Promise<void> {
  try {
    await supprimerNotificationsPour(`attestation:${attestationId}`);
    const userId = await compteSalarieDe(employeeId);
    if (userId) await notifierSalarie(userId, { type: "AUTRE", message, lien: "/espace/attestations", refId: `attestation:${attestationId}:traitee` });
  } catch {
    // La décision est enregistrée ; le salarié la verra dans « Mes attestations ».
  }
}

/** REFUSE une demande, avec un motif obligatoire. */
export async function refuserAttestation(
  db: PrismaClient,
  p: { id: string; motif: string; parId: string },
): Promise<{ ok: true } | Refus> {
  const motif = p.motif.trim();
  if (!motif) return { ok: false, motif: "Indiquez le motif du refus." };
  const r = await db.$transaction(async (tx) => {
    const a = await tx.attestation.findUnique({ where: { id: p.id }, select: { employeeId: true, type: true } });
    if (!a) return null;
    // Conditionné au statut : une demande délivrée entre-temps ne se refuse pas.
    const { count } = await tx.attestation.updateMany({
      where: { id: p.id, statut: "DEMANDEE" },
      data: { statut: "REFUSEE", motifRefus: motif, delivreeParId: p.parId },
    });
    if (count !== 1) return "traitee" as const;
    await journaliser(tx, { entite: "Attestation", entiteId: p.id, champ: "refus", nouvelleValeur: motif, userId: p.parId });
    return a;
  });
  if (r === null) return { ok: false, motif: "Demande introuvable." };
  if (r === "traitee") return { ok: false, motif: "Cette demande a déjà été traitée." };
  await apresTraitement(p.id, r.employeeId, `Votre demande d'${NOM_TYPE_ATTESTATION[r.type]} a été refusée : ${motif}`);
  return { ok: true };
}
