import Link from "next/link";
import { formaterFC } from "@/lib/montant";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { supprimerArticle } from "../actions";
import { EditerArticle } from "./editer-article";
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
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { jjmmaaaa } from "@/lib/achats-liste";
import { classePastilleDlc, joursAvantDlc, libelleJoursDlc } from "@/lib/achats-doublons";
import { complementLibelle, incoherenceContenance, libelleArticle } from "@/lib/libelle-article";

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
  searchParams: Promise<{ erreur?: string; mouvements?: string; prix?: string }>;
}) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const { id } = await params;
  const estDirection = user.role === "ADMIN";

  const [a, toutesCategories, fournisseurs, proposition, taux] = await Promise.all([
    prisma.articleStock.findUnique({
      where: { id },
      include: {
        stock: true,
        categorie: { select: { nom: true } },
        fournisseur: { select: { id: true, nom: true } },
        mouvements: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: MOUVEMENTS_CHARGES,
          include: {
            facture: { select: { id: true, numero: true, fournisseurId: true, fournisseurNom: true } },
            reception: { select: { bonDeCommande: { select: { id: true, numero: true, fournisseurId: true, fournisseur: { select: { nom: true } } } } } },
          },
        },
        lignesFacture: {
          include: { facture: { select: { id: true, numero: true, date: true, tauxChangeUtilise: true } } },
        },
        _count: { select: { mouvements: true } },
      },
    }),
    // Pour le formulaire « Modifier » de la fiche — mêmes listes que l'Inventaire.
    prisma.categorieStock.findMany({ orderBy: [{ ordre: "asc" }, { nom: "asc" }], select: { id: true, nom: true, domaine: true, actif: true } }),
    prisma.fournisseur.findMany({ orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
    demandeSurCible(cleArticle(id)), // proposition de modification en attente de la Direction ?
    tauxDuJour(),
  ]);
  if (!a) notFound();
  // Catégories ARCHIVÉES : plus proposées dans le choix, sauf celle que l'article porte déjà (il reste rattaché).
  const categories = toutesCategories.filter((c) => c.actif || c.id === a.categorieId);

  const niv: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
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
    ...a.mouvements
      .filter((m) => m.type === "ENTREE" && !m.factureId && m.montantUSD !== null)
      .map((m) => pointDeMouvement({ articleId: m.articleId, montantUSD: m.montantUSD, quantite: m.quantite, date: new Date(m.date), origine: m.origine }))
      .filter((x): x is NonNullable<typeof x> => x !== null),
  ]);
  const prixHisto = analyse.points;
  const { min: prixMin, max: prixMax, variation, hausse } = analyse;

  // Affichage progressif (sans défilement interne) : l'état « tout voir » vit dans l'adresse.
  const tousMouvements = sp.mouvements === "tous";
  const tousPrix = sp.prix === "tous";
  const lien = (o: { mouvements?: boolean; prix?: boolean }, ancre: string) => {
    const q = new URLSearchParams();
    if (o.mouvements ?? tousMouvements) q.set("mouvements", "tous");
    if (o.prix ?? tousPrix) q.set("prix", "tous");
    return `/stock/catalogue/${a.id}?${q}#${ancre}`;
  };
  const nbMouvements = a._count.mouvements;
  const mouvementsAffiches = tousMouvements ? a.mouvements : a.mouvements.slice(0, MOUVEMENTS_AFFICHES);
  const mouvementsChargesEnPlus = a.mouvements.length - mouvementsAffiches.length;
  const mouvementsHorsPage = nbMouvements - a.mouvements.length; // au-delà des 200 chargés
  const prixRecents = [...prixHisto].reverse();
  const prixAffiches = tousPrix ? prixRecents : prixRecents.slice(0, PRIX_AFFICHES);

  // DLC des dernières entrées (Liste d'achat, 2026-10-08) : les 5 plus récentes qui en portent une. Indicatif (pas de suivi par lot).
  const isoPur = (d: Date) => new Date(d).toISOString().slice(0, 10); // colonne @db.Date : date PURE
  const entreesDlc = a.mouvements.filter((m) => m.type === "ENTREE" && m.dlc).slice(0, 5);
  const aujourdhuiISO = jourCourantKinshasaISO();

  const source = (m: (typeof a.mouvements)[number]) => {
    const bc = m.reception?.bonDeCommande;
    const fournId = m.facture?.fournisseurId ?? bc?.fournisseurId ?? null;
    const fournNom = m.facture?.fournisseurNom ?? bc?.fournisseur?.nom ?? null;
    return { facture: m.facture, bc, fournId, fournNom };
  };

  // Nom AFFICHÉ (contenance comprise si le nom ne la porte pas) ; la désignation enregistrée reste celle du formulaire.
  const libelle = libelleArticle(a);
  const complement = complementLibelle(a);
  const incoherence = incoherenceContenance(a);

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
            {a.fournisseur && <span>· <Link href={`/stock/fournisseurs/${a.fournisseur.id}`} className="text-primary hover:underline">{a.fournisseur.nom}</Link></span>}
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
          <TelechargerLien href={`/stock/catalogue/${a.id}/pdf`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Exporter PDF
          </TelechargerLien>
          <EditerArticle
            a={{
              id: a.id,
              domaine: a.domaine,
              code: a.code,
              designation: a.designation,
              nomCourt: a.nomCourt,
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
            Dernier achat à <span className="font-semibold">{usd(hausse.prix)}</span>, soit <span className="font-semibold">+{hausse.pct.toFixed(0)}%</span> au-dessus de la moyenne précédente ({usd(hausse.moyenneAnterieure)}).
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Stock actuel" valeur={a.stock ? `${qte(a.stock.quantite)}${a.unite ? ` ${a.unite}` : ""}` : "—"} accent={stockQte < 0 ? "red" : undefined} />
        <Kpi label="Valeur du stock" valeur={valeurC ? `${valeurC.approx ? "≈ " : ""}${usd(valeurC.valeur)}` : "—"} sous={valeurC?.approx ? "au taux du jour" : undefined} />
        <Kpi label="Prix de référence" valeur={libPrix.principal} sous={libPrix.autre ? `${libPrix.autre} au taux du jour` : undefined} />
        <Kpi label="Alerte" valeur={niv ? ALERTE_LABEL[niv] : "—"} accent={niv === "URGENT" ? "red" : niv === "APPRO" ? "amber" : niv === "OK" ? "green" : undefined} />
      </div>

      {a.stock && (
        <p className="text-xs text-muted-foreground">
          Seuil minimum : <span className="font-medium">{qte(a.stock.stockMinimum)}</span>
          {Number(a.stock.seuilUrgent) > 0 && <> · seuil urgent : <span className="font-medium">{qte(a.stock.seuilUrgent)}</span></>}
        </p>
      )}

      {/* Évolution du prix d'achat (lignes de facture) */}
      <section className="rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Évolution du prix d&apos;achat</h2>
          {prixHisto.length > 0 && (
            <span className="text-xs text-muted-foreground">
              min {usd(prixMin)} · max {usd(prixMax)}
              {variation !== null && (
                <span className={`ml-2 font-medium ${variation > 0 ? "text-red-700" : variation < 0 ? "text-emerald-700" : ""}`}>
                  {variation > 0 ? "▲" : variation < 0 ? "▼" : ""} {Math.abs(variation).toFixed(1)}% vs achat précédent
                </span>
              )}
              {analyse.dernier && refUSD !== null && (() => {
                const ref = refUSD;
                const ecart = ((analyse.dernier.prix - ref) / ref) * 100;
                return (
                  <span className={`ml-2 font-medium ${ecart > 0 ? "text-red-700" : ecart < 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                    {ecart > 0 ? "▲" : ecart < 0 ? "▼" : "="} {Math.abs(ecart).toFixed(1)}% vs prix de référence
                  </span>
                );
              })()}
            </span>
          )}
        </div>
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
                <Link href={lien({ prix: true }, "prix")} scroll={false} className="mt-2 inline-block text-sm text-primary hover:underline">
                  Voir les {prixRecents.length - prixAffiches.length} achats plus anciens
                </Link>
              )}
            </div>
          </>
        )}
      </section>

      {entreesDlc.length > 0 && (
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

      {/* Historique des mouvements */}
      <section id="mouvements">
        <h2 className="mb-2 text-base font-semibold">Mouvements ({nbMouvements})</h2>
        {a.mouvements.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun mouvement de stock pour cet article.</p>
        ) : (
          <>
          <div className="rounded-lg border">
            <div className="divide-y">
              {mouvementsAffiches.map((m) => {
                const sortie = m.type === "SORTIE";
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
                        {sortie && m.categorieSortie && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{m.categorieSortie === "PERTE" ? "Perte" : "Livraison restaurant"}</span>}
                        {m.dlc && <span data-dlc className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">DLC {jjmmaaaa(isoPur(m.dlc))}</span>}
                      </div>
                    </div>
                    <div className={`shrink-0 text-right font-semibold tabular-nums ${sortie ? "text-red-700" : "text-emerald-700"}`}>
                      {sortie ? "−" : "+"}{qte(m.quantite)} <span data-unite className={`text-xs font-normal ${a.unite?.trim() ? "" : "text-muted-foreground"}`}>{uniteAffichee(a.unite)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {mouvementsChargesEnPlus > 0 && (
            <Link href={lien({ mouvements: true }, "mouvements")} scroll={false} className="mt-2 inline-block text-sm text-primary hover:underline">
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
    </div>
  );
}

function Kpi({ label, valeur, accent, sous }: { label: string; valeur: string; accent?: "green" | "amber" | "red"; sous?: string }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : accent === "green" ? "border-emerald-200 bg-emerald-50" : "";
  return (
    <div className={`min-w-0 rounded-lg border p-3 ${cls}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-lg font-semibold tabular-nums">{valeur}</p>
      {sous && <p className="text-xs tabular-nums text-muted-foreground">{sous}</p>}
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
