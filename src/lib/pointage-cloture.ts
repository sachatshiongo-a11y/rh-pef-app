import "server-only";

// La CLÔTURE d'une journée pointée par scan, et ce qu'il faut pour la défaire proprement.
//
// Décision de la Direction du 2026-09-29 : le départ scanné clôt la journée TOUT DE SUITE, avec la
// pause par défaut (30 min) quand le salarié n'a pas saisi la sienne. Clore = `heureFin` à
// l'instant du SCAN, la pause, puis les heures PAYABLES écrites aux présences (comme avant).
// Décision d'argent du même jour : la pause par défaut n'est PAS déduite — elle est stockée
// `pauseParDefaut = true` avec `pauseMinutes = 0` (les minutes DÉDUITES), et les heures viennent
// de `heuresPayables` (`pointage-jour.ts`), la seule fonction qui retire une pause.
//
// Chaque clôture est JOURNALISÉE (entité « Pointage », champ « cloture ») avec ce que Présences +
// Heures portaient AVANT elle et ce qu'elle y a écrit. C'est ce qui permet :
//   • d'annuler un départ (« Annuler ce pointage », 5 min) en rendant aux présences leur état
//     d'avant, au lieu d'effacer à l'aveugle une saisie de la Direction ;
//   • de savoir si la Direction a CORRIGÉ la journée depuis (`journeeTouchee`) : on ne réécrit
//     alors plus rien — ni pause saisie après coup, ni annulation.

import type { Prisma } from "@prisma/client";
import { journaliser } from "@/lib/audit";
import { heuresPayables, type PausePointage } from "@/lib/pointage-jour";
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
 * La pause à ÉCRIRE sur le pointage : `pauseSaisie` = minutes saisies par le salarié (déduites) ;
 * `null` = pas de saisie → la pause par défaut, marquée comme telle et NON déduite (0 min).
 */
export function pauseAEcrire(pauseSaisie: number | null): PausePointage {
  return pauseSaisie === null
    ? { pauseMinutes: 0, pauseParDefaut: true }
    : { pauseMinutes: pauseSaisie, pauseParDefaut: false };
}

/**
 * Clôt la journée à l'instant du départ scanné, avec la pause saisie (`pauseSaisie`, déduite) ou,
 * à défaut (`null`), la pause par défaut (affichée, NON déduite). À appeler SOUS le verrou de la
 * ligne du pointage. Ne clôt jamais une journée déjà close (`heureFin: null` dans le filtre).
 * Renvoie aussi la pause écrite, pour que l'appelant ne la reconstitue pas.
 */
export async function clore(
  tx: Tx,
  p: { pointage: PointageAClore; heureFin: Date; pauseSaisie: number | null; userId: string },
): Promise<{ heures: number; presencesEcrites: boolean; pause: PausePointage }> {
  const { pointage } = p;
  const pause = pauseAEcrire(p.pauseSaisie);
  const heures = heuresPayables({ heureDebut: pointage.heureDebut, heureFin: p.heureFin, ...pause });
  const avant = await etatPresences(tx, pointage.employeeId, pointage.date);
  const clos = await tx.pointage.updateMany({
    where: { id: pointage.id, heureFin: null },
    data: { heureFin: p.heureFin, ...pause },
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
      pauseMinutes: pause.pauseMinutes,
      pauseParDefaut: pause.pauseParDefaut,
      heures,
      presencesEcrites,
      code: apres.code,
    }),
    userId: p.userId,
  });
  return { heures, presencesEcrites, pause };
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
  pointage: PointageAClore & PausePointage & { heureFin: Date | null },
): Promise<boolean> {
  if (!pointage.heureFin) return true;
  const cloture = await lireCloture(tx, pointage.id);
  if (!cloture) return true;
  const maintenant = await etatPresences(tx, pointage.employeeId, pointage.date);
  // Rien n'avait été écrit (congé approuvé ce jour) : toute heure apparue depuis vient d'ailleurs.
  if (!cloture.presencesEcrites) return maintenant.heures !== null;
  const attendu = heuresPayables({ ...pointage, heureFin: pointage.heureFin });
  return maintenant.heures !== attendu || maintenant.code !== cloture.code;
}
