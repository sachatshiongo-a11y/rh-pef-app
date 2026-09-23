import "server-only";

// Un scan de l'affiche QR → une arrivée ou un départ. Module SERVEUR : le code de l'affiche est
// comparé ici (temps constant), l'heure retenue est TOUJOURS celle du serveur (`maintenant`
// n'existe que pour les tests), et la position du téléphone ne fait jamais refuser un scan : un
// scan loin du restaurant, ou sans position, est ENREGISTRÉ et marqué A_VERIFIER — l'outil
// signale, la Direction tranche (cf. docs/superpowers/specs/2026-09-23-pointage-qr-design.md).
//
// Les heures renvoyées (`heure`, `arriveeA`, `heureFin`) sont des instants ISO 8601 : l'écran les
// affiche en heure de Kinshasa.

import { Prisma, type PrismaClient, type ScanPointage } from "@prisma/client";
import { codesEgaux } from "@/lib/pointage-code";
import { dateDuJourKinshasa, heuresNettes } from "@/lib/pointage-jour";
import { DELAI_DOUBLE_SCAN_MS, verdictPosition, type PositionScan, type VerdictPosition } from "@/lib/pointage-qr";
import { appliquerAuxPresences, refusSiPaieValideeOuConge } from "@/lib/pointage-presences";

export type ResultatScan =
  | { etat: "ARRIVEE"; heure: string; verdict: VerdictPosition }
  | { etat: "DEPART_A_CONFIRMER"; scanId: string; heure: string; arriveeA: string; verdict: VerdictPosition }
  | { etat: "DEPART_TROP_TOT"; arriveeA: string } // < 5 min après l'arrivée : rien n'est écrit
  | { etat: "COMPLETE" };

const AFFICHE_INVALIDE = "Cette affiche n'est plus valable, demandez la nouvelle à la Direction.";
const ENTIER_MAX = 2_147_483_647; // colonnes Int (précision, distance)

/**
 * La position vient du navigateur : on ne lui fait pas confiance. Une position illisible (non
 * numérique, hors bornes, précision négative) est traitée comme INDISPONIBLE — enregistrée et
 * marquée à vérifier, comme toute position absente, jamais une cause de refus.
 */
function positionLisible(p: unknown): PositionScan {
  if (typeof p === "object" && p !== null) {
    const o = p as Record<string, unknown>;
    if (o.erreur === "REFUSEE" || o.erreur === "INDISPONIBLE") return { erreur: o.erreur };
    const { lat, lng, precisionM } = o;
    if (
      typeof lat === "number" && typeof lng === "number" && typeof precisionM === "number" &&
      Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(precisionM) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && precisionM >= 0
    ) {
      return { lat, lng, precisionM };
    }
  }
  return { erreur: "INDISPONIBLE" };
}

/** Les colonnes du scan, depuis la position lue et son verdict. */
function champsScan(p: PositionScan, v: VerdictPosition) {
  const coords = "erreur" in p ? null : p;
  return {
    latitude: coords ? coords.lat : null,
    longitude: coords ? coords.lng : null,
    precisionM: coords ? Math.min(Math.round(coords.precisionM), ENTIER_MAX) : null,
    distanceM: v.distanceM === null ? null : Math.min(Math.round(v.distanceM), ENTIER_MAX),
    verdict: v.verdict,
    motif: v.verdict === "A_VERIFIER" ? v.motif : null,
  };
}

/**
 * Le verdict d'un scan TEL QU'ENREGISTRÉ (distance et précision arrondies au mètre) : le même objet
 * au premier scan et à un rescan du départ, qui renvoie CE scan tel qu'il a été jugé. Exportée :
 * le Suivi de la Direction (`pointer/suivi`) la réutilise pour reconstruire le motif lisible
 * (`libelleMotif`) d'un scan déjà en base, plutôt que d'écrire une seconde reconstitution.
 */
export function verdictDe(s: Pick<ScanPointage, "verdict" | "motif" | "distanceM" | "precisionM">): VerdictPosition {
  if (s.verdict === "AU_RESTAURANT") return { verdict: "AU_RESTAURANT", distanceM: s.distanceM ?? 0 };
  const motif = s.motif ?? "POSITION_INDISPONIBLE";
  return motif === "PRECISION_INSUFFISANTE"
    ? { verdict: "A_VERIFIER", motif, distanceM: s.distanceM, precisionM: s.precisionM ?? undefined }
    : { verdict: "A_VERIFIER", motif, distanceM: s.distanceM };
}

function estConflitUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export async function enregistrerScan(
  client: PrismaClient,
  p: {
    employeeId: string;
    userId: string;
    code: string;
    position: PositionScan;
    confirmerDepartRapide?: boolean;
    maintenant?: Date; // injection pour les tests UNIQUEMENT : en production, l'heure du serveur
  },
): Promise<ResultatScan> {
  return scanner(client, p, p.maintenant ?? new Date(), true);
}

