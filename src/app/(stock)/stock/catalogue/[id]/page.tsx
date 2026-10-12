import Link from "next/link";
import type { ReactNode } from "react";
import { formaterFC } from "@/lib/montant";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { supprimerArticle } from "../actions";
import { EditerArticle } from "./editer-article";
import { PastilleMotif, PastilleType, TEINTE_FILTRE_MOUVEMENT } from "@/components/stock/pastille-mouvement";
import { FournisseursArticle, type LigneFournisseurArticle } from "./fournisseurs-article";
import { chargerPrixParFournisseur } from "@/lib/article-fournisseurs";
import { niveauAlerte, ALERTE_LABEL, DOMAINE_LABEL, usd, qte, uniteAffichee, type NiveauAlerte } from "@/lib/stock";
import { analyserPrix, pointDeMouvement, pointDeLigne } from "@/lib/stock-prix";
import { exigerPageStock } from "@/lib/garde-page";
import { TelechargerLien } from "@/components/telecharger-lien";
import { demandeSurCible } from "@/lib/validations-stock/apercu";
import { cleArticle } from "@/lib/validations-stock/charge";
import { DetailDemande, AlertesDemande } from "../../a-valider/detail-demande";
import { DecisionDemande } from "../../a-valider/decision-demande";
import { libellesPrix, prixArticleEnUSD, valeurEnUSD } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import { jourCourantKinshasaISO, anneeCouranteKinshasa } from "@/lib/heure-kinshasa";
import { anneesAvecDonnees, lireAnneeFiche } from "@/lib/fiche-annees";
import {
  anneesDesMouvements, bornesPeriode, consommationDuMois, effectifsParAnnee, effectifsPeriode, groupesParMois, libelleMois, libelleMoisAnnee,
  lienPdfArticle, lireMoisMouvements, moisAvecMouvements, moisEnCours, nbDuMois, totauxDuMois, type AgregatMouvement, type PeriodeMouvements,
} from "@/lib/mouvements-article-mois";
import { jjmmaaaa } from "@/lib/achats-liste";
import { classePastilleDlc, joursAvantDlc, libelleJoursDlc } from "@/lib/achats-doublons";
import { complementLibelle, incoherenceContenance, libelleArticle } from "@/lib/libelle-article";
import { formaterDecimales } from "@/lib/montant";
import { OngletsDefilants } from "@/components/onglets-defilants";
import { PastillesFiltre } from "@/components/pastilles-filtre";
import { EtatVide } from "@/components/etat-vide";
import {
  lireOngletArticle, lireFiltreMouvements, typeDuFiltre, lienFicheArticle,
  type FiltreMouvements, type OngletArticle,
} from "@/lib/fiche-article";
import { Indicateur } from "@/components/indicateur";

// Fiche « tout sur la page » (Direction, 2026-09-28 : « pourquoi ne pas juste les mettre sur la
// page ») : aucun cadre à hauteur fixe avec sa propre barre de défilement. Les listes longues
// s'affichent par tranches : les plus récents d'abord, puis un lien qui AJOUTE les plus anciens à
// la page. Garde-fou : fiche-sans-defilement.test.ts.
const MOUVEMENTS_AFFICHES = 50;
const PRIX_AFFICHES = 20;
const MOUVEMENTS_CHARGES = 200; // au-delà : la page Mouvements, filtrée sur l'article

const dCourt = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "—");

