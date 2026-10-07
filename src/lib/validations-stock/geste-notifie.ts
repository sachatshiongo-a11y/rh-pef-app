import "server-only";

// GESTES DE STOCK NOTIFIÉS À LA DIRECTION — décision de Sacha (2026-10-07) :
// « je ne veux pas que la direction ait à valider les sorties de stock, je veux juste recevoir les
//   notifications lorsqu'un mouvement est fait, lorsqu'une facture est enregistrée, quand un achat est
//   fait ou tout autre entrée de stock ».
//
//  - UNE notification par GESTE (une saisie de 30 lignes = une notification qui résume), jamais une
//    par ligne ;
//  - adressée à CHAQUE compte Direction (ADMIN actif) sur sa cloche de l'espace Stock
//    (`destinataireUserId` : personnelle, son « lu » n'est qu'à lui) + push sur ses appareils. Pas
//    d'e-mail : une livraison au restaurant par jour et par article n'a rien à faire dans une boîte ;
//  - jamais à l'auteur ; un geste de la Direction elle-même ne génère rien ;
//  - envoyée APRÈS l'écriture et JAMAIS bloquante : `notifierGesteStock` ne lève pas. Un échec (base
//    momentanément indisponible, push en panne) est consigné, l'écriture reste faite et annoncée faite.
//
// Anti-avalanche (mouvements manuels seulement) : le même auteur qui enchaîne des gestes de même nature
// (les livraisons de la semaine saisies en rafale) ne fait pas sonner la Direction dix fois. Tant que
// la notification de son premier geste est NON LUE et date de moins de FENETRE_REGROUPEMENT_MS, elle
// est MISE À JOUR (« 3 saisies de sorties (Livraison restaurant) par Jean depuis 9 h 05 — dernière : … ») au lieu
// d'en empiler une nouvelle. Le compteur vit dans `refId` (`geste:<auteur>:<clé>:<n>`), seul champ
// libre du modèle (pas de changement de schéma). Factures, achats et réceptions ont chacun leur lien
// propre : jamais regroupés.

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envoyerPush } from "@/lib/push";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { heureKinshasa } from "@/lib/heure-kinshasa";

export type AuteurGeste = { id: string; nom: string; role: Role };

export type LigneGeste = { articleId: string; designation: string; unite: string | null; quantite: number };

export type GesteStock =
  | {
      genre: "MOUVEMENT";
      type: "ENTREE" | "SORTIE";
      categorieSortie: "PERTE" | "LIVRAISON_RESTAURANT" | null;
      origine: string;
      /** Date du mouvement (date pure : minuit UTC du jour civil de Kinshasa). */
      date: Date;
      lignes: LigneGeste[];
      /** Articles visés aussi par une ANCIENNE demande de mouvement en attente (double saisie possible). */
      demandesEnAttente?: string[];
    }
  | { genre: "FACTURE"; factureId: string; numero: string | null; fournisseurNom: string; montantUSD: number; nbLignes: number; entreeEnStock: boolean; nbEntrees: number }
  | { genre: "ACHAT"; nbLignes: number; montants: { devise: "USD" | "CDF"; montant: number }[] }
  | { genre: "ACHAT_LEGUMES"; nbLignes: number; montantsCDF: (number | null)[] }
  | { genre: "RECEPTION"; bonDeCommandeId: string; numero: string; fournisseurNom: string | null; nbLignes: number; complete: boolean };

/** Fenêtre de regroupement des mouvements d'un même auteur (voir l'en-tête). */
export const FENETRE_REGROUPEMENT_MS = 10 * 60_000;
const LONGUEUR_MAX = 480;

const pluriel = (n: number, un: string, plusieurs = `${un}s`) => `${formaterNombre(n)} ${n > 1 ? plusieurs : un}`;
const quantite = (q: number) => formaterNombre(q, { maximumFractionDigits: 3 });

/**
 * « 3 bouteilles », « 2,5 Kg », « 1 sac » : l'unité de l'article, mise au pluriel quand c'est un mot
 * (pas une abréviation : kg, g, l, cl, ml… restent tels quels). Sans unité : la quantité seule.
 */
export function quantiteEtUnite(q: number, unite: string | null): string {
  const u = (unite ?? "").trim();
  if (!u) return quantite(q);
  const mot = /^[a-zà-ÿ]{3,}$/i.test(u) && !/[sxz]$/i.test(u) && !/^(?:pce|pcs|btl|cs|kg|mg|cl|ml|dl)$/i.test(u);
  return `${quantite(q)} ${q >= 2 && mot ? `${u}s` : u}`;
}

const nomType = (type: "ENTREE" | "SORTIE") => (type === "ENTREE" ? "Entrée" : "Sortie");
const LIBELLE_MOTIF = { LIVRAISON_RESTAURANT: "Livraison restaurant", PERTE: "Perte" } as const;

