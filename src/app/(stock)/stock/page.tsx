import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Avatar } from "@/components/avatar";
import { ALERTE_CLASSE, usd, qte, STATUT_BC_LABEL, STATUT_BC_CLASSE, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";
import { indicateursStock } from "@/lib/indicateurs/stock";
import { exigerPageStock } from "@/lib/garde-page";
import { inventaireFige } from "@/lib/cloture-inventaire";
import { moisDuParametre, MOIS_FR } from "@/lib/dates-fr";
import { SelecteurMois } from "@/components/selecteur-mois";
import { CartesEntreesStock, voitIndicateursEntrees } from "./_tableau-de-bord/cartes-entrees-stock";
import { BlocDisponibilitePlats, voitDisponibilitePlats } from "./_tableau-de-bord/bloc-disponibilite-plats";
import { jourCivilKinshasa, moisCourantKinshasa } from "@/lib/heure-kinshasa";

const jfr = (v: Date | null) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—");

type SP = { mois?: string };

// Accueil de l'espace Stock, mois par mois (demande de la Direction du 2026-09-30) : même sélecteur
// que le tableau de bord de l'Exploitation (?mois=AAAA-MM, mois courant par défaut). Trois sortes
// de blocs :
//  - PAR PÉRIODE (commandes, légumes, consommation ; listes « derniers … ») : suivent le mois choisi.
//    Au mois courant, les listes « derniers … » restent celles d'avant (les plus récentes, tous mois).
//  - INSTANTANÉS (alertes, factures dues, semaine en cours, articles) : aucun instantané n'est
//    stocké, donc rien n'est reconstitué — hors du mois courant, la carte dit « aujourd'hui ».
//    Seule exception : la valeur du stock, figée par la clôture du mois (ClotureStock.snapshot).
//  - CUMULÉS (articles les plus commandés, fournisseurs les plus sollicités) : tous mois confondus,
//    comme avant, et dits comme tels hors du mois courant.
export default async function StockDashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const estDirection = user.role === "ADMIN";
  const prenom = user.nom.split(" ")[0];
  const now = new Date();
  const moisCourant = moisCourantKinshasa(now);
  const moisValue = moisDuParametre(sp.mois, now);
  const estCourant = moisValue === moisCourant;
  // Mois choisi, en nombres (mois de 1 à 12) : à passer tel quel à tout bloc « par période ».
  const annee = Number(moisValue.slice(0, 4)), mois = Number(moisValue.slice(5, 7));
  const libelleMois = `${MOIS_FR[mois - 1]} ${annee}`;
  // Bornes du mois choisi (dates pures, UTC) — seulement hors du mois courant : au mois courant, les
  // listes « derniers … » ne changent pas.
  const dansLeMois = estCourant ? {} : { date: { gte: new Date(Date.UTC(annee, mois - 1, 1)), lt: new Date(Date.UTC(annee, mois, 1)) } };
  const pieceDuMois = estCourant ? {} : { annee, mois };
  const dateDuJour = jourCivilKinshasa(now).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const [
    moi, config, nbArticles, nbFournisseurs, ind,
    derniersBC, dernieresFactures, mouvementsRecents, reconRecentes,
    commandesMois, topArticles, fournTop, fournisseursListe,
    derniersComptages, pertesRecentes, bcAValider, stockFige,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
    prisma.articleStock.count(),
    prisma.fournisseur.count(),
    // Valeur du stock, alertes, factures, légumes et consommation : @/lib/indicateurs/stock (partagé
    // avec le tableau de bord de l'Exploitation). 8 articles au seuil, comme avant.
    // Légumes et consommation : le mois choisi ; le reste : aujourd'hui.
    indicateursStock(now, { nbAlertes: 8, mois: moisValue }),
    prisma.bonDeCommande.findMany({ where: pieceDuMois, orderBy: { createdAt: "desc" }, take: 5, include: { fournisseur: { select: { nom: true } } } }),
    prisma.factureFournisseur.findMany({ where: pieceDuMois, orderBy: { createdAt: "desc" }, take: 5, include: { fournisseur: { select: { nom: true } } } }),
    prisma.mouvementStock.findMany({ where: { type: { in: ["ENTREE", "SORTIE"] }, ...dansLeMois }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { article: { select: { designation: true } } } }),
    prisma.mouvementStock.findMany({ where: { type: "AJUSTEMENT", ...dansLeMois }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 5, include: { article: { select: { designation: true } } } }),
    prisma.bonDeCommande.count({ where: { annee, mois } }),
    prisma.ligneBonDeCommande.groupBy({ by: ["designation"], _count: { designation: true }, _sum: { quantite: true }, orderBy: { _count: { designation: "desc" } }, take: 8 }),
    prisma.bonDeCommande.groupBy({ by: ["fournisseurId"], _count: { fournisseurId: true }, orderBy: { _count: { fournisseurId: "desc" } }, take: 5 }),
    prisma.fournisseur.findMany({ select: { id: true, nom: true } }),
    prisma.sessionComptage.findMany({ where: dansLeMois, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.mouvementStock.findMany({ where: { categorieSortie: "PERTE", ...dansLeMois }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 6, include: { article: { select: { designation: true } } } }),
    prisma.bonDeCommande.findMany({ where: { statut: "BROUILLON" }, orderBy: { createdAt: "desc" }, take: 6, include: { fournisseur: { select: { nom: true } } } }),
    // Valeur du stock d'un autre mois : l'inventaire figé à sa clôture, s'il existe (jamais reconstitué).
    estCourant ? Promise.resolve(null) : inventaireFige(annee, mois),
  ]);

  const maPhoto = moi?.employe?.photoUrl ?? null;
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  const { nbUrgent, nbAppro, valeurStock, alertes: auSeuil, facturesAPayer, facturesSemaine, facturesEchues, legumesMois, consoMois } = ind;

  const fournNom = new Map(fournisseursListe.map((f) => [f.id, f.nom]));
  const topFourn = fournTop.filter((f) => f.fournisseurId).map((f) => ({ nom: fournNom.get(f.fournisseurId!) ?? "—", n: f._count.fournisseurId }));

  // Étiquettes hors du mois courant (au mois courant : aucune, l'écran reste celui d'avant).
  const AUJ = "aujourd'hui";
  const etiquette = (e: string) => (estCourant ? undefined : e);
  const avecEtiquette = (sous: string, e: string) => (estCourant ? sous : `${sous} · ${e}`);
  const valeurAffichee = stockFige ? stockFige.valeurTotaleUSD : valeurStock;
  const sousValeur = estCourant ? undefined : stockFige ? `figée à la clôture ${/^[aeiouy]/.test(libelleMois) ? "d'" : "de "}${libelleMois}` : `aujourd'hui · aucun inventaire figé pour ${libelleMois}`;
  // Liens : le mois suit quand la liste sait filtrer par mois (Mouvements, Bons de commande) ou par
  // année (Factures). Au mois courant, les listes « derniers … » gardent leurs liens d'avant.
  const lienMouvements = `/stock/mouvements?mois=${annee}-${mois}`;
  const lienCommandes = `/stock/commandes?annee=${annee}&mois=${mois}`;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <Avatar nom={user.nom} taille={56} photoUrl={maPhoto} />
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">Bonjour {prenom}</h1>
            <p className="text-sm capitalize text-muted-foreground">{user.role === "ADMIN" ? "Direction" : "Responsable stock"} · {dateDuJour} · Stock &amp; Achats</p>
          </div>
        </div>
        <div className="w-full rounded-xl border bg-muted/30 px-4 py-2 sm:w-auto sm:text-right">
          <p className="text-xs text-muted-foreground">Taux du jour</p>
          <p className="text-lg font-semibold">1 USD = {taux ? taux.toLocaleString("fr-FR") : "—"} CDF</p>
        </div>
      </div>

      {/* Le mois — sélecteur partagé avec l'Exploitation (@/components/selecteur-mois). */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-semibold">Le mois · <span className="capitalize">{libelleMois}</span></h2>
          <SelecteurMois chemin="/stock" moisValue={moisValue} moisCourant={moisCourant} />
        </div>
        {!estCourant && (
          <p className="text-xs text-muted-foreground" data-avertissement-instantane>
            Les cartes marquées « aujourd&apos;hui » montrent l&apos;état actuel : le stock du passé n&apos;est pas reconstitué. Seule la valeur du stock peut venir de l&apos;inventaire figé à la clôture du mois.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Articles" valeur={String(nbArticles)} sous={etiquette(AUJ)} href="/stock/catalogue" />
          <Kpi label="Alertes urgentes" valeur={String(nbUrgent)} sous={etiquette(AUJ)} accent={nbUrgent > 0 ? "red" : undefined} href="/stock/catalogue?alerte=URGENT" />
          <Kpi label="À réapprovisionner" valeur={String(nbAppro)} sous={etiquette(AUJ)} accent={nbAppro > 0 ? "amber" : undefined} href="/stock/catalogue?alerte=APPRO" />
          <Kpi label="Valeur du stock" valeur={usd(valeurAffichee)} sous={sousValeur} />
          <Kpi label="Factures à payer" valeur={usd(facturesAPayer.montant)} sous={avecEtiquette(`${facturesAPayer.nb} facture(s)`, AUJ)} accent={(facturesAPayer.montant ?? 0) > 0 ? "amber" : undefined} href="/stock/factures?statut=du" />
          <Kpi label="Commandes du mois" valeur={String(commandesMois)} href={lienCommandes} />
          <Kpi label="À régler cette semaine" valeur={usd(facturesSemaine.montant)} sous={avecEtiquette(`${facturesSemaine.nb} facture(s)`, "semaine en cours")} accent={(facturesSemaine.montant ?? 0) > 0 ? "amber" : undefined} href="/stock/factures?statut=du" />
          <Kpi label="Factures échues" valeur={usd(facturesEchues.montant)} sous={avecEtiquette(`${facturesEchues.nb} facture(s)`, AUJ)} accent={facturesEchues.nb > 0 ? "red" : undefined} href="/stock/factures?statut=ECHUE_NON_REGLEE" />
          <Kpi label="Légumes frais du mois" valeur={usd(legumesMois.montant)} sous={`${legumesMois.nb} achat(s)`} href="/stock/legumes" />
          <Kpi label="Conso. du mois (sorties)" valeur={`≈ ${usd(consoMois.montant)}`} sous={`${consoMois.nb} sortie(s) valorisées`} href={lienMouvements} />
        </div>
      </section>

      {/* Entrées de stock du MOIS CHOISI par le sélecteur (annee/mois ci-dessus). */}
      <CartesEntreesStock annee={annee} mois={mois} voitMontants={voitIndicateursEntrees(user)} />

      {/* Bons de commande à valider — Direction uniquement */}
      {estDirection && bcAValider.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-amber-900">Bons de commande à valider ({bcAValider.length}){estCourant ? "" : ` · ${AUJ}`}</h2>
            <Link href="/stock/a-valider" className="text-xs font-medium text-amber-800 underline">Tout traiter</Link>
          </div>
          <ul className="divide-y divide-amber-200 text-sm">
            {bcAValider.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                <Link href={`/stock/commandes/${b.id}`} className="truncate pr-2 font-medium text-amber-900 hover:underline">{b.numero} · {b.fournisseur?.nom ?? "—"}</Link>
                <span className="shrink-0 font-medium text-amber-900">{usd(b.totalUSD)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Disponibilité des plats : le stock d'AUJOURD'HUI, pas celui du mois choisi (même calcul que l'Exploitation). */}
        <BlocDisponibilitePlats voit={voitDisponibilitePlats(user)} periode={etiquette(AUJ)} />

        <Bloc titre={`Articles au seuil minimum (${nbUrgent + nbAppro})`} periode={etiquette(AUJ)} lien="/stock/catalogue">
          {auSeuil.length === 0 ? <Vide t="Aucun article sous le seuil." /> : (
            <ul className="divide-y text-sm">
              {auSeuil.map((a, i) => (
                <li key={i} className="flex items-center justify-between py-1.5">
                  <span className="truncate pr-2">{a.designation}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>{qte(a.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Derniers bons de commande" periode={etiquette(libelleMois)} lien={estCourant ? "/stock/commandes" : lienCommandes}>
          {derniersBC.length === 0 ? <Vide t="Aucun bon de commande." /> : (
            <ul className="divide-y text-sm">
              {derniersBC.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/stock/commandes/${b.id}`} className="truncate hover:underline">{b.numero} · {b.fournisseur?.nom ?? "—"}</Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_BC_CLASSE[b.statut]}`}>{STATUT_BC_LABEL[b.statut]}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Dernières factures" periode={etiquette(libelleMois)} lien={estCourant ? "/stock/factures" : `/stock/factures?annee=${annee}`}>
          {dernieresFactures.length === 0 ? <Vide t="Aucune facture." /> : (
            <ul className="divide-y text-sm">
              {dernieresFactures.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/stock/factures/${f.id}`} className="truncate hover:underline">{f.fournisseur?.nom ?? f.fournisseurNom} · {usd(f.montantUSD)}</Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Dernières entrées & sorties" periode={etiquette(libelleMois)} lien={estCourant ? "/stock/mouvements" : lienMouvements}>
          {mouvementsRecents.length === 0 ? <Vide t="Aucun mouvement." /> : (
            <ul className="divide-y text-sm">
              {mouvementsRecents.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{m.article.designation}<span className="text-xs text-muted-foreground"> · {jfr(m.date)}</span></span>
                  <span className={`shrink-0 font-medium ${m.type === "SORTIE" ? "text-red-700" : "text-emerald-700"}`}>{m.type === "SORTIE" ? "−" : "+"}{qte(m.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Réconciliations récentes (ajustements)" periode={etiquette(libelleMois)} lien="/stock/reconciliation">
          {reconRecentes.length === 0 ? <Vide t="Aucun ajustement d'inventaire." /> : (
            <ul className="divide-y text-sm">
              {reconRecentes.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{m.article.designation}<span className="text-xs text-muted-foreground"> · {jfr(m.date)}</span></span>
                  <span className="shrink-0 text-muted-foreground">{qte(m.quantite)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Derniers comptages" periode={etiquette(libelleMois)} lien="/stock/archives">
          {derniersComptages.length === 0 ? <Vide t="Aucun comptage archivé." /> : (
            <ul className="divide-y text-sm">
              {derniersComptages.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/stock/archives/${s.id}`} className="truncate pr-2 hover:underline">{new Date(s.date).toLocaleDateString("fr-FR")} · {s.nbArticles} article(s)</Link>
                  <span className={`shrink-0 text-xs ${s.nbHorsTol > 0 ? "font-medium text-red-700" : "text-muted-foreground"}`}>{s.nbEcarts} écart(s){s.nbHorsTol > 0 ? ` · ${s.nbHorsTol} hors tol.` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Pertes récentes" periode={etiquette(libelleMois)} lien={estCourant ? "/stock/mouvements" : `${lienMouvements}&motif=perte`}>
          {pertesRecentes.length === 0 ? <Vide t="Aucune perte enregistrée." /> : (
            <ul className="divide-y text-sm">
              {pertesRecentes.map((m) => (
                <li key={m.id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate pr-2 font-medium">{m.article.designation}<span className="text-xs font-normal text-muted-foreground"> · {jfr(m.date)}</span></span>
                    <span className="shrink-0 font-medium text-red-700">−{qte(m.quantite)}</span>
                  </div>
                  {m.raisonSortie && <p className="text-xs text-muted-foreground">{m.raisonSortie}</p>}
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Articles les plus commandés" periode={etiquette("tous mois confondus")} lien="/stock/commandes">
          {topArticles.length === 0 ? <Vide t="Aucune commande enregistrée." /> : (
            <ul className="divide-y text-sm">
              {topArticles.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{a.designation}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a._count.designation} commande(s) · {qte(a._sum.quantite ?? 0)} au total</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>

        <Bloc titre="Fournisseurs les plus sollicités" periode={etiquette("tous mois confondus")} lien="/stock/fournisseurs">
          {topFourn.length === 0 ? <Vide t="Aucun bon de commande." /> : (
            <ul className="divide-y text-sm">
              {topFourn.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="truncate pr-2">{i === 0 && <span className="mr-1">🏆</span>}{f.nom}</span>
                  <span className="shrink-0 font-medium">{f.n} BC</span>
                </li>
              ))}
            </ul>
          )}
        </Bloc>
      </div>

      <p className="text-xs text-muted-foreground">{nbFournisseurs} fournisseurs · {nbArticles} articles au catalogue{estCourant ? "" : ` (${AUJ})`}.</p>
    </div>
  );
}

function Kpi({ label, valeur, sous, accent, href }: { label: string; valeur: string; sous?: string; accent?: "red" | "amber"; href?: string }) {
  const cls = accent === "red" ? "border-red-200 bg-red-50" : accent === "amber" ? "border-amber-200 bg-amber-50" : "";
  // h-full + flex : toutes les cartes d'une même rangée occupent la même hauteur (fin de l'effet décalé sur mobile).
  const inner = (
    <div className={`flex h-full flex-col rounded-lg border p-4 ${cls} ${href ? "transition-colors hover:border-primary" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold sm:text-xl">{valeur}</p>
      {sous && <p className="mt-auto pt-0.5 text-xs text-muted-foreground">{sous}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

/** `periode` : ce que couvre le bloc hors du mois courant (« août 2026 », « aujourd'hui »…). */
function Bloc({ titre, periode, lien, children }: { titre: string; periode?: string; lien: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{titre}{periode && <span className="text-xs font-normal text-muted-foreground" data-periode> · {periode}</span>}</h2>
        <Link href={lien} className="text-xs text-primary underline">Tout voir</Link>
      </div>
      {children}
    </div>
  );
}

function Vide({ t }: { t: string }) {
  return <p className="text-sm text-muted-foreground">{t}</p>;
}
