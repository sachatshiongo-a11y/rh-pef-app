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
  const devise = String(formData.get("devise") ?? "USD") === "CDF" ? "CDF" : "USD";
  const origine = String(formData.get("origine") ?? "").trim() || ORIGINE_LISTE_ACHAT;

  // Taux CDF/USD partagé avec la RH (Config) — utilisé pour convertir un achat en francs.
  let taux: number | null = null;
  if (devise === "CDF") {
    const config = await prisma.config.findUnique({ where: { id: "singleton" } });
    taux = config ? Number(config.tauxChangeCDF) : null;
    if (!taux) throw new Error("Taux de change CDF/USD non défini (Config).");
  }

  const lignes = ids
    .map((articleId, i) => ({
      articleId,
      designation: designations[i] ?? "",
      unite: unites[i] ?? "",
      domaine: ["NOURRITURE", "BOISSON", "AUTRE"].includes(domaines[i]) ? (domaines[i] as "NOURRITURE" | "BOISSON" | "AUTRE") : "NOURRITURE",
      quantite: qtes[i] ?? 0,
      montant: montants[i] ?? 0,
      fournId: fournIds[i] ?? "",
      fournNom: fournNoms[i] ?? "",
      rang: i + 1,
    }))
    .filter((l) => (l.articleId || l.designation) && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article du catalogue ou désignation libre, + quantité).");

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
      const montantUSD = aMontant ? (devise === "CDF" ? l.montant / (taux as number) : l.montant) : null;

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
          devise: aMontant ? devise : null,
          montantOrigine: aMontant ? l.montant : null,
          tauxChangeUtilise: aMontant && devise === "CDF" ? taux : null,
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
