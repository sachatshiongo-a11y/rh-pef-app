import "server-only";

// Un scan de l'affiche QR → une arrivée ou un départ. Module SERVEUR : le code de l'affiche est
// comparé ici (temps constant), l'heure retenue est TOUJOURS celle du serveur (`maintenant`
// n'existe que pour les tests), et la position du téléphone ne fait jamais refuser un scan : un
// scan loin du restaurant, ou sans position, est ENREGISTRÉ et marqué A_VERIFIER — l'outil
// signale, la Direction tranche (cf. docs/superpowers/specs/2026-09-23-pointage-qr-design.md).
//
// Les heures renvoyées (`heure`, `arriveeA`, `departA`, `heureFin`) sont des instants ISO 8601 :
// l'écran les affiche en heure de Kinshasa.
//
// Décision de la Direction du 2026-09-29 — « scanner = pointer », sans bouton de confirmation. Les
// garde-fous qui remplacent le bouton vivent ICI, côté serveur :
//   • scan répété : moins de 10 minutes après le dernier pointage (arrivée ou départ) de la même
//     personne, RIEN de nouveau — on renvoie le pointage déjà fait (`repete: true`) ;
//   • « Annuler ce pointage » : 5 minutes, le salarié lui-même (`pointage-annulation.ts`) ; un scan
//     annulé ne compte plus, une arrivée annulée se refait au scan suivant ;
//   • le départ CLÔT la journée tout de suite, avec la pause par défaut (30 min) si le salarié n'a
//     pas saisi la sienne ; il peut la saisir ensuite (`saisirPauseScan`), tant que la Direction
//     n'a pas corrigé la journée (`pointage-cloture.ts`).

import { Prisma, type PrismaClient, type ScanPointage } from "@prisma/client";
import { codesEgaux } from "@/lib/pointage-code";
import { dateDuJourKinshasa, heuresNettes } from "@/lib/pointage-jour";
import {
  DELAI_SCAN_REPETE_MS,
  PAUSE_PAR_DEFAUT_MIN,
  verdictPosition,
  type PositionScan,
  type VerdictPosition,
} from "@/lib/pointage-qr";
import { appliquerAuxPresences, refusSiPaieValideeOuConge } from "@/lib/pointage-presences";
import { annulableMs } from "@/lib/pointage-annulation";
import { clore, journeeTouchee, lireCloture } from "@/lib/pointage-cloture";
import { journaliser } from "@/lib/audit";

/** La pause retenue pour la journée : `parDefaut` = posée d'office (30 min), pas saisie. */
export type PauseDuJour = { minutes: number; parDefaut: boolean };

/**
 * `repete` : ce scan n'a rien écrit, il réaffiche le pointage déjà fait. `annulableMs` : temps
 * restant pour « Annuler ce pointage » (0 = plus possible), mesuré à l'heure du serveur.
 * DEPART : la journée est CLOSE (horodatée au scan) ; `pauseModifiable` = le salarié peut encore
 * remplacer la pause par défaut par la sienne.
 */
export type ResultatScan =
  | { etat: "ARRIVEE"; scanId: string; heure: string; verdict: VerdictPosition; repete: boolean; annulableMs: number }
  | {
      etat: "DEPART";
      scanId: string;
      heure: string;
      arriveeA: string;
      verdict: VerdictPosition;
      repete: boolean;
      annulableMs: number;
      pause: PauseDuJour;
      heures: number;
      /** Faux quand un congé approuvé couvre ce jour : rien n'a été écrit aux présences. */
      presencesEcrites: boolean;
      pauseModifiable: boolean;
    }
  | { etat: "COMPLETE"; arriveeA: string; departA: string; pause: PauseDuJour };

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
    maintenant?: Date; // injection pour les tests UNIQUEMENT : en production, l'heure du serveur
  },
): Promise<ResultatScan> {
  return scanner(client, p, p.maintenant ?? new Date(), true);
}

