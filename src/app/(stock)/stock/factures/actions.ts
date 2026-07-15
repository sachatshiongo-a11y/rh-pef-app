"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { parserClasseurFactures } from "@/lib/import-factures-excel";
import { extraireFacturePDF } from "@/lib/import-facture-pdf";
import { meilleurFournisseur } from "@/lib/fournisseur-match";
import { meilleurArticle } from "@/lib/article-match";
import { Prisma } from "@prisma/client";

const normNom = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function televerserFacturePdf(file: File, fournisseurNom: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const dest = `factures/${(normNom(fournisseurNom) || "facture").slice(0, 30)}-${Date.now().toString(36)}.pdf`;
  const res = await fetch(`${base}/storage/v1/object/employes/${dest}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/pdf", "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error(`Téléversement du PDF échoué (${res.status}).`);
  return `/fichiers/${dest}`; // bucket privé — servi derrière session
}

const EXT_MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

/** Téléverse un document de facture (PDF ou image scannée) et renvoie son lien applicatif privé. */
async function televerserDocument(file: File, fournisseurNom: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ext = ((file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "")) || "pdf";
  const mime = EXT_MIME[ext] || file.type || "application/octet-stream";
  const dest = `factures/${(normNom(fournisseurNom) || "facture").slice(0, 30)}-${Date.now().toString(36)}.${ext}`;
  const res = await fetch(`${base}/storage/v1/object/employes/${dest}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": mime, "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error(`Téléversement du document échoué (${res.status}).`);
  return `/fichiers/${dest}`; // bucket privé — servi derrière session
}

/** Joint (ou remplace) le document d'origine d'une facture existante — PDF ou scan image. Direction uniquement. */
export async function attacherDocumentFacture(id: string, formData: FormData) {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) throw new Error("Aucun fichier sélectionné.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Fichier trop volumineux (max 25 Mo).");
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id }, select: { fournisseurNom: true } });
  const url = await televerserDocument(file, f.fournisseurNom);
  await prisma.factureFournisseur.update({ where: { id }, data: { documentUrl: url } });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: "documentUrl", nouvelleValeur: "joint", userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath(`/stock/factures/${id}`);
}

/** Lit un PDF de facture et renvoie un pré-remplissage complet (fournisseur, date, n°, LIGNES) — Direction. À CONFIRMER. */
export type LigneAnalyse = {
  designation: string; quantite: number; prixUnitaireUSD: number; total: number;
  articleId: string | null; articleNom: string | null; unite: string | null; // article du catalogue rapproché
};
export type AnalyseFacture = {
  montant: number | null; date: string | null; numero: string | null;
  fournisseur: { nom: string | null; rccm: string | null; idNational: string | null; telephone: string | null; email: string | null; adresse: string | null; ville: string | null };
  match: { id: string; nom: string; score: number } | null; // fournisseur existant proche
  lignes: LigneAnalyse[];
};
const VIDE: AnalyseFacture = { montant: null, date: null, numero: null, fournisseur: { nom: null, rccm: null, idNational: null, telephone: null, email: null, adresse: null, ville: null }, match: null, lignes: [] };

export async function analyserFacturePDF(formData: FormData): Promise<AnalyseFacture> {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);
  const file = formData.get("facturePdf");
  if (!(file instanceof File) || file.size === 0) return VIDE;
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  try {
    const ex = await extraireFacturePDF(await file.arrayBuffer(), taux);
    // Rapprochement flou avec les fournisseurs existants (« Kathy » ↔ « Maison Kathy »).
    let match: AnalyseFacture["match"] = null;
    if (ex.fournisseur.nom) {
      const liste = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
      const m = meilleurFournisseur(ex.fournisseur.nom, liste);
      if (m) match = { id: m.id, nom: m.nom, score: Math.round(m.score * 100) / 100 };
    }
    // Rapprochement de chaque ligne avec un article du catalogue, par mots-clés
    // (« Saumon frais 1KG » → « Filet de saumon norvégien »).
    const articlesCat = await prisma.articleStock.findMany({ where: { actif: true }, select: { id: true, designation: true, unite: true } });
    const pourMatch = articlesCat.map((a) => ({ id: a.id, designation: a.designation }));
    const lignes: LigneAnalyse[] = ex.lignes.map((l) => {
      const m = meilleurArticle(l.designation, pourMatch);
      const art = m ? articlesCat.find((x) => x.id === m.id) : null;
      return {
        designation: art ? art.designation : l.designation,
        quantite: l.quantite,
        prixUnitaireUSD: l.prixUnitaireUSD,
        total: l.totalLigneUSD,
        articleId: art?.id ?? null,
        articleNom: art?.designation ?? null,
        unite: art?.unite ?? l.unite ?? null,
      };
    });
    return { montant: ex.montant, date: ex.date, numero: ex.numero, fournisseur: ex.fournisseur, match, lignes };
  } catch {
    return VIDE;
  }
}

