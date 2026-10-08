import { libellesPrix } from "@/lib/prix-article";
import { tauxDuJour } from "@/lib/taux-du-jour";
import Link from "next/link";
import { FilAriane } from "@/components/fil-ariane";
import { notFound } from "next/navigation";
import type { BonDeCommande, FactureFournisseur, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { niveauAlerte, ALERTE_CLASSE, ALERTE_LABEL, usd, qte, type NiveauAlerte } from "@/lib/stock";
import { EditerFournisseur } from "./editer-fournisseur";
import { formaterMontant, formaterUSD } from "@/lib/montant";
import { jjmmaaaa } from "@/lib/achats-liste";
import { exigerPageStock } from "@/lib/garde-page";
import { OngletsDefilants } from "@/components/onglets-defilants";
import { EtatVide } from "@/components/etat-vide";
import { ciblesEnAttente } from "@/lib/validations-stock/apercu";
import {
  lireOnglet, lireFiltreFactures, lireFiltreBons, statutsFactures, statutsBons, lienFiche, suffixeRetour,
  grouperFacturesParMois, STATUTS_BC_EN_COURS,
  type FiltreFactures, type FiltreBons, type OngletFournisseur,
} from "@/lib/fiche-fournisseur";
import { FacturesUI } from "../../factures/factures-client";
import { versFactureRow } from "../../factures/facture-row";
import { CommandesListe } from "../../commandes/commandes-liste";

const s = (v: string | null) => v ?? "";

/** Plafonds d'affichage d'un onglet (au-delà : une phrase le dit, jamais une liste tronquée en silence). */
const MAX_FACTURES = 500;
const MAX_BONS = 300;
const MAX_ACHATS = 300;

type SP = { onglet?: string | string[]; filtre?: string | string[] };

export default async function FournisseurDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const { id } = await params;
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const onglet = lireOnglet(sp.onglet);
  const filtreFactures = lireFiltreFactures(sp.filtre);
  const filtreBons = lireFiltreBons(sp.filtre);

  // Toujours lus, et peu coûteux : la fiche, les comptes des libellés d'onglets, les KPIs et les
  // effectifs des filtres (agrégats SQL, aucune ligne rapatriée). Le CONTENU, lui, n'est lu que pour
  // l'onglet affiché : plus de 500 factures + 300 bons + 300 achats à chaque ouverture.
  const [f, statsFactures, statsBons, nbAchatsDirects, taux] = await Promise.all([
    prisma.fournisseur.findUnique({ where: { id }, include: { _count: { select: { articles: true } } } }),
    prisma.factureFournisseur.groupBy({ by: ["statut"], where: { fournisseurId: id }, _count: { _all: true }, _sum: { montantUSD: true, resteAPayerUSD: true } }),
    prisma.bonDeCommande.groupBy({ by: ["statut"], where: { fournisseurId: id }, _count: { _all: true } }),
    // Le VRAI total des achats DIRECTS (la liste de l'onglet est plafonnée).
    prisma.mouvementStock.count({ where: { fournisseurId: id, type: "ENTREE" } }),
    tauxDuJour(), // prix d'articles en francs (≈) et paiement des factures en francs
  ]);
  if (!f) notFound();

  // Agrégats factures : mêmes règles qu'avant (réglé = montant − reste ; impayé = reste des non réglées ; échu = reste des échues).
  let total = 0, regle = 0, impaye = 0, echu = 0, nbFactures = 0, nbARegler = 0, nbPayees = 0, nbEchu = 0;
  for (const g of statsFactures) {
    const m = Number(g._sum.montantUSD ?? 0), r = Number(g._sum.resteAPayerUSD ?? 0), n = g._count._all;
    total += m; regle += m - r; nbFactures += n;
    if (g.statut === "REGLEE") nbPayees += n;
    else { impaye += r; nbARegler += n; }
    if (g.statut === "ECHUE_NON_REGLEE") { echu += r; nbEchu += n; }
  }
  const nbBonsDe = (statuts: string[]) => statsBons.filter((g) => statuts.includes(g.statut)).reduce((n, g) => n + g._count._all, 0);
  const nbBons = statsBons.reduce((n, g) => n + g._count._all, 0);
  const nbBonsEnCours = nbBonsDe(STATUTS_BC_EN_COURS), nbBonsRecus = nbBonsDe(["RECU"]);
  const nbBonsValides = nbBons - nbBonsDe(["BROUILLON", "ANNULE"]);

  // Le CONTENU de l'onglet affiché, et de lui seul.
  const [facturesDb, enAttente, bonsDb, achatsDirects, articles] = await Promise.all([
    onglet === "factures"
      ? prisma.factureFournisseur.findMany({
          where: { fournisseurId: id, ...(statutsFactures(filtreFactures) ? { statut: { in: statutsFactures(filtreFactures) } } : {}) },
          orderBy: [{ annee: "desc" }, { mois: "desc" }, { date: "desc" }],
          take: MAX_FACTURES,
        })
      : null,
    onglet === "factures" ? ciblesEnAttente() : null, // factures dont le paiement attend la Direction (pastille « Paiement demandé »)
    onglet === "bons"
      ? prisma.bonDeCommande.findMany({
          where: { fournisseurId: id, ...(statutsBons(filtreBons) ? { statut: { in: statutsBons(filtreBons) } } : {}) },
          orderBy: [{ date: "desc" }, { sequence: "desc" }],
          take: MAX_BONS,
          include: { _count: { select: { lignes: true } } },
        })
      : null,
    // Achats DIRECTS : lignes de la Liste d'achat (sans facture ni bon de commande) rattachées ici.
    onglet === "achats"
      ? prisma.mouvementStock.findMany({
          where: { fournisseurId: id, type: "ENTREE" },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: MAX_ACHATS,
          select: { id: true, date: true, quantite: true, origine: true, devise: true, montantOrigine: true, montantUSD: true, articleId: true, article: { select: { designation: true, unite: true } } },
        })
      : null,
    onglet === "articles"
      ? prisma.articleStock.findMany({
          where: { fournisseurId: id }, orderBy: { designation: "asc" },
          include: { stock: true, categorie: { select: { nom: true } } },
        })
      : null,
  ]);

  const lienOnglet = (o: OngletFournisseur) => lienFiche(id, o);
  const onglets: { o: OngletFournisseur; label: string }[] = [
    { o: "factures", label: `Factures (${nbFactures})` },
    { o: "bons", label: `Bons de commande (${nbBons})` },
    { o: "achats", label: `Achats directs (${nbAchatsDirects})` },
    { o: "articles", label: `Articles (${f._count.articles})` },
    { o: "coordonnees", label: "Coordonnées" },
  ];

  const coord: [string, string | null][] = [
    ["Contact", f.contactNom], ["Téléphone", f.telephone], ["E-mail", f.email], ["Ville", f.ville],
    ["Pays", f.pays], ["RCCM", f.rccm], ["ID National", f.idNational],
    ["Délai de paiement", f.delaiPaiement], ["Délai de livraison", f.delaiLivraison],
    ["Mode de paiement", f.modePaiement], ["Produits fournis", f.produits],
  ];

  return (
    <div className="w-full space-y-5">
      <FilAriane segments={[{ label: "Fournisseurs", href: "/stock/fournisseurs" }, { label: f.nom }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{f.nom}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {f._count.articles} article(s) · {nbBonsValides} bon(s) de commande validé(s) · {nbFactures} facture(s) · {nbAchatsDirects} achat(s) direct(s)
          </p>
        </div>
        {estDirection && <EditerFournisseur f={{
          id: f.id, nom: f.nom, contactNom: s(f.contactNom), telephone: s(f.telephone), email: s(f.email),
          ville: s(f.ville), pays: s(f.pays), rccm: s(f.rccm), idNational: s(f.idNational),
          delaiPaiement: s(f.delaiPaiement), delaiLivraison: s(f.delaiLivraison), modePaiement: s(f.modePaiement), produits: s(f.produits),
        }} />}
      </div>

      {/* KPIs factures — au-dessus des onglets, visibles quel que soit l'onglet : le solde dû au fournisseur est ce qu'on vient chercher sur sa fiche. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total facturé" valeur={usd(total)} />
        <Kpi label="Réglé" valeur={usd(regle)} accent="green" />
        <Kpi label={`Impayé (${nbARegler})`} valeur={usd(impaye)} accent={impaye > 0 ? "amber" : undefined} />
        <Kpi label={`Échu (${nbEchu})`} valeur={usd(echu)} accent={echu > 0 ? "red" : undefined} />
      </div>

      <OngletsDefilants
        libelle="Sections de la fiche fournisseur"
        onglets={onglets.map(({ o, label }) => ({ href: lienOnglet(o), label, actif: o === onglet }))}
      />

      {facturesDb && enAttente && <OngletFactures id={id} filtre={filtreFactures} estDirection={estDirection} factures={facturesDb} enAttente={enAttente.factures} effectifs={{ "a-regler": nbARegler, payees: nbPayees, toutes: nbFactures }} taux={taux ?? 0} />}
      {bonsDb && <OngletBons id={id} nom={f.nom} filtre={filtreBons} estDirection={estDirection} bons={bonsDb} effectifs={{ "en-cours": nbBonsEnCours, recus: nbBonsRecus, tous: nbBons }} />}
      {achatsDirects && <OngletAchats nbAchatsDirects={nbAchatsDirects} achatsDirects={achatsDirects} />}
      {articles && <OngletArticles articles={articles} taux={taux} />}
      {onglet === "coordonnees" && (
        <section className="rounded-xl border p-4">
          <h2 className="mb-3 text-base font-semibold">Coordonnées</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {coord.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
            {coord.every(([, v]) => !v) && <p className="text-sm text-muted-foreground">Aucune coordonnée renseignée.</p>}
          </dl>
        </section>
      )}
    </div>
  );
}

/** Pastilles de filtre — même forme que celles de l'écran Factures. */
function Pastilles<T extends string>({ valeurs, actif, effectifs, lien, libelle }: {
  valeurs: readonly (readonly [T, string])[]; actif: T; effectifs: Record<T, number>; lien: (v: T) => string; libelle: string;
}) {
  return (
    <nav aria-label={libelle} className="flex flex-wrap gap-1.5 text-sm">
      {valeurs.map(([v, label]) => (
        <Link key={v} href={lien(v)} aria-current={v === actif ? "page" : undefined} className={`rounded-full border px-3 py-1 ${v === actif ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>
          {label} ({effectifs[v]})
        </Link>
      ))}
    </nav>
  );
}

// ─── Onglet Factures : filtre À régler / Payées / Toutes, regroupées par mois, actions groupées ───
function OngletFactures({ id, filtre, estDirection, factures, enAttente, effectifs, taux }: {
  id: string; filtre: FiltreFactures; estDirection: boolean; factures: FactureFournisseur[]; enAttente: Set<string>; effectifs: Record<FiltreFactures, number>; taux: number;
}) {
  const moisPlats = grouperFacturesParMois(factures).map((g) => ({ cle: g.cle, label: g.titre, factures: g.items.map((x) => versFactureRow(x, enAttente)) }));
  const lien = (v: FiltreFactures) => lienFiche(id, "factures", v);
  return (
    <section className="space-y-3">
      <Pastilles
        libelle="Filtrer les factures" actif={filtre} effectifs={effectifs} lien={lien}
        valeurs={[["a-regler", "À régler"], ["payees", "Payées"], ["toutes", "Toutes"]] as const}
      />
      {effectifs[filtre] > factures.length && <p className="text-xs text-muted-foreground">Les {factures.length} plus récentes sont affichées.</p>}
      {factures.length === 0 ? (
        <EtatVide
          message={filtre === "a-regler" ? (effectifs.toutes > 0 ? "Aucune facture à régler : tout est payé." : "Aucune facture.") : filtre === "payees" ? "Aucune facture payée." : "Aucune facture."}
          action={filtre !== "toutes" && effectifs.toutes > 0 ? <Link href={lien("toutes")} className="text-primary underline">Voir toutes les factures ({effectifs.toutes})</Link> : undefined}
        />
      ) : (
        <FacturesUI key={filtre} moisPlats={moisPlats} ouvert={filtre === "a-regler"} sansFournisseur estDirection={estDirection} taux={taux} suffixeRetour={suffixeRetour(lien(filtre))} />
      )}
    </section>
  );
}

// ─── Onglet Bons de commande : filtre En cours / Reçus / Tous, regroupés par mois ───
function OngletBons({ id, nom, filtre, estDirection, bons, effectifs }: {
  id: string; nom: string; filtre: FiltreBons; estDirection: boolean; bons: (BonDeCommande & { _count: { lignes: number } })[]; effectifs: Record<FiltreBons, number>;
}) {
  const lien = (v: FiltreBons) => lienFiche(id, "bons", v);
  return (
    <section className="space-y-3">
      <Pastilles
        libelle="Filtrer les bons de commande" actif={filtre} effectifs={effectifs} lien={lien}
        valeurs={[["en-cours", "En cours"], ["recus", "Reçus"], ["tous", "Tous"]] as const}
      />
      {effectifs[filtre] > bons.length && <p className="text-xs text-muted-foreground">Les {bons.length} plus récents sont affichés.</p>}
      {bons.length === 0 ? (
        <EtatVide
          message={filtre === "en-cours" ? (effectifs.tous > 0 ? "Aucun bon de commande en cours." : "Aucun bon de commande.") : filtre === "recus" ? "Aucun bon de commande reçu." : "Aucun bon de commande."}
          action={filtre !== "tous" && effectifs.tous > 0 ? <Link href={lien("tous")} className="text-primary underline">Voir tous les bons ({effectifs.tous})</Link> : undefined}
        />
      ) : (
        <CommandesListe
          key={filtre} estDirection={estDirection} sansFournisseur suffixeRetour={suffixeRetour(lien(filtre))}
          commandes={bons.map((b) => ({
            id: b.id, numero: b.numero, fournisseurId: b.fournisseurId ?? null, fournisseurNom: nom,
            date: new Date(b.date).toISOString(), nbLignes: b._count.lignes, total: Number(b.totalUSD), statut: b.statut, documentUrl: b.documentUrl ?? null,
          }))}
        />
      )}
    </section>
  );
}

// ─── Onglet Achats directs (Liste d'achat) : contenu inchangé ───
type AchatDirect = {
  id: string; date: Date; quantite: Prisma.Decimal; origine: string | null; devise: "USD" | "CDF" | null;
  montantOrigine: Prisma.Decimal | null; montantUSD: Prisma.Decimal | null; articleId: string; article: { designation: string; unite: string | null };
};

function OngletAchats({ nbAchatsDirects, achatsDirects }: { nbAchatsDirects: number; achatsDirects: AchatDirect[] }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Achats directs — Liste d&apos;achat ({nbAchatsDirects})</h2>
      {nbAchatsDirects > achatsDirects.length && <p className="mb-2 text-xs text-muted-foreground">Les {achatsDirects.length} plus récents sont affichés.</p>}
      {achatsDirects.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">Aucun achat direct. Choisissez ce fournisseur sur une ligne de la Liste d&apos;achat pour l&apos;y retrouver.</p>
      ) : (
        <div className="divide-y rounded-lg border text-sm">
          {achatsDirects.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <Link href={`/stock/catalogue/${m.articleId}`} className="font-medium text-primary hover:underline">{m.article.designation}</Link>
                <div className="truncate text-xs text-muted-foreground">{jjmmaaaa(m.date.toISOString())}{m.origine ? ` · ${m.origine}` : ""}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">+{qte(m.quantite)}{m.article.unite ? ` ${m.article.unite}` : ""}</div>
                <div className="text-[11px] tabular-nums text-muted-foreground">
                  {m.montantOrigine !== null && m.devise
                    ? `${formaterMontant(Number(m.montantOrigine), m.devise)}${m.devise === "CDF" && m.montantUSD !== null ? ` ≈ ${formaterUSD(Number(m.montantUSD))}` : ""}`
                    : m.montantUSD !== null ? formaterUSD(Number(m.montantUSD)) : "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Onglet Articles fournis : contenu inchangé ───
type ArticleFourni = Prisma.ArticleStockGetPayload<{ include: { stock: true; categorie: { select: { nom: true } } } }>;

function OngletArticles({ articles, taux }: { articles: ArticleFourni[]; taux: number | null }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">Articles fournis ({articles.length})</h2>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Désignation</th>
              <th className="px-3 py-2">Catégorie</th>
              <th className="px-3 py-2 text-right">Prix</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2">Alerte</th>
            </tr>
          </thead>
          <tbody>
            {articles.map((a) => {
              const niv: NiveauAlerte | null = a.stock ? niveauAlerte(a.stock.quantite, a.stock.stockMinimum) : null;
              return (
                <tr key={a.id} className="border-t hover:bg-accent/40 even:bg-muted/25">
                  <td className="px-3 py-2 font-medium"><Link href={`/stock/catalogue/${a.id}`} className="text-primary hover:underline">{a.designation}</Link></td>
                  <td className="px-3 py-2 text-muted-foreground">{a.categorie?.nom ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{(() => { const l = libellesPrix(a, taux); return <>{l.principal}{l.autre && <span className="block text-[11px] text-muted-foreground">{l.autre}</span>}</>; })()}</td>
                  <td className="px-3 py-2 text-right">{a.stock ? qte(a.stock.quantite) : "—"}</td>
                  <td className="px-3 py-2">{niv && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[niv]}`}>{ALERTE_LABEL[niv]}</span>}</td>
                </tr>
              );
            })}
            {articles.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Aucun article rattaché. Rattachez-en depuis le catalogue.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Kpi({ label, valeur, accent }: { label: string; valeur: string; accent?: "green" | "amber" | "red" }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : accent === "green" ? "border-emerald-200 bg-emerald-50" : "";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{valeur}</p>
    </div>
  );
}