async function scanner(
  client: PrismaClient,
  p: { employeeId: string; userId: string; code: string; position: PositionScan },
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
  //    du salarié. Sans position du TÉLÉPHONE (refusée, 8 s dépassées), le scan est enregistré
  //    quand même, « à vérifier ».
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
      // On rejoue UNE fois : il trouve alors l'arrivée du gagnant — un scan répété, rien de plus.
      if (rejouable && estConflitUnique(e)) return scanner(client, p, maintenant, false);
      throw e;
    }
    return resultatArrivee(arrivee, false, maintenant);
  }

  // 5-9. Sous verrou de la ligne du pointage : deux scans simultanés (ou un scan et une
  //      annulation) ne peuvent écrire ni deux départs, ni un départ ET une nouvelle arrivée.
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "public"."Pointage" WHERE "id" = ${pointage.id} FOR UPDATE`;
    const courant = await tx.pointage.findUnique({
      where: { id: pointage.id },
      include: { scans: { orderBy: { instant: "asc" } } },
    });
    if (!courant) throw new Error("Ce pointage a été supprimé entre-temps : scannez de nouveau l'affiche.");

    // Un scan annulé (« Annuler ce pointage ») ne compte plus.
    const valables = courant.scans.filter((s) => !s.annuleLe);
    const arrivees = valables.filter((s) => s.moment === "ARRIVEE");
    const arrivee = arrivees.length > 0 ? arrivees[arrivees.length - 1] : null;
    const depart = valables.find((s) => s.moment === "DEPART") ?? null;
    const arriveeAnnulee = arrivee === null && courant.scans.some((s) => s.moment === "ARRIVEE");
    const pause: PauseDuJour = { minutes: courant.pauseMinutes, parDefaut: courant.pauseParDefaut };

    // 5. Journée close : le départ qui l'a close est réaffiché s'il date de moins de 10 min (scan
    //    répété), sinon « journée complète ». Rien n'est écrit.
    if (courant.heureFin) {
      if (
        depart &&
        depart.instant.getTime() === courant.heureFin.getTime() &&
        maintenant.getTime() - depart.instant.getTime() < DELAI_SCAN_REPETE_MS
      ) {
        const cloture = await lireCloture(tx, courant.id);
        return resultatDepart(courant, depart, { repete: true, presencesEcrites: cloture?.presencesEcrites ?? true }, maintenant);
      }
      return {
        etat: "COMPLETE",
        arriveeA: courant.heureDebut.toISOString(),
        departA: courant.heureFin.toISOString(),
        pause,
      } as const;
    }

    // 6. L'arrivée a été annulée : ce scan est la NOUVELLE arrivée. La ligne du pointage reste (la
    //    supprimer effacerait ses scans) ; elle reprend l'heure de ce scan.
    if (arriveeAnnulee) {
      await tx.pointage.update({
        where: { id: courant.id },
        data: { heureDebut: maintenant, source: "QR", creeParId: p.userId },
      });
      const nouvelle = await tx.scanPointage.create({
        data: { ...scan, pointageId: courant.id, employeeId: p.employeeId, moment: "ARRIVEE", instant: maintenant },
      });
      return resultatArrivee(nouvelle, false, maintenant);
    }

    // 7. Un départ scanné AVANT la mise en service de la clôture automatique, jamais clos : on le
    //    clôt maintenant, avec la pause par défaut — la même règle qu'un départ d'aujourd'hui.
    if (depart) {
      const r = await clore(tx, {
        pointage: courant,
        heureFin: depart.instant,
        pauseMinutes: PAUSE_PAR_DEFAUT_MIN,
        parDefaut: true,
        userId: p.userId,
      });
      const clos = { ...courant, heureFin: depart.instant, pauseMinutes: PAUSE_PAR_DEFAUT_MIN, pauseParDefaut: true };
      return resultatDepart(clos, depart, { repete: false, presencesEcrites: r.presencesEcrites }, maintenant);
    }

    // 8. Scan répété : moins de 10 min après l'arrivée scannée → rien de nouveau, l'arrivée est
    //    réaffichée. (Un pointage sans scan d'arrivée — ancien bouton « APP » — n'est pas concerné.)
    if (arrivee && maintenant.getTime() - arrivee.instant.getTime() < DELAI_SCAN_REPETE_MS)
      return resultatArrivee(arrivee, true, maintenant);

    // 9. Le départ : horodaté MAINTENANT, et la journée close tout de suite avec la pause par
    //    défaut. Le salarié peut saisir la sienne ensuite (facultatif).
    const nouveau = await tx.scanPointage.create({
      data: { ...scan, pointageId: courant.id, employeeId: p.employeeId, moment: "DEPART", instant: maintenant },
    });
    const r = await clore(tx, {
      pointage: courant,
      heureFin: maintenant,
      pauseMinutes: PAUSE_PAR_DEFAUT_MIN,
      parDefaut: true,
      userId: p.userId,
    });
    const clos = { ...courant, heureFin: maintenant, pauseMinutes: PAUSE_PAR_DEFAUT_MIN, pauseParDefaut: true };
    return resultatDepart(clos, nouveau, { repete: false, presencesEcrites: r.presencesEcrites }, maintenant);
  });
}

function resultatArrivee(s: ScanPointage, repete: boolean, maintenant: Date): ResultatScan {
  return {
    etat: "ARRIVEE",
    scanId: s.id,
    heure: s.instant.toISOString(),
    verdict: verdictDe(s),
    repete,
    annulableMs: annulableMs(s.instant, maintenant),
  };
}

function resultatDepart(
  pointage: { date: Date; heureDebut: Date; heureFin: Date | null; pauseMinutes: number; pauseParDefaut: boolean },
  s: ScanPointage,
  o: { repete: boolean; presencesEcrites: boolean },
  maintenant: Date,
): ResultatScan {
  const heureFin = pointage.heureFin ?? s.instant;
  return {
    etat: "DEPART",
    scanId: s.id,
    heure: s.instant.toISOString(),
    arriveeA: pointage.heureDebut.toISOString(),
    verdict: verdictDe(s),
    repete: o.repete,
    annulableMs: annulableMs(s.instant, maintenant),
    pause: { minutes: pointage.pauseMinutes, parDefaut: pointage.pauseParDefaut },
    heures: heuresNettes(pointage.heureDebut, heureFin, pointage.pauseMinutes),
    presencesEcrites: o.presencesEcrites,
    // La pause par défaut se remplace le jour même (Kinshasa) ; la Direction a pu corriger ensuite :
    // le serveur le revérifie à la saisie (`saisirPauseScan`).
    pauseModifiable: pointage.pauseParDefaut && pointage.date.getTime() === dateDuJourKinshasa(maintenant).getTime(),
  };
}

/** Un départ annulé (« Annuler ce pointage ») ne reçoit plus de pause. */
export const MESSAGE_DEPART_ANNULE = "Ce départ a été annulé : scannez de nouveau l'affiche pour pointer votre départ.";
/** Un départ d'un autre jour ne se modifie plus : la Direction a pu corriger ces heures depuis. */
export const MESSAGE_DEPART_AUTRE_JOUR =
  "Ce départ a été pointé un autre jour : sa pause ne peut plus être modifiée ici. Pour les heures de ce jour, adressez-vous à la Direction.";
export const MESSAGE_PAUSE_DEJA_SAISIE =
  "Votre pause est déjà enregistrée : pour la corriger, adressez-vous à la Direction.";
export const MESSAGE_JOURNEE_CLOSE_AUTREMENT =
  "Votre journée a été close autrement : pour la corriger, adressez-vous à la Direction.";

/**
 * La pause SAISIE par le salarié après son départ (étape facultative) : elle remplace la pause par
 * défaut, et les heures nettes aux présences suivent. `heureFin` reste l'instant du SCAN.
 *
 * Refusée (rien n'est réécrit) : un autre jour que celui du départ ; une pause déjà saisie ; une
 * journée que la Direction a corrigée depuis (heures ou code retouchés dans Présences & heures) ;
 * un départ annulé. Un départ scanné AVANT la clôture automatique, jamais clos, est clos ici avec
 * la pause saisie.
 *
 * `presencesEcrites` : faux quand un congé approuvé couvre ce jour — l'écran le dit.
 */
export async function saisirPauseScan(
  client: PrismaClient,
  p: {
    employeeId: string;
    userId: string;
    scanId: string;
    pauseMinutes: number;
    maintenant?: Date; // injection pour les tests UNIQUEMENT : en production, l'heure du serveur
  },
): Promise<{ heureFin: string; heures: number; presencesEcrites: boolean; pauseMinutes: number }> {
  const pauseMinutes = Math.round(Math.max(0, Math.min(600, Number(p.pauseMinutes) || 0)));
  const scan = await client.scanPointage.findUnique({ where: { id: String(p.scanId) }, include: { pointage: true } });
  // Même message pour « inexistant », « d'un collègue » et « pas un départ » : rien ne se devine.
  if (!scan || scan.employeeId !== p.employeeId || scan.pointage.employeeId !== p.employeeId || scan.moment !== "DEPART")
    throw new Error("Ce départ est introuvable.");
  if (scan.pointage.date.getTime() !== dateDuJourKinshasa(p.maintenant ?? new Date()).getTime())
    throw new Error(MESSAGE_DEPART_AUTRE_JOUR);

  return client.$transaction(async (tx) => {
    // Sous le même verrou que le scan et l'annulation ; tout est relu APRÈS l'avoir pris.
    await tx.$queryRaw`SELECT "id" FROM "public"."Pointage" WHERE "id" = ${scan.pointageId} FOR UPDATE`;
    const [pointage, relu] = await Promise.all([
      tx.pointage.findUniqueOrThrow({ where: { id: scan.pointageId } }),
      tx.scanPointage.findUniqueOrThrow({ where: { id: scan.id }, select: { annuleLe: true } }),
    ]);
    if (relu.annuleLe) throw new Error(MESSAGE_DEPART_ANNULE);

    if (!pointage.heureFin) {
      const r = await clore(tx, { pointage, heureFin: scan.instant, pauseMinutes, parDefaut: false, userId: p.userId });
      return { heureFin: scan.instant.toISOString(), heures: r.heures, presencesEcrites: r.presencesEcrites, pauseMinutes };
    }

    if (pointage.heureFin.getTime() !== scan.instant.getTime()) throw new Error(MESSAGE_JOURNEE_CLOSE_AUTREMENT);
    if (!pointage.pauseParDefaut) throw new Error(MESSAGE_PAUSE_DEJA_SAISIE);
    if (await journeeTouchee(tx, pointage)) throw new Error("La Direction a déjà corrigé cette journée : pour la modifier, adressez-vous à elle.");

    const heures = heuresNettes(pointage.heureDebut, pointage.heureFin, pauseMinutes);
    const maj = await tx.pointage.updateMany({
      where: { id: pointage.id, pauseParDefaut: true },
      data: { pauseMinutes, pauseParDefaut: false },
    });
    if (maj.count === 0) throw new Error(MESSAGE_PAUSE_DEJA_SAISIE);
    const cloture = await lireCloture(tx, pointage.id);
    // Rien n'avait été écrit aux présences à la clôture (congé approuvé) : rien ne l'est ici non plus.
    const presencesEcrites = cloture?.presencesEcrites
      ? await appliquerAuxPresences(tx, pointage.employeeId, pointage.date, heures)
      : false;
    await journaliser(tx, {
      entite: "Pointage",
      entiteId: pointage.id,
      champ: "pauseMinutes",
      ancienneValeur: `${pointage.pauseMinutes} min (par défaut)`,
      nouvelleValeur: `${pauseMinutes} min (saisie par le salarié)`,
      userId: p.userId,
    });
    return { heureFin: pointage.heureFin.toISOString(), heures, presencesEcrites, pauseMinutes };
  });
}
