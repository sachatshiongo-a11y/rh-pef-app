import { prisma } from "@/lib/prisma";
import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurInventaire, type FeuilleInventaire } from "@/lib/export-excel";
import { MOIS_FR } from "@/lib/dates-fr";
import { inventaireDuMois, parDomaine, alerteLabel, ligneSansPrix, PLAFOND_MOUVEMENTS_EXPORT } from "@/lib/cloture-inventaire";
import { mentionSansPrix } from "@/lib/valeur-stock";
import { dateHeureGenerationKinshasa } from "@/lib/heure-kinshasa";
import { niveauAlerte, uniteAffichee } from "@/lib/stock";
import { formaterNombre } from "@/lib/montant";
import { CHAMPS_LIBELLE, libelleArticle } from "@/lib/libelle-article";

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `${formaterNombre(r2(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
/** Affiché tel quel par `TelechargerLien` à la place du téléchargement. */
const MESSAGE_PDF_RETIRE = "L'inventaire se télécharge en Excel.";

const num = (n: number) => formaterNombre(Math.round(n * 1000) / 1000);

/**
 * Inventaire valorisé d'un mois (figé à la clôture, sinon état actuel) : une feuille par domaine
 * avec KPI en haut, tableau d'inventaire (catégorie, fournisseur, statut de réappro) ET les
 * mouvements du même domaine dans la même feuille. EXCEL SEULEMENT : le PDF a été retiré le 13/10/2026 (décision de la
 * Direction). Il faisait tomber l'instance de production : react-pdf paginait un tableau de plusieurs centaines de
 * lignes en bloquant la boucle d'événements des dizaines de secondes (le contrôle de santé de Render, 5 s, échouait).
 * Le catalogue en compte 446, l'Excel (+49 à +89 Mo, sans blocage) est le format qui convient.
 */
export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  // Une panne se DIT. Sans ce filet, une erreur levée ici devenait un 500 sans corps, que l'écran traduisait
  // par « Le document n'a pas pu être récupéré. Vérifiez votre connexion » — la même phrase qu'une coupure de
  // réseau (constaté en production le 12/10/2026 : impossible de savoir laquelle des deux). La cause réelle va
  // dans le journal du serveur, sous une référence que la personne peut citer ; elle n'est jamais affichée
  // (les messages de la base ne sortent pas de la maison).
  try {
    return await produire(req);
  } catch (e) {
    const reference = `INV-${Date.now().toString(36).slice(-5).toUpperCase()}`;
    console.error(`[stock] export de l'inventaire en échec (${reference}) :`, req.url, e);
    return new Response(
      `L'inventaire n'a pas pu être produit (erreur interne, référence ${reference}). Réessayez ; si cela se répète, communiquez cette référence.`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }
}