/**
 * Importe un ou plusieurs classeurs Excel « Suivi des factures fournisseurs ». Direction uniquement.
 * Rattache chaque facture au fournisseur existant (par nom) ou le crée ; ignore les doublons
 * (même fournisseur/mois/année/montant/n°) pour permettre des imports répétés.
 */
export async function importerFacturesExcel(formData: FormData): Promise<{ importees: number; ignorees: number; fournisseursCrees: string[]; erreurs: string[] }> {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);

  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) return { importees: 0, ignorees: 0, fournisseursCrees: [], erreurs: ["Aucun fichier."] };

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  const anneeCourante = config?.anneeCourante ?? new Date().getFullYear();

  const erreurs: string[] = [];
  const lignes = [] as Awaited<ReturnType<typeof parserClasseurFactures>>;
  for (const f of fichiers) {
    const anneeFichier = Number((f.name.match(/(20\d{2})/) ?? [])[1]) || anneeCourante;
    try {
      lignes.push(...(await parserClasseurFactures(await f.arrayBuffer(), anneeFichier, taux)));
    } catch (e) {
      erreurs.push(`${f.name} : ${e instanceof Error ? e.message : "illisible"}`);
    }
  }
  if (lignes.length === 0) return { importees: 0, ignorees: 0, fournisseursCrees: [], erreurs: erreurs.length ? erreurs : ["Aucune facture trouvée dans le(s) fichier(s)."] };

  // Fournisseurs : rattachement ou création.
  const fours = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
  const parNom = new Map(fours.map((x) => [normNom(x.nom), x.id]));
  const fournisseursCrees: string[] = [];
  for (const nom of [...new Set(lignes.map((l) => l.fournisseurNom))]) {
    if (parNom.has(normNom(nom))) continue;
    const cree = await prisma.fournisseur.create({ data: { nom, pays: "République démocratique du Congo" } });
    parNom.set(normNom(nom), cree.id);
    fournisseursCrees.push(nom);
  }

  // Dé-duplication (signature) contre l'existant + à l'intérieur du lot.
  const sig = (r: { annee: number; mois: number; fournisseurNom: string; montantUSD: number; numero: string | null }) =>
    `${r.annee}|${r.mois}|${normNom(r.fournisseurNom)}|${r.montantUSD.toFixed(2)}|${r.numero ?? ""}`;
  const existantes = await prisma.factureFournisseur.findMany({ select: { annee: true, mois: true, fournisseurNom: true, montantUSD: true, numero: true } });
  const vues = new Set(existantes.map((e) => sig({ annee: e.annee, mois: e.mois, fournisseurNom: e.fournisseurNom, montantUSD: Number(e.montantUSD), numero: e.numero })));

  const aInserer = lignes.filter((r) => { const s = sig(r); if (vues.has(s)) return false; vues.add(s); return true; });

  if (aInserer.length > 0) {
    await prisma.factureFournisseur.createMany({
      data: aInserer.map((r) => ({
        fournisseurId: parNom.get(normNom(r.fournisseurNom)) ?? null,
        fournisseurNom: r.fournisseurNom, numero: r.numero,
        date: r.date, dateEcheance: r.dateEcheance, datePaiement: r.datePaiement,
        montantUSD: r.montantUSD, montantRegleUSD: r.montantRegleUSD, resteAPayerUSD: r.resteAPayerUSD,
        statut: r.statut, modePaiement: r.modePaiement, mois: r.mois, annee: r.annee,
      })),
    });
    await journaliser(prisma, { entite: "FactureFournisseur", entiteId: "import", champ: "import Excel", nouvelleValeur: `${aInserer.length} facture(s)`, userId: user.id });
  }

  revalidatePath("/stock/factures");
  return { importees: aInserer.length, ignorees: lignes.length - aInserer.length, fournisseursCrees, erreurs };
}

const dec = (v: FormDataEntryValue | null): number => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};
const AUJ = () => new Date().toISOString().slice(0, 10);

