"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { actionLisible } from "@/lib/action-lisible";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { estDirection } from "@/lib/validations-stock/demandes";
import { DOMAINE_LABEL } from "@/lib/stock";
import { cleArticleExacte } from "@/lib/achats-doublons";
import { doublonDeCategorie, messageDoublonCategorie, nomCategorieNet, NOM_CATEGORIE_MAX, type DoublonCategorie } from "@/lib/categorie-stock";

// Catégories du stock (Inventaire → « Catégories »). Créer, renommer, réordonner, archiver, changer de
// domaine et supprimer sont des gestes de la DIRECTION : les autres rôles lisent la liste, sans plus.
// Une catégorie archivée n'est plus proposée dans les choix, mais ses articles y restent rattachés.

/** Session + espace Stock + Direction : `quoi` dit le geste refusé aux autres rôles. */
async function garde(quoi: string) {
  const user = await verifySession();
  requireModule(user, "stock");
  if (!estDirection(user)) throw new Error(`${quoi} est réservé à la Direction.`);
  return user;
}

const DOMAINES = ["NOURRITURE", "BOISSON", "AUTRE"] as const;
type Domaine = (typeof DOMAINES)[number];

function lireDomaine(v: FormDataEntryValue | null): Domaine {
  const d = String(v ?? "");
  if ((DOMAINES as readonly string[]).includes(d)) return d as Domaine;
  throw new Error("Domaine inconnu : choisissez Nourriture, Boissons ou Autre.");
}

function lireNom(v: FormDataEntryValue | null): string {
  const nom = nomCategorieNet(String(v ?? ""));
  if (!nom) throw new Error("Le nom de la catégorie est requis.");
  if (nom.length > NOM_CATEGORIE_MAX) throw new Error(`Le nom de la catégorie est trop long (${NOM_CATEGORIE_MAX} caractères au plus).`);
  if (!cleArticleExacte(nom)) throw new Error("Le nom de la catégorie doit contenir au moins une lettre ou un chiffre.");
  return nom;
}

function revalider() {
  // Inventaire, fiche article (/stock/catalogue/[id]), création d'article, écran des catégories : tout le dossier.
  revalidatePath("/stock/catalogue", "layout");
  revalidatePath("/stock");
}

/** Deux gestes simultanés sur le même domaine : on les range l'un derrière l'autre (nom comparé, ordre). */
async function verrouillerDomaine(tx: Prisma.TransactionClient, domaine: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`categorie-stock:${domaine}`}))::text AS verrou`;
}

/**
 * Contrôle du nom, à deux niveaux comme « Ajouter un article » : le nom IDENTIQUE d'une autre catégorie du
 * domaine (archivées comprises) est refusé sans recours ; un nom seulement PROCHE l'est aussi, sauf si la
 * personne a confirmé (`quandMeme`). Rend la réponse à renvoyer à l'écran, ou null quand le nom est accepté.
 */
async function controlerNom(tx: Prisma.TransactionClient, nom: string, domaine: string, quandMeme: boolean, exclureId?: string): Promise<DoublonCategorie | null> {
  const toutes = await tx.categorieStock.findMany({ select: { id: true, nom: true, domaine: true, actif: true } });
  const d = doublonDeCategorie(nom, domaine, toutes, exclureId);
  if (!d || (!d.exact && quandMeme)) return null;
  return { doublon: true, categorie: d.categorie, confirmable: !d.exact, message: messageDoublonCategorie(nom, d) };
}

/** Drapeau « Créer quand même » / « Renommer quand même » renvoyé par l'écran après l'avertissement. */
const confirme = (formData: FormData) => String(formData.get("quandMeme") ?? "") === "1";

/** Une violation de l'unicité (domaine, nom) qui aurait échappé au contrôle : dite en français, jamais en SQL. */
function enFrancais(e: unknown, nom: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new Error(`La catégorie « ${nom} » existe déjà dans ce domaine. Rien n'a été enregistré.`);
  }
  throw e;
}

