"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisi } from "@/lib/nombre";
import { cleAlnum as normNom } from "@/lib/texte";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { donneesMontantsImportee, parserClasseurFactures } from "@/lib/import-factures-excel";
import { sigExistante, sigImportee } from "@/lib/import-factures";
import { extraireFacturePDF } from "@/lib/import-facture-pdf";
import { meilleurFournisseur } from "@/lib/fournisseur-match";
import { meilleurArticle } from "@/lib/article-match";
import { reglerFactureTx, reglerLotTx, notifierReglements, statutDe, verrouillerFacture, type VerseLot } from "@/lib/validations-stock/reglement";
import { deviseFacture, resteFacture } from "@/lib/facture-devise";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { apresCommit, demanderPaiement, estDirection, exigerAucunPaiementDemande } from "@/lib/validations-stock/demandes";
import { texteDecimal } from "@/lib/validations-stock/charge";
import { verrouillerStocks } from "@/lib/validations-stock/comptage";
import { entrerEnStockTx } from "@/lib/validations-stock/stock-positif";
import { supprimerFacturesTx } from "@/lib/validations-stock/suppression-facture";
import { notifierGesteStock } from "@/lib/validations-stock/geste-notifie";
import { Prisma } from "@prisma/client";
import { jourCourantKinshasaISO, anneeCouranteKinshasa, jourCivilKinshasa } from "@/lib/heure-kinshasa";


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
export const attacherDocumentFacture = actionLisible(async (id: string, formData: FormData) => {
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
});

/** Lit un PDF de facture et renvoie un pré-remplissage complet (fournisseur, date, n°, LIGNES) — Direction. À CONFIRMER. */
export type LigneAnalyse = {
  designation: string; quantite: number; prixUnitaireUSD: number; total: number;
  articleId: string | null; articleNom: string | null; unite: string | null; // article du catalogue rapproché
};
export type AnalyseFacture = {
  /** Montant et prix des lignes dans `devise` (CDF : document libellé en francs, jamais converti). */
  montant: number | null; date: string | null; numero: string | null; devise: "USD" | "CDF";
  fournisseur: { nom: string | null; rccm: string | null; idNational: string | null; telephone: string | null; email: string | null; adresse: string | null; ville: string | null };
  match: { id: string; nom: string; score: number } | null; // fournisseur existant proche
  lignes: LigneAnalyse[];
};
const VIDE: AnalyseFacture = { montant: null, date: null, numero: null, devise: "USD", fournisseur: { nom: null, rccm: null, idNational: null, telephone: null, email: null, adresse: null, ville: null }, match: null, lignes: [] };

export const analyserFacturePDF = actionLisible(async (formData: FormData): Promise<AnalyseFacture> => {
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
    return { montant: ex.montant, date: ex.date, numero: ex.numero, devise: ex.devise, fournisseur: ex.fournisseur, match, lignes };
  } catch {
    return VIDE;
  }
});

/**
 * Importe un ou plusieurs classeurs Excel « Suivi des factures fournisseurs ». Direction uniquement.
 * Rattache chaque facture au fournisseur existant (par nom) ou le crée ; ignore les doublons
 * (même fournisseur/mois/année/montant/n°) pour permettre des imports répétés.
 */
