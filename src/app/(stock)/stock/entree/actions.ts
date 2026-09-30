"use server";

import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { dec } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { cleAlnum } from "@/lib/texte";
import { lireDateAchat, ORIGINE_LISTE_ACHAT } from "@/lib/achats-liste";
import { avertissementsListeAchat, type LigneAVerifier } from "@/lib/achats-liste-serveur";

/**
 * Résultat d'une Liste d'achat enregistrée : nouveaux articles créés au catalogue, nouveaux
 * fournisseurs créés à la volée, et AVERTISSEMENTS non bloquants (double saisie possible avec
 * une facture ou une réception, comptage d'inventaire postérieur) — l'achat est enregistré quand
 * même, la personne décide.
 */
export type ResultatListeAchat = { crees: string[]; fournisseursCrees: string[]; avertissements: string[] };


const DEVISES = ["USD", "CDF"] as const;
type Devise = (typeof DEVISES)[number];
const estDevise = (v: string): v is Devise => (DEVISES as readonly string[]).includes(v);

/**
 * Devise de CHAQUE ligne (décision Direction 2026-09-30 : USD ou FC ligne par ligne).
 *
 * Le formulaire envoie un champ `devise` PAR LIGNE, dans l'ordre des lignes, comme `articleId`,
 * `quantite`… Un formulaire d'avant (onglet resté ouvert pendant le déploiement) n'envoyait qu'UN
 * `devise`, pour toute la liste : il s'applique alors à chaque ligne, comme avant. Un seul champ
 * pour une seule ligne revient au même dans les deux cas. Absent : USD (défaut d'avant).
 *
 * Revalidé ici : seules USD et CDF passent ; toute autre valeur, ou un nombre de devises qui ne
 * correspond pas aux lignes, est refusé — on ne devine jamais la devise d'un montant.
 */
function lireDevisesParLigne(formData: FormData, nbLignes: number): Devise[] {
  const brutes = formData.getAll("devise").map((v) => String(v).trim());
  const inconnue = brutes.findIndex((v) => !estDevise(v));
  if (inconnue >= 0) {
    const ligne = brutes.length === nbLignes && nbLignes > 1 ? ` (ligne ${inconnue + 1})` : "";
    throw new Error(`Devise inconnue${ligne} : « ${brutes[inconnue]} ». Seules USD et FC (CDF) sont acceptées ; rien n'a été enregistré.`);
  }
  const valides = brutes as Devise[];
  if (valides.length === 0) return Array(nbLignes).fill("USD");
  if (valides.length === nbLignes) return valides;
  if (valides.length === 1) return Array(nbLignes).fill(valides[0]); // ancien formulaire : devise unique
  throw new Error("Formulaire incohérent (une devise par ligne attendue) : rechargez la page et saisissez à nouveau ; rien n'a été enregistré.");
}

/**
 * Liste d'achat → inventaire : chaque ligne (article + quantité) crée un MouvementStock d'ENTRÉE
 * et incrémente le stock de l'article. Une ligne peut viser un article du CATALOGUE ou être en
 * ÉCRITURE LIBRE (nouvel article) : dans ce cas l'article est rapproché par désignation exacte
 * (anti-doublon) ou CRÉÉ automatiquement au catalogue (domaine Nourriture / Boissons / Autre
 * choisi sur la ligne, unité et prix de référence = prix unitaire de cet achat). Transactionnel.
 *
 * Décisions Direction 2026-09-28 :
 *  - DATE au choix (défaut : aujourd'hui à Kinshasa), jamais dans le futur, jamais dans une
 *    période de stock clôturée — le mouvement reçoit cette date ;
 *  - FOURNISSEUR facultatif PAR LIGNE : choisi dans la liste (id), ou tapé — un nom connu est
 *    rapproché (`cleAlnum`), un nom nouveau crée le fournisseur à la volée. Ni caisse ni validation.
 *
 * Décision Direction 2026-09-30 : DEVISE PAR LIGNE (USD ou CDF) — chaque mouvement porte la devise
 * et le taux de SA ligne (`lireDevisesParLigne`).
 */