async function produire(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  // PDF retiré : refus lisible, AVANT toute lecture de la base (un ancien favori ou un onglet ouvert ne casse rien).
  if (sp.get("format") === "pdf") return new Response(MESSAGE_PDF_RETIRE, { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const m = (sp.get("mois") ?? "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return new Response("Mois invalide (attendu AAAA-M).", { status: 400 });
  const annee = Number(m[1]), mois = Number(m[2]);

  const inv = await inventaireDuMois(annee, mois);
  const groupes = parDomaine(inv);
  const periodeLabel = `${MOIS_FR[mois - 1]} ${annee}`;
  // Honnête sur la date : l'instantané est le stock du MOMENT de la clôture, pas un stock de fin de mois reconstitué.
  const etat = inv.fige
    ? `stock figé à la clôture : stock au ${inv.figeLe ? dateHeureGenerationKinshasa(inv.figeLe) : "moment de la clôture (heure non conservée)"}`
    : `état actuel au ${dateHeureGenerationKinshasa(new Date())} (mois non clôturé)`;
  // Total partiel : les articles en stock sans prix n'y sont pas comptés (jamais 0 en silence).
  const partiel = mentionSansPrix(inv.nbSansPrix);
  const totalTexte = `${usd(inv.valeurTotaleUSD)}${partiel ? ` (${partiel})` : ""}`;
  const suffixe = `${annee}-${String(mois).padStart(2, "0")}`;

  // Mouvements du mois, groupés par domaine (dans la feuille du domaine, jamais à part).
  const debut = new Date(Date.UTC(annee, mois - 1, 1)), fin = new Date(Date.UTC(annee, mois, 1));
  const lus = await prisma.mouvementStock.findMany({
    where: { date: { gte: debut, lt: fin } },
    orderBy: [{ date: "asc" }],
    take: PLAFOND_MOUVEMENTS_EXPORT + 1, // un de plus : sert à savoir si la liste est coupée
    select: {
      type: true, quantite: true, date: true, montantUSD: true,
      article: { select: { code: true, ...CHAMPS_LIBELLE, unite: true, domaine: true } },
    },
  });
  // Coupée : on le DIT dans le classeur (les « Entrées / Sorties du mois » ne portent alors que sur ce qui est listé).
  const tronque = lus.length > PLAFOND_MOUVEMENTS_EXPORT;
  const mouvements = tronque ? lus.slice(0, PLAFOND_MOUVEMENTS_EXPORT) : lus;
  const mvtParDomaine = (dom: string) => mouvements.filter((x) => String(x.article.domaine) === dom);

  const feuilles: FeuilleInventaire[] = groupes.map((g) => {
    const urgents = g.lignes.filter((l) => niveauAlerte(l.quantite, l.stockMinimum, l.seuilUrgent) === "URGENT").length;
    const appros = g.lignes.filter((l) => niveauAlerte(l.quantite, l.stockMinimum, l.seuilUrgent) === "APPRO").length;
    const mvts = mvtParDomaine(g.domaine);
    const valEnt = r2(mvts.filter((x) => x.type !== "SORTIE").reduce((t, x) => t + (x.montantUSD !== null ? Number(x.montantUSD) : 0), 0));
    const valSor = r2(mvts.filter((x) => x.type === "SORTIE").reduce((t, x) => t + (x.montantUSD !== null ? Number(x.montantUSD) : 0), 0));
    return {
      nom: g.label,
      titre: `Inventaire ${g.label} — ${periodeLabel} (${etat})`,
      kpis: [
        { label: `Valeur du stock — ${g.label}`, valeur: `${usd(g.valeur)}${g.nbSansPrix > 0 ? ` (${mentionSansPrix(g.nbSansPrix)})` : ""}` },
        { label: "Valeur du stock — TOTAL", valeur: totalTexte },
        { label: "Articles", valeur: String(g.lignes.length) },
        { label: "Dont à réapprovisionner", valeur: String(urgents + appros) },
        { label: "En rupture (urgent)", valeur: String(urgents) },
        { label: "À réapprovisionner", valeur: String(appros) },
        { label: "Entrées du mois (USD)", valeur: usd(valEnt) },
        { label: "Sorties du mois (USD)", valeur: usd(valSor) },
      ],
      invEntete: ["Code", "Désignation", "Unité", "Catégorie", "Fournisseur", "Stock min", "Stock final", "Alerte stock", "Prix U. USD", "Valeur USD", "Prix saisi en FC"],
      invLignes: g.lignes.map((l) => [
        l.code, libelleArticle(l), l.unite, l.categorie, l.fournisseur,
        r2(l.stockMinimum), r2(l.quantite), alerteLabel(l.quantite, l.stockMinimum, l.seuilUrgent),
        // Sans prix : cellules vides (jamais 0) — le total est partiel de ces articles.
        ligneSansPrix(l) ? "" : r2(l.prixUnitaireUSD), ligneSansPrix(l) ? "" : r2(l.quantite * l.prixUnitaireUSD),
        // Article en francs : son prix tel que saisi et le taux qui l'a converti (« taux non défini » : non valorisé).
        l.prixUnitaireCDF !== undefined ? `${l.prixUnitaireCDF} FC ${l.tauxChange ? `≈ au taux ${l.tauxChange}` : "(taux non défini : non valorisé)"}` : ligneSansPrix(l) ? "sans prix" : "",
      ]),
      invTotauxCols: [9],
      alerteCol: 7,
      mvtTitre: tronque
        ? `MOUVEMENTS DU MOIS — ${g.label} — LISTE COUPÉE aux ${formaterNombre(PLAFOND_MOUVEMENTS_EXPORT)} premiers mouvements du mois (tous domaines) : entrées et sorties ci-dessus INCOMPLÈTES`
        : `MOUVEMENTS DU MOIS — ${g.label}`,
      // Unité de l'article à côté des quantités (2026-10-09) ; « — » si elle manque, jamais devinée.
      mvtEntete: ["Date", "Code", "Désignation", "Unité", "Entrées", "Sorties", "Valeur USD"],
      mvtLignes: mvts.map((x) => [
        new Date(x.date).toLocaleDateString("fr-FR"),
        x.article.code ?? "",
        libelleArticle(x.article),
        uniteAffichee(x.article.unite),
        x.type !== "SORTIE" ? num(Number(x.quantite)) : "",
        x.type === "SORTIE" ? num(Number(x.quantite)) : "",
        x.montantUSD !== null ? r2(Number(x.montantUSD)) : "",
      ]),
    };
  });

  const buf = await classeurInventaire({ periode: `${periodeLabel} · ${etat} · stock total ${totalTexte}`, feuilles });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Inventaire_${suffixe}.xlsx"`,
    },
  });
}
