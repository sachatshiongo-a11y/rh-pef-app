import { prisma } from "@/lib/prisma";
import { type Jour, type LigneResto } from "./restaurant-client";
import { RestaurantEcran } from "./restaurant-ecran";
import { proposerRattachements } from "@/lib/fiches/rattachement-resto";
import { joursSemaine } from "./semaine";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { formaterNombre } from "@/lib/montant";
import { chargerEntreesStockResto } from "@/lib/stock-restaurant-charger";
import { planRattachementAuto } from "@/lib/rattachement-auto";
import { LIBELLE_SIGNALEMENT, recuDuDepot, stockRestaurantTheorique, type SignalementLivraison } from "@/lib/stock-restaurant";

const q3 = (v: string) => formaterNombre(Number(v), { maximumFractionDigits: 3 });
const jjmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** « 3 l du 22/09 : unité incompatible » — une livraison du dépôt non additionnée, en clair. */
const texteSignal = (s: SignalementLivraison, avecDate: boolean) =>
  `${q3(s.quantite)}${s.uniteCatalogue ? ` ${s.uniteCatalogue}` : ""}${avecDate ? ` du ${jjmm(s.date)}` : ""} : ${LIBELLE_SIGNALEMENT[s.motif]}`;
import { exigerPageStock } from "@/lib/garde-page";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

type SP = { espace?: string; semaine?: string; desactives?: string };

export default async function RestaurantPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const espace = sp.espace === "BAR" ? "BAR" : "CUISINE";
  // « Afficher les désactivés » (Direction) : les articles désactivés reviennent, grisés, sans saisie.
  const afficherDesactives = estDirection && sp.desactives === "1";
  const base = sp.semaine ? new Date(sp.semaine) : jourCivilKinshasa(new Date());
  const jours: Jour[] = joursSemaine(base);
  const debut = new Date(jours[0].iso), fin = new Date(jours[6].iso);

  // Stock théorique : l'état COURANT (aujourd'hui, Kinshasa) ; le reçu du dépôt, jour par jour.
  const aujourdhui = jourKinshasaISO();
  const [articles, livraisons, catalogue, entrees] = await Promise.all([
    prisma.articleResto.findMany({
      where: { espace, ...(afficherDesactives ? {} : { actif: true }) },
      orderBy: [{ categorie: "asc" }, { ordre: "asc" }, { designation: "asc" }],
      include: {
        comptages: { where: { date: { gte: debut, lte: fin } } },
        articleStock: { select: { designation: true } },
      },
    }),
    // Livraisons au restaurant (sorties de stock « Livraison restaurant ») de la semaine affichée.
    prisma.mouvementStock.findMany({
      where: { categorieSortie: "LIVRAISON_RESTAURANT", date: { gte: debut, lte: fin } },
      orderBy: { date: "desc" },
      include: { article: { select: { designation: true } } },
    }),
    // Catalogue actif : choix du rattachement ET propositions (noms identiques). Lecture seule —
    // rien n'est rattaché ici, seulement proposé.
    prisma.articleStock.findMany({ where: { actif: true }, orderBy: { designation: "asc" }, select: { id: true, designation: true, nomCourt: true, unite: true, actif: true, contenance: true, contenanceUnite: true } }),
    // Entrées du stock théorique (requêtes groupées, jamais par article) : lecture seule.
    chargerEntreesStockResto({ depuis: jours[0].iso, jusquA: aujourdhui > jours[6].iso ? aujourdhui : jours[6].iso }),
  ]);
  const theorique = stockRestaurantTheorique(entrees, aujourdhui).parArticle;
  // Livraisons de la semaine qui n'alimentent pas le restaurant : signalées, jamais réparties.
  const nonRattachees = stockRestaurantTheorique(entrees, jours[6].iso).nonRattachees.filter((l) => l.date >= jours[0].iso);
  // Rattachement automatique : ce que le bouton du bandeau ferait (LECTURE seule — rien n'est écrit à
  // l'affichage). Les propositions déjà couvertes par lui ne sont pas montrées une seconde fois.
  const planAuto = await planRattachementAuto([...new Set(nonRattachees.map((l) => l.articleStockId))]);
  const couverts = new Set(planAuto.filter((d) => d.action !== "LAISSER").map((d) => d.articleStockId));
  const propositions = proposerRattachements(articles.filter((a) => a.actif), catalogue).filter((p) => !couverts.has(p.articleStockId));

  // Regroupe les livraisons par jour.
  const livParJour = new Map<string, { designation: string; quantite: number }[]>();
  for (const m of livraisons) {
    const k = new Date(m.date).toISOString().slice(0, 10);
    (livParJour.get(k) ?? livParJour.set(k, []).get(k)!).push({ designation: m.article.designation, quantite: Number(m.quantite) });
  }

  const signalesSemaine = new Map<string, SignalementLivraison>();
  const lignes: LigneResto[] = articles.map((a) => {
    const comptages: Record<string, string> = {};
    for (const c of a.comptages) comptages[new Date(c.date).toISOString().slice(0, 10)] = Number(c.quantite).toString();
    const recus: Record<string, string> = {};
    const signauxJour: Record<string, string[]> = {};
    for (const j of jours) {
      const r = recuDuDepot(entrees, a.id, j.iso);
      if (r.quantite !== null) recus[j.iso] = r.quantite;
      if (r.signalements.length > 0) signauxJour[j.iso] = r.signalements.map((x) => texteSignal(x, false));
      for (const x of r.signalements) signalesSemaine.set(`${x.livraisonId}`, x);
    }
    const t = theorique.get(a.id);
    return {
      id: a.id, actif: a.actif, categorie: a.categorie, designation: a.designation, unite: a.unite,
      base: a.stockBaseJournalier !== null ? Number(a.stockBaseJournalier).toString() : "",
      comptages,
      articleStockId: a.articleStockId,
      articleStockDesignation: a.articleStock?.designation ?? null,
      recus, signauxJour,
      theorique: {
        stock: t?.stock ?? null,
        aucunComptage: t?.aucunComptage ?? true,
        signalements: (t?.signalements ?? []).map((x) => texteSignal(x, true)),
      },
    };
  });

  const categories = [...new Set(articles.map((a) => a.categorie).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr"));

  const livraisonsParJour = [...livParJour.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return (
    <RestaurantEcran
      espace={espace} jours={jours} aujourdhui={aujourdhui} estDirection={estDirection} afficherDesactives={afficherDesactives}
      lignes={lignes} categories={categories} catalogue={catalogue.map((a) => ({ id: a.id, designation: a.designation, unite: a.unite ?? "" }))}
      livraisonsParJour={livraisonsParJour} nonRattachees={nonRattachees} signalements={[...signalesSemaine.values()]} planAuto={planAuto}
      articlesResto={entrees.articles} propositions={propositions}
    />
  );
}
