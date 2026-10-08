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
import { parserClasseurFactures } from "@/lib/import-factures-excel";
import { extraireFacturePDF } from "@/lib/import-facture-pdf";
import { meilleurFournisseur } from "@/lib/fournisseur-match";
import { meilleurArticle } from "@/lib/article-match";
import { convertirFrancs, reglerFactureTx, reglerLotTx, notifierReglements, statutDe, verrouillerFacture } from "@/lib/validations-stock/reglement";
import { apresCommit, demanderPaiement, estDirection, exigerAucunPaiementDemande } from "@/lib/validations-stock/demandes";
import { texteDecimal } from "@/lib/validations-stock/charge";
import { verrouillerStocks } from "@/lib/validations-stock/comptage";
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
  montant: number | null; date: string | null; numero: string | null;
  fournisseur: { nom: string | null; rccm: string | null; idNational: string | null; telephone: string | null; email: string | null; adresse: string | null; ville: string | null };
  match: { id: string; nom: string; score: number } | null; // fournisseur existant proche
  lignes: LigneAnalyse[];
};
const VIDE: AnalyseFacture = { montant: null, date: null, numero: null, fournisseur: { nom: null, rccm: null, idNational: null, telephone: null, email: null, adresse: null, ville: null }, match: null, lignes: [] };

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
    return { montant: ex.montant, date: ex.date, numero: ex.numero, fournisseur: ex.fournisseur, match, lignes };
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
 */
export const creerFactureAvecLignes = actionLisible(async (formData: FormData) => {
  const user = await garde();
  const fournisseurNom = String(formData.get("fournisseurNom") ?? "").trim();
  if (!fournisseurNom) throw new Error("Le fournisseur est requis.");

  const ids = formData.getAll("ligne_articleId").map(String);
  const desigs = formData.getAll("ligne_designation").map((v) => String(v).trim());
  const unites = formData.getAll("ligne_unite").map((v) => String(v).trim());
  const qtes = formData.getAll("ligne_quantite").map((v, i) => decSaisi(v, `quantité, ligne ${i + 1}`));
  const prixs = formData.getAll("ligne_prix").map((v, i) => decSaisi(v, `prix, ligne ${i + 1}`));

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
  const montantRegleUSD = decSaisi(formData.get("montantRegleUSD"), "montant déjà réglé");
  // Un montant déjà réglé à la création EST un paiement : hors Direction, il passe par une demande
  // (fiche de la facture → « Marquer payée » ou « + Paiement »), jamais par ce raccourci.
  if (montantRegleUSD !== 0 && !estDirection(user)) {
    throw new Error("Un règlement doit être validé par la Direction : enregistrez la facture sans montant réglé, puis demandez le paiement depuis sa fiche (« Marquer payée » ou « + Paiement »).");
  }
  const reste = Math.max(0, montantUSD - montantRegleUSD);
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

  // Facture enregistrée par un compte non-Direction : notifiée à la Direction (2026-10-07), après
  // l'écriture et avant la redirection, jamais bloquante.
  await notifierGesteStock(user, {
    genre: "FACTURE", factureId: fac.id, numero, fournisseurNom, montantUSD, nbLignes: lignes.length,
    entreeEnStock: entrerEnStock, nbEntrees: entrerEnStock ? lignes.filter((l) => l.articleId).length : 0,
  });

  await journaliser(prisma, { entite: "FactureFournisseur", entiteId: fac.id, champ: "creation", nouvelleValeur: `${fournisseurNom} — ${montantUSD} USD (${lignes.length} ligne(s))${entrerEnStock ? " · entrée stock" : ""}`, userId: user.id });
  revalidatePath("/stock/factures");
  revalidatePath("/stock/catalogue");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock");
  redirect(`/stock/factures/${fac.id}`);
});