/** Crée une catégorie (nom + domaine), à la fin de la liste de son domaine. */
export const creerCategorie = actionLisible(async (formData: FormData): Promise<DoublonCategorie | void> => {
  const user = await garde("Créer une catégorie");
  const nom = lireNom(formData.get("nom"));
  const domaine = lireDomaine(formData.get("domaine"));
  const cat = await prisma.$transaction(async (tx) => {
    await verrouillerDomaine(tx, domaine);
    const doublon = await controlerNom(tx, nom, domaine, confirme(formData));
    if (doublon) return doublon;
    const fin = await tx.categorieStock.aggregate({ where: { domaine }, _max: { ordre: true } });
    return tx.categorieStock.create({ data: { nom, domaine, ordre: (fin._max.ordre ?? 0) + 1 } });
  }).catch((e) => enFrancais(e, nom));
  if ("doublon" in cat) return cat;
  await journaliser(prisma, { entite: "CategorieStock", entiteId: cat.id, champ: "creation", nouvelleValeur: `${nom} (${DOMAINE_LABEL[domaine]})`, userId: user.id });
  revalider();
});

/**
 * Renomme une catégorie et/ou change son domaine. Le nouveau nom passe le même anti-doublon que la
 * création, en s'excluant elle-même (« boissons » → « Boissons » est un simple changement de casse).
 * Le DOMAINE ne change que si la catégorie n'a AUCUN article (archivés compris) : on ne déplace jamais
 * le domaine d'un article par ce biais.
 */
export const modifierCategorie = actionLisible(async (id: string, formData: FormData): Promise<DoublonCategorie | void> => {
  const user = await garde("Modifier une catégorie");
  const nom = lireNom(formData.get("nom"));
  const domaineSaisi = formData.has("domaine") ? lireDomaine(formData.get("domaine")) : null;
  const avant = await prisma.categorieStock.findUnique({ where: { id }, select: { nom: true, domaine: true, _count: { select: { articles: true } } } });
  if (!avant) throw new Error("Cette catégorie n'existe plus : rechargez la page.");
  const domaine = domaineSaisi ?? (avant.domaine as Domaine);
  const changeDomaine = domaine !== avant.domaine;
  if (nom === avant.nom && !changeDomaine) return; // rien à écrire
  const doublon = await prisma.$transaction(async (tx) => {
    // Les deux domaines concernés, toujours dans le même ordre, pour ne pas se croiser avec un autre geste.
    for (const d of [...new Set([avant.domaine, domaine])].sort()) await verrouillerDomaine(tx, d);
    if (changeDomaine) {
      const n = await tx.articleStock.count({ where: { categorieId: id } });
      if (n > 0) {
        throw new Error(`« ${avant.nom} » contient ${n} article${n > 1 ? "s" : ""} : déplacez d'abord ${n > 1 ? "ses articles" : "son article"} vers une autre catégorie, puis changez son domaine.`);
      }
    }
    const d = await controlerNom(tx, nom, domaine, confirme(formData), id);
    if (d) return d;
    await tx.categorieStock.update({ where: { id }, data: { nom, ...(changeDomaine ? { domaine } : {}) } });
    return null;
  }).catch((e) => enFrancais(e, nom));
  if (doublon) return doublon;
  if (nom !== avant.nom) await journaliser(prisma, { entite: "CategorieStock", entiteId: id, champ: "nom", ancienneValeur: avant.nom, nouvelleValeur: nom, userId: user.id });
  if (changeDomaine) await journaliser(prisma, { entite: "CategorieStock", entiteId: id, champ: "domaine", ancienneValeur: DOMAINE_LABEL[avant.domaine], nouvelleValeur: DOMAINE_LABEL[domaine], userId: user.id });
  revalider();
});

/**
 * Archive ou réactive des catégories (une ou plusieurs). Archivée : plus proposée dans les listes de
 * choix, mais ses articles restent visibles et rattachés. Réactiver une catégorie dont le nom est
 * devenu proche d'une autre ne pose pas de doute : les deux existaient déjà.
 */