function statutDe(reste: number, echeanceISO: string | null): "REGLEE" | "A_REGLER" | "ECHUE_NON_REGLEE" {
  if (reste <= 0.001) return "REGLEE";
  if (echeanceISO && echeanceISO < AUJ()) return "ECHUE_NON_REGLEE";
  return "A_REGLER";
}

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Lie (ou détache si bonDeCommandeId = null) une facture à un bon de commande — à tout moment. */
export async function lierFactureABon(factureId: string, bonDeCommandeId: string | null) {
  const user = await garde();
  const bcId = bonDeCommandeId || null;
  if (bcId) {
    // Cohérence : le BC doit exister (et, si la facture a un fournisseur, être du même fournisseur).
    const facture = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id: factureId }, select: { fournisseurId: true } });
    const bc = await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: bcId }, select: { fournisseurId: true } });
    if (facture.fournisseurId && bc.fournisseurId && facture.fournisseurId !== bc.fournisseurId) {
      throw new Error("Ce bon de commande appartient à un autre fournisseur.");
    }
  }
  await prisma.factureFournisseur.update({ where: { id: factureId }, data: { bonDeCommandeId: bcId } });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: factureId, champ: "bonDeCommande", nouvelleValeur: bcId ?? "(détaché)", userId: user.id });
  revalidatePath(`/stock/factures/${factureId}`);
  if (bcId) revalidatePath(`/stock/commandes/${bcId}`);
  revalidatePath("/stock/factures");
  revalidatePath("/stock/commandes");
}

/** Ajoute une facture fournisseur individuellement (via le formulaire). */
export async function creerFacture(formData: FormData) {
  const user = await garde();
  const fournisseurNom = String(formData.get("fournisseurNom") ?? "").trim();
  const montantUSD = dec(formData.get("montantUSD"));
  const dateStr = String(formData.get("date") ?? "").trim() || null;
  if (!fournisseurNom) throw new Error("Le fournisseur est requis.");
  if (montantUSD <= 0) throw new Error("Le montant doit être supérieur à 0.");

  const fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;
  const echeanceStr = String(formData.get("dateEcheance") ?? "").trim() || null;
  const montantRegleUSD = dec(formData.get("montantRegleUSD"));
  const reste = Math.max(0, montantUSD - montantRegleUSD);
  const ref = dateStr ?? echeanceStr ?? AUJ();
  const d = new Date(ref);

  const bonDeCommandeId = String(formData.get("bonDeCommandeId") ?? "").trim() || null;
  const fac = await prisma.factureFournisseur.create({
    data: {
      fournisseurId, fournisseurNom, bonDeCommandeId,
      numero: String(formData.get("numero") ?? "").trim() || null,
      date: dateStr ? new Date(dateStr) : null,
      dateEcheance: echeanceStr ? new Date(echeanceStr) : null,
      montantUSD, montantRegleUSD, resteAPayerUSD: reste,
      statut: statutDe(reste, echeanceStr),
      modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
      mois: d.getUTCMonth() + 1, annee: d.getUTCFullYear(),
    },
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: fac.id, champ: "creation", nouvelleValeur: `${fournisseurNom} — ${montantUSD} USD`, userId: user.id });
  revalidatePath("/stock/factures");
}

/**
 * Crée une facture fournisseur détaillée (avec ses lignes d'articles et quantités).
 * Le montant total est calculé à partir des lignes.
 */
