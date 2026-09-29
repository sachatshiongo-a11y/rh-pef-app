import "server-only";

// La CLÔTURE d'une journée pointée par scan, et ce qu'il faut pour la défaire proprement.
//
// Décision de la Direction du 2026-09-29 : le départ scanné clôt la journée TOUT DE SUITE, avec la
// pause par défaut (30 min) quand le salarié n'a pas saisi la sienne. Clore = `heureFin` à
// l'instant du SCAN, la pause, puis les heures nettes écrites aux présences (comme avant).
//
// Chaque clôture est JOURNALISÉE (entité « Pointage », champ « cloture ») avec ce que Présences +
// Heures portaient AVANT elle et ce qu'elle y a écrit. C'est ce qui permet :
//   • d'annuler un départ (« Annuler ce pointage », 5 min) en rendant aux présences leur état
//     d'avant, au lieu d'effacer à l'aveugle une saisie de la Direction ;
//   • de savoir si la Direction a CORRIGÉ la journée depuis (`journeeTouchee`) : on ne réécrit
//     alors plus rien — ni pause saisie après coup, ni annulation.

import type { Prisma } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { heuresNettes } from "@/lib/pointage-jour";
import { appliquerAuxPresences, etatPresences, type EtatPresences } from "@/lib/pointage-presences";

type Tx = Prisma.TransactionClient;

export const ENTITE_POINTAGE = "Pointage";
export const CHAMP_CLOTURE = "cloture";

/** Ce que la clôture a écrit, relu depuis le journal. */
export type Cloture = {
  avant: EtatPresences;
  heures: number;
  presencesEcrites: boolean;
  /** Le code de présence du jour juste après la clôture (P/F créé, ou celui qui existait). */
  code: string | null;
};

type PointageAClore = { id: string; employeeId: string; date: Date; heureDebut: Date };

/**
 * Clôt la journée à l'instant du départ scanné, avec `pauseMinutes` (`parDefaut` : la pause de
 * 30 min posée d'office). À appeler SOUS le verrou de la ligne du pointage. Ne clôt jamais une
 * journée déjà close (`heureFin: null` dans le filtre).
 */
export async function clore(
  tx: Tx,
  p: { pointage: PointageAClore; heureFin: Date; pauseMinutes: number; parDefaut: boolean; userId: string },
): Promise<{ heures: number; presencesEcrites: boolean }> {
  const { pointage } = p;
  const heures = heuresNettes(pointage.heureDebut, p.heureFin, p.pauseMinutes);
  const avant = await etatPresences(tx, pointage.employeeId, pointage.date);
  const clos = await tx.pointage.updateMany({
    where: { id: pointage.id, heureFin: null },
    data: { heureFin: p.heureFin, pauseMinutes: p.pauseMinutes, pauseParDefaut: p.parDefaut },
  });
  if (clos.count === 0) throw new Error("Votre journée est déjà close.");
  const presencesEcrites = await appliquerAuxPresences(tx, pointage.employeeId, pointage.date, heures);
  const apres = await etatPresences(tx, pointage.employeeId, pointage.date);
  await journaliser(tx, {
    entite: ENTITE_POINTAGE,
    entiteId: pointage.id,
    champ: CHAMP_CLOTURE,
    ancienneValeur: JSON.stringify(avant),
    nouvelleValeur: JSON.stringify({
      heureFin: p.heureFin.toISOString(),
      pauseMinutes: p.pauseMinutes,
      pauseParDefaut: p.parDefaut,
      heures,
      presencesEcrites,
      code: apres.code,
    }),
    userId: p.userId,
  });
  return { heures, presencesEcrites };
}

/** La DERNIÈRE clôture journalisée de ce pointage (null s'il n'a jamais été clos par un scan). */
export async function lireCloture(tx: Tx, pointageId: string): Promise<Cloture | null> {
  const ligne = await tx.journalAudit.findFirst({
    where: { entite: ENTITE_POINTAGE, entiteId: pointageId, champ: CHAMP_CLOTURE },
    orderBy: { date: "desc" },
    select: { ancienneValeur: true, nouvelleValeur: true },
  });
  if (!ligne?.ancienneValeur || !ligne.nouvelleValeur) return null;
  try {
    const avant = JSON.parse(ligne.ancienneValeur) as EtatPresences;
    const apres = JSON.parse(ligne.nouvelleValeur) as { heures: number; presencesEcrites: boolean; code: string | null };
    return { avant, heures: apres.heures, presencesEcrites: apres.presencesEcrites === true, code: apres.code ?? null };
  } catch {
    return null;
  }
}

/**
 * Vrai si Présences + Heures ne portent plus ce que le pointage y a écrit : la Direction a corrigé
 * la journée (heures retouchées ou effacées, code changé). Prudent : sans clôture journalisée, on
 * considère la journée comme touchée. Les heures attendues se recalculent depuis le pointage
 * (arrivée, départ, pause EN VIGUEUR), pour rester justes après une pause saisie après coup.
 */
export async function journeeTouchee(
  tx: Tx,
  pointage: PointageAClore & { heureFin: Date | null; pauseMinutes: number },
): Promise<boolean> {
  if (!pointage.heureFin) return true;
  const cloture = await lireCloture(tx, pointage.id);
  if (!cloture) return true;
  const maintenant = await etatPresences(tx, pointage.employeeId, pointage.date);
  // Rien n'avait été écrit (congé approuvé ce jour) : toute heure apparue depuis vient d'ailleurs.
  if (!cloture.presencesEcrites) return maintenant.heures !== null;
  const attendu = heuresNettes(pointage.heureDebut, pointage.heureFin, pointage.pauseMinutes);
  return maintenant.heures !== attendu || maintenant.code !== cloture.code;
}
