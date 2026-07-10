import "server-only";
import { prisma } from "@/lib/prisma";

// Clôture mensuelle du stock : une fois un mois clôturé (Paramètres → Direction), plus aucun
// mouvement daté dans ce mois ne peut être créé ou supprimé — les chiffres deviennent figés,
// comme la paie validée côté RH. Réversible (rouvrir le mois).

/** Lève une erreur si la période (année/mois) de `date` est clôturée. */
export async function exigerPeriodeOuverte(date: Date) {
  const annee = date.getUTCFullYear();
  const mois = date.getUTCMonth() + 1;
  const cloture = await prisma.clotureStock.findUnique({ where: { annee_mois: { annee, mois } } });
  if (cloture) {
    throw new Error(`La période ${String(mois).padStart(2, "0")}/${annee} est clôturée : aucun mouvement de stock ne peut y être ajouté ou supprimé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)`);
  }
}

/** Idem pour plusieurs dates d'un coup (une seule requête). */
export async function exigerPeriodesOuvertes(dates: Date[]) {
  const paires = [...new Set(dates.map((d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`))]
    .map((s) => { const [a, m] = s.split("-").map(Number); return { annee: a, mois: m }; });
  if (paires.length === 0) return;
  const clotures = await prisma.clotureStock.findMany({ where: { OR: paires } });
  if (clotures.length > 0) {
    const c = clotures[0];
    throw new Error(`La période ${String(c.mois).padStart(2, "0")}/${c.annee} est clôturée : aucun mouvement de stock ne peut y être ajouté ou supprimé. (Direction : Paramètres → Clôture mensuelle pour la rouvrir.)`);
  }
}
