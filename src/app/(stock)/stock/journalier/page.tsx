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
import { VentesGrid } from "./ventes-grid";
import { EnteteJournalier, lienJournalier } from "./entete-journalier";
import { JourMobileProvider } from "@/components/jour-mobile";
import { rangJourParDefaut } from "@/lib/jour-mobile";
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
  // Jour proposé par les fiches « Commande journalière » : aujourd'hui s'il est dans la semaine affichée, sinon son lundi.
  const aujourdhui = jourKinshasaISO();
  const jourDefaut = aujourdhui >= iso(lundi) && aujourdhui < iso(finSemaine) ? aujourdhui : iso(lundi);

  const isosSemaine = joursLabel.map((j) => j.iso);
  // Un seul état « jour choisi » (téléphone) pour le haut de page et la liste du jour ; il repart du
  // jour courant à chaque semaine affichée.
  const cadre = (enTete: React.ReactNode, corps: React.ReactNode) => (
    <JourMobileProvider key={iso(lundi)} defaultIdx={rangJourParDefaut(isosSemaine, aujourdhui)}>
      <div className="space-y-4">{enTete}{corps}</div>
    </JourMobileProvider>
  );
  /** Haut de page : identique pour les quatre onglets (la note de l'onglet et l'import varient). */
  const enTete = (aide?: React.ReactNode, opts: { joursSelecteur?: { iso: string }[]; importer?: React.ReactNode } = {}) => (
    <EnteteJournalier
      vue={vue} domaine={domaine} lundi={lundi} jourDefaut={jourDefaut} aujourdhui={aujourdhui}
      joursSelecteur={opts.joursSelecteur ?? joursLabel} aide={aide} importer={opts.importer}
    />
  );
  /** Note de l'onglet, sous le haut de page sur ordinateur (sur téléphone, elle est dans « Plus »). */
  const noteDeLOnglet = (aide: React.ReactNode) => <p className="text-xs text-muted-foreground max-lg:hidden">{aide}</p>;

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
    const aide = <>Seules les sorties « Livraison restaurant » alimentent le restaurant ; les pertes restent au dépôt. La consommation réelle = stock de la veille (compté, sinon théorique) + reçu du dépôt − compté le jour : elle n&apos;existe que les jours comptés (« — » sinon).</>;
    return cadre(
      enTete(aide),
      <>
        {noteDeLOnglet(aide)}
        <TableConso jours={joursLabel} sorties={donnees.sorties} legumes={legumes} consoResto={donnees.consoResto} />
      </>,
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
    const lienDimanche = (afficher: boolean) => `${lienJournalier({ vue, semaine: iso(lundi), domaine })}${afficher ? "&dimanche=1" : ""}`;
    const aide = (
      <>
        Saisissez le <strong>nombre vendu</strong> par unité de vente, jour par jour : Cuisine = fiches techniques « Plat vendu », Bar = fiches techniques Bar (verre, cocktail, café…) — jamais les bouteilles du stock. Case vide = pas de saisie (« — ») ; 0 = rien vendu. Enregistrement automatique ; collage depuis Excel possible.
        {" "}
        {!dimancheVendu && (
          <Link href={lienDimanche(!dimanche)} className="underline underline-offset-2 hover:text-foreground">{dimanche ? "Masquer le dimanche" : "Saisir aussi le dimanche"}</Link>
        )}
      </>
    );
    return cadre(
      enTete(aide, { joursSelecteur: jours, importer: user.role === "ADMIN" ? <ImportClasseur /> : undefined }),
      <>
        {noteDeLOnglet(aide)}
        {user.role === "ADMIN" && <div className="max-lg:hidden"><ImportClasseur /></div>}
        <VentesGrid
          lignes={espaces.flatMap((e) => v.lignes[e])}
          jours={jours}
          ventes={Object.fromEntries(v.ventes)}
          peutModifier
        />
      </>,
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
    const aide = <>Saisissez la quantité <strong>commandée</strong> par le restaurant, par article et par jour (les légumes frais sont en fin de liste). Enregistrement automatique.</>;
    return cadre(
      enTete(aide, { importer: user.role === "ADMIN" ? <ImportCommande /> : undefined }),
      <>
        {noteDeLOnglet(aide)}
        {/* Le document constate, le remède va sur l'écran : aucune note dans le PDF. */}
        {!calee && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Fiche commande pas encore calée sur votre classeur : lancez « Importer les lignes du classeur Commande journalière ».
          </p>
        )}
        {user.role === "ADMIN" && <div className="max-lg:hidden"><ImportCommande /></div>}
        <CommandeGrid articles={articles} jours={joursLabel} commandes={{ ...commandes, ...cmdLeg }} peutModifier />
      </>,
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

  return cadre(
    enTete(),
    <TableComparaison jours={joursLabel} lignes={lignes} sansMotif={donnees.sorties.sansMotif.length} />,
  );
}
