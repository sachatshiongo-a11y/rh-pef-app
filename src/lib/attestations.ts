import "server-only";

import { Prisma, type PrismaClient, type TypeAttestation } from "@prisma/client";
import { salaireNetHabituelUSD, brutHorsTransportUSD } from "@/lib/paie-net";
import { lireMoisEffet } from "@/lib/config";
import { MOIS_FR } from "@/lib/dates-fr";
import { libelleTypeContrat } from "@/lib/contrats-classement";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { journaliser } from "@/lib/audit";
import { televerserFichier } from "@/lib/storage";
import { compteSalarieDe, creerNotification, notifierSalarie, supprimerNotificationsPour } from "@/lib/notifications";
import { NOM_TYPE_ATTESTATION, numeroAttestation, type DonneesAttestation } from "@/lib/attestations-donnees";

// ATTESTATIONS — demande, délivrance numérotée, refus (spec 2026-09-28, lot 4).
//
// Le client Prisma est reçu en PARAMÈTRE (idiome de `lib/signature.ts`) : les tests d'intégration
// injectent leur base embarquée, et un test de concurrence peut passer DEUX clients.
//
// Les messages de refus sont des VALEURS (`{ ok: false, motif }`), jamais des exceptions : une
// délivrance en lot rend un message par ligne.

type Lecture = Prisma.TransactionClient;
/**
 * `aCompleter` : le refus tient à une donnée MANQUANTE de la fiche (date d'embauche, date de
 * sortie) — la Direction est prévenue qu'elle doit la compléter.
 */
export type Refus = { ok: false; motif: string; aCompleter?: boolean };

/**
 * À partir de quel mois une paie fait foi pour l'attestation de salaire : la date d'effet de la
 * paie au planning (`paie_reference_planning_depuis`, exercice actif), relue par `lireMoisEffet`.
 * Décision de la Direction (2026-09-28) : les paies antérieures (juin…) ne font pas foi. `null` si
 * le paramètre n'est pas posé — toute paie validée compte alors.
 */
