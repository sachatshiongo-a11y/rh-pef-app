import "server-only";

// « Annuler ce pointage » (décision de la Direction du 2026-09-29) : le salarié qui vient de
// scanner l'affiche par erreur peut retirer CE pointage, pendant 5 minutes, et lui seul.
//
// L'HISTORIQUE N'EST JAMAIS EFFACÉ. Une annulation pose `annuleLe` / `annuleParId` sur le scan
// (et une ligne au journal d'audit) ; aucun scan, aucun pointage n'est supprimé. Un scan annulé
// reste en base, ignoré par le moteur (`pointage-scan.ts`) et par chaque écran qui lit les
// pointages : ils filtrent avec `SCAN_VALABLE` et `POINTAGE_VALABLE` ci-dessous.
//
//   • Arrivée annulée : le pointage du jour « n'existe plus » pour les écrans (sa ligne reste, avec
//     ses scans) ; le scan suivant refait l'arrivée sur la même ligne.
//   • Départ annulé : il avait clos la journée → la journée est rouverte, et Présences + Heures
//     reviennent à leur état d'AVANT la clôture (relu au journal, cf. `pointage-cloture.ts`).
//     Refusé si la Direction a corrigé la journée entre-temps : on ne défait jamais son travail.

import type { Prisma, PrismaClient } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { DELAI_ANNULATION_MS } from "@/lib/pointage-qr";
import { heureKinshasa } from "@/lib/heure-kinshasa";
import { restaurerPresences } from "@/lib/pointage-presences";
import { journeeTouchee, lireCloture } from "@/lib/pointage-cloture";

/** Un scan qui compte (non annulé). À mettre dans CHAQUE lecture de `ScanPointage`. */
export const SCAN_VALABLE = { annuleLe: null } satisfies Prisma.ScanPointageWhereInput;

/**
 * Un pointage qui existe pour les écrans : sans aucun scan d'arrivée (saisi hors scan, ancien
 * pointage « APP »), ou avec au moins une arrivée NON annulée. À mettre dans CHAQUE lecture de
 * `Pointage` destinée à l'affichage ou aux décomptes.
 */
export const POINTAGE_VALABLE = {
  OR: [{ scans: { none: { moment: "ARRIVEE" } } }, { scans: { some: { moment: "ARRIVEE", annuleLe: null } } }],
} satisfies Prisma.PointageWhereInput;

export const MESSAGE_POINTAGE_INTROUVABLE = "Ce pointage est introuvable.";
export const MESSAGE_DEJA_ANNULE = "Ce pointage est déjà annulé.";
export const MESSAGE_DELAI_ANNULATION_PASSE =
  "Le délai d'annulation (5 minutes) est passé : pour corriger ce pointage, adressez-vous à la Direction.";
export const MESSAGE_DEPART_A_ANNULER_D_ABORD =
  "Votre départ est déjà pointé : annulez d'abord le départ, ou adressez-vous à la Direction.";
export const MESSAGE_JOURNEE_CORRIGEE =
  "La Direction a déjà corrigé cette journée : pour la modifier, adressez-vous à elle.";
export const MESSAGE_PAIE_VALIDEE = "La paie du mois est validée : ce pointage ne peut plus être modifié.";

/**
 * Temps restant (ms) pour annuler un scan fait à `instant`, 0 s'il est passé. Mesuré à l'heure du
 * SERVEUR : l'écran retire le bouton à l'échéance, le serveur refuse de toute façon au-delà.
 */
export function annulableMs(instant: Date, maintenant: Date): number {
  return Math.max(0, instant.getTime() + DELAI_ANNULATION_MS - maintenant.getTime());
}

/**
 * Annule un scan du salarié `employeeId` — le sien, jamais celui d'un collègue (même message pour
 * « inexistant » et « d'un collègue » : rien ne se devine) — dans les 5 minutes. Sous verrou de la
 * ligne du pointage : un scan ou une saisie de pause simultanés attendent, puis voient l'annulation.
 */
