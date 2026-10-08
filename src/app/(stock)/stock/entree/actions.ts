"use server";

import { verrouillerStocks } from "@/lib/validations-stock/comptage";
import { revalidatePath } from "next/cache";
import { actionLisible } from "@/lib/action-lisible";
import { decSaisi } from "@/lib/nombre";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { exigerPeriodeOuverte } from "@/lib/cloture-stock";
import { cleAlnum } from "@/lib/texte";
import { lireDateAchat, ORIGINE_LISTE_ACHAT } from "@/lib/achats-liste";
import { analyserListeAchat, avertissementsListeAchat, catalogueCandidats, type LigneAVerifier } from "@/lib/achats-liste-serveur";
import { cleArticleExacte, lireDlc, memeDesignation, type AnalyseLigne } from "@/lib/achats-doublons";
import { decisionArticle, prochesDansListe } from "@/lib/article-proche";
import { notifierGesteStock } from "@/lib/validations-stock/geste-notifie";

/**
 * Résultat d'une Liste d'achat enregistrée : nouveaux articles créés au catalogue, nouveaux
 * fournisseurs créés à la volée, AVERTISSEMENTS non bloquants (double saisie possible avec une
 * facture ou une réception à ±14 jours, comptage d'inventaire postérieur) — l'achat est enregistré
 * quand même, la personne décide — et le nombre de lignes enregistrées avec une DLC.
 */
export type ResultatListeAchat = { crees: string[]; fournisseursCrees: string[]; avertissements: string[]; dlcRenseignees: number };

/**
 * Un champ répété par ligne (`dlc`, `creerNouveau`), lu par position comme `articleId`… : absent
 * (formulaire d'avant) = vide pour chaque ligne ; sinon UN par ligne — un autre nombre est refusé
 * (une DLC ne doit jamais glisser sur la ligne voisine).
 */