export const entreeListeAchat = actionLisible(async (formData: FormData): Promise<ResultatListeAchat> => {
  const user = await verifySession();
  requireModule(user, "stock");
  const dateISO = lireDateAchat(String(formData.get("date") ?? ""));
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  await exigerPeriodeOuverte(date);

  const ids = formData.getAll("articleId").map(String);
  const designations = formData.getAll("designation").map((v) => String(v).trim());
  const unites = formData.getAll("unite").map((v) => String(v).trim());
  const domaines = formData.getAll("domaine").map(String);
  const qtes = formData.getAll("quantite").map(dec);
  const montants = formData.getAll("montant").map(dec); // montant payé par ligne (facultatif)
  const fournIds = formData.getAll("fournisseurId").map((v) => String(v).trim());
  const fournNoms = formData.getAll("fournisseurNom").map((v) => String(v).trim());
  const devises = lireDevisesParLigne(formData, ids.length);
  const origine = String(formData.get("origine") ?? "").trim() || ORIGINE_LISTE_ACHAT;

  const lignes = ids
    .map((articleId, i) => ({
      articleId,
      designation: designations[i] ?? "",
      unite: unites[i] ?? "",
      domaine: ["NOURRITURE", "BOISSON", "AUTRE"].includes(domaines[i]) ? (domaines[i] as "NOURRITURE" | "BOISSON" | "AUTRE") : "NOURRITURE",
      quantite: qtes[i] ?? 0,
      montant: montants[i] ?? 0,
      devise: devises[i],
      fournId: fournIds[i] ?? "",
      fournNom: fournNoms[i] ?? "",
      rang: i + 1,
    }))
    .filter((l) => (l.articleId || l.designation) && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article du catalogue ou désignation libre, + quantité).");

  // Taux CDF/USD partagé avec la RH (Config) — lu SEULEMENT si une ligne payée en francs doit être
  // convertie. Sans taux, ces lignes sont nommées et rien n'est écrit : jamais un montant en francs
  // compté comme des dollars, ni une ligne perdue en silence.
  let taux: number | null = null;
  const enFrancs = lignes.filter((l) => l.devise === "CDF" && l.montant > 0);
  if (enFrancs.length > 0) {
    const config = await prisma.config.findUnique({ where: { id: "singleton" } });
    const lu = config ? Number(config.tauxChangeCDF) : NaN;
    taux = Number.isFinite(lu) && lu > 0 ? lu : null;
    if (taux === null) {
      const rangs = enFrancs.map((l) => l.rang);
      throw new Error(
        `${rangs.length > 1 ? `Lignes ${rangs.join(", ")} payées` : `Ligne ${rangs[0]} payée`} en francs (FC) : le taux de change CDF/USD n'est pas défini (Paramètres), la conversion en dollars est impossible. Rien n'a été enregistré — passez ${rangs.length > 1 ? "ces lignes" : "la ligne"} en USD ou faites définir le taux.`
      );
    }
  }

  // Rapprochement des lignes LIBRES par désignation exacte — on ne crée pas un doublon
  // d'un article déjà au catalogue.
  const existants = await prisma.articleStock.findMany({ select: { id: true, designation: true } });
  const parNom = new Map(existants.map((a) => [cleAlnum(a.designation), a.id]));

  // Fournisseurs : un id choisi dans la liste doit exister ; un nom tapé est rapproché d'un
  // fournisseur connu (même clé que les articles : « maman epiphanie » = « Maman Épiphanie »).
  const fournisseurs = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
  const fournConnus = new Set(fournisseurs.map((f) => f.id));
  const fournParNom = new Map(fournisseurs.map((f) => [cleAlnum(f.nom), f.id]));
  const perime = lignes.find((l) => l.fournId && !fournConnus.has(l.fournId));
  if (perime) throw new Error(`Fournisseur introuvable (ligne ${perime.rang}) : rechargez la page et choisissez-le à nouveau.`);
  // Un nom sans lettre ni chiffre (« -- ») n'a pas de clé : il créerait un fournisseur illisible,
  // que plus aucun rapprochement ne retrouverait.
  const illisible = lignes.find((l) => !l.fournId && l.fournNom && !cleAlnum(l.fournNom));
  if (illisible) throw new Error(`Nom de fournisseur illisible (ligne ${illisible.rang}) : écrivez son nom en lettres ou en chiffres, ou laissez le champ vide.`);

  // Avertissements non bloquants (double saisie, comptage postérieur), calculés avant l'écriture.
  const avertissements = await avertissementsListeAchat(dateISO, lignes.map((l) => ({ articleId: l.articleId, designation: l.designation, quantite: l.quantite })));

  const crees: string[] = [];
  const fournisseursCrees: string[] = [];
  await prisma.$transaction(async (tx) => {
    const resoudreFournisseur = async (l: (typeof lignes)[number]): Promise<string | null> => {
      if (l.fournId) return l.fournId;
      if (!l.fournNom) return null;
      const cle = cleAlnum(l.fournNom);
      const connu = fournParNom.get(cle);
      if (connu) return connu;
      // Deux saisies simultanées du même nouveau nom créeraient deux fournisseurs (`nom` n'est pas
      // unique : pas d'upsert ni de P2002 possible). Verrou transactionnel sur la CLÉ du nom, puis
      // relecture : la seconde transaction attend la première et retrouve le fournisseur créé.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fournisseur:${cle}`}))::text AS verrou`;
      const recents = await tx.fournisseur.findMany({ select: { id: true, nom: true } });
      const deja = recents.find((f) => cleAlnum(f.nom) === cle);
      if (deja) { fournParNom.set(cle, deja.id); return deja.id; }
      const nouveau = await tx.fournisseur.create({ data: { nom: l.fournNom } });
      fournParNom.set(cle, nouveau.id);
      fournisseursCrees.push(l.fournNom);
      await journaliser(tx, { entite: "Fournisseur", entiteId: nouveau.id, champ: "creation", nouvelleValeur: `${l.fournNom} (auto — liste d'achat)`, userId: user.id });
      return nouveau.id;
    };

    for (const l of lignes) {
      let articleId = l.articleId || null;
      const fournisseurId = await resoudreFournisseur(l);
      const aMontant = l.montant > 0;
      const montantUSD = aMontant ? (l.devise === "CDF" ? l.montant / (taux as number) : l.montant) : null;

      if (!articleId) {
        articleId = parNom.get(cleAlnum(l.designation)) ?? null;
        if (!articleId) {
          // Nouvel article : créé au catalogue dans le domaine choisi, avec l'unité saisie et
          // le prix unitaire de CET achat comme prix de référence.
          const prixRef = montantUSD !== null && l.quantite > 0 ? Math.round((montantUSD / l.quantite) * 10000) / 10000 : null;
          const nouveau = await tx.articleStock.create({
            data: { designation: l.designation, unite: l.unite || null, domaine: l.domaine, prixUnitaireUSD: prixRef },
          });
          articleId = nouveau.id;
          parNom.set(cleAlnum(l.designation), nouveau.id);
          crees.push(l.designation);
          await journaliser(tx, { entite: "ArticleStock", entiteId: nouveau.id, champ: "creation", nouvelleValeur: `${l.designation} (auto — liste d'achat, ${l.domaine})`, userId: user.id });
        }
      }

      await tx.mouvementStock.create({
        data: {
          articleId, type: "ENTREE", quantite: l.quantite, date, origine, fournisseurId, creeParId: user.id,
          devise: aMontant ? l.devise : null,
          montantOrigine: aMontant ? l.montant : null,
          tauxChangeUtilise: aMontant && l.devise === "CDF" ? taux : null,
          montantUSD,
        },
      });
      await tx.stock.upsert({
        where: { articleId },
        update: { quantite: { increment: l.quantite } },
        create: { articleId, quantite: l.quantite },
      });
    }
  });

  await journaliser(prisma, { entite: "MouvementStock", entiteId: `${lignes.length} entrées`, champ: "entree (liste d'achat)", nouvelleValeur: origine, userId: user.id });
  // Un article créé à la volée hors Direction reste permis (la Liste d'achat ne doit jamais bloquer
  // un achat), mais il est SIGNALÉ sur la cloche de l'espace Stock.
  if (crees.length > 0 && user.role !== "ADMIN") {
    await prisma.notification.create({ data: { domaine: "STOCK", type: "AUTRE", message: `${crees.length > 1 ? `${crees.length} nouveaux articles créés` : "Nouvel article créé"} par ${user.nom} (Liste d'achat) : ${crees.map((d) => `« ${d} »`).join(", ")}`.slice(0, 480), lien: "/stock/catalogue", refId: "article-cree:liste-achat" } });
  }
  revalidatePath("/stock/entree");
  revalidatePath("/stock/mouvements");
  revalidatePath("/stock/fournisseurs", "layout");
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock");
  return { crees, fournisseursCrees, avertissements };
});

/**
 * Vérification À LA SAISIE (avant l'enregistrement) : mêmes avertissements non bloquants que
 * l'enregistrement. N'écrit rien. Une date illisible ou future ne renvoie rien : c'est
 * l'enregistrement qui la refuse, avec son message.
 */
export const verifierDoublonsListe = actionLisible(async (dateSaisie: string, lignes: LigneAVerifier[]): Promise<{ avertissements: string[] }> => {
  requireModule(await verifySession(), "stock");
  let dateISO: string;
  try { dateISO = lireDateAchat(dateSaisie); } catch { return { avertissements: [] }; }
  const propres = (Array.isArray(lignes) ? lignes : []).slice(0, 200).map((l) => ({
    articleId: String(l?.articleId ?? ""),
    designation: String(l?.designation ?? ""),
    quantite: Number(l?.quantite) || 0,
  }));
  return { avertissements: await avertissementsListeAchat(dateISO, propres) };
});