async function moisEffetAttestationSalaire(db: Lecture): Promise<number | null> {
  const p = await db.parametreLegal.findFirst({
    where: { cle: "paie_reference_planning_depuis", exercice: { actif: true } },
    select: { valeur: true },
  });
  return lireMoisEffet(p?.valeur == null ? null : Number(p.valeur));
}

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

  if (!emp.dateEmbauche) {
    return { ok: false, motif: "Votre date d'embauche n'est pas enregistrée : la Direction doit la compléter.", aCompleter: true };
  }

  // Sorti : date de sortie (fin de contrat enregistrée), sinon fin du dernier contrat. Sans l'une
  // ni l'autre, on REFUSE plutôt que d'imprimer « jusqu'au — ».
  let dateSortie: string | null = null;
  if (!emp.actif) {
    const fin = await db.finContrat.findFirst({ where: { employeeId }, orderBy: { dateFin: "desc" }, select: { dateFin: true } });
    const d = fin?.dateFin ?? dernier?.dateFin ?? null;
    if (!d) {
      return { ok: false, motif: "Votre date de sortie n'est pas enregistrée : la Direction doit la compléter.", aCompleter: true };
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
    // Et seulement à partir de la date d'effet de la paie au planning : avant, elle ne fait pas foi.
    const depuis = await moisEffetAttestationSalaire(db);
    const aPartirDe = depuis === null ? {} : {
      payrollRun: {
        OR: [
          { annee: { gt: Math.floor(depuis / 100) } },
          { annee: Math.floor(depuis / 100), mois: { gte: depuis % 100 } },
        ],
      },
    };
    const ligne = await db.payrollLine.findFirst({
      where: { employeeId, statutPaiement: { in: ["VALIDE", "PAYE"] }, ...aPartirDe },
      orderBy: [{ payrollRun: { annee: "desc" } }, { payrollRun: { mois: "desc" } }],
      include: { payrollRun: { select: { mois: true, annee: true, tauxChangeUtilise: true } } },
    });
    if (!ligne) {
      return {
        ok: false,
        motif: depuis === null
          ? "Aucune paie validée : l'attestation de salaire reprend la dernière paie validée ou payée."
          : `Aucune paie validée depuis ${MOIS_FR[(depuis % 100) - 1]} ${Math.floor(depuis / 100)} : la Direction doit d'abord valider la paie.`,
      };
    }
    donnees.salaire = {
      mois: ligne.payrollRun.mois,
      annee: ligne.payrollRun.annee,
      // Le salaire HABITUEL : net hors transport et frais médicaux remboursés, AVANT acompte et
      // retenue de prêt (des avances, pas une baisse du salaire) — `lib/paie-net`, décisions du 2026-09-28.
      netUSD: usd(salaireNetHabituelUSD(ligne)),
      // Brut HORS transport : l'assiette CNSS/IPR, la même formule que le bulletin.
      brutUSD: usd(brutHorsTransportUSD(ligne)),
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
  const r = await db.$transaction(async (tx): Promise<{ ok: true; id: string; nom: string } | (Refus & { nom?: string })> => {
    await verrouillerEmploye(tx, p.employeeId);
    const enCours = await tx.attestation.findFirst({ where: { employeeId: p.employeeId, type: p.type, statut: "DEMANDEE" }, select: { id: true } });
    if (enCours) return { ok: false, motif: `Une demande d'${NOM_TYPE_ATTESTATION[p.type]} est déjà en cours.` };
    const eligible = await instantaneAttestation(tx, p.employeeId, p.type);
    if (!eligible.ok) return { ...eligible, nom: undefined };
    const a = await tx.attestation.create({
      data: { employeeId: p.employeeId, type: p.type, motif: p.motif?.trim() || null, demandeParId: p.parId },
    });
    await journaliser(tx, { entite: "Attestation", entiteId: a.id, champ: "demande", nouvelleValeur: p.type, userId: p.parId });
    return { ok: true, id: a.id, nom: eligible.donnees.nom };
  });
  if (!r.ok) {
    if (r.aCompleter) await signalerDonneeManquante(db, p.employeeId, p.type, r.motif);
    return { ok: false, motif: r.motif };
  }

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

/**
 * `existante` : en libre-service, l'attestation de salaire de CE mois de paie était déjà délivrée —
 * c'est LA MÊME qui est rendue (même numéro), rien n'est écrit.
 */
export type ResultatDelivrance = { ok: true; id: string; numero: string; existante?: boolean } | (Refus & { refusee?: boolean });

/** Deux instantanés de salaire identiques (mois de paie ET montants imprimés). */
function memeSalaire(a: DonneesAttestation["salaire"] | undefined, b: DonneesAttestation["salaire"] | undefined): boolean {
  return !!a && !!b && a.mois === b.mois && a.annee === b.annee && a.netUSD === b.netUSD && a.brutUSD === b.brutUSD
    && a.allocationsUSD === b.allocationsUSD && a.tauxChange === b.tauxChange;
}

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
  p: {
    attestationId?: string;
    employeeId?: string;
    type?: TypeAttestation;
    parId: string;
    maintenant?: Date;
    /**
     * LIBRE-SERVICE (décision Direction 2026-09-28) : le salarié obtient lui-même son attestation de
     * SALAIRE, sans validation. Délivrance directe, mêmes règles et même verrou ; UNE attestation par
     * mois de paie — si elle existe déjà (même paie, mêmes montants), c'est elle qui est rendue.
     * La Direction est informée par sa cloche au lieu de prévenir le salarié, qui est l'auteur.
     */
    libreService?: boolean;
  },
): Promise<ResultatDelivrance> {
  const maintenant = p.maintenant ?? new Date();
  if (p.libreService && (p.attestationId || p.type !== "SALAIRE")) {
    return { ok: false, motif: "Seule l'attestation de salaire s'obtient en libre-service." };
  }
  const r = await db.$transaction(async (tx): Promise<
    | { ok: true; id: string; numero: string; existante?: boolean; donnees?: DonneesAttestation; employeeId: string; type: TypeAttestation }
    | (Refus & { refusee?: boolean; employeeId?: string; type?: TypeAttestation; id?: string })
  > => {
    let employeeId: string;
    let type: TypeAttestation;
    // La demande que cette délivrance SATISFAIT (verrouillée, relue DEMANDEE) — ou aucune.
    let demandeId: string | null = null;
    if (p.attestationId) {
      await tx.$queryRaw`SELECT "id" FROM "public"."Attestation" WHERE "id" = ${p.attestationId} FOR UPDATE`;
      const a = await tx.attestation.findUnique({ where: { id: p.attestationId } });
      if (!a) return { ok: false, motif: "Demande introuvable." };
      if (a.statut !== "DEMANDEE") return { ok: false, motif: "Cette demande a déjà été traitée." };
      employeeId = a.employeeId;
      type = a.type;
      demandeId = a.id;
    } else {
      if (!p.employeeId || !p.type) return { ok: false, motif: "Salarié ou type d'attestation manquant." };
      employeeId = p.employeeId;
      type = p.type;
      // Une demande du même type attend : la délivrance directe la SATISFAIT plutôt que de laisser
      // une demande orpheline. COURSE : « Demandes de validation » a pu la traiter entre la lecture
      // et le verrou — on RELIT son statut sous verrou et on ne la reprend que si elle est encore
      // DEMANDEE. Sinon la délivrance directe crée SA propre attestation : un numéro déjà délivré
      // n'est jamais écrasé, une demande refusée ne repasse jamais délivrée.
      await verrouillerEmploye(tx, employeeId);
      // En libre-service, une demande en attente n'est PAS reprise : un refus d'éligibilité la
      // refuserait par le clic du salarié lui-même. Elle reste à la Direction.
      const enAttente = p.libreService
        ? null
        : await tx.attestation.findFirst({ where: { employeeId, type, statut: "DEMANDEE" }, select: { id: true } });
      if (enAttente) {
        await tx.$queryRaw`SELECT "id" FROM "public"."Attestation" WHERE "id" = ${enAttente.id} FOR UPDATE`;
        const relue = await tx.attestation.findUnique({ where: { id: enAttente.id }, select: { statut: true } });
        if (relue?.statut === "DEMANDEE") demandeId = enAttente.id;
      }
    }

    const eligible = await instantaneAttestation(tx, employeeId, type);
    if (!eligible.ok) {
      if (!demandeId) return eligible;
      const { count } = await tx.attestation.updateMany({
        where: { id: demandeId, statut: "DEMANDEE" },
        data: { statut: "REFUSEE", motifRefus: eligible.motif, delivreeParId: p.parId },
      });
      if (count !== 1) return { ok: false, motif: "Cette demande a déjà été traitée." };
      await journaliser(tx, { entite: "Attestation", entiteId: demandeId, champ: "refus", nouvelleValeur: eligible.motif, userId: p.parId });
      return { ...eligible, refusee: true, employeeId, type, id: demandeId };
    }

    // Libre-service : l'attestation de ce mois de paie existe déjà → la même, sans nouveau numéro.
    // Lue APRÈS le verrou de la ligne Employee (pris plus haut, délivrance directe) : un double clic
    // attend la première transaction, puis trouve ce qu'elle a écrit.
    if (p.libreService) {
      const deja = await tx.attestation.findMany({
        where: { employeeId, type: "SALAIRE", statut: "DELIVREE", payrollLineId: eligible.payrollLineId, numero: { not: null } },
        orderBy: { delivreeLe: "desc" },
        select: { id: true, numero: true, donnees: true },
      });
      const meme = deja.find((d) => memeSalaire((d.donnees as DonneesAttestation | null)?.salaire, eligible.donnees.salaire));
      if (meme?.numero) return { ok: true, id: meme.id, numero: meme.numero, existante: true, employeeId, type };
    }

    const numero = numeroAttestation(jourCivilKinshasa(maintenant).getUTCFullYear(), await prochainRang(tx, jourCivilKinshasa(maintenant).getUTCFullYear()));
    // « à sa demande » : seulement quand l'attestation répond à une demande du salarié.
    const donnees: DonneesAttestation = {
      ...eligible.donnees,
      aSaDemande: demandeId !== null || !!p.libreService,
      ...(p.libreService ? { libreService: true } : {}),
    };
    const data = {
      statut: "DELIVREE" as const,
      numero,
      delivreeLe: maintenant,
      delivreeParId: p.parId,
      payrollLineId: eligible.payrollLineId,
      donnees: donnees as unknown as Prisma.InputJsonValue,
    };
    let a: { id: string };
    if (demandeId) {
      // Écriture CONDITIONNÉE au statut : ceinture en plus du verrou — jamais d'écrasement.
      const { count } = await tx.attestation.updateMany({ where: { id: demandeId, statut: "DEMANDEE" }, data });
      if (count !== 1) throw new Error("Cette demande a déjà été traitée.");
      a = { id: demandeId };
    } else {
      a = await tx.attestation.create({ data: { ...data, employeeId, type, demandeLe: maintenant, demandeParId: p.parId } });
    }
    await journaliser(tx, {
      entite: "Attestation",
      entiteId: a.id,
      champ: "delivrance",
      nouvelleValeur: p.libreService ? `${numero} (libre-service)` : numero,
      userId: p.parId,
    });
    return { ok: true, id: a.id, numero, donnees, employeeId, type };
  }).catch((e: unknown) => {
    // Ceinture de l'écriture conditionnée : une demande traitée entre-temps revient en MESSAGE.
    if (e instanceof Error && e.message === "Cette demande a déjà été traitée.") return { ok: false as const, motif: e.message } as Refus & { refusee?: boolean; employeeId?: string; type?: TypeAttestation; id?: string };
    throw e;
  });

  if (!r.ok) {
    if (r.aCompleter && r.employeeId && r.type) await signalerDonneeManquante(db, r.employeeId, r.type, r.motif);
    if (r.refusee && r.id && r.employeeId && r.type) {
      await apresTraitement(r.id, r.employeeId, `Votre demande d'${NOM_TYPE_ATTESTATION[r.type]} a été refusée : ${r.motif}`);
      return { ok: false, motif: r.motif, refusee: true };
    }
    return { ok: false, motif: r.motif };
  }

  if (r.existante || !r.donnees) return { ok: true, id: r.id, numero: r.numero, existante: true };

  await figerAttestation(db, { id: r.id, donnees: r.donnees, numero: r.numero, delivreeLe: maintenant });
  if (p.libreService) {
    await informerDirectionLibreService(r.id, r.donnees.nom, r.employeeId, r.numero);
    return { ok: true, id: r.id, numero: r.numero };
  }
  await apresTraitement(r.id, r.employeeId, `Votre ${NOM_TYPE_ATTESTATION[r.type]} (${r.numero}) est disponible`);
  return { ok: true, id: r.id, numero: r.numero };
}

/**
 * Une attestation est refusée faute d'une donnée de la fiche : la Direction est prévenue de ce
 * qu'elle doit compléter (le salarié, lui, lit « la Direction doit la compléter »).
 */
async function signalerDonneeManquante(db: PrismaClient, employeeId: string, type: TypeAttestation, motif: string): Promise<void> {
  try {
    const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { nom: true } });
    await creerNotification({
      type: "AUTRE",
      message: `${emp?.nom ?? "Un salarié"} : ${NOM_TYPE_ATTESTATION[type]} impossible — ${motif.replace(/^Votre /, "sa ").replace(" : la Direction doit la compléter.", "")}. Complétez la fiche.`,
      lien: `/employes/${employeeId}`,
      refId: `attestation:a-completer:${employeeId}`,
    });
  } catch {
    // Signalement de confort.
  }
}

/** Rend et fige l'exemplaire. Silencieux en cas d'échec : l'instantané suffit à le régénérer. */
export async function figerAttestation(
  db: PrismaClient,
  a: { id: string; donnees: DonneesAttestation; numero: string; delivreeLe: Date },
): Promise<void> {
  try {
    // Import À LA DEMANDE : le moteur PDF (react-pdf, polices) ne pèse que sur la délivrance, pas sur
    // chaque page qui importe ces actions (« Demandes de validation », fiche employé).
    const { rendreAttestationPdf } = await import("@/lib/pdf/attestation-buffer");
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

/**
 * Libre-service : la Direction est informée (cloche) de l'attestation que le salarié vient
 * d'obtenir. Jamais bloquant.
 */
async function informerDirectionLibreService(attestationId: string, nom: string, employeeId: string, numero: string): Promise<void> {
  try {
    await creerNotification({
      type: "AUTRE",
      message: `${nom} a obtenu son attestation de salaire ${numero} en libre-service.`,
      lien: `/employes/${employeeId}?tab=contrats`,
      refId: `attestation:${attestationId}:libre-service`,
    });
  } catch {
    // L'attestation est délivrée et journalisée ; elle figure au registre.
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
