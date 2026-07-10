import Link from "next/link";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { BoutonSupprimerTout } from "../_rapport/bouton-supprimer-tout";
import { ImportBonsCommandeBtn } from "./import-bc-btn";
import { CommandesListe } from "./commandes-liste";
import { supprimerTousBonsCommande } from "./actions";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

type SP = { annee?: string; mois?: string; fournisseurId?: string };
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export default async function CommandesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const annee = sp.annee && /^\d{4}$/.test(sp.annee) ? Number(sp.annee) : undefined;
  const mois = sp.mois && /^\d{1,2}$/.test(sp.mois) ? Number(sp.mois) : undefined;
  const fournisseurId = sp.fournisseurId || undefined;

  const where: Prisma.BonDeCommandeWhereInput = {
    ...(annee ? { annee } : {}),
    ...(mois ? { mois } : {}),
    ...(fournisseurId ? { fournisseurId } : {}),
  };
  const [commandes, fournisseurs, anneesRaw] = await Promise.all([
    prisma.bonDeCommande.findMany({ where, orderBy: [{ annee: "desc" }, { sequence: "desc" }], include: { fournisseur: { select: { nom: true } }, _count: { select: { lignes: true } } } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    prisma.bonDeCommande.findMany({ distinct: ["annee"], select: { annee: true }, orderBy: { annee: "desc" } }),
  ]);
  const annees = anneesRaw.map((a) => a.annee);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Bons de commande</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BoutonRapport types={[{ value: "BONS_COMMANDE", label: "Bons de commande" }]} />
          {estDirection && <ImportBonsCommandeBtn />}
          <Link href="/stock/commandes/nouveau" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">+ Nouveau bon de commande</Link>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <select name="annee" defaultValue={annee ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Toutes les années</option>
          {annees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select name="mois" defaultValue={mois ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les mois</option>
          {MOIS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select name="fournisseurId" defaultValue={fournisseurId ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5">
          <option value="">Tous les fournisseurs</option>
          {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Filtrer</button>
        {estDirection && <Link href="/stock/commandes" className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50">Réinitialiser</Link>}
        <BoutonSupprimerTout estDirection={estDirection} action={supprimerTousBonsCommande} libelle="Supprimer TOUS les bons de commande ?" />
      </form>

      <CommandesListe
        estDirection={estDirection}
        commandes={commandes.map((c) => ({
          id: c.id, numero: c.numero, fournisseurId: c.fournisseurId ?? null, fournisseurNom: c.fournisseur?.nom ?? null,
          date: new Date(c.date).toISOString(), nbLignes: c._count.lignes, total: Number(c.totalUSD), statut: c.statut, documentUrl: c.documentUrl ?? null,
        }))}
      />
    </div>
  );
}