export const importerFacturesExcel = actionLisible(async (formData: FormData): Promise<{ importees: number; ignorees: number; fournisseursCrees: string[]; erreurs: string[] }> => {
  const user = await verifySession();
  requireModule(user, "stock");
  requireRole(user, ["ADMIN"]);

  const fichiers = formData.getAll("fichiers").filter((f): f is File => f instanceof File && f.size > 0);
  if (fichiers.length === 0) return { importees: 0, ignorees: 0, fournisseursCrees: [], erreurs: ["Aucun fichier."] };

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  const anneeCourante = config?.anneeCourante ?? anneeCouranteKinshasa();

  const erreurs: string[] = [];
  const lignes = [] as Awaited<ReturnType<typeof parserClasseurFactures>>;
  for (const f of fichiers) {
    const anneeFichier = Number((f.name.match(/(20\d{2})/) ?? [])[1]) || anneeCourante;
    try {
      lignes.push(...(await parserClasseurFactures(await f.arrayBuffer(), anneeFichier, taux, erreurs)));
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

  // Dé-duplication (signature, dans la devise de chaque facture) contre l'existant + à l'intérieur du lot.
  const existantes = await prisma.factureFournisseur.findMany({ select: { annee: true, mois: true, fournisseurNom: true, numero: true, devise: true, montantUSD: true, montantCDF: true } });
  const vues = new Set(existantes.map(sigExistante));

  const aInserer = lignes.filter((r) => { const s = sigImportee(r); if (vues.has(s)) return false; vues.add(s); return true; });

  if (aInserer.length > 0) {
    await prisma.factureFournisseur.createMany({
      data: aInserer.map((r) => ({
        fournisseurId: parNom.get(normNom(r.fournisseurNom)) ?? null,
        fournisseurNom: r.fournisseurNom, numero: r.numero,
        date: r.date, dateEcheance: r.dateEcheance, datePaiement: r.datePaiement,
        ...donneesMontantsImportee(r),
        statut: r.statut, modePaiement: r.modePaiement, mois: r.mois, annee: r.annee,
      })),
    });
    await journaliser(prisma, { entite: "FactureFournisseur", entiteId: "import", champ: "import Excel", nouvelleValeur: `${aInserer.length} facture(s)`, userId: user.id });
  }

  revalidatePath("/stock/factures");
  return { importees: aInserer.length, ignorees: lignes.length - aInserer.length, fournisseursCrees, erreurs };
});

const AUJ = () => jourCourantKinshasaISO();

async function garde() {
  const user = await verifySession();
  requireModule(user, "stock");
  return user;
}

/** Lie (ou détache si bonDeCommandeId = null) une facture à un bon de commande — à tout moment. */
export const lierFactureABon = actionLisible(async (factureId: string, bonDeCommandeId: string | null) => {
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
});

/**
 * Crée une facture fournisseur détaillée (avec ses lignes d'articles et quantités).
 * Le montant total est calculé à partir des lignes.
 *
 * DEVISE (2026-10-09) : `devise` = USD (défaut, comme avant) ou CDF. Une facture en francs a ses
 * prix de ligne, son montant, son réglé et son reste EN FRANCS (la devise de saisie fait foi,
 * src/lib/facture-devise.ts). Son entrée en stock garde la devise et le taux comme la Liste d'achat :
 * chaque mouvement porte la devise (CDF), le montant saisi, le taux des Paramètres du jour et
 * l'équivalent en dollars figé (francs ÷ taux) ; sans taux, l'entrée en stock est refusée, rien
 * n'est écrit (jamais un montant en francs valorisé à 0 ou à un taux supposé).
 */
export const creerFactureAvecLignes = actionLisible(async (formData: FormData) => {
  const user = await garde();
  const fournisseurNom = String(formData.get("fournisseurNom") ?? "").trim();
  if (!fournisseurNom) throw new Error("Le fournisseur est requis.");
  const deviseBrute = String(formData.get("devise") ?? "USD").trim() || "USD";
  // On ne devine jamais la devise d'un montant : seules USD et CDF passent.
  if (deviseBrute !== "USD" && deviseBrute !== "CDF") throw new Error("Devise de la facture inconnue : choisissez dollars ($) ou francs (FC).");
  const devise: "USD" | "CDF" = deviseBrute;

  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const unites = formData.getAll("ligne_unite").map((v) => String(v).trim());
  const qtes = formData.getAll("ligne_quantite").map((v, i) => decSaisi(v, `quantité, ligne ${i + 1}`));
  const prixs = formData.getAll("ligne_prix").map((v, i) => decSaisi(v, `prix, ligne ${i + 1}`));

  const arr2 = (n: number) => Math.round(n * 100) / 100;
  const lignes = desigs
    .map((designation, i) => {
      const quantite = qtes[i] ?? 0;
      const base = { articleId: ids[i] || null, designation, unite: unites[i] || null, quantite };
      // En dollars : exactement comme avant. En francs : prix au centime de franc (précision de la
      // colonne), total = quantité × prix, au centime.
      if (devise === "USD") return { ...base, prixUnitaireUSD: prixs[i] ?? 0, totalLigneUSD: quantite * (prixs[i] ?? 0), total: quantite * (prixs[i] ?? 0) };
      const pu = arr2(prixs[i] ?? 0);
      return { ...base, prixUnitaireCDF: pu, totalLigneCDF: arr2(quantite * pu), total: arr2(quantite * pu) };
    })
    .filter((l) => l.designation && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (désignation + quantité).");

  const montant = devise === "USD" ? lignes.reduce((t, l) => t + l.total, 0) : arr2(lignes.reduce((t, l) => t + l.total, 0));
  const dateStr = String(formData.get("date") ?? "").trim() || null;
  const echeanceStr = String(formData.get("dateEcheance") ?? "").trim() || null;
  // « Déjà réglé », dans la devise de la facture (ancien nom du champ : montantRegleUSD).
  const montantRegle = decSaisi(formData.get("montantRegle") ?? formData.get("montantRegleUSD"), "montant déjà réglé");
  // Un montant déjà réglé à la création EST un paiement : hors Direction, il passe par une demande
  // (fiche de la facture → « Marquer payée » ou « + Paiement »), jamais par ce raccourci.
  if (montantRegle !== 0 && !estDirection(user)) {
    throw new Error("Un règlement doit être validé par la Direction : enregistrez la facture sans montant réglé, puis demandez le paiement depuis sa fiche (« Marquer payée » ou « + Paiement »).");
  }
  const reste = Math.max(0, montant - montantRegle);
  const d = new Date(dateStr ?? echeanceStr ?? AUJ());
  const numero = String(formData.get("numero") ?? "").trim() || null;
  // C'est l'enregistrement de la facture (articles + quantités) qui fait entrer la marchandise
  // en stock — pas la réception du bon de commande (volontairement différenciés). Décochable
  // pour une facture purement financière sans mouvement de marchandise.
  const entrerEnStock = formData.get("entrerEnStock") != null; // case cochée ⇒ présente dans le FormData
  // Les entrées en stock créées plus bas portent la date de la FACTURE (`d`) : c'est elle que la
  // clôture doit contrôler. Contrôler « aujourd'hui » laissait une facture datée d'un mois clôturé
  // écrire dans ce mois figé.
  if (entrerEnStock) await exigerPeriodeOuverte(d);
  const origine = `Facture ${fournisseurNom}${numero ? ` ${numero}` : ""}`;
  // Facture en francs : taux des Paramètres du jour de l'enregistrement, figé sur la facture et sur
  // ses entrées en stock (valorisation en dollars, comme la Liste d'achat). Sans taux, une entrée en
  // stock valorisée est refusée — rien n'est écrit.
  const tauxFC = devise === "CDF" ? await tauxDuJour() : null;
  if (devise === "CDF" && entrerEnStock && tauxFC === null) {
    const rangs = lignes.map((l, i) => (l.articleId && l.total > 0 ? i + 1 : 0)).filter((x) => x > 0);
    if (rangs.length > 0) throw new Error(`Facture en francs (FC) à entrer en stock : le taux de change CDF/USD n'est pas défini (Paramètres), la valeur en dollars ${rangs.length > 1 ? `des lignes ${rangs.join(", ")}` : `de la ligne ${rangs[0]}`} est impossible. Rien n'a été enregistré — faites définir le taux, ou décochez « entrer en stock ».`);
  }

  // Garde-fou anti-double comptage : le même achat saisi dans la Liste d'achat (ou en entrée
  // manuelle) PUIS enregistré ici avec ses lignes ferait entrer le stock DEUX FOIS. On détecte
  // les entrées récentes hors facture sur les mêmes articles et on demande confirmation.
  if (entrerEnStock && formData.get("forcerDoublons") == null) {
    const artIds = lignes.map((l) => l.articleId).filter((x): x is string => !!x);
    if (artIds.length > 0) {
      const ref = dateStr ? new Date(dateStr) : jourCivilKinshasa(new Date());
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
    // Entrée en stock : lignes de stock verrouillées d'abord, dans un ordre fixe (pas d'interblocage).
    if (entrerEnStock) await verrouillerStocks(tx, [...new Set(lignes.map((l) => l.articleId).filter((x): x is string => !!x))]);
    const f = await tx.factureFournisseur.create({
      data: {
        fournisseurId,
        fournisseurNom,
        bonDeCommandeId: String(formData.get("bonDeCommandeId") ?? "").trim() || null,
        numero,
        date: dateStr ? new Date(dateStr) : null,
        dateEcheance: echeanceStr ? new Date(echeanceStr) : null,
        // Montants dans la devise de la facture ; ceux de l'autre devise NULS (FactureFournisseur_devise_check).
        ...(devise === "USD"
          ? { montantUSD: montant, montantRegleUSD: montantRegle, resteAPayerUSD: reste }
          : { devise: "CDF" as const, montantCDF: montant, montantRegleCDF: montantRegle, resteAPayerCDF: reste, montantUSD: null, montantRegleUSD: null, resteAPayerUSD: null, tauxChangeUtilise: tauxFC }),
        statut: statutDe(reste, echeanceStr),
        modePaiement: String(formData.get("modePaiement") ?? "").trim() || null,
        documentUrl,
        mois: d.getUTCMonth() + 1, annee: d.getUTCFullYear(),
        lignes: { create: lignes.map((l) => { const { total, ...ligne } = l; void total; return ligne; }) },
      },
    });
    if (entrerEnStock) {
      for (const l of lignes) {
        if (!l.articleId) continue; // seules les lignes reliées à un article du catalogue entrent en stock
        await tx.mouvementStock.create({
          data: {
            articleId: l.articleId, type: "ENTREE", quantite: l.quantite, date: d,
            origine, factureId: f.id, creeParId: user.id,
            // En dollars : comme avant (le total de la ligne). En francs : devise, montant saisi, taux
            // et équivalent en dollars figé — comme une ligne en francs de la Liste d'achat.
            ...(devise === "USD"
              ? { montantUSD: l.total }
              : l.total > 0 ? { devise: "CDF" as const, montantOrigine: l.total, tauxChangeUtilise: tauxFC, montantUSD: l.total / tauxFC! } : {}),
          },
        });
        await entrerEnStockTx(tx, [{ articleId: l.articleId, quantite: l.quantite }]); // porte unique (stock-positif.ts)
      }
    }
    return f;
  });

  // Facture enregistrée par un compte non-Direction : notifiée à la Direction (2026-10-07), après
  // l'écriture et avant la redirection, jamais bloquante.
  await notifierGesteStock(user, {
    genre: "FACTURE", factureId: fac.id, numero, fournisseurNom, montantUSD: devise === "USD" ? montant : 0, ...(devise === "CDF" ? { devise, montantCDF: montant } : {}), nbLignes: lignes.length,
    entreeEnStock: entrerEnStock, nbEntrees: entrerEnStock ? lignes.filter((l) => l.articleId).length : 0,
  });

  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: fac.id, champ: "creation", nouvelleValeur: `${fournisseurNom} — ${montant} ${devise} (${lignes.length} ligne(s))${entrerEnStock ? " · entrée stock" : ""}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  redirect(`/stock/factures/${fac.id}`);
});

const MESSAGE_FACTURE_DEJA_SUPPRIMEE = "Cette facture a déjà été supprimée (par un autre onglet ou un autre clic) : le stock qu'elle avait fait entrer n'a été repris qu'une seule fois. Rechargez la page.";

/** Supprime une facture fournisseur et ANNULE ses entrées de stock (décrémente ce qu'elle avait fait entrer). */
export const supprimerFacture = actionLisible(async (id: string) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]); // seule la Direction peut supprimer
  const { facs } = await prisma.$transaction((tx) => supprimerFacturesTx(tx, [id]));
  const f = facs[0];
  if (!f) return { erreur: MESSAGE_FACTURE_DEJA_SUPPRIMEE };
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: id, champ: "suppression", ancienneValeur: `${f.fournisseurNom} — ${f.devise === "CDF" ? `${f.montantCDF} CDF` : f.montantUSD}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
});

/** Réponse d'un geste de règlement fait par un compte qui n'est pas la Direction : rien n'est payé. */
export type DemandeEnvoyee = { demande: true; message: string };
const MESSAGE_DEMANDE = "Paiement demandé : il sera enregistré quand la Direction l'aura validé.";

function rafraichirFactures(ids: string[]) {
  revalidatePath("/stock/factures");
  for (const id of ids) revalidatePath(`/stock/factures/${id}`);
  revalidatePath("/stock/a-valider");
  revalidatePath("/stock");
}

/**
 * Marque une facture comme réglée : un paiement du reste à payer, daté au choix (défaut :
 * aujourd'hui à Kinshasa — voir `reglerFactureTx`/`lireDatePaiement`).
 * Hors Direction : rien n'est payé, une DEMANDE est adressée à la Direction (demandes.ts).
 *
 * `francs` (2026-10-08, « payer des factures en francs ») : le montant versé EN FRANCS (saisie à la
 * française). Sur une facture en dollars, converti par LA conversion des règlements (taux des
 * Paramètres du jour du paiement — ou de la validation, pour une demande) ; la facture garde son reste
 * en dollars ; moins que le reste = paiement partiel, plus = refusé.
 * `dollars` (2026-10-09, factures en francs) : le montant versé EN DOLLARS sur une facture tenue en
 * francs, converti au taux du jour (sens inverse). Sans l'un ni l'autre : le reste, dans la devise de
 * la facture (une facture en francs se solde en francs, sans taux).
 * C'est le même chemin que « + Paiement » (REGLEMENT), avec la note « Marquée payée ».
 */
export const marquerPayee = actionLisible(async (id: string, dateStr?: string, francs?: string, dollars?: string): Promise<DemandeEnvoyee | void> => {
  const user = await garde();
  // `francs` / `dollars` présent = montant versé dans CETTE devise : un montant vide est refusé
  // (jamais un repli silencieux dans l'autre devise).
  const lire = (v: string | undefined, devise: "USD" | "CDF") => {
    if (v === undefined || v === null) return null;
    if (String(v).trim() === "") throw new Error(devise === "CDF" ? "Saisissez le montant versé en francs." : "Saisissez le montant versé en dollars.");
    const n = decSaisi(v, devise === "CDF" ? "montant en francs" : "montant en dollars");
    if (!(n > 0)) throw new Error(devise === "CDF" ? "Le montant en francs doit être supérieur à 0." : "Le montant en dollars doit être supérieur à 0.");
    return { devise, montant: n };
  };
  const fc = lire(francs, "CDF");
  const usd = lire(dollars, "USD");
  if (fc && usd) throw new Error("Un seul montant versé : en francs OU en dollars.");
  const verse = fc ?? usd;
  if (!estDirection(user)) {
    if (verse) {
      await demanderPaiement(user, {
        mode: "REGLEMENT", factureId: id, dateStr,
        reglement: { type: "PAIEMENT", montantUSD: verse.devise === "USD" ? texteDecimal(verse.montant) : null, montantCDF: verse.devise === "CDF" ? texteDecimal(verse.montant) : null, taux: null, modePaiement: null, note: verse.devise === "CDF" ? "Marquée payée (en francs)" : "Marquée payée (en dollars)" },
      });
    } else {
      await demanderPaiement(user, { mode: "SOLDE", factureId: id, dateStr });
    }
    rafraichirFactures([id]);
    return { demande: true, message: MESSAGE_DEMANDE };
  }
  const reg = await prisma.$transaction(async (tx) => {
    // Verrou de la facture AVANT de lire les demandes : une demande déposée en même temps attend.
    const f = await verrouillerFacture(tx, id);
    await exigerAucunPaiementDemande(tx, [id]);
    if (verse) {
      const memeDevise = verse.devise === deviseFacture(f);
      return reglerFactureTx(tx, user.id, id, { verse, dateStr, note: memeDevise ? "Marquée payée" : verse.devise === "CDF" ? "Marquée payée (en francs)" : "Marquée payée (en dollars)" });
    }
    if (resteFacture(f) <= 0.001) return null; // déjà soldée
    return reglerFactureTx(tx, user.id, id, { dateStr, note: "Marquée payée" });
  });
  rafraichirFactures([id]);
  // Après le paiement : un échec de notification ne doit JAMAIS revenir comme une erreur (un nouvel
  // essai paierait deux fois).
  if (reg) await apresCommit(() => notifierReglements([reg]));
});

/** Enregistre un paiement (total ou PARTIEL, en USD ou en CDF) ou un AVOIR (note de crédit). */
export const enregistrerPaiement = actionLisible(async (id: string, formData: FormData): Promise<DemandeEnvoyee | void> => {
  const user = await garde();
  const type = String(formData.get("type") ?? "PAIEMENT") === "AVOIR" ? "AVOIR" : "PAIEMENT";
  // Devise du montant VERSÉ ; la facture, elle, garde sa devise (conversion au taux du jour si elles diffèrent).
  const devise = String(formData.get("devise") ?? "USD") === "CDF" ? "CDF" : "USD";
  const saisi = decSaisi(formData.get("montant"), "montant");
  if (saisi <= 0) throw new Error("Le montant doit être supérieur à 0.");
  const dateStr = String(formData.get("date") ?? "").trim() || undefined; // validé/défaulté dans reglerFactureTx
  const mode = String(formData.get("modePaiement") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (type === "AVOIR" && !note) throw new Error("Indiquez le motif de l'avoir (ex. retour marchandise).");

  // Hors Direction : une demande, en DEVISE DE SAISIE. Un montant dans l'autre devise que la facture
  // sera converti au taux des Paramètres au moment de la validation (comme le paiement direct,
  // ci-dessous, le fait maintenant).
  if (!estDirection(user)) {
    await demanderPaiement(user, {
      mode: "REGLEMENT", factureId: id, dateStr,
      reglement: { type, montantUSD: devise === "USD" ? texteDecimal(saisi) : null, montantCDF: devise === "CDF" ? texteDecimal(saisi) : null, taux: null, modePaiement: mode, note },
    });
    rafraichirFactures([id]);
    return { demande: true, message: type === "AVOIR" ? "Avoir demandé : il sera enregistré quand la Direction l'aura validé." : MESSAGE_DEMANDE };
  }
  const reg = await prisma.$transaction(async (tx) => {
    await verrouillerFacture(tx, id); // avant la lecture des demandes (voir marquerPayee)
    await exigerAucunPaiementDemande(tx, [id]);
    // Conversion (si la devise versée n'est pas celle de la facture) au taux lu dans CETTE transaction.
    return reglerFactureTx(tx, user.id, id, { verse: { devise, montant: saisi }, dateStr, mode, note, type });
  });
  rafraichirFactures([id]);
  await apresCommit(() => notifierReglements([reg]));
});

/**
 * Marque plusieurs factures comme réglées d'un coup (réglé = montant, reste = 0), datées TOUTES
 * de la même date de paiement au choix (défaut : aujourd'hui à Kinshasa). Si l'une des factures
 * ENCORE À RÉGLER À CE MOMENT a une date de facture postérieure à la date choisie, le lot ENTIER
 * est refusé — nommant la fautive — plutôt que d'en régler une partie en silence.
 *
 * Tout se passe dans UNE transaction interactive, avec `SELECT … FOR UPDATE` (voir `reglerLotTx`) :
 * un règlement concurrent attend la fin de CETTE transaction, et la lecture qui compte est celle
 * faite SOUS le verrou. Renvoie le nombre réellement réglé (`reglees`) à côté du nombre demandé
 * (`demandees`) : l'écart se dit à l'écran plutôt que de vider la sélection en silence.
 * Hors Direction : rien n'est payé, UNE demande (tout ou rien) est adressée à la Direction ;
 * `demandePaiement` = nombre de factures qu'elle porte.
 *
 * `devise` = ce qui est VERSÉ : "USD" (défaut, comme avant), "CDF" (2026-10-08), ou "SA_DEVISE"
 * (2026-10-09 : chaque facture dans sa devise, aucune conversion).
 */
export type ResultatLot = { reglees: number; demandees: number; demandePaiement?: number };
export const marquerPayeesEnLot = actionLisible(async (ids: string[], dateStr?: string, devise?: "USD" | "CDF" | "SA_DEVISE"): Promise<ResultatLot> => {
  const user = await garde();
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return { reglees: 0, demandees: 0 };
  const verse: VerseLot = devise === "CDF" || devise === "SA_DEVISE" ? devise : "USD";

  if (!estDirection(user)) {
    const r = await demanderPaiement(user, { mode: "LOT", factureIds: uniq, dateStr, verse });
    rafraichirFactures([]);
    return { reglees: 0, demandees: uniq.length, demandePaiement: r.nbFactures };
  }

  const regs = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" WHERE "id" IN (${Prisma.join(uniq)}) ORDER BY "id" FOR UPDATE`; // avant la lecture des demandes
    await exigerAucunPaiementDemande(tx, uniq);
    return reglerLotTx(tx, user.id, uniq, dateStr, verse === "CDF" ? "Marquée payée (lot en francs)" : verse === "SA_DEVISE" ? "Marquée payée (lot, dans la devise de chaque facture)" : "Marquée payée (lot)", { verse });
  });

  if (regs.length > 0) {
    rafraichirFactures([]);
    await apresCommit(() => notifierReglements(regs));
  }
  return { reglees: regs.length, demandees: uniq.length };
});

/** Supprime plusieurs factures d'un coup (Direction) — reprend le stock entré par chacune, une seule fois même si une autre suppression vise la même facture. */
export const supprimerFacturesEnLot = actionLisible(async (ids: string[]) => {
  const user = await garde();
  requireRole(user, ["ADMIN"]);
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const { facs, dejaSupprimees } = await prisma.$transaction((tx) => supprimerFacturesTx(tx, uniq));
  if (facs.length === 0) return { erreur: uniq.length > 1 ? "Ces factures ont déjà été supprimées (par un autre onglet ou un autre clic) : le stock qu'elles avaient fait entrer n'a été repris qu'une seule fois. Rechargez la page." : MESSAGE_FACTURE_DEJA_SUPPRIMEE };
  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: "lot", champ: "suppression", nouvelleValeur: `${facs.length} facture(s) supprimée(s)`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  return dejaSupprimees > 0 ? { n: facs.length, dejaSupprimees } : { n: facs.length };
});