/** Lien vers l'écran Mouvements filtré sur le mois du mouvement, son motif et (une seule ligne) son article. */
export function lienMouvements(g: Extract<GesteStock, { genre: "MOUVEMENT" }>): string {
  const p = new URLSearchParams();
  p.set("mois", `${g.date.getUTCFullYear()}-${g.date.getUTCMonth() + 1}`);
  p.set("motif", g.type === "ENTREE" ? "autres" : g.categorieSortie === "LIVRAISON_RESTAURANT" ? "livraison" : g.categorieSortie === "PERTE" ? "perte" : "sans");
  if (g.lignes.length === 1) p.set("articleId", g.lignes[0].articleId);
  return `/stock/mouvements?${p.toString()}`;
}

/** « 3 Kg — Riz » (une ligne) ou « 2 articles : Riz 3 Kg, Sel 1 Kg » (plusieurs). */
function detailLignes(lignes: LigneGeste[]): string {
  if (lignes.length === 1) return `${quantiteEtUnite(lignes[0].quantite, lignes[0].unite)} — ${lignes[0].designation}`;
  return `${pluriel(lignes.length, "article")} : ${lignes.map((l) => `${l.designation} ${quantiteEtUnite(l.quantite, l.unite)}`).join(", ")}`;
}

/** Somme par devise, dans la devise de saisie (jamais d'aller-retour) ; aucune ligne chiffrée : « — ». */
function totalParDevise(montants: { devise: "USD" | "CDF"; montant: number }[]): string {
  const usd = montants.filter((m) => m.devise === "USD").reduce((t, m) => t + m.montant, 0);
  const cdf = montants.filter((m) => m.devise === "CDF").reduce((t, m) => t + m.montant, 0);
  const parties = [...(usd > 0 ? [formaterUSD(usd)] : []), ...(cdf > 0 ? [formaterFC(cdf)] : [])];
  return parties.length ? parties.join(" + ") : "—";
}

const sansMontant = (n: number) => (n > 0 ? ` (${pluriel(n, "ligne")} sans montant)` : "");

export type TexteGeste = { message: string; lien: string; titre: string; cle: string | null };

/** Texte, lien et clé de regroupement d'un geste. PURE. */
export function texteGeste(auteurNom: string, g: GesteStock): TexteGeste {
  const borne = (s: string) => (s.length > LONGUEUR_MAX ? `${s.slice(0, LONGUEUR_MAX - 1)}…` : s);
  switch (g.genre) {
    case "MOUVEMENT": {
      const tete = g.lignes.length === 1
        ? `${nomType(g.type)} de ${quantiteEtUnite(g.lignes[0].quantite, g.lignes[0].unite)} — ${g.lignes[0].designation} (${g.origine}) par ${auteurNom}`
        : `${nomType(g.type)} de ${pluriel(g.lignes.length, "article")} (${g.origine}) par ${auteurNom} : ${g.lignes.map((l) => `${l.designation} ${quantiteEtUnite(l.quantite, l.unite)}`).join(", ")}`;
      const alerte = g.demandesEnAttente?.length ? ` — attention : une ancienne demande en attente vise aussi ${g.demandesEnAttente.map((d) => `« ${d} »`).join(", ")} (double saisie ?)` : "";
      return { message: borne(tete + alerte), lien: lienMouvements(g), titre: g.type === "ENTREE" ? "Entrée de stock" : "Sortie de stock", cle: alerte ? null : `${g.type}:${g.categorieSortie ?? g.origine}` }; // un doublon possible n'est jamais noyé dans une rafale
    }
    case "FACTURE": {
      const nom = `${g.numero ? `Facture n° ${g.numero}` : "Facture sans numéro"} de ${g.fournisseurNom}`;
      const montant = g.montantUSD > 0 ? formaterUSD(g.montantUSD) : "montant : —";
      const stock = g.entreeEnStock
        ? g.nbEntrees > 0 ? ` (entrée en stock : ${pluriel(g.nbEntrees, "article")})` : " (aucune ligne reliée au catalogue : rien n'est entré en stock)"
        : " (sans entrée en stock)";
      return { message: borne(`${nom} enregistrée par ${auteurNom} — ${montant}${stock}`), lien: `/stock/factures/${g.factureId}`, titre: "Facture enregistrée", cle: null };
    }
    case "ACHAT": {
      const chiffres = g.montants.filter((m) => m.montant > 0);
      return {
        message: borne(`Achat enregistré par ${auteurNom} — ${pluriel(g.nbLignes, "article")}, ${totalParDevise(chiffres)}${chiffres.length > 0 ? sansMontant(g.nbLignes - chiffres.length) : ""}`),
        lien: "/stock/entree", titre: "Achat enregistré", cle: null,
      };
    }
    case "ACHAT_LEGUMES": {
      const chiffres = g.montantsCDF.filter((m): m is number => m !== null && m > 0);
      const total = chiffres.length ? formaterFC(chiffres.reduce((t, m) => t + m, 0)) : "—";
      return {
        message: borne(`Achat de légumes enregistré par ${auteurNom} — ${pluriel(g.nbLignes, "ligne")}, ${total}${chiffres.length > 0 ? sansMontant(g.nbLignes - chiffres.length) : ""}`),
        lien: "/stock/legumes", titre: "Achat de légumes enregistré", cle: null,
      };
    }
    case "RECEPTION":
      return {
        message: borne(`Réception du bon de commande n° ${g.numero}${g.fournisseurNom ? ` (${g.fournisseurNom})` : ""} enregistrée par ${auteurNom} — ${pluriel(g.nbLignes, "ligne reçue", "lignes reçues")}, ${g.complete ? "complète" : "partielle"}`),
        lien: `/stock/commandes/${g.bonDeCommandeId}`, titre: "Réception de marchandise", cle: null,
      };
  }
}