async function scanner(
  client: PrismaClient,
  p: { employeeId: string; userId: string; code: string; position: PositionScan; confirmerDepartRapide?: boolean },
  maintenant: Date,
  rejouable: boolean,
): Promise<ResultatScan> {
  // 1. Le code de l'affiche — AVANT toute écriture.
  const config = await client.config.findUnique({
    where: { id: "singleton" },
    select: { pointageCode: true, pointageLatitude: true, pointageLongitude: true, pointageRayonM: true },
  });
  if (!config?.pointageCode || typeof p.code !== "string" || !codesEgaux(p.code, config.pointageCode))
    throw new Error(AFFICHE_INVALIDE);

  // 2. Paie du mois validée, congé approuvé ce jour.
  const date = dateDuJourKinshasa(maintenant);
  await refusSiPaieValideeOuConge(client, p.employeeId, date);

  // 3. Le verdict de position. Sans position du restaurant, il n'y a rien à quoi comparer : c'est
  //    un réglage manquant de la Direction (l'affiche ne s'imprime pas sans lui), pas un défaut
  //    du salarié.
  if (config.pointageLatitude === null || config.pointageLongitude === null)
    throw new Error("La position du restaurant n'est pas encore réglée : demandez à la Direction de la régler (Paramètres → Pointage).");
  const position = positionLisible(p.position);
  const restaurant = { lat: Number(config.pointageLatitude), lng: Number(config.pointageLongitude) };
  const scan = champsScan(position, verdictPosition(position, restaurant, config.pointageRayonM));

  const pointage = await client.pointage.findUnique({ where: { employeeId_date: { employeeId: p.employeeId, date } } });

  // 4. Premier scan du jour → l'arrivée : le pointage ET son scan, ensemble ou pas du tout.
  if (!pointage) {
    let arrivee: ScanPointage;
    try {
      arrivee = await client.$transaction(async (tx) => {
        const cree = await tx.pointage.create({
          data: { employeeId: p.employeeId, date, heureDebut: maintenant, source: "QR", creeParId: p.userId },
        });
        return tx.scanPointage.create({
          data: { ...scan, pointageId: cree.id, employeeId: p.employeeId, moment: "ARRIVEE", instant: maintenant },
        });
      });
    } catch (e) {
      // Deux scans d'arrivée au même instant : le perdant bute sur l'unicité (employé, jour).
      // On rejoue UNE fois : il trouve alors l'arrivée du gagnant et suit la règle du second scan.
      if (rejouable && estConflitUnique(e)) return scanner(client, p, maintenant, false);
      throw e;
    }
    return { etat: "ARRIVEE", heure: maintenant.toISOString(), verdict: verdictDe(arrivee) };
  }

  // 5. Journée complète.
  if (pointage.heureFin) return { etat: "COMPLETE" };

  const arriveeA = pointage.heureDebut.toISOString();
  // 6-8. Le départ, sous verrou de la ligne du pointage : deux scans de départ simultanés ne
  //      peuvent pas écrire deux scans DEPART.
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "public"."Pointage" WHERE "id" = ${pointage.id} FOR UPDATE`;
    const ouvert = await tx.pointage.findUnique({ where: { id: pointage.id }, select: { heureFin: true } });
    if (!ouvert || ouvert.heureFin) return { etat: "COMPLETE" } as const;

    // 6. Un départ déjà scanné, en attente de sa pause → CE scan, aucune nouvelle ligne.
    const deja = await tx.scanPointage.findFirst({
      where: { pointageId: pointage.id, moment: "DEPART" },
      orderBy: { instant: "asc" },
    });
    if (deja) {
      return {
        etat: "DEPART_A_CONFIRMER",
        scanId: deja.id,
        heure: deja.instant.toISOString(),
        arriveeA,
        verdict: verdictDe(deja),
      } as const;
    }

    // 7. Double scan par erreur (moins de 5 min après l'arrivée) : on demande confirmation.
    if (maintenant.getTime() - pointage.heureDebut.getTime() < DELAI_DOUBLE_SCAN_MS && !p.confirmerDepartRapide)
      return { etat: "DEPART_TROP_TOT", arriveeA } as const;

    // 8. Le départ : horodaté MAINTENANT, clos plus tard à cet instant quand la pause est saisie.
    const depart = await tx.scanPointage.create({
      data: { ...scan, pointageId: pointage.id, employeeId: p.employeeId, moment: "DEPART", instant: maintenant },
    });
    return {
      etat: "DEPART_A_CONFIRMER",
      scanId: depart.id,
      heure: maintenant.toISOString(),
      arriveeA,
      verdict: verdictDe(depart),
    } as const;
  });
}

/**
 * Clôt la journée : `heureFin` = l'instant du SCAN de départ (jamais l'heure de la confirmation),
 * pause bornée 0-600 min, heures nettes écrites aux présences — le tout dans une transaction.
 */
export async function confirmerDepartScan(
  client: PrismaClient,
  p: { employeeId: string; scanId: string; pauseMinutes: number },
): Promise<{ heureFin: string; heures: number }> {
  const pauseMinutes = Math.round(Math.max(0, Math.min(600, Number(p.pauseMinutes) || 0)));
  const scan = await client.scanPointage.findUnique({ where: { id: p.scanId }, include: { pointage: true } });
  // Même message pour « inexistant », « d'un collègue » et « pas un départ » : rien ne se devine.
  if (!scan || scan.employeeId !== p.employeeId || scan.pointage.employeeId !== p.employeeId || scan.moment !== "DEPART")
    throw new Error("Ce départ est introuvable.");
  if (scan.pointage.heureFin) throw new Error("Votre départ est déjà confirmé.");

  const heureFin = scan.instant;
  const heures = heuresNettes(scan.pointage.heureDebut, heureFin, pauseMinutes);
  await client.$transaction(async (tx) => {
    // `heureFin: null` dans le filtre : deux confirmations simultanées, une seule clôt.
    const clos = await tx.pointage.updateMany({
      where: { id: scan.pointageId, heureFin: null },
      data: { heureFin, pauseMinutes },
    });
    if (clos.count === 0) throw new Error("Votre départ est déjà confirmé.");
    await appliquerAuxPresences(tx, p.employeeId, scan.pointage.date, heures);
  });
  return { heureFin: heureFin.toISOString(), heures };
}
