"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte, exigerPeriodesOuvertes } from "@/lib/cloture-stock";

const dec = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Enregistre des achats de légumes frais (multi-lignes) : montant saisi en CDF, converti en USD
 * au taux partagé (Config). Journal daté — ne touche pas au stock permanent.
 */
export async function creerAchatsLegumes(formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");

  const dateStr = String(formData.get("date") ?? "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();
  await exigerPeriodeOuverte(date);
  const noms = formData.getAll("legume").map((v) => String(v).trim());
  const unites = formData.getAll("unite").map((v) => String(v).trim());
  const qtes = formData.getAll("quantite").map(dec);
  const cdfs = formData.getAll("montantCDF").map(dec);

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  const lignes = noms
    .map((legume, i) => ({ legume, unite: unites[i] || null, quantite: qtes[i] ?? 0, montantCDF: cdfs[i] ?? 0 }))
    .filter((l) => l.legume && l.quantite > 0);
  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (légume + quantité).");

  await prisma.achatLegume.createMany({
    data: lignes.map((l) => ({
      date, legume: l.legume, unite: l.unite, quantite: l.quantite,
      montantCDF: l.montantCDF > 0 ? l.montantCDF : null,
      montantUSD: l.montantCDF > 0 && taux ? l.montantCDF / taux : null,
      tauxChangeUtilise: l.montantCDF > 0 && taux ? taux : null,
      creeParId: user.id,
    })),
  });
  await journaliser(prisma, { entite: "AchatLegume", entiteId: `${lignes.length} ligne(s)`, champ: "achat legumes", nouvelleValeur: date.toISOString().slice(0, 10), userId: user.id });
  revalidatePath("/stock/legumes");
}

/** Supprime une ligne d'achat de légumes. */
export async function supprimerAchatLegume(id: string) {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer
  const a = await prisma.achatLegume.findUniqueOrThrow({ where: { id } });
  await exigerPeriodeOuverte(new Date(a.date));
  await prisma.achatLegume.delete({ where: { id } });
  await journaliser(prisma, { entite: "AchatLegume", entiteId: id, champ: "suppression", ancienneValeur: `${a.legume} ${a.quantite}`, userId: user.id });
  revalidatePath("/stock/legumes");
}

/** Supprime plusieurs achats de légumes d'un coup (Direction). */
export async function supprimerAchatsLegumesEnLot(ids: string[]) {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const dates = await prisma.achatLegume.findMany({ where: { id: { in: uniq } }, select: { date: true } });
  await exigerPeriodesOuvertes(dates.map((d) => new Date(d.date)));
  const n = await prisma.achatLegume.deleteMany({ where: { id: { in: uniq } } });
  await journaliser(prisma, { entite: "AchatLegume", entiteId: "lot", champ: "suppression", nouvelleValeur: `${n.count} achat(s)`, userId: user.id });
  revalidatePath("/stock/legumes");
}
