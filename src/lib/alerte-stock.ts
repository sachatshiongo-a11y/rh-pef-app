import "server-only";
import { prisma } from "@/lib/prisma";
import { envoyerPush } from "@/lib/push";
import { niveauAlerte, ALERTE_LABEL, type NiveauAlerte } from "@/lib/stock";

/** Niveaux d'alerte actuels des articles donnés (à appeler AVANT une opération pour comparer). */
export async function niveauxActuels(articleIds: string[]): Promise<Map<string, NiveauAlerte>> {
  const m = new Map<string, NiveauAlerte>();
  if (articleIds.length === 0) return m;
  const stocks = await prisma.stock.findMany({ where: { articleId: { in: articleIds } } });
  for (const s of stocks) m.set(s.articleId, niveauAlerte(s.quantite, s.seuilUrgent, s.stockMinimum));
  return m;
}

/**
 * Après une opération qui a fait baisser le stock, notifie Direction + responsable stock des
 * articles qui VIENNENT DE PASSER en « À réapprovisionner » ou « Urgent » (cloche + push).
 */
export async function notifierNouvellesAlertes(articleIds: string[], avant: Map<string, NiveauAlerte>) {
  if (articleIds.length === 0) return;
  const stocks = await prisma.stock.findMany({
    where: { articleId: { in: articleIds } },
    include: { article: { select: { designation: true } } },
  });
  const nouvelles: { designation: string; niveau: NiveauAlerte }[] = [];
  for (const s of stocks) {
    const apres = niveauAlerte(s.quantite, s.seuilUrgent, s.stockMinimum);
    const av = avant.get(s.articleId) ?? "OK";
    // Nouvelle alerte = on tombe en URGENT/APPRO alors qu'on n'y était pas (ou on s'aggrave vers URGENT).
    if ((apres === "URGENT" && av !== "URGENT") || (apres === "APPRO" && av === "OK")) {
      nouvelles.push({ designation: s.article.designation, niveau: apres });
    }
  }
  if (nouvelles.length === 0) return;

  const urgents = nouvelles.filter((n) => n.niveau === "URGENT");
  const message = `Stock bas — ${nouvelles.map((n) => `${n.designation} (${ALERTE_LABEL[n.niveau]})`).join(", ")}`.slice(0, 480);
  const cibles = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "STOCK"] }, actif: true }, select: { id: true } });
  await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message, lien: `/stock/catalogue/nourriture?alerte=${urgents.length ? "URGENT" : "APPRO"}`, refId: "alerte-stock" } });
  await envoyerPush(cibles.map((c) => c.id), {
    title: urgents.length ? "Articles en rupture (urgent)" : "Articles à réapprovisionner",
    body: message.slice(0, 180),
    url: "/stock/catalogue/nourriture",
    tag: "alerte-stock",
  });
}
