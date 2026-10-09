import "server-only";
import { prisma } from "@/lib/prisma";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { joursAvantDlc } from "@/lib/achats-doublons";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";

// DLC proches (tableau de bord Stock, demande de la Direction du 2026-10-08) : les ENTRÉES récentes
// dont la DLC saisie sur la Liste d'achat tombe bientôt, ou est passée. INDICATIF : le stock n'est pas
// suivi par lot — on ne sait pas si la quantité entrée est encore au dépôt, ni ce qui a été consommé
// en premier. Les jours se comptent au jour CIVIL de Kinshasa (jamais le jour UTC du serveur).

/** Entrées regardées : celles des 60 derniers jours. */
export const DLC_ENTREES_JOURS = 60;
/** Horizon : DLC dans les 7 prochains jours (ou déjà passée). */
export const DLC_HORIZON_JOURS = 7;

export type DlcProche = {
  mouvementId: string;
  articleId: string;
  designation: string;
  unite: string | null;
  quantite: number;
  dateEntreeISO: string;
  dlcISO: string;
  /** Jours avant la DLC : négatif = dépassée, 0 = aujourd'hui. */
  jours: number;
};

const decaler = (iso: string, jours: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d;
};
const iso = (d: Date) => d.toISOString().slice(0, 10); // colonne @db.Date : date PURE

/** Les DLC proches, de la plus urgente à la moins urgente (`max` lignes, et le nombre total). */
export async function dlcProches(maintenant: Date, max = 10): Promise<{ lignes: DlcProche[]; total: number; aujourdhuiISO: string }> {
  const aujourdhuiISO = jourCourantKinshasaISO(maintenant);
  const where = {
    type: "ENTREE" as const,
    date: { gte: decaler(aujourdhuiISO, -DLC_ENTREES_JOURS) },
    dlc: { not: null, lte: decaler(aujourdhuiISO, DLC_HORIZON_JOURS) },
    article: { actif: true }, // un article mis de côté n'a plus rien à surveiller
  };
  const [mouvements, total] = await Promise.all([
    prisma.mouvementStock.findMany({
      where,
      orderBy: [{ dlc: "asc" }, { date: "desc" }, { createdAt: "desc" }],
      take: max,
      select: { id: true, articleId: true, quantite: true, date: true, dlc: true, article: { select: { ...CHAMPS_LIBELLE, unite: true } } },
    }),
    prisma.mouvementStock.count({ where }),
  ]);
  return {
    aujourdhuiISO,
    total,
    lignes: mouvements.map((m) => {
      const dlcISO = iso(m.dlc as Date);
      return {
        mouvementId: m.id, articleId: m.articleId, designation: libelleArticle(m.article), unite: m.article.unite,
        quantite: Number(m.quantite), dateEntreeISO: iso(m.date), dlcISO, jours: joursAvantDlc(dlcISO, aujourdhuiISO),
      };
    }),
  };
}