/** Supprime une facture fournisseur et ANNULE ses entrées de stock (décrémente ce qu'elle avait fait entrer). */
export const supprimerFacture = actionLisible(async (id: string) => {
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
 * française, proposé à reste × taux du jour). Converti par LA conversion des règlements
 * (`convertirFrancs`, taux des Paramètres du jour du paiement — ou de la validation pour une demande) ;
 * la facture garde son reste en dollars ; moins que le reste = paiement partiel, plus = refusé.
 * C'est le même chemin que « + Paiement » en francs (REGLEMENT), avec la note « Marquée payée ».
 */
export const marquerPayee = actionLisible(async (id: string, dateStr?: string, francs?: string): Promise<DemandeEnvoyee | void> => {
  const user = await garde();
  const enFrancs = francs !== undefined && francs !== null && String(francs).trim() !== "";
  const fc = enFrancs ? decSaisi(francs, "montant en francs") : null;
  if (fc !== null && !(fc > 0)) throw new Error("Le montant en francs doit être supérieur à 0.");
  if (!estDirection(user)) {
    if (fc !== null) {
      await demanderPaiement(user, {
        mode: "REGLEMENT", factureId: id, dateStr,
        reglement: { type: "PAIEMENT", montantUSD: null, montantCDF: texteDecimal(fc), taux: null, modePaiement: null, note: "Marquée payée (en francs)" },
      });
    } else {
      await demanderPaiement(user, { mode: "SOLDE", factureId: id, dateStr });
    }
    rafraichirFactures([id]);
    return { demande: true, message: MESSAGE_DEMANDE };
  }
  const reg = await prisma.$transaction(async (tx) => {
    if (fc !== null) {
      await verrouillerFacture(tx, id); // avant la lecture des demandes (voir ci-dessous)
      await exigerAucunPaiementDemande(tx, [id]);
      const { montant, taux } = await convertirFrancs(tx, fc);
      return reglerFactureTx(tx, user.id, id, { montant, montantCDF: fc, taux, dateStr, note: "Marquée payée (en francs)" });
    }
    // Verrou de la facture AVANT de lire les demandes : une demande déposée en même temps attend.
    const f = await verrouillerFacture(tx, id);
    await exigerAucunPaiementDemande(tx, [id]);
    const reste = Number(f.resteAPayerUSD);
    if (reste <= 0.001) return null; // déjà soldée
    return reglerFactureTx(tx, user.id, id, { montant: reste, dateStr, note: "Marquée payée" });
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
  const devise = String(formData.get("devise") ?? "USD") === "CDF" ? "CDF" : "USD";
  const saisi = decSaisi(formData.get("montant"), "montant");
  if (saisi <= 0) throw new Error("Le montant doit être supérieur à 0.");
  const dateStr = String(formData.get("date") ?? "").trim() || undefined; // validé/défaulté dans reglerFactureTx
  const mode = String(formData.get("modePaiement") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (type === "AVOIR" && !note) throw new Error("Indiquez le motif de l'avoir (ex. retour marchandise).");

  // Hors Direction : une demande, en DEVISE DE SAISIE. Un montant en francs sera converti au taux
  // des Paramètres au moment de la validation (comme le paiement direct, ci-dessous, le fait maintenant).
  if (!estDirection(user)) {
    await demanderPaiement(user, {
      mode: "REGLEMENT", factureId: id, dateStr,
      reglement: { type, montantUSD: devise === "USD" ? texteDecimal(saisi) : null, montantCDF: devise === "CDF" ? texteDecimal(saisi) : null, taux: null, modePaiement: mode, note },
    });
    rafraichirFactures([id]);
    return { demande: true, message: type === "AVOIR" ? "Avoir demandé : il sera enregistré quand la Direction l'aura validé." : MESSAGE_DEMANDE };
  }
  // Payé en francs : conversion au taux courant, montant CDF et taux figés sur le paiement.
  let montant = saisi, montantCDF: number | null = null, taux: number | null = null;
  if (devise === "CDF") ({ montant, taux } = await convertirFrancs(prisma, (montantCDF = saisi)));

  const reg = await prisma.$transaction(async (tx) => {
    await verrouillerFacture(tx, id); // avant la lecture des demandes (voir marquerPayee)
    await exigerAucunPaiementDemande(tx, [id]);
    return reglerFactureTx(tx, user.id, id, { montant, montantCDF, taux, dateStr, mode, note, type });
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
 */
export type ResultatLot = { reglees: number; demandees: number; demandePaiement?: number };
export const marquerPayeesEnLot = actionLisible(async (ids: string[], dateStr?: string, devise?: "USD" | "CDF"): Promise<ResultatLot> => {
  const user = await garde();
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return { reglees: 0, demandees: 0 };
  // En francs (2026-10-08) : chaque facture soldée par reste × taux du jour francs (voir reglerLotTx).
  const enFrancs = devise === "CDF";

  if (!estDirection(user)) {
    const r = await demanderPaiement(user, { mode: "LOT", factureIds: uniq, dateStr, enFrancs });
    rafraichirFactures([]);
    return { reglees: 0, demandees: uniq.length, demandePaiement: r.nbFactures };
  }

  const regs = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "stock"."FactureFournisseur" WHERE "id" IN (${Prisma.join(uniq)}) ORDER BY "id" FOR UPDATE`; // avant la lecture des demandes
    await exigerAucunPaiementDemande(tx, uniq);
    return reglerLotTx(tx, user.id, uniq, dateStr, enFrancs ? "Marquée payée (lot en francs)" : "Marquée payée (lot)", { enFrancs });
  });

  if (regs.length > 0) {
    rafraichirFactures([]);
    await apresCommit(() => notifierReglements(regs));
  }
  return { reglees: regs.length, demandees: uniq.length };
});

/** Supprime plusieurs factures d'un coup (Direction) — reprend le stock entré par chacune. */
export const supprimerFacturesEnLot = actionLisible(async (ids: string[]) => {
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
});