export const basculerActifCategories = actionLisible(async (ids: string[], actif: boolean) => {
  const user = await garde(actif ? "Réactiver une catégorie" : "Archiver une catégorie");
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const cats = await prisma.categorieStock.findMany({ where: { id: { in: uniq }, actif: !actif }, select: { id: true, nom: true } });
  if (cats.length === 0) return;
  await prisma.categorieStock.updateMany({ where: { id: { in: cats.map((c) => c.id) } }, data: { actif } });
  for (const c of cats) await journaliser(prisma, { entite: "CategorieStock", entiteId: c.id, champ: "actif", ancienneValeur: actif ? "archivée" : "active", nouvelleValeur: actif ? "active" : "archivée", userId: user.id });
  revalider();
});

/**
 * Monte ou descend une catégorie dans la liste de SON domaine. L'ordre affiché est (ordre, nom) :
 * plusieurs catégories partent à 0 (imports), donc le geste RENUMÉROTE d'abord tout le domaine dans
 * l'ordre affiché (1, 2, 3…), puis échange la catégorie avec sa voisine.
 */
export const deplacerCategorie = actionLisible(async (id: string, sens: "haut" | "bas") => {
  const user = await garde("Réordonner les catégories");
  if (sens !== "haut" && sens !== "bas") throw new Error("Sens inconnu.");
  const cat = await prisma.categorieStock.findUnique({ where: { id }, select: { domaine: true, nom: true } });
  if (!cat) throw new Error("Cette catégorie n'existe plus : rechargez la page.");
  await prisma.$transaction(async (tx) => {
    await verrouillerDomaine(tx, cat.domaine);
    const liste = await tx.categorieStock.findMany({ where: { domaine: cat.domaine }, orderBy: [{ ordre: "asc" }, { nom: "asc" }], select: { id: true, ordre: true } });
    const i = liste.findIndex((c) => c.id === id);
    const j = sens === "haut" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= liste.length) return; // déjà en tête / en queue
    [liste[i], liste[j]] = [liste[j], liste[i]];
    for (const [k, c] of liste.entries()) if (c.ordre !== k + 1) await tx.categorieStock.update({ where: { id: c.id }, data: { ordre: k + 1 } });
  });
  await journaliser(prisma, { entite: "CategorieStock", entiteId: id, champ: "ordre", nouvelleValeur: `${cat.nom} : ${sens === "haut" ? "monte" : "descend"}`, userId: user.id });
  revalider();
});

/**
 * Supprime des catégories VIDES (aucun article rattaché, archivés compris). Tout ou rien : si l'une
 * contient des articles, rien n'est supprimé et le refus les nomme. Direction seulement.
 */
export const supprimerCategories = actionLisible(async (ids: string[]) => {
  const user = await garde("Supprimer une catégorie");
  const uniq = [...new Set(ids.map(String))].filter(Boolean);
  if (uniq.length === 0) return;
  const cats = await prisma.categorieStock.findMany({ where: { id: { in: uniq } }, select: { id: true, nom: true, _count: { select: { articles: true } } } });
  const pleines = cats.filter((c) => c._count.articles > 0);
  if (pleines.length > 0) {
    const liste = pleines.map((c) => `« ${c.nom} » (${c._count.articles} article${c._count.articles > 1 ? "s" : ""})`).join(", ");
    throw new Error(`Suppression refusée : ${liste} — déplacez d'abord les articles vers une autre catégorie (ou archivez la catégorie). Rien n'a été supprimé.`);
  }
  // `articles: { none: {} }` redit la règle au moment d'écrire : un article rattaché entre-temps bloque la suppression.
  const r = await prisma.categorieStock.deleteMany({ where: { id: { in: cats.map((c) => c.id) }, articles: { none: {} } } });
  if (r.count !== cats.length) throw new Error("Une catégorie vient de recevoir un article : rechargez la page. Rien n'est garanti supprimé, vérifiez la liste.");
  for (const c of cats) await journaliser(prisma, { entite: "CategorieStock", entiteId: c.id, champ: "suppression", ancienneValeur: c.nom, userId: user.id });
  revalider();
});