export async function creerFactureAvecLignes(formData: FormData) {
  const user = await garde();
  const fournisseurNom = String(formData.get("fournisseurNom") ?? "").trim();
  if (!fournisseurNom) throw new Error("Le fournisseur est requis.");

  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const unites = formData.getAll("ligne_unite").map((v) => String(v).trim());
  const qtes = formData.getAll("ligne_quantite").map(dec);
  const prixs = formData.getAll("ligne_prix").map(dec);

  const lignes = desigs
    .map((designation, i) => ({
      articleId: ids[i] || null,
      designation,
      unite: unites[i] || null,
      quantite: qtes[i] ?? 0,
      prixUnitaireUSD: prixs[i] ?? 0,
      totalLigneUSD: (qtes[i] ?? 0) * (prixs[i] ?? 0),
    }))
    .filter((l) => l.designation && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const montantUSD = lignes.reduce((t, l) => t + l.totalLigneUSD, 0);
  const dateStr = String(formData.get("date") ?? "").trim() || null;
  const echeanceStr = String(formData.get("dateEcheance") ?? "").trim() || null;
  const montantRegleUSD = dec(formData.get("montantRegleUSD"));
  const reste = Math.max(0, montantUSD - montantRegleUSD);
  const d = new Date(dateStr ?? echeanceStr ?? AUJ());
  const numero = String(formData.get("numero") ?? "").trim() || null;
  // C'est l'enregistrement de la facture (articles + quantités) qui fait entrer la marchandise
  // en stock — pas la réception du bon de commande (volontairement différenciés). Décochable
  // pour une facture purement financière sans mouvement de marchandise.
  const entrerEnStock = formData.get("entrerEnStock") != null; // case cochée ⇒ présente dans le FormData
  if (entrerEnStock) await exigerPeriodeOuverte(new Date()); // les entrées en stock sont datées du jour
  const origine = `Facture ${fournisseurNom}${numero ? ` ${numero}` : ""}`;

  // Garde-fou anti-double comptage : le même achat saisi dans la Liste d'achat (ou en entrée
  // manuelle) PUIS enregistré ici avec ses lignes ferait entrer le stock DEUX FOIS. On détecte
  // les entrées récentes hors facture sur les mêmes articles et on demande confirmation.
  if (entrerEnStock && formData.get("forcerDoublons") == null) {
    const artIds = lignes.map((l) => l.articleId).filter((x): x is string => !!x);
    if (artIds.length > 0) {
      const ref = dateStr ? new Date(dateStr) : new Date();
      const debut = new Date(ref); debut.setUTCDate(debut.getUTCDate() - 14);
      const fin = new Date(ref); fin.setUTCDate(fin.getUTCDate() + 14);
      const recents = await prisma.mouvementStock.findMany({
        // OR origine null : les lignes sans origine (historiques) doivent aussi être détectées —
        // « NOT contains » seul les exclurait (sémantique SQL des NULL).
        where: { type: "ENTREE", factureId: null, articleId: { in: artIds }, date: { gte: debut, lte: fin }, OR: [{ origine: null }, { origine: { not: { contains: "Inventaire" } } }] },
        include: { article: { select: { designation: true } } },
        orderBy: { date: "desc" },
        take: 6,
      });
      if (recents.length > 0) {
        const liste = recents.slice(0, 5).map((m) => `${m.article.designation} (+${Number(m.quantite)} le ${new Date(m.date).toLocaleDateString("fr-FR")}${m.origine ? ` — ${m.origine}` : ""})`).join(" · ");
        throw new Error(`DOUBLON_POSSIBLE|Des entrées récentes hors facture existent déjà pour ces articles : ${liste}. Si cette facture correspond à ces achats déjà saisis, le stock serait compté deux fois — décochez « entrer en stock », ou supprimez d'abord ces entrées dans la Liste d'achat / Mouvements. Sinon, confirmez avec le bouton « Enregistrer quand même ».`);
      }
    }
  }

  // Rattachement fournisseur : id explicite ; sinon rapprochement flou (« Kathy » ↔ « Maison Kathy »),
  // sinon création automatique du fournisseur avec les coordonnées lues sur la facture.
  let fournisseurId = String(formData.get("fournisseurId") ?? "").trim() || null;
  if (!fournisseurId) {
    const liste = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
    const m = meilleurFournisseur(fournisseurNom, liste, 0.82);
    if (m) fournisseurId = m.id;
    else {
      const coord = (k: string) => String(formData.get(k) ?? "").trim() || null;
      const nf = await prisma.fournisseur.create({
        data: {
          nom: fournisseurNom,
          rccm: coord("nf_rccm"), idNational: coord("nf_idNational"), adresse: coord("nf_adresse"),
          telephone: coord("nf_telephone"), email: coord("nf_email"), ville: coord("nf_ville"),
        },
      });
      fournisseurId = nf.id;
      await journaliser(prisma, { entite: "Fournisseur", entiteId: nf.id, champ: "creation", nouvelleValeur: `${fournisseurNom} (auto — facture)`, userId: user.id });
    }
  }

  // PDF joint (facultatif) — téléversé hors transaction.
  let documentUrl: string | null = null;
  const pdf = formData.get("facturePdf");
  if (pdf instanceof File && pdf.size > 0) documentUrl = await televerserFacturePdf(pdf, fournisseurNom);

  const fac = await prisma.$transaction(async (tx) => {
    const f = await tx.factureFournisseur.create({
      data: {
        fournisseurId,
        fournisseurNom,
        bonDeCommandeId: String(formData.get("bonDeCommandeId") ?? "").trim() || null,
        numero,
        date: dateStr ? new Date(dateStr) : null,
        dateEcheance: echeanceStr ? new Date(echeanceStr) : null,
        montantUSD, montantRegleUSD, resteAPayerUSD: reste,
        statut: statutDe(reste, echeanceStr),
        modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
        documentUrl,
        mois: d.getUTCMonth() + 1, annee: d.getUTCFullYear(),
        lignes: { create: lignes },
      },
    });
    if (entrerEnStock) {
      for (const l of lignes) {
        if (!l.articleId) continue; // seules les lignes reliées à un article du catalogue entrent en stock
        await tx.mouvementStock.create({
          data: {
            articleId: l.articleId, type: "ENTREE", quantite: l.quantite, date: d,
            origine, montantUSD: l.totalLigneUSD, factureId: f.id, creeParId: user.id,
          },
        });
        await tx.stock.upsert({
          where: { articleId: l.articleId },
          update: { quantite: { increment: l.quantite } },
          create: { articleId: l.articleId, quantite: l.quantite },
        });
      }
    }
    return f;
  });

  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: fac.id, champ: "creation", nouvelleValeur: `${fournisseurNom} — ${montantUSD} USD (${lignes.length} ligne(s))${entrerEnStock ? " · entrée stock" : ""}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  redirect(`/stock/factures/${fac.id}`);
}

/** Supprime une facture fournisseur et ANNULE ses entrées de stock (décrémente ce qu'elle avait fait entrer). */
export async function supprimerFacture(id: string) {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer
  const f = await prisma.factureFournisseur.findUniqueOrThrow({
    where: { id },
    include: { mouvements: { where: { type: "ENTREE" } } },
  });
  await prisma.$transaction(async (tx) => {
    // Reprise du stock entré par cette facture, avant suppression (les mouvements passeront à factureId=null).
    for (const m of f.mouvements) {
      await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: Number(m.quantite) } } });
      await tx.mouvementStock.delete({ where: { id: m.id } });
    }
    await tx.factureFournisseur.delete({ where: { id } });
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: "suppression", ancienneValeur: `${f.fournisseurNom} — ${f.montantUSD}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
}

/**
 * CŒUR UNIQUE des règlements : applique un paiement/avoir sur une facture (trace datée,
 * cumul réglé/reste, statut recalculé). Utilisé par « + Paiement / Avoir » ET « Marquer payée »
 * — un seul chemin de code, plus de logique dupliquée qui divergerait.
 */
async function appliquerReglement(userId: string, id: string, p: {
  montant: number; montantCDF?: number | null; taux?: number | null;
  dateStr?: string; mode?: string | null; note?: string | null; type?: "PAIEMENT" | "AVOIR";
}) {
  const type = p.type ?? "PAIEMENT";
  const dateStr = p.dateStr ?? AUJ();
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id } });
  const reste = Number(f.resteAPayerUSD);
  if (p.montant <= 0) throw new Error("Le montant doit être supérieur à 0.");
  if (p.montant > reste + 0.009) throw new Error(`Le ${type === "AVOIR" ? "montant de l'avoir" : "paiement"} (${p.montant.toFixed(2)} $) dépasse le reste à payer (${reste.toFixed(2)} $).`);

  const nouveauRegle = Number(f.montantRegleUSD) + p.montant;
  const nouveauReste = Math.max(0, Number(f.montantUSD) - nouveauRegle);
  const solde = nouveauReste <= 0.001;
  const echeanceISO = f.dateEcheance ? new Date(f.dateEcheance).toISOString().slice(0, 10) : null;

  await prisma.$transaction([
    prisma.paiement.create({ data: { factureId: id, type, date: new Date(dateStr), montantUSD: p.montant, montantCDF: p.montantCDF ?? null, tauxChangeUtilise: p.taux ?? null, modePaiement: p.mode ?? f.modePaiement, note: p.note ?? null, creeParId: userId } }),
    prisma.factureFournisseur.update({
      where: { id },
      data: {
        montantRegleUSD: nouveauRegle,
        resteAPayerUSD: nouveauReste,
        statut: statutDe(nouveauReste, echeanceISO),
        ...(solde ? { datePaiement: new Date(dateStr) } : {}),
      },
    }),
  ]);
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: type === "AVOIR" ? "avoir" : "paiement", nouvelleValeur: `${p.montant.toFixed(2)} $${p.montantCDF ? ` (${p.montantCDF.toLocaleString("fr-FR")} FC)` : ""} (${solde ? "soldée" : `reste ${nouveauReste.toFixed(2)} $`})`, userId });
  revalidatePath("/stock/factures");
  revalidatePath(`/stock/factures/${id}`);
}