export default async function ArticleFichePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string; mouvements?: string; prix?: string; onglet?: string | string[]; filtre?: string | string[]; annee?: string | string[]; mois?: string | string[] }>;
}) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const { id } = await params;
  const estDirection = user.role === "ADMIN";
  const filtre = lireFiltreMouvements(sp.filtre);

  // Toujours lus, et peu coûteux : la fiche, les comptes des libellés d'onglets et des filtres (agrégats SQL,
  // aucune ligne rapatriée), les chiffres des cartes. Le CONTENU de l'onglet Mouvements et la comparaison de prix des
  // fournisseurs, eux, ne sont lus que pour l'onglet affiché (même principe que la fiche fournisseur).
  const [a, toutesCategories, fournisseurs, proposition, taux, groupesMouvements, entreesSansFacture, ingredients] = await Promise.all([
    prisma.articleStock.findUnique({
      where: { id },
      include: {
        stock: true,
        categorie: { select: { nom: true } },
        fournisseur: { select: { id: true, nom: true } },
        fournisseurs: { include: { fournisseur: { select: { id: true, nom: true } } } },
        lignesFacture: {
          include: { facture: { select: { id: true, numero: true, date: true, tauxChangeUtilise: true } } },
        },
      },
    }),
    // Pour le formulaire « Modifier » de la fiche — mêmes listes que l'Inventaire.
    prisma.categorieStock.findMany({ orderBy: [{ ordre: "asc" }, { nom: "asc" }], select: { id: true, nom: true, domaine: true, actif: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    demandeSurCible(cleArticle(id)), // proposition de modification en attente de la Direction ?
    tauxDuJour(),
    // Un seul agrégat (jour × type × motif) : les effectifs des pastilles, les années et mois proposés, les totaux de chaque mois
    // ET la carte « Consommation du mois » en découlent (lib/mouvements-article-mois.ts) — une seule règle pour les deux.
    prisma.mouvementStock.groupBy({ by: ["date", "type", "categorieSortie"], where: { articleId: id }, _count: { _all: true }, _sum: { quantite: true } }),
    // Entrées payées hors facture (liste d'achat…) : des achats quand même, pour l'évolution du prix (les 500 plus récentes).
    prisma.mouvementStock.findMany({
      where: { articleId: id, type: "ENTREE", factureId: null, montantUSD: { not: null } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500,
      select: { articleId: true, montantUSD: true, quantite: true, date: true, origine: true },
    }),
    // Fiches techniques où l'article est un ingrédient (une fiche peut le citer plusieurs fois).
    prisma.ingredientFiche.findMany({
      where: { articleId: id }, orderBy: { fiche: { nom: "asc" } },
      select: { id: true, unite: true, quantite: true, fiche: { select: { id: true, nom: true, type: true, actif: true } } },
    }),
  ]);
  if (!a) notFound();
  // Catégories ARCHIVÉES : plus proposées dans le choix, sauf celle que l'article porte déjà (il reste rattaché).
  const categories = toutesCategories.filter((c) => c.actif || c.id === a.categorieId);

  // Mouvements : l'année (celle en cours par défaut) et le mois (tous par défaut) viennent de l'adresse ; les effectifs des
  // pastilles de type suivent ce choix. Le libellé de l'onglet, lui, garde le TOTAL de l'article.
  const agregats: AgregatMouvement[] = groupesMouvements.map((g) => ({ date: g.date, type: g.type, categorieSortie: g.categorieSortie, nb: g._count._all, quantite: Number(g._sum.quantite ?? 0) }));
  const anneeCourante = anneeCouranteKinshasa();
  const annees = anneesAvecDonnees(anneesDesMouvements(agregats), anneeCourante);
  const anneeVue = lireAnneeFiche(sp.annee, annees, anneeCourante, true);
  const moisDispo = anneeVue === "toutes" ? [] : moisAvecMouvements(agregats, anneeVue);
  const moisVue = lireMoisMouvements(sp.mois, moisDispo);
  const periode: PeriodeMouvements = { annee: anneeVue, mois: moisVue };
  const effectifsMouvements = effectifsPeriode(agregats, periode);
  const effectifsAnnees = effectifsParAnnee(agregats, annees);
  const nbMouvements = effectifsParAnnee(agregats, []).toutes;
  const nbFiltre = effectifsMouvements[filtre];
  const nbFichesUtilisant = new Set(ingredients.map((i) => i.fiche.id)).size;
  // Onglet « Fiches techniques » : seulement si l'article y est utilisé ; un lien vers lui sans fiche retombe sur Mouvements.
  const ongletDemande = lireOngletArticle(sp.onglet);
  const onglet: OngletArticle = ongletDemande === "fiches" && nbFichesUtilisant === 0 ? "mouvements" : ongletDemande;

  // Contenu de l'onglet affiché, et de lui seul.
  const [mouvementsDb, entreesDlc, comparaison] = await Promise.all([
    onglet === "mouvements"
      ? prisma.mouvementStock.findMany({
          where: { articleId: id, ...(typeDuFiltre(filtre) ? { type: typeDuFiltre(filtre) } : {}), ...(bornesPeriode(periode) ? { date: bornesPeriode(periode)! } : {}) },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: MOUVEMENTS_CHARGES,
          include: {
            facture: { select: { id: true, numero: true, fournisseurId: true, fournisseurNom: true } },
            reception: { select: { bonDeCommande: { select: { id: true, numero: true, fournisseurId: true, fournisseur: { select: { nom: true } } } } } },
          },
        })
      : null,
    // DLC des dernières entrées (Liste d'achat, 2026-10-08) : les 5 plus récentes qui en portent une. Indicatif (pas de suivi par lot).
    onglet === "mouvements" && (filtre === "tous" || filtre === "entrees")
      ? prisma.mouvementStock.findMany({ where: { articleId: id, type: "ENTREE", dlc: { not: null } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 5, select: { id: true, date: true, quantite: true, dlc: true } })
      : null,
    // Fournisseurs de l'article et dernier prix de chacun (calculé depuis l'historique : Liste d'achat, factures, bons).
    onglet === "fournisseurs"
      ? chargerPrixParFournisseur(a.id, { unite: a.unite, uniteParCarton: a.uniteParCarton, contenance: a.contenance, contenanceUnite: a.contenanceUnite }, taux)
      : null,
  ]);

  const lignesFournisseurs: LigneFournisseurArticle[] = comparaison ? (() => {
    const prixDe = new Map(comparaison.lignes.map((l) => [l.fournisseurId, l]));
    return a.fournisseurs
      .map((l): LigneFournisseurArticle => {
        const p = prixDe.get(l.fournisseurId);
        return {
          fournisseurId: l.fournisseurId, nom: l.fournisseur.nom, habituel: l.habituel,
          prix: p ? {
            devise: p.devise, prix: p.prix, prixSaisi: p.prixSaisi, uniteLigne: p.uniteLigne, motif: p.motif, date: new Date(p.date).toISOString().slice(0, 10),
            origine: p.origine, refId: p.refId, refLibelle: p.refLibelle, autre: p.autre, moinsCher: p.moinsCher, ecartPct: p.ecartPct, nbAchats: p.nbAchats,
          } : null,
        };
      })
      // L'habituel d'abord, puis le moins cher, puis ceux qui ont un prix, puis par nom.
      .sort((x, y) => Number(y.habituel) - Number(x.habituel) || Number(y.prix?.moinsCher ?? false) - Number(x.prix?.moinsCher ?? false) || Number(y.prix !== null) - Number(x.prix !== null) || x.nom.localeCompare(y.nom, "fr"));
  })() : [];
  const dejaLies = new Set(a.fournisseurs.map((l) => l.fournisseurId));
  const fournisseursAAjouter = fournisseurs.filter((f) => !dejaLies.has(f.id));

  const niv: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum, a.stock.seuilUrgent) : null;
  const stockQte = a.stock ? Number(a.stock.quantite) : 0;
  // Prix de référence dans SA devise (2026-10-08) ; l'autre devise et la valeur en dollars d'un
  // article en francs sont « ≈ » au taux du jour (src/lib/prix-article.ts), « — » sans taux.
  const libPrix = libellesPrix(a, taux);
  const valeurC = valeurEnUSD(a, stockQte, taux);
  const refC = prixArticleEnUSD(a, taux);
  const refUSD = refC && refC.valeur > 0 ? refC.valeur : null;
  const ref$ = refC ? `${refC.approx ? "≈ " : ""}${usd(refC.valeur)}` : "—";

  // Évolution du prix : chaque ligne de facture porte un prix unitaire figé + la date de la facture.
  const analyse = analyserPrix([
    ...a.lignesFacture
      // Facture en francs : francs ÷ taux figé à son enregistrement ; sans taux, pas de point (jamais 0).
      .map((l) => pointDeLigne(l))
      .filter((x): x is NonNullable<typeof x> => x !== null),
    // Entrées payées hors facture (liste d'achat…) : des achats quand même.
    ...entreesSansFacture
      .map((m) => pointDeMouvement({ articleId: m.articleId, montantUSD: m.montantUSD, quantite: m.quantite, date: new Date(m.date), origine: m.origine }))
      .filter((x): x is NonNullable<typeof x> => x !== null),
  ]);
  const prixHisto = analyse.points;
  const { min: prixMin, max: prixMax, variation, hausse } = analyse;

  // Consommation du mois en cours : LA règle de lib/mouvements-article-mois.ts (toutes les sorties du mois, pertes comprises et dites
  // à part) — la même que l'en-tête de chaque mois de l'onglet Mouvements.
  const enCours = moisEnCours();
  const { total: sortiesMois, pertes: pertesMois } = consommationDuMois(agregats, enCours.annee, enCours.mois);
  const uniteTxt = a.unite?.trim() ? ` ${a.unite.trim()}` : "";

  // Affichage progressif (sans défilement interne) : l'état « tout voir » vit dans l'adresse.
  const tousMouvements = sp.mouvements === "tous";
  const tousPrix = sp.prix === "tous";
  const mouvements = mouvementsDb ?? [];
  const mouvementsAffiches = tousMouvements ? mouvements : mouvements.slice(0, MOUVEMENTS_AFFICHES);
  const mouvementsChargesEnPlus = mouvements.length - mouvementsAffiches.length;
  const mouvementsHorsPage = nbFiltre - mouvements.length; // au-delà des 200 chargés
  const prixRecents = [...prixHisto].reverse();
  const prixAffiches = tousPrix ? prixRecents : prixRecents.slice(0, PRIX_AFFICHES);

  const isoPur = (d: Date) => new Date(d).toISOString().slice(0, 10); // colonne @db.Date : date PURE
  const aujourdhuiISO = jourCourantKinshasaISO();

  const source = (m: (typeof mouvements)[number]) => {
    const bc = m.reception?.bonDeCommande;
    const fournId = m.facture?.fournisseurId ?? bc?.fournisseurId ?? null;
    const fournNom = m.facture?.fournisseurNom ?? bc?.fournisseur?.nom ?? null;
    return { facture: m.facture, bc, fournId, fournNom };
  };

  // Nom AFFICHÉ (contenance comprise si le nom ne la porte pas) ; la désignation enregistrée reste celle du formulaire.
  const libelle = libelleArticle(a);
  const complement = complementLibelle(a);
  const incoherence = incoherenceContenance(a);

  const lienOnglet = (o: OngletArticle) => lienFicheArticle(a.id, o);
  const onglets: { o: OngletArticle; label: string }[] = [
    { o: "mouvements", label: `Mouvements (${nbMouvements})` },
    { o: "fournisseurs", label: `Fournisseurs (${a.fournisseurs.length})` },
    ...(nbFichesUtilisant > 0 ? [{ o: "fiches" as const, label: `Fiches techniques (${nbFichesUtilisant})` }] : []),
    { o: "prix", label: `Prix (${prixHisto.length})` },
    { o: "informations", label: "Informations" },
  ];
  const lienFiltre = (v: FiltreMouvements) => lienFicheArticle(a.id, "mouvements", { filtre: v, annee: anneeVue, mois: moisVue });
  const lienAnnee = (v: string) => lienFicheArticle(a.id, "mouvements", { filtre, annee: v === "toutes" ? "toutes" : Number(v) });
  const lienMois = (v: string) => lienFicheArticle(a.id, "mouvements", { filtre, annee: anneeVue, mois: v === "tous" ? null : Number(v) });
  const effectifsMois: Record<string, number> = { tous: effectifsAnnees[String(anneeVue)] ?? 0 };
  if (anneeVue !== "toutes") for (const m of moisDispo) effectifsMois[String(m)] = effectifsPeriode(agregats, { annee: anneeVue, mois: m }).tous;
  // Mouvements affichés, groupés par mois ; chaque mois porte les totaux du mois ENTIER (jamais ceux de la page).
  const mois = groupesParMois(mouvementsAffiches);
  const quand = anneeVue === "toutes" ? "" : moisVue ? ` en ${libelleMoisAnnee(anneeVue, moisVue).toLowerCase()}` : ` en ${anneeVue}`;
  const prixConso = (q: number) => valeurEnUSD(a, q, taux);
  const infos: [string, ReactNode][] = [
    ["Désignation enregistrée", a.designation],
    ["Nom court", a.nomCourt],
    ["Marque", a.marque],
    ["Code article", a.code],
    ["Domaine", DOMAINE_LABEL[a.domaine] ?? a.domaine],
    ["Catégorie", a.categorie?.nom ?? "à classer"],
    ["Unité", a.unite],
    ["Contenance d'une unité", a.contenance !== null && a.contenanceUnite ? `${formaterDecimales(Number(a.contenance), 3)} ${a.contenanceUnite}` : null],
    ["Unités / carton", a.uniteParCarton !== null ? formaterDecimales(Number(a.uniteParCarton), 3) : null],
    ["Prix de référence", libPrix.principal !== "—" ? <>{libPrix.principal}{libPrix.autre && <span className="block text-[11px] font-normal text-muted-foreground">{libPrix.autre} au taux du jour</span>}</> : null],
    ["Fournisseur habituel", a.fournisseur ? <Link href={`/stock/fournisseurs/${a.fournisseur.id}`} className="text-primary hover:underline">{a.fournisseur.nom}</Link> : null],
    ["Stock minimum", a.stock ? qte(a.stock.stockMinimum) : null],
    ["Seuil urgent", a.stock && Number(a.stock.seuilUrgent) > 0 ? qte(a.stock.seuilUrgent) : null],
  ];

  return (
    <div className="w-full space-y-5">
      <FilAriane segments={[{ label: "Inventaire", href: `/stock/catalogue?domaine=${a.domaine}` }, { label: libelle }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl" title={complement ? `Nom enregistré : « ${a.designation} » — la contenance (${complement}) s'ajoute à l'affichage` : undefined}>{libelle}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{DOMAINE_LABEL[a.domaine] ?? a.domaine}</span>
            <span>· {a.categorie?.nom ?? "à classer"}</span>
            {a.code && <span>· Code {a.code}</span>}
            {a.unite && <span>· {a.unite}{a.contenance !== null ? ` de ${a.contenance.toString().replace(".", ",")} ${a.contenanceUnite}` : ""}</span>}
            {a.fournisseur && <span>· <Link href={`/stock/fournisseurs/${a.fournisseur.id}`} className="text-primary hover:underline">{a.fournisseur.nom}</Link>{a.fournisseurs.length > 1 && <> <Link href={lienOnglet("fournisseurs")} className="rounded bg-muted px-1 py-0.5 text-[11px] font-semibold text-muted-foreground hover:underline" title="Voir tous les fournisseurs de cet article">+{a.fournisseurs.length - 1}</Link></>}</span>}
            {!a.fournisseur && a.fournisseurs.length > 0 && <span>· <Link href={lienOnglet("fournisseurs")} className="hover:underline">{a.fournisseurs.length} fournisseur{a.fournisseurs.length > 1 ? "s" : ""}, sans habituel</Link></span>}
          </p>
          {/* Le nom et la contenance se contredisent : le logiciel le dit, la Direction corrige l'un ou l'autre. */}
          {incoherence && (
            <p data-incoherence-contenance className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900">
              Contenance à vérifier : {incoherence.message}. Le nom affiché n&apos;est pas complété — corrigez le nom ou la contenance.
            </p>
          )}
        </div>
        {/* Les boutons passent à la ligne sur téléphone : à 375 px, les trois côte à côte débordaient. */}
        <div className="flex flex-wrap items-center gap-2">
          <TelechargerLien href={onglet === "mouvements" ? lienPdfArticle(a.id, periode, filtre) : `/stock/catalogue/${a.id}/pdf`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Exporter PDF
          </TelechargerLien>
          <EditerArticle
            a={{
              id: a.id,
              domaine: a.domaine,
              code: a.code,
              designation: a.designation,
              nomCourt: a.nomCourt,
              marque: a.marque,
              unite: a.unite,
              contenance: a.contenance !== null ? a.contenance.toString() : null,
              contenanceUnite: a.contenanceUnite,
              uniteParCarton: a.uniteParCarton !== null ? a.uniteParCarton.toString() : null,
              prixUnitaireUSD: a.prixUnitaireUSD !== null ? a.prixUnitaireUSD.toString() : null,
              devisePrix: a.devisePrix,
              prixUnitaireCDF: a.prixUnitaireCDF !== null ? a.prixUnitaireCDF.toString() : null,
              categorieId: a.categorieId,
              fournisseurId: a.fournisseurId,
              stockMinimum: a.stock ? a.stock.stockMinimum.toString() : "0",
              seuilUrgent: a.stock ? a.stock.seuilUrgent.toString() : "0",
            }}
            categories={categories}
            fournisseurs={fournisseurs}
            estDirection={estDirection}
            taux={taux}
          />
          {estDirection && (
            <form action={supprimerArticle.bind(null, a.id)}>
              <ConfirmSubmitButton
                message={`Supprimer « ${libelle} » du catalogue ? Refusé s'il a un historique (mouvements, factures…) — dans ce cas, désactivez-le plutôt.`}
                className="rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                Supprimer
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </div>
      {sp.erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      {proposition && (
        <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
          <p className="text-sm font-semibold text-amber-900">Modification proposée — en attente de la Direction</p>
          <p className="text-xs text-amber-900/80">Proposée par {proposition.auteurNom} le {new Date(proposition.creeLe).toLocaleDateString("fr-FR", { timeZone: "Africa/Kinshasa" })}. L&apos;article garde ses valeurs actuelles tant qu&apos;elle n&apos;est pas validée.</p>
          <AlertesDemande a={proposition} />
          <DetailDemande a={proposition} />
          <DecisionDemande id={proposition.id} version={proposition.version} estDirection={estDirection} estAuteur={proposition.auteurId === user.id} />
        </section>
      )}

      {/* Alerte visuelle : le dernier prix d'achat grimpe nettement au-dessus de la moyenne précédente. */}
      {hausse && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <span className="font-semibold">⚠ Hausse du prix d&apos;achat</span>
          <span>
            Dernier achat à <span className="font-semibold">{usd(hausse.prix)}</span>, soit <span className="font-semibold">+{formaterDecimales(hausse.pct, 0)} %</span> au-dessus de la moyenne précédente ({usd(hausse.moyenneAnterieure)}).
          </span>
        </div>
      )}

      {/* Les quatre chiffres de l'article — au-dessus des onglets, visibles quel que soit l'onglet. L'alerte de stock
          (OK / À réapprovisionner / Urgent) et les seuils vivent dans la carte « Stock actuel ». */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Indicateur
          libelle="Stock actuel" valeur={a.stock ? `${qte(a.stock.quantite)}${uniteTxt}` : "—"}
          sousTexte={niv && a.stock ? `${ALERTE_LABEL[niv]} · minimum ${qte(a.stock.stockMinimum)}${Number(a.stock.seuilUrgent) > 0 ? ` · urgent ${qte(a.stock.seuilUrgent)}` : ""}` : undefined}
          teinte={stockQte < 0 || niv === "URGENT" ? "alerte" : niv === "APPRO" ? "attention" : niv === "OK" ? "entree" : undefined}
        />
        <Indicateur libelle="Valeur du stock" valeur={valeurC ? `${valeurC.approx ? "≈ " : ""}${usd(valeurC.valeur)}` : "—"} sousTexte={valeurC?.approx ? "au taux du jour" : undefined} />
        <Indicateur
          libelle="Dernier prix d'achat"
          valeur={analyse.dernier ? (analyse.dernier.prixCDF !== undefined ? formaterFC(analyse.dernier.prixCDF) : usd(analyse.dernier.prix)) : "—"}
          sousTexte={analyse.dernier ? `${analyse.dernier.prixCDF !== undefined ? `≈ ${usd(analyse.dernier.prix)} · ` : ""}le ${dCourt(analyse.dernier.date)}${hausse ? ` · +${formaterDecimales(hausse.pct, 0)} % vs moyenne` : ""}` : "aucun achat chiffré"}
          teinte={hausse ? "alerte" : undefined}
        />
        <Indicateur
          libelle="Consommation du mois" valeur={`${qte(sortiesMois)}${uniteTxt}`}
          sousTexte={pertesMois > 0 ? `dont ${qte(pertesMois)}${uniteTxt} de pertes` : "sorties du mois en cours"}
        />
      </div>

      <OngletsDefilants
        libelle="Sections de la fiche article"
        onglets={onglets.map(({ o, label }) => ({ href: lienOnglet(o), label, actif: o === onglet }))}
      />

      {/* Historique des mouvements : année, mois, puis type (Entrées / Sorties / Ajustements / Tous) — trois choix qui se combinent */}
      {onglet === "mouvements" && (
        <section id="mouvements" className="space-y-3">
          <PastillesFiltre
            libelle="Année des mouvements" actif={String(anneeVue)} effectifs={effectifsAnnees} lien={lienAnnee}
            valeurs={[...annees.map((an) => [String(an), String(an)] as const), ["toutes", "Toutes"] as const]}
          />
          {anneeVue !== "toutes" && moisDispo.length > 0 && (
            <PastillesFiltre
              libelle={`Mois de ${anneeVue}`} actif={moisVue === null ? "tous" : String(moisVue)} effectifs={effectifsMois} lien={lienMois}
              valeurs={[["tous", "Tous les mois"] as const, ...moisDispo.map((m) => [String(m), libelleMois(m)] as const)]}
            />
          )}
          <PastillesFiltre
            libelle="Filtrer les mouvements" actif={filtre} effectifs={effectifsMouvements} lien={lienFiltre}
            valeurs={[["entrees", "Entrées"], ["sorties", "Sorties"], ["ajustements", "Ajustements"], ["tous", "Tous"]] as const}
            teintes={TEINTE_FILTRE_MOUVEMENT}
          />
          {entreesDlc && entreesDlc.length > 0 && (
            <section id="dlc" data-dlc-fiche className="rounded-xl border p-4">
              <h2 className="text-base font-semibold">DLC des dernières entrées</h2>
              <p className="mb-2 text-xs text-muted-foreground">Indicatif : le logiciel ne suit pas les lots, la quantité entrée n&apos;est peut-être plus en stock.</p>
              <ul className="divide-y text-sm">
                {entreesDlc.map((m) => {
                  const dlcISO = isoPur(m.dlc as Date);
                  const jours = joursAvantDlc(dlcISO, aujourdhuiISO);
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">Entrée du {jjmmaaaa(isoPur(m.date))} · +{qte(m.quantite)}{a.unite ? ` ${a.unite}` : ""}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${classePastilleDlc(jours)}`}>DLC {jjmmaaaa(dlcISO)} · {libelleJoursDlc(jours)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {mouvements.length === 0 ? (
            <EtatVide
              message={nbMouvements === 0 ? "Aucun mouvement de stock pour cet article." : `Aucun mouvement${filtre === "tous" ? "" : " de ce type"}${quand} (${nbMouvements} au total pour cet article).`}
              action={nbMouvements > 0 ? <Link href={lienFicheArticle(a.id, "mouvements", { annee: "toutes" })} className="text-primary underline">Voir tous les mouvements ({nbMouvements})</Link> : undefined}
            />
          ) : (
            <>
            <div className="space-y-4">
              {mois.map((g) => {
                const t = totauxDuMois(agregats, g.annee, g.mois);
                const valeur = prixConso(t.consommation.total);
                // La page ne montre qu'une partie du mois : les totaux, eux, restent ceux du mois entier.
                const nbDuMoisFiltre = nbDuMois(agregats, g.annee, g.mois, filtre);
                const partiel = g.lignes.length < nbDuMoisFiltre;
                return (
                  <section key={`${g.annee}-${g.mois}`} aria-label={libelleMoisAnnee(g.annee, g.mois)} data-mois={`${g.annee}-${g.mois}`} className="rounded-lg border">
                    <div className="border-b bg-muted/40 px-3 py-2">
                      <h3 className="text-sm font-semibold">{libelleMoisAnnee(g.annee, g.mois)}</h3>
                      <dl data-totaux-mois={`${g.annee}-${g.mois}`} className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-3">
                        <div className="flex items-baseline justify-between gap-2 sm:block">
                          <dt className="text-xs text-muted-foreground">Entrées du mois</dt>
                          <dd data-entrees-mois className="font-semibold tabular-nums text-emerald-700">+{qte(t.entrees)} <span className="text-xs font-normal">{uniteAffichee(a.unite)}</span></dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 sm:block">
                          <dt className="text-xs text-muted-foreground">Sorties du mois</dt>
                          <dd data-sorties-mois className="font-semibold tabular-nums text-red-700">−{qte(t.sorties)} <span className="text-xs font-normal">{uniteAffichee(a.unite)}</span></dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 sm:block">
                          <dt className="text-xs text-muted-foreground">Consommation totale du mois</dt>
                          <dd data-consommation-mois className="font-semibold tabular-nums">
                            {qte(t.consommation.total)} <span className="text-xs font-normal">{uniteAffichee(a.unite)}</span>
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              · {valeur ? `${valeur.approx ? "≈ " : ""}${usd(valeur.valeur)}` : "valeur —"}
                              {t.consommation.pertes > 0 && ` · dont ${qte(t.consommation.pertes)}${uniteTxt} de pertes`}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      {valeur?.approx && <p className="mt-1 text-[11px] text-muted-foreground">Valeur au prix de référence actuel de l&apos;article, au taux du jour.</p>}
                      {partiel && <p data-mois-partiel className="mt-1 text-[11px] text-muted-foreground">{g.lignes.length} mouvement{g.lignes.length > 1 ? "s" : ""} affiché{g.lignes.length > 1 ? "s" : ""} sur {nbDuMoisFiltre} ce mois-ci — les totaux ci-dessus sont ceux du mois entier.</p>}
                    </div>
                    <div className="divide-y">
                      {g.lignes.map((m) => {
                        const sortie = m.type === "SORTIE";
                        const ajustement = m.type === "AJUSTEMENT"; // son sens n'est pas enregistré : ni + ni −
                        const src = source(m);
                        const chip = "rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20";
                        return (
                          <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium capitalize">{new Date(m.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })}</div>
                              {m.origine && <div className="truncate text-[11px] text-muted-foreground">{m.origine}</div>}
                              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                {src.facture && <Link href={`/stock/factures/${src.facture.id}`} className={chip}>🧾 Facture{src.facture.numero ? ` ${src.facture.numero}` : ""}</Link>}
                                {src.bc && <Link href={`/stock/commandes/${src.bc.id}`} className={chip}>📄 BC {src.bc.numero}</Link>}
                                {src.fournId && <Link href={`/stock/fournisseurs/${src.fournId}`} className={chip}>🏢 {src.fournNom ?? "Fournisseur"}</Link>}
                                {/* Mêmes pastilles que l'écran Mouvements : le type (vert Entrée, rouge Sortie, gris Ajustement), puis le motif d'une sortie. */}
                                <PastilleType type={m.type} />
                                {sortie && <PastilleMotif motif={m.categorieSortie} />}
                                {m.dlc && <span data-dlc className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">DLC {jjmmaaaa(isoPur(m.dlc))}</span>}
                              </div>
                            </div>
                            <div className={`shrink-0 text-right font-semibold tabular-nums ${sortie ? "text-red-700" : ajustement ? "text-slate-600" : "text-emerald-700"}`}>
                              {sortie ? "−" : ajustement ? "±" : "+"}{qte(m.quantite)} <span data-unite className={`text-xs font-normal ${a.unite?.trim() ? "" : "text-muted-foreground"}`}>{uniteAffichee(a.unite)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
            {mouvementsChargesEnPlus > 0 && (
              <Link href={lienFicheArticle(a.id, "mouvements", { filtre, annee: anneeVue, mois: moisVue, tousMouvements: true })} scroll={false} className="mt-2 inline-block text-sm text-primary hover:underline">
                Voir les {mouvementsChargesEnPlus} mouvements plus anciens
              </Link>
            )}
            {mouvementsChargesEnPlus === 0 && mouvementsHorsPage > 0 && (
              <Link href={`/stock/mouvements?articleId=${a.id}&mois=tous`} className="mt-2 inline-block text-sm text-primary hover:underline">
                Voir les {mouvementsHorsPage} mouvements plus anciens dans Mouvements
              </Link>
            )}
            </>
          )}
        </section>
      )}

      {/* Fournisseurs de l'article, fournisseur habituel marqué, dernier prix de chacun (2026-10-16) */}
      {onglet === "fournisseurs" && comparaison && (
        <FournisseursArticle articleId={a.id} unite={a.unite} lignes={lignesFournisseurs} autres={fournisseursAAjouter} etat={comparaison.etat} estDirection={estDirection} />
      )}

      {/* Fiches techniques où l'article est un ingrédient */}
      {onglet === "fiches" && (
        <section id="fiches" className="space-y-2">
          <h2 className="text-base font-semibold">Fiches techniques qui utilisent cet article ({nbFichesUtilisant})</h2>
          <div className="tableau-normal rounded-lg border">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="en-tete-collante bg-muted text-left">
                <tr>
                  <th className="px-3 py-2">Fiche</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Quantité par fiche</th>
                </tr>
              </thead>
              <tbody>
                {ingredients.map((i) => (
                  <tr key={i.id} className="border-t hover:bg-accent/40 even:bg-muted/25">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/stock/fiches/${i.fiche.id}`} className="text-primary hover:underline">{i.fiche.nom}</Link>
                      {!i.fiche.actif && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{i.fiche.type === "BAR" ? "Bar" : "Plat"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qte(i.quantite)} {i.unite}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Évolution du prix d'achat (lignes de facture) */}
      {onglet === "prix" && (
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Évolution du prix d&apos;achat</h2>
          {prixHisto.length > 0 && (
            <span className="text-xs text-muted-foreground">
              min {usd(prixMin)} · max {usd(prixMax)}
              {variation !== null && (
                <span className={`ml-2 font-medium ${variation > 0 ? "text-red-700" : variation < 0 ? "text-emerald-700" : ""}`}>
                  {variation > 0 ? "▲" : variation < 0 ? "▼" : ""} {formaterDecimales(Math.abs(variation), 1)} % vs achat précédent
                </span>
              )}
              {analyse.dernier && refUSD !== null && (() => {
                const ref = refUSD;
                const ecart = ((analyse.dernier.prix - ref) / ref) * 100;
                return (
                  <span className={`ml-2 font-medium ${ecart > 0 ? "text-red-700" : ecart < 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                    {ecart > 0 ? "▲" : ecart < 0 ? "▼" : "="} {formaterDecimales(Math.abs(ecart), 1)} % vs prix de référence
                  </span>
                );
              })()}
            </span>
          )}
        </div>
        <p className="mb-2 text-sm">Prix de référence : <span className="font-medium">{libPrix.principal}</span>{libPrix.autre && <span className="text-xs text-muted-foreground"> · {libPrix.autre} au taux du jour</span>}</p>
        {prixHisto.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat facturé pour cet article. Le prix évoluera au fil des factures.</p>
        ) : (
          <>
            <Sparkline points={prixHisto.map((p) => p.prix)} reference={refUSD} />
            {refUSD !== null && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                <span className="mr-1 inline-block w-5 border-t-2 border-dashed border-amber-500 align-middle" /> prix de référence ({ref$}{refC?.approx ? ` = ${libPrix.principal} au taux du jour` : ""}) — un prix d&apos;achat de repère, lui aussi
              </p>
            )}
            <div id="prix" className="mt-3">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-1 font-medium">Date</th><th className="py-1 font-medium">Facture</th><th className="py-1 text-right font-medium">Qté</th><th className="py-1 text-right font-medium">Prix unit.</th></tr>
                </thead>
                <tbody>
                  {prixAffiches.map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{dCourt(p.date)}</td>
                      <td className="py-1.5">{p.factureId ? <Link href={`/stock/factures/${p.factureId}`} className="text-primary hover:underline">{p.numero ?? "Facture"}</Link> : <span className="text-muted-foreground">{p.numero ?? "Liste d'achat"}</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">{qte(p.qte)}</td>
                      {/* Ligne d'une facture en francs : le prix saisi en francs, et son équivalent au taux figé de la facture. */}
                      <td className="py-1.5 text-right font-medium tabular-nums">{p.prixCDF !== undefined ? <>{formaterFC(p.prixCDF)} <span className="block text-[11px] font-normal text-muted-foreground">≈ {usd(p.prix)}</span></> : usd(p.prix)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {prixAffiches.length < prixRecents.length && (
                <Link href={lienFicheArticle(a.id, "prix", { tousPrix: true })} scroll={false} className="mt-2 inline-block text-sm text-primary hover:underline">
                  Voir les {prixRecents.length - prixAffiches.length} achats plus anciens
                </Link>
              )}
            </div>
          </>
        )}
      </section>
      )}

      {/* Informations : tous les champs de l'article ; « Modifier » (en haut) ouvre le formulaire complet. */}
      {onglet === "informations" && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-3 text-base font-semibold">Informations</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {infos.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Le stock ne se modifie pas ici : il évolue par les mouvements, l&apos;inventaire (comptage) ou la correction d&apos;un stock négatif.</p>
        </section>
      )}
    </div>
  );
}

// Mini-courbe SVG de l'évolution du prix (sans dépendance). Chronologique, gauche → droite.
// `reference` (prix du catalogue) trace une ligne de base pointillée, incluse dans l'échelle :
// on VOIT d'un coup d'œil si les achats se font au-dessus ou en dessous du prix de référence.
function Sparkline({ points, reference = null }: { points: number[]; reference?: number | null }) {
  if (points.length === 0) return null;
  if (points.length < 2 && reference === null)
    return <p className="text-xs text-muted-foreground">Un seul achat — pas encore de courbe.</p>;
  const w = 600, h = 64, pad = 5;
  const tous = reference !== null ? [...points, reference] : points;
  const min = Math.min(...tous), max = Math.max(...tous);
  const span = max - min || 1;
  const x = (i: number) => (points.length < 2 ? w / 2 : pad + (i * (w - 2 * pad)) / (points.length - 1));
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label="Évolution du prix (pointillé : prix de référence)">
      {reference !== null && (
        <line x1={pad} x2={w - pad} y1={y(reference)} y2={y(reference)} strokeDasharray="6 4" strokeWidth={1.5} className="stroke-amber-500" vectorEffect="non-scaling-stroke" />
      )}
      {points.length >= 2 && <path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" vectorEffect="non-scaling-stroke" />}
      {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className="fill-primary" />)}
    </svg>
  );
}