export async function annulerScan(
  client: PrismaClient,
  p: {
    employeeId: string;
    userId: string;
    scanId: string;
    maintenant?: Date; // injection pour les tests UNIQUEMENT : en production, l'heure du serveur
  },
): Promise<{ moment: "ARRIVEE" | "DEPART"; heure: string }> {
  const maintenant = p.maintenant ?? new Date();
  const scan = await client.scanPointage.findUnique({
    where: { id: String(p.scanId) },
    select: { id: true, employeeId: true, pointageId: true },
  });
  if (!scan || scan.employeeId !== p.employeeId) throw new Error(MESSAGE_POINTAGE_INTROUVABLE);

  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "public"."Pointage" WHERE "id" = ${scan.pointageId} FOR UPDATE`;
    const pointage = await tx.pointage.findUnique({
      where: { id: scan.pointageId },
      include: { scans: { orderBy: { instant: "asc" } } },
    });
    if (!pointage || pointage.employeeId !== p.employeeId) throw new Error(MESSAGE_POINTAGE_INTROUVABLE);
    const courant = pointage.scans.find((s) => s.id === scan.id);
    if (!courant) throw new Error(MESSAGE_POINTAGE_INTROUVABLE);
    if (courant.annuleLe) throw new Error(MESSAGE_DEJA_ANNULE);
    if (maintenant.getTime() - courant.instant.getTime() > DELAI_ANNULATION_MS) throw new Error(MESSAGE_DELAI_ANNULATION_PASSE);

    const run = await tx.payrollRun.findUnique({
      where: { mois_annee: { mois: pointage.date.getUTCMonth() + 1, annee: pointage.date.getUTCFullYear() } },
      select: { statut: true },
    });
    if (run?.statut === "VALIDE") throw new Error(MESSAGE_PAIE_VALIDEE);

    const departValable = pointage.scans.find((s) => s.moment === "DEPART" && !s.annuleLe) ?? null;
    if (courant.moment === "ARRIVEE") {
      if (pointage.heureFin || departValable) throw new Error(MESSAGE_DEPART_A_ANNULER_D_ABORD);
    } else if (pointage.heureFin) {
      // Le départ a clos la journée : on la rouvre, et les présences reviennent à leur état d'avant.
      // Une journée close autrement (heure de fin qui n'est pas celle de ce scan), ou corrigée
      // depuis par la Direction, ne se défait pas ici.
      if (pointage.heureFin.getTime() !== courant.instant.getTime()) throw new Error(MESSAGE_JOURNEE_CORRIGEE);
      if (await journeeTouchee(tx, pointage)) throw new Error(MESSAGE_JOURNEE_CORRIGEE);
      const cloture = await lireCloture(tx, pointage.id);
      if (!cloture) throw new Error(MESSAGE_JOURNEE_CORRIGEE);
      if (cloture.presencesEcrites) await restaurerPresences(tx, pointage.employeeId, pointage.date, cloture.avant);
      await tx.pointage.update({
        where: { id: pointage.id },
        data: { heureFin: null, pauseMinutes: 0, pauseParDefaut: false },
      });
      await journaliser(tx, {
        entite: "Pointage",
        entiteId: pointage.id,
        champ: "heureFin",
        ancienneValeur: courant.instant.toISOString(),
        nouvelleValeur: null,
        userId: p.userId,
      });
    }

    await tx.scanPointage.update({ where: { id: courant.id }, data: { annuleLe: maintenant, annuleParId: p.userId } });
    const libelle = courant.moment === "ARRIVEE" ? "arrivée scannée" : "départ scanné";
    await journaliser(tx, {
      entite: "ScanPointage",
      entiteId: courant.id,
      champ: "annuleLe",
      ancienneValeur: `${libelle} à ${heureKinshasa(courant.instant)} (${courant.instant.toISOString()})`,
      nouvelleValeur: `annulé par le salarié le ${maintenant.toISOString()}`,
      userId: p.userId,
    });
    return { moment: courant.moment, heure: courant.instant.toISOString() };
  });
}