/** Marque une facture comme réglée : un paiement du reste à payer, daté d'aujourd'hui. */
export async function marquerPayee(id: string) {
  const user = await garde();
  const f = await prisma.factureFournisseur.findUniqueOrThrow({ where: { id }, select: { resteAPayerUSD: true } });
  const reste = Number(f.resteAPayerUSD);
  if (reste <= 0.001) return; // déjà soldée
  await appliquerReglement(user.id, id, { montant: reste, note: "Marquée payée" });
}

/** Enregistre un paiement (total ou PARTIEL, en USD ou en CDF) ou un AVOIR (note de crédit). */
export async function enregistrerPaiement(id: string, formData: FormData) {
  const user = await garde();
  const type = String(formData.get("type") ?? "PAIEMENT") === "AVOIR" ? "AVOIR" : "PAIEMENT";
  const devise = String(formData.get("devise") ?? "USD") === "CDF" ? "CDF" : "USD";
  const saisi = dec(formData.get("montant"));
  if (saisi <= 0) throw new Error("Le montant doit être supérieur à 0.");
  const dateStr = String(formData.get("date") ?? "").trim() || AUJ();
  const mode = String(formData.get("modePaiement") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (type === "AVOIR" && !note) throw new Error("Indiquez le motif de l'avoir (ex. retour marchandise).");

  // Payé en francs : conversion au taux courant, montant CDF et taux figés sur le paiement.
  let montant = saisi, montantCDF: number | null = null, taux: number | null = null;
  if (devise === "CDF") {
    const config = await prisma.config.findUnique({ where: { id: "singleton" } });
    taux = Number(config?.tauxChangeCDF ?? 0);
    if (!taux) throw new Error("Taux de change non configuré (Paramètres RH).");
    montantCDF = saisi;
    montant = Math.round((saisi / taux) * 100) / 100;
  }

  await appliquerReglement(user.id, id, { montant, montantCDF, taux, dateStr, mode, note, type });
}

/** Marque plusieurs factures comme réglées d'un coup (réglé = montant, reste = 0, payée aujourd'hui). */
export async function marquerPayeesEnLot(ids: string[]) {
  const user = await garde();
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  // Deux requêtes en transaction : trace des paiements (le reste de chaque facture), puis règlement.
  const [, n] = await prisma.$transaction([
    prisma.$executeRaw`
      INSERT INTO "stock"."Paiement" ("id", "factureId", "date", "montantUSD", "modePaiement", "note", "creeParId")
      SELECT gen_random_uuid(), "id", now(), "resteAPayerUSD", "modePaiement", 'Marquée payée (lot)', ${user.id}
      FROM "stock"."FactureFournisseur"
      WHERE "id" IN (${Prisma.join(uniq)}) AND "statut" <> 'REGLEE' AND "resteAPayerUSD" > 0`,
    prisma.$executeRaw`
      UPDATE "stock"."FactureFournisseur"
      SET "montantRegleUSD" = "montantUSD", "resteAPayerUSD" = 0, "statut" = 'REGLEE', "datePaiement" = now()
      WHERE "id" IN (${Prisma.join(uniq)}) AND "statut" <> 'REGLEE'`,
  ]);
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: "lot", champ: "statut", nouvelleValeur: `${n} facture(s) réglée(s)`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock");
}

/** Supprime plusieurs factures d'un coup (Direction) — reprend le stock entré par chacune. */
export async function supprimerFacturesEnLot(ids: string[]) {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const facs = await prisma.factureFournisseur.findMany({ where: { id: { in: uniq } }, include: { mouvements: { where: { type: "ENTREE" } } } });
  await prisma.$transaction(async (tx) => {
    for (const f of facs) {
      for (const m of f.mouvements) {
        await tx.stock.updateMany({ where: { articleId: m.articleId }, data: { quantite: { decrement: Number(m.quantite) } } });
        await tx.mouvementStock.delete({ where: { id: m.id } });
      }
    }
    await tx.factureFournisseur.deleteMany({ where: { id: { in: uniq } } });
  });
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: "lot", champ: "suppression", nouvelleValeur: `${facs.length} facture(s) supprimée(s)`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
}
