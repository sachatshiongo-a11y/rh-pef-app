import "server-only";
import { prisma } from "@/lib/prisma";

// Clôture mensuelle du stock : une fois un mois clôturé (Paramètres → Direction), plus aucun
// mouvement daté dans ce mois ne peut être créé ou supprimé — les chiffres deviennent figés,
// comme la paie validée côté RH. Réversible (rouvrir le mois).

// BORNE BASSE (relecture 2026-09-28) : clôturer un mois fige aussi TOUT ce qui le précède — un
// mouvement daté d'un mois antérieur changerait les stocks des mois déjà clôturés (dont les
// instantanés sont figés). Un mois rouvert au milieu reste donc figé tant qu'un mois POSTÉRIEUR
// est clôturé : pour corriger mars quand juin est clos, la Direction rouvre avril, mai et juin.
// Une seule fonction pour tous les chemins (Liste d'achat, Mouvements, Légumes, Factures, imports,
// suppressions) : la règle ne peut pas diverger d'un écran à l'autre.

const rang = (annee: number, mois: number) => annee * 12 + (mois - 1);
const jjmmaaaa = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");

/** Dernier mois clôturé du stock (borne de la période figée), ou null si rien n'est clôturé. */
export type BorneCloture = { annee: number; mois: number } | null;

export async function derniereClotureStock(): Promise<BorneCloture> {
  return prisma.clotureStock.findFirst({ orderBy: [{ annee: "desc" }, { mois: "desc" }], select: { annee: true, mois: true } });
}

/** Vrai si la date (jour pur, UTC) tombe dans la période figée : mois clôturé ou antérieur. PURE. */
export function estDansPeriodeFigee(date: Date, borne: BorneCloture): boolean {
  return borne !== null && rang(date.getUTCFullYear(), date.getUTCMonth() + 1) <= rang(borne.annee, borne.mois);
}

/** Lève une erreur si la date tombe dans un mois clôturé ou dans un mois qui précède le dernier mois clôturé. */
export async function exigerPeriodeOuverte(date: Date) {
  await exigerPeriodesOuvertes([date]);
}

/** Idem pour plusieurs dates d'un coup (une seule requête). */
export async function exigerPeriodesOuvertes(dates: Date[]) {
  if (dates.length === 0) return;
  const derniere = await derniereClotureStock();
  if (!derniere) return;
  const borne = rang(derniere.annee, derniere.mois);
  const figee = dates.find((d) => estDansPeriodeFigee(d, derniere));
  if (!figee) return;
  const periode = `${String(derniere.mois).padStart(2, "0")}/${derniere.annee}`;
  if (rang(figee.getUTCFullYear(), figee.getUTCMonth() + 1) === borne) {
    throw new Error(`La période ${periode} est clôturée : aucun mouvement de stock ne peut y être ajouté ou supprimé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)`);
  }
  throw new Error(`La période ${periode} est clôturée : le stock est figé jusqu'à ce mois inclus, aucun mouvement daté du ${jjmmaaaa(figee)} ne peut être ajouté ou supprimé. (Direction : Paramètres → Clôture mensuelle, rouvrir les mois jusqu'à celui de cette date.)`);
}