/** Texte d'une notification de mouvements regroupés (n ≥ 2). PURE. */
export function texteRegroupe(auteurNom: string, g: Extract<GesteStock, { genre: "MOUVEMENT" }>, n: number, depuis: Date): string {
  const motif = g.categorieSortie ? LIBELLE_MOTIF[g.categorieSortie] : g.origine;
  // « saisies » : chaque geste peut porter plusieurs lignes ; le compteur compte les gestes.
  const quoi = g.type === "ENTREE" ? "saisies d'entrées" : "saisies de sorties";
  const s = `${formaterNombre(n)} ${quoi} (${motif}) par ${auteurNom} depuis ${heureKinshasa(depuis)} — dernière : ${detailLignes(g.lignes)}`;
  return s.length > LONGUEUR_MAX ? `${s.slice(0, LONGUEUR_MAX - 1)}…` : s;
}

async function livrer(auteur: AuteurGeste, g: GesteStock, maintenant: Date) {
  if (auteur.role === "ADMIN") return; // un geste de la Direction ne la notifie pas
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", actif: true, id: { not: auteur.id } }, select: { id: true } });
  if (admins.length === 0) return;
  const t = texteGeste(auteur.nom, g);
  const prefixe = t.cle ? `geste:${auteur.id}:${t.cle}:` : null;
  // Un destinataire en échec ne prive pas les autres : chacun dans son try/catch.
  const pushs = new Map<string, string[]>(); // corps du push → destinataires
  for (const a of admins) {
    try {
      let corps = t.message;
      let regroupe = false;
      if (prefixe && g.genre === "MOUVEMENT") {
        const recente = await prisma.notification.findFirst({
          where: { domaine: "STOCK", destinataireUserId: a.id, lu: false, refId: { startsWith: prefixe }, createdAt: { gte: new Date(maintenant.getTime() - FENETRE_REGROUPEMENT_MS) } },
          orderBy: { createdAt: "desc" },
        });
        const n = recente ? Number(recente.refId!.slice(prefixe.length)) : NaN;
        if (recente && Number.isInteger(n) && n >= 1) {
          corps = texteRegroupe(auteur.nom, g, n + 1, recente.createdAt);
          // Mise à jour CONDITIONNELLE sur le compteur lu : deux gestes simultanés ne l'écrasent pas.
          const maj = await prisma.notification.updateMany({
            where: { id: recente.id, refId: recente.refId, lu: false },
            data: { message: corps, lien: lienMouvements({ ...g, lignes: [] }), refId: `${prefixe}${n + 1}` },
          });
          regroupe = maj.count === 1;
          if (!regroupe) corps = t.message;
        }
      }
      if (!regroupe) {
        await prisma.notification.create({
          data: { domaine: "STOCK", destinataireUserId: a.id, type: "AUTRE", message: t.message, lien: t.lien, refId: prefixe ? `${prefixe}1` : `geste:${auteur.id}:${g.genre}` },
        });
      }
      pushs.set(corps, [...(pushs.get(corps) ?? []), a.id]);
    } catch (e) {
      console.error("[stock] notification d'un compte Direction en échec :", e);
    }
  }
  // Même étiquette pour une rafale : l'appareil remplace la précédente (texte regroupé) au lieu d'empiler.
  const tag = prefixe ? `geste-${auteur.id}-${t.cle}` : `geste-${auteur.id}-${g.genre}-${maintenant.getTime()}`;
  for (const [corps, ids] of pushs) await envoyerPush(ids, { title: t.titre, body: corps.slice(0, 180), url: t.lien, tag });
}

/**
 * Notifie la Direction d'un geste de stock fait par un compte NON-Direction. À appeler APRÈS
 * l'écriture (transaction validée). Ne lève JAMAIS : un échec est consigné, sans effet sur le geste.
 */
export async function notifierGesteStock(auteur: AuteurGeste, g: GesteStock, maintenant: Date = new Date()): Promise<void> {
  try {
    await livrer(auteur, g, maintenant);
  } catch (e) {
    console.error("[stock] notification de la Direction en échec (le geste, lui, est enregistré) :", e);
  }
}
