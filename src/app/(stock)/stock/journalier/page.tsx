import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { lundiDe } from "@/lib/dates-fr";
import { CommandeGrid, type CmdArticle } from "./commande-grid";
import { LEGUMES } from "../legumes/legumes-data";
import { TableConso } from "./table-conso";
import { chargerDonneesRestaurant } from "./donnees-restaurant";
import { TableComparaison } from "./table-comparaison";
import { consommationParArticleCatalogue, lignesComparaison } from "@/lib/journalier-restaurant";
import { exigerPageStock } from "@/lib/garde-page";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { MenuFicheCommande, MenuFichesConso } from "./menu-fiches-conso";
import { VentesGrid } from "./ventes-grid";
import { ImportClasseur } from "./import-classeur";
import { ImportCommande } from "./import-commande";
import { chargerVentesSemaine } from "./ventes-data";
import { ficheCommandeCalee } from "./fiches-data";
import { avecDimanche, type EspaceVente } from "@/lib/ventes-journalieres";

type SP = { semaine?: string; domaine?: string; vue?: string; dimanche?: string };
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

export default async function JournalierPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await exigerPageStock();
  const sp = await searchParams;
  const domaine = sp.domaine === "NOURRITURE" || sp.domaine === "BOISSON" ? sp.domaine : undefined;
  const vue = sp.vue === "commande" || sp.vue === "comparaison" || sp.vue === "ventes" ? sp.vue : "conso";
  const lundi = sp.semaine ? lundiDe(new Date(sp.semaine)) : lundiDe(new Date());
  const jours = Array.from({ length: 7 }, (_, i) => addDays(lundi, i));
  const finSemaine = addDays(lundi, 7);
  const joursLabel = jours.map((d, i) => ({ iso: iso(d), label: `${JOURS[i]} ${d.getUTCDate()}` }));
  const libelleSemaine = `Semaine du ${lundi.getUTCDate()}/${lundi.getUTCMonth() + 1} au ${addDays(lundi, 6).getUTCDate()}/${addDays(lundi, 6).getUTCMonth() + 1}`;
  // Jour proposé par les fiches « Commande journalière » : aujourd'hui s'il est dans la semaine affichée, sinon son lundi.
  const aujourdhui = jourKinshasaISO();
  const jourDefaut = aujourdhui >= iso(lundi) && aujourdhui < iso(finSemaine) ? aujourdhui : iso(lundi);

  const lien = (params: Partial<SP>) => {
    const p = new URLSearchParams();
    p.set("vue", params.vue ?? vue);
    p.set("semaine", params.semaine ?? iso(lundi));
    const dom = params.domaine !== undefined ? params.domaine : domaine;
    if (dom) p.set("domaine", dom);
    return `/stock/journalier?${p}`;
  };

  const enTete = (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Consommation journalière</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Suivi par jour : ce qui est <strong>commandé</strong> par le restaurant, ce qui lui est <strong>livré</strong> (sorties « Livraison restaurant ») et ce qu&apos;il <strong>consomme</strong> (comptages du restaurant). Enregistrez les livraisons datées depuis l&apos;onglet Mouvements.
        </p>
      </div>

      {/* Sélecteur de vue — pleine largeur et gros onglets sur mobile (bien visible au doigt),
          compact sur ordinateur. */}
      <div className="flex w-full overflow-hidden rounded-lg border text-sm font-medium sm:w-fit">
        {([["commande", "Commande"], ["conso", "Consommation"], ["comparaison", "Comparaison"], ["ventes", "Rapport journalier"]] as const).map(([v, label]) => (
          <Link
            key={v}
            href={lien({ vue: v })}
            className={`flex-1 border-l px-3 py-2.5 text-center first:border-l-0 sm:flex-none sm:py-1.5 ${vue === v ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1">
          <Link href={lien({ semaine: iso(addDays(lundi, -7)) })} className="rounded-md border px-2 py-1 hover:bg-accent">←</Link>
          <span className="px-2 font-medium">{libelleSemaine}</span>
          <Link href={lien({ semaine: iso(addDays(lundi, 7)) })} className="rounded-md border px-2 py-1 hover:bg-accent">→</Link>
          <Link href={lien({ semaine: iso(new Date()) })} className="ml-1 rounded-md border px-2 py-1 hover:bg-accent">Cette semaine</Link>
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="flex gap-1.5">
          {([["", "Tous"], ["NOURRITURE", "Cuisine (nourriture)"], ["BOISSON", "Bar (boissons)"]] as const).map(([k, label]) => (
            <Link key={k} href={lien({ domaine: k })} className={`rounded-full border px-3 py-1 ${(domaine ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</Link>
          ))}
        </div>
        {vue !== "ventes" && <span className="text-muted-foreground">·</span>}
        {/* Onglet Commande : la fiche sur le modèle du classeur (le tableau brut y reste, en second). */}
        {vue === "commande" && (
          <MenuFicheCommande semaine={iso(lundi)} jours={joursLabel.map((j) => j.iso)} jourDefaut={jourDefaut} domaine={domaine} libelleSemaine={libelleSemaine} />
        )}
        {(vue === "conso" || vue === "comparaison") && <div className="flex items-center overflow-hidden rounded-md border">
          <span className="px-2 py-1 text-xs text-muted-foreground">Exporter</span>
          <a href={`/stock/journalier/pdf?vue=${vue}&semaine=${iso(lundi)}${domaine ? `&domaine=${domaine}` : ""}`} download className="border-l px-2.5 py-1 hover:bg-accent">PDF</a>
          <a href={`/stock/journalier/excel?vue=${vue}&semaine=${iso(lundi)}${domaine ? `&domaine=${domaine}` : ""}`} download className="border-l px-2.5 py-1 hover:bg-accent">Excel</a>
        </div>}
        {(vue === "conso" || vue === "ventes") && (
          <MenuFichesConso semaine={iso(lundi)} domaine={domaine} libelleSemaine={libelleSemaine} jourDefaut={jourDefaut} />
        )}
      </div>
    </div>
  );

  // Légumes frais : achats du jour (AchatLegume) et commandes (CommandeLegumeResto). Cuisine only.
  const inclureLegumes = domaine !== "BOISSON";
  const chargerLegumesAchats = async () => {
    const legumes = await prisma.achatLegume.findMany({ where: { date: { gte: lundi, lt: finSemaine } }, select: { legume: true, date: true, quantite: true } });
    const m = new Map<string, { jours: number[]; total: number }>();
    for (const l of legumes) {
      const row = m.get(l.legume) ?? { jours: Array(7).fill(0), total: 0 };
      const idx = Math.floor((new Date(l.date).getTime() - lundi.getTime()) / 86_400_000);
      const q = Number(l.quantite);
      if (idx >= 0 && idx < 7) row.jours[idx] += q;
      row.total += q;
      m.set(l.legume, row);
    }
    return m;
  };
  const chargerCommandesLegumes = async () => {
    const cmds = await prisma.commandeLegumeResto.findMany({ where: { date: { gte: lundi, lt: finSemaine } }, select: { legume: true, date: true, quantite: true } });
    const map: Record<string, number> = {};
    for (const c of cmds) map[`legume:${c.legume}_${iso(new Date(c.date))}`] = Number(c.quantite);
    return map;
  };

  // ---------- VUE CONSOMMATION (sorties par motif + légumes + consommation réelle) ----------
  if (vue === "conso") {
    const [donnees, legAchats] = await Promise.all([
      chargerDonneesRestaurant(lundi, domaine),
      inclureLegumes ? chargerLegumesAchats() : Promise.resolve(new Map<string, { jours: number[]; total: number }>()),
    ]);
    const legumes = [...legAchats.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nom, r]) => ({ nom, ...r }));
    return (
      <div className="space-y-4">
        {enTete}
        <p className="text-xs text-muted-foreground">
          Seules les sorties « Livraison restaurant » alimentent le restaurant ; les pertes restent au dépôt. La consommation réelle = stock de la veille (compté, sinon théorique) + reçu du dépôt − compté le jour : elle n&apos;existe que les jours comptés (« — » sinon).
        </p>
        <TableConso jours={joursLabel} sorties={donnees.sorties} legumes={legumes} consoResto={donnees.consoResto} />
      </div>
    );
  }

  // ---------- VUE VENTES (saisie des plats et boissons vendus, forme du « Rapport journalier ») ----------
  if (vue === "ventes") {
    const espaces: EspaceVente[] = domaine === "NOURRITURE" ? ["CUISINE"] : domaine === "BOISSON" ? ["BAR"] : ["CUISINE", "BAR"];
    const v = await chargerVentesSemaine(lundi, espaces);
    // Lundi → samedi comme le classeur ; le dimanche dès qu'il porte une vente, ou à la demande.
    const dimancheVendu = avecDimanche(v.jours, v.ventes);
    const dimanche = dimancheVendu || sp.dimanche === "1";
    const jours = joursLabel.slice(0, dimanche ? 7 : 6).map((j) => ({ ...j, fige: v.joursFiges.has(j.iso) }));
    const lienDimanche = (afficher: boolean) => `${lien({})}${afficher ? "&dimanche=1" : ""}`;
    return (
      <div className="space-y-4">
        {enTete}
        <p className="text-xs text-muted-foreground">
          Saisissez le <strong>nombre vendu</strong> par unité de vente, jour par jour : Cuisine = fiches techniques « Plat vendu », Bar = fiches techniques Bar (verre, cocktail, café…) — jamais les bouteilles du stock. Case vide = pas de saisie (« — ») ; 0 = rien vendu. Enregistrement automatique ; collage depuis Excel possible.
          {" "}
          {!dimancheVendu && (
            <Link href={lienDimanche(!dimanche)} className="underline underline-offset-2 hover:text-foreground">{dimanche ? "Masquer le dimanche" : "Saisir aussi le dimanche"}</Link>
          )}
        </p>
        {user.role === "ADMIN" && <ImportClasseur />}
        <VentesGrid
          lignes={espaces.flatMap((e) => v.lignes[e])}
          jours={jours}
          ventes={Object.fromEntries(v.ventes)}
          peutModifier
        />
      </div>
    );
  }

  // Articles actifs (filtrés par domaine) + catégorie, pour la saisie et la comparaison.
  const chargerArticles = async (): Promise<CmdArticle[]> => {
    const articles = await prisma.articleStock.findMany({
      where: { actif: true, ...(domaine ? { domaine } : {}) },
      orderBy: [{ categorie: { nom: "asc" } }, { designation: "asc" }],
      select: { id: true, designation: true, categorie: { select: { nom: true } } },
    });
    return articles.map((a) => ({ id: a.id, designation: a.designation, categorie: a.categorie?.nom ?? "À classer" }));
  };
  const chargerCommandes = async () => {
    const cmds = await prisma.commandeResto.findMany({ where: { date: { gte: lundi, lt: finSemaine } }, select: { articleId: true, date: true, quantite: true } });
    const map: Record<string, number> = {};
    for (const c of cmds) map[`${c.articleId}_${iso(new Date(c.date))}`] = Number(c.quantite);
    return map;
  };

  // ---------- VUE COMMANDE (saisie) ----------
  if (vue === "commande") {
    const [articles, commandes, cmdLeg, calee] = await Promise.all([chargerArticles(), chargerCommandes(), inclureLegumes ? chargerCommandesLegumes() : Promise.resolve<Record<string, number>>({}), ficheCommandeCalee()]);
    if (inclureLegumes) articles.push(...LEGUMES.map((l) => ({ id: `legume:${l.nom}`, designation: l.unite ? `${l.nom} (${l.unite})` : l.nom, categorie: "Légumes frais" })));
    return (
      <div className="space-y-4">
        {enTete}
        <p className="text-xs text-muted-foreground">Saisissez la quantité <strong>commandée</strong> par le restaurant, par article et par jour (les légumes frais sont en fin de liste). Enregistrement automatique.</p>
        {/* Le document constate, le remède va sur l'écran : aucune note dans le PDF. */}
        {!calee && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Fiche commande pas encore calée sur votre classeur : lancez « Importer les lignes du classeur Commande journalière ».
          </p>
        )}
        {user.role === "ADMIN" && <ImportCommande />}
        <CommandeGrid articles={articles} jours={joursLabel} commandes={{ ...commandes, ...cmdLeg }} peutModifier />
      </div>
    );
  }

  // ---------- VUE COMPARAISON (commandé / livré au restaurant / consommé) ----------
  const [donnees, commandes, articles, legAchatsC, cmdLegC] = await Promise.all([
    chargerDonneesRestaurant(lundi, domaine), chargerCommandes(), chargerArticles(),
    inclureLegumes ? chargerLegumesAchats() : Promise.resolve(new Map<string, { jours: number[]; total: number }>()),
    inclureLegumes ? chargerCommandesLegumes() : Promise.resolve<Record<string, number>>({}),
  ]);
  const isos = joursLabel.map((j) => j.iso);
  const legumes = inclureLegumes
    ? [...new Set([...LEGUMES.map((l) => l.nom), ...legAchatsC.keys()])].map((nom) => ({
        nom, cmd: isos.map((j) => cmdLegC[`legume:${nom}_${j}`] ?? 0), liv: legAchatsC.get(nom)?.jours ?? Array(7).fill(0),
      }))
    : [];
  const lignes = lignesComparaison({
    jours: isos, articles, commandes, livraisons: donnees.sorties.livraisons,
    consoParArticle: consommationParArticleCatalogue(donnees.entrees, isos),
    inclureHorsCatalogue: !domaine, legumes,
  });

  return (
    <div className="space-y-4">
      {enTete}
      <TableComparaison jours={joursLabel} lignes={lignes} sansMotif={donnees.sorties.sansMotif.length} />
    </div>
  );
}
