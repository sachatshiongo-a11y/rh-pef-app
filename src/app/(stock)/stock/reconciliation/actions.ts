"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { envoyerPush } from "@/lib/push";
import { SEUIL_TOLERANCE_PCT } from "@/lib/stock";

const num = (s: string) => Number(String(s).replace(",", ".").trim());

/**
 * Applique un comptage physique : ajuste le stock au réel, ARCHIVE la fiche (SessionComptage),
 * et exige une explication pour tout écart > 10 %. Si des écarts dépassent le seuil, notifie la
 * Direction et le responsable stock.
 */
export async function appliquerComptage(formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");

  const ids = formData.getAll("recon_articleId").map(String);
  const phys = formData.getAll("recon_physique").map((v) => String(v).trim());
  const expl = formData.getAll("recon_explication").map((v) => String(v).trim());
  const domaineRaw = String(formData.get("domaine") ?? "").trim();
  const domaine = ["NOURRITURE", "BOISSON", "AUTRE"].includes(domaineRaw) ? domaineRaw : null;
  const origine = String(formData.get("origine") ?? "").trim() || `Comptage ${new Date().toLocaleDateString("fr-FR")}`;

  const comptes = ids
    .map((articleId, i) => ({ articleId, physique: phys[i], explication: expl[i] ?? "" }))
    .filter((c) => c.articleId && c.physique !== "" && Number.isFinite(num(c.physique)))
    .map((c) => ({ articleId: c.articleId, physique: num(c.physique), explication: c.explication }));

  if (comptes.length === 0) throw new Error("Saisissez au moins un comptage physique.");

  const [stocks, articles] = await Promise.all([
    prisma.stock.findMany({ where: { articleId: { in: comptes.map((c) => c.articleId) } } }),
    prisma.articleStock.findMany({ where: { id: { in: comptes.map((c) => c.articleId) } }, select: { id: true, designation: true } }),
  ]);
  const theo = new Map(stocks.map((s) => [s.articleId, Number(s.quantite)]));
  const nom = new Map(articles.map((a) => [a.id, a.designation]));

  // Calcule les écarts + repère les lignes hors tolérance.
  const lignes = comptes.map((c) => {
    const t = theo.get(c.articleId) ?? 0;
    const ecart = c.physique - t;
    const pct = t !== 0 ? (ecart / Math.abs(t)) * 100 : (ecart !== 0 ? 100 : 0);
    const horsTol = Math.abs(ecart) > 0.0001 && (t === 0 ? c.physique !== 0 : Math.abs(pct) > SEUIL_TOLERANCE_PCT);
    return { ...c, theorique: t, ecart, pct, horsTol, designation: nom.get(c.articleId) ?? "" };
  });

  const sansExplication = lignes.filter((l) => l.horsTol && !l.explication);
  if (sansExplication.length > 0) {
    throw new Error(`Écart supérieur à ${SEUIL_TOLERANCE_PCT} % : une explication est requise pour ${sansExplication.map((l) => l.designation).join(", ")}.`);
  }

  const nbEcarts = lignes.filter((l) => Math.abs(l.ecart) > 0.0001).length;
  const nbHorsTol = lignes.filter((l) => l.horsTol).length;

  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.sessionComptage.create({
      data: { domaine, nbArticles: lignes.length, nbEcarts, nbHorsTol, creeParId: user.id },
    });
    for (const l of lignes) {
      await tx.ligneComptage.create({
        data: {
          sessionId: s.id, articleId: l.articleId, designation: l.designation,
          theorique: l.theorique, physique: l.physique, ecart: l.ecart,
          ecartPct: Number.isFinite(l.pct) ? Math.round(l.pct * 100) / 100 : null,
          explication: l.explication || null,
        },
      });
      if (Math.abs(l.ecart) > 0.0001) {
        await tx.mouvementStock.create({ data: { articleId: l.articleId, type: "AJUSTEMENT", quantite: Math.abs(l.ecart), origine, creeParId: user.id } });
      }
      await tx.stock.upsert({ where: { articleId: l.articleId }, update: { quantite: l.physique }, create: { articleId: l.articleId, quantite: l.physique } });
    }
    return s;
  });

  // Notifie Direction + responsable stock si des écarts dépassent la tolérance.
  if (nbHorsTol > 0) {
    const cibles = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "STOCK"] }, actif: true }, select: { id: true } });
    await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `Comptage du ${new Date().toLocaleDateString("fr-FR")} : ${nbHorsTol} écart(s) supérieur(s) à ${SEUIL_TOLERANCE_PCT} %.`, lien: `/stock/archives/${session.id}`, refId: session.id } });
    await envoyerPush(cibles.map((c) => c.id), { title: "Écart d'inventaire", body: `${nbHorsTol} écart(s) > ${SEUIL_TOLERANCE_PCT} % lors du comptage.`, url: `/stock/archives/${session.id}`, tag: `comptage-${session.id}` });
  }

  await journaliser(prisma, { entite: "SessionComptage", entiteId: session.id, champ: "comptage", nouvelleValeur: `${nbEcarts} écart(s), ${nbHorsTol} hors tolérance`, userId: user.id });
  revalidatePath("/stock/reconciliation");
  revalidatePath("/stock/archives");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
}