const parLigne = (formData: FormData, nom: string, n: number): string[] => {
  const v = formData.getAll(nom).map((x) => String(x).trim());
  if (v.length > 0 && v.length !== n) throw new Error("Formulaire incohérent (un champ par ligne attendu) : rechargez la page et saisissez à nouveau ; rien n'a été enregistré.");
  return Array.from({ length: n }, (_, i) => v[i] ?? "");
};


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
 * ÉCRITURE LIBRE (nouvel article) : dans ce cas l'article est rapproché du catalogue (anti-doublon,
 * ci-dessous) ou CRÉÉ automatiquement (domaine Nourriture / Boissons / Autre choisi sur la ligne,
 * unité et prix de référence = prix unitaire de cet achat). Transactionnel : tout ou rien.
 *
 * Décisions Direction 2026-09-28 :
 *  - DATE au choix (défaut : aujourd'hui à Kinshasa), jamais dans le futur, jamais dans une
 *    période de stock clôturée — le mouvement reçoit cette date ;
 *  - FOURNISSEUR facultatif PAR LIGNE : choisi dans la liste (id), ou tapé — un nom connu est
 *    rapproché (`cleAlnum`), un nom nouveau crée le fournisseur à la volée. Ni caisse ni validation.
 *
 * Décision Direction 2026-09-30 : DEVISE PAR LIGNE (USD ou CDF) — chaque mouvement porte la devise
 * et le taux de SA ligne (`lireDevisesParLigne`).
 *
 * Demande Direction 2026-10-08 — ANTI-DOUBLON D'ARTICLE et DLC facultative (lib/achats-doublons.ts,
 * lib/article-proche.ts — règle de l'application Atelier) :
 *  - une ligne libre est rattachée d'office à l'article qui porte EXACTEMENT son nom (accents, casse,
 *    espaces, séparateurs, écriture de la contenance près) s'il est UNIQUE ; si des articles PROCHES
 *    existent (« Tomate » quand « Tomates » existe) ou plusieurs exacts, la ligne est REFUSÉE tant
 *    que la personne n'a pas choisi — l'écran remplace la ligne par l'article choisi (« Utiliser … »)
 *    ou envoie `creerNouveau` = « 1 » (« Créer quand même un nouvel article »). Jamais deviné.
 *  - le DOUBLON D'ACHAT (même achat saisi deux fois) reste un avertissement NON bloquant ;
 *  - DLC : champ `dlc` par ligne, facultatif ; une date antérieure à celle de l'achat est refusée.
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
  const qtes = formData.getAll("quantite").map((v, i) => decSaisi(v, `quantité, ligne ${i + 1}`));
  const montants = formData.getAll("montant").map((v, i) => decSaisi(v, `montant, ligne ${i + 1}`)); // montant payé par ligne (facultatif)
  const fournIds = formData.getAll("fournisseurId").map((v) => String(v).trim());
  const fournNoms = formData.getAll("fournisseurNom").map((v) => String(v).trim());
  const devises = lireDevisesParLigne(formData, ids.length);
  const dlcs = parLigne(formData, "dlc", ids.length);
  const creerNouveaux = parLigne(formData, "creerNouveau", ids.length);
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
      dlcSaisie: dlcs[i],
      dlc: null as string | null,
      creerNouveau: creerNouveaux[i] === "1",
      /** Ligne libre rattachée d'office à un article existant (correspondance exacte unique). */
      rattache: "",
      rang: i + 1,
    }))
    .filter((l) => (l.articleId || l.designation) && l.quantite > 0);

  if (lignes.length === 0) throw new Error("Ajoutez au moins une ligne (article du catalogue ou désignation libre, + quantité).");

  // DLC facultative : vide autorisé ; illisible ou antérieure à la date de l'achat → refus qui nomme la ligne.
  for (const l of lignes) l.dlc = lireDlc(l.dlcSaisie, dateISO, l);

  // Article du catalogue disparu depuis l'ouverture de la page (supprimé, fusionné) : refus lisible,
  // jamais l'erreur brute de la base.
  const idsCatalogue = [...new Set(lignes.map((l) => l.articleId).filter(Boolean))];
  if (idsCatalogue.length > 0) {
    const existent = new Set((await prisma.articleStock.findMany({ where: { id: { in: idsCatalogue } }, select: { id: true } })).map((a) => a.id));
    const disparue = lignes.find((l) => l.articleId && !existent.has(l.articleId));
    if (disparue) throw new Error(`Ligne ${disparue.rang}${disparue.designation ? ` (« ${disparue.designation} »)` : ""} : cet article n'existe plus au catalogue. Rechargez la page et choisissez-le à nouveau ; rien n'a été enregistré.`);
  }

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

  // DOUBLON D'ARTICLE — sort au catalogue de chaque ligne LIBRE. « Créer quand même » vaut pour la
  // désignation : posé sur une ligne, il vaut pour les autres lignes du même nom (un seul article créé).
  const libres = lignes.filter((l) => !l.articleId);
  const catalogue = libres.length > 0 ? await catalogueCandidats() : [];
  const cleNom = (d: string) => cleArticleExacte(d) || d;
  const creationVoulue = new Set(libres.filter((l) => l.creerNouveau).map((l) => cleNom(l.designation)));
  const aChoisir: string[] = [];
  const creera = new Set<(typeof lignes)[number]>();
  for (const l of libres) {
    const d = decisionArticle(l.designation, catalogue);
    if (d.type === "auto") l.rattache = d.article.id;
    else if (d.type !== "choix" || (d.creationPossible && creationVoulue.has(cleNom(l.designation)))) creera.add(l);
    else aChoisir.push(`ligne ${l.rang} « ${l.designation} » → ${d.candidats.map((a) => `« ${a.designation} »${a.actif ? "" : " (inactif)"}`).join(", ")}${d.creationPossible ? "" : " (ce nom existe déjà plusieurs fois : choisissez l'un d'eux)"}`);
  }
  // Deux noms NOUVEAUX et proches dans la même liste (« Poivrons » puis « Poivron ») : la seconde ligne
  // demande le même choix — « Utiliser la ligne n » (même nom) ou « Créer quand même ».
  const nouvelles = lignes.filter((l) => creera.has(l));
  for (const [i, js] of prochesDansListe(nouvelles.map((l) => l.designation), () => true)) {
    const l = nouvelles[i];
    if (!l.creerNouveau && !creationVoulue.has(cleNom(l.designation))) aChoisir.push(`ligne ${l.rang} « ${l.designation} » → ${js.map((j) => `la ligne ${nouvelles[j].rang} « ${nouvelles[j].designation} »`).join(", ")} (nouvel article de cette liste)`);
  }
  if (aChoisir.length > 0) {
    // Onglet ouvert avant le déploiement : il ne sait pas proposer le choix — on le dit.
    const ancien = formData.getAll("creerNouveau").length === 0 ? "Rechargez la page pour choisir l'article existant ou en créer un nouveau. " : "";
    throw new Error(`${ancien}Article déjà au catalogue (ou dans cette liste) sous un nom proche : choisissez « Utiliser … » ou « Créer quand même un nouvel article » sur ${aChoisir.length > 1 ? "chaque ligne" : "la ligne"} ; rien n'a été enregistré. ${aChoisir.join(" ; ")}.`);
  }

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

  // Avertissements non bloquants (double saisie à ±14 jours, comptage postérieur), calculés AVANT
  // l'écriture (sinon la liste se signalerait elle-même).
  const avertissements = await avertissementsListeAchat(dateISO, lignes.flatMap((l) => (l.articleId || l.rattache ? [{ articleId: l.articleId || l.rattache, quantite: l.quantite }] : [])));

  const crees: string[] = [];
  const fournisseursCrees: string[] = [];
  await prisma.$transaction(async (tx) => {
    // Stocks des articles connus verrouillés d'abord, dans un ordre fixe (pas d'interblocage avec un
    // comptage ou une validation qui verrouillent les mêmes lignes).
    await verrouillerStocks(tx, [...new Set(lignes.map((l) => l.articleId || l.rattache).filter(Boolean))]);
    // Noms NOUVEAUX : verrou sur leur clé, tous d'un coup et TRIÉS (deux listes simultanées qui créent
    // les mêmes articles dans un autre ordre ne s'interbloquent pas), avant la relecture ci-dessous.
    const clesNouvelles = [...new Set(lignes.filter((l) => !l.articleId && !l.rattache).map((l) => cleArticleExacte(l.designation) || cleAlnum(l.designation) || l.designation))].sort();
    for (const cle of clesNouvelles) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`article:${cle}`}))::text AS verrou`;
    // Catalogue relu UNE fois, sous ces verrous : un article du même nom créé entre-temps par une autre liste y est.
    const catalogueSousVerrou = clesNouvelles.length > 0 ? await tx.articleStock.findMany({ select: { id: true, designation: true } }) : [];
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

    // Articles créés par CETTE liste, par nom exact : deux lignes du même nouveau nom → un seul article.
    const creesParCle = new Map<string, string>();
    for (const l of lignes) {
      let articleId = l.articleId || l.rattache || null;
      const fournisseurId = await resoudreFournisseur(l);
      const aMontant = l.montant > 0;
      const montantUSD = aMontant ? (l.devise === "CDF" ? l.montant / (taux as number) : l.montant) : null;

      if (!articleId) {
        const cle = cleArticleExacte(l.designation) || cleAlnum(l.designation) || l.designation;
        articleId = creesParCle.get(cle) ?? null;
        if (!articleId) {
          // Même garde que les fournisseurs : deux listes simultanées du même nouveau nom ne créent
          // qu'UN article (clé verrouillée plus haut, catalogue relu sous le verrou).
          const deja = catalogueSousVerrou.filter((a) => memeDesignation(l.designation, a.designation));
          if (deja.length === 1) articleId = deja[0].id; // créé entre-temps sous ce nom exact : c'est lui
        }
        if (!articleId) {
          // Nouvel article : créé au catalogue dans le domaine choisi, avec l'unité saisie et
          // le prix unitaire de CET achat comme prix de référence.
          const prixRef = montantUSD !== null && l.quantite > 0 ? Math.round((montantUSD / l.quantite) * 10000) / 10000 : null;
          const nouveau = await tx.articleStock.create({
            data: { designation: l.designation, unite: l.unite || null, domaine: l.domaine, prixUnitaireUSD: prixRef },
          });
          articleId = nouveau.id;
          crees.push(l.designation);
          await journaliser(tx, { entite: "ArticleStock", entiteId: nouveau.id, champ: "creation", nouvelleValeur: `${l.designation} (auto — liste d'achat, ${l.domaine})`, userId: user.id });
        }
        creesParCle.set(cle, articleId);
      }

      await tx.mouvementStock.create({
        data: {
          articleId, type: "ENTREE", quantite: l.quantite, date, origine, fournisseurId, creeParId: user.id,
          devise: aMontant ? l.devise : null,
          montantOrigine: aMontant ? l.montant : null,
          tauxChangeUtilise: aMontant && l.devise === "CDF" ? taux : null,
          montantUSD,
          dlc: l.dlc ? new Date(`${l.dlc}T00:00:00.000Z`) : null,
        },
      });
      await tx.stock.upsert({
        where: { articleId },
        update: { quantite: { increment: l.quantite } },
        create: { articleId, quantite: l.quantite },
      });
    }
  });

  // Un achat d'un compte non-Direction est NOTIFIÉ à la Direction (décision du 2026-10-07) : une
  // notification pour toute la liste, après l'écriture, jamais bloquante.
  await notifierGesteStock(user, { genre: "ACHAT", nbLignes: lignes.length, montants: lignes.map((l) => ({ devise: l.devise, montant: l.montant })) });

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
  return { crees, fournisseursCrees, avertissements, dlcRenseignees: lignes.filter((l) => l.dlc).length };
});

/**
 * Vérification À LA SAISIE (avant l'enregistrement) : pour chaque ligne (dans l'ordre de l'écran),
 * son sort au catalogue (rattachement automatique, articles proches à choisir) ; plus les
 * avertissements non bloquants. N'écrit rien. Une date
 * illisible ou future ne renvoie rien : c'est l'enregistrement qui la refuse, avec son message.
 * L'enregistrement REVÉRIFIE tout : cet écran informe, il ne décide pas.
 */
export const verifierDoublonsListe = actionLisible(async (dateSaisie: string, lignes: LigneAVerifier[]): Promise<{ avertissements: string[]; lignes: (AnalyseLigne | null)[] }> => {
  requireModule(await verifySession(), "stock");
  let dateISO: string;
  try { dateISO = lireDateAchat(dateSaisie); } catch { return { avertissements: [], lignes: [] }; }
  const propres: LigneAVerifier[] = (Array.isArray(lignes) ? lignes : []).slice(0, 200).map((l) => ({
    articleId: String(l?.articleId ?? ""),
    designation: String(l?.designation ?? "").trim(),
    quantite: Number(l?.quantite) || 0,
  }));
  return analyserListeAchat(dateISO, propres);
});
