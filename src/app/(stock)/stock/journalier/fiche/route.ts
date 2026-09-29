import { exigerEspaceStock } from "@/lib/garde-route";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { TableauxParPartieDocument } from "@/lib/pdf/tableau";
import { classeurExcel } from "@/lib/export-excel";
import { lundiDe } from "@/lib/dates-fr";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { dateCourte, dateLongue, feuilleExcel, fichesCommandeSemaine, partiePdf, semaineIso, type EspaceFiche, type Fiche } from "@/lib/fiches-conso";
import { formaterNombre } from "@/lib/montant";
import { chargerCommandesJournalieres, chargerCommandesSemaine, chargerConsommationsReelles, chargerRapportsJournaliers } from "../fiches-data";

/**
 * Fiches de l'onglet Consommation (Stock → Conso. journalière), en PDF ou en Excel :
 * - `type=rapport&semaine=AAAA-MM-JJ`      : « Rapport journalier cuisine et bar » de la semaine —
 *   plats et boissons VENDUS (onglet Ventes) ;
 * - `type=consommation&semaine=AAAA-MM-JJ` : « Consommation réelle du restaurant » de la semaine —
 *   articles, d'après les comptages (le contenu du rapport journalier avant le 2026-09-29) ;
 * - `type=commande&date=AAAA-MM-JJ`        : « Commande journalière » (fiche cuisine, fiche bar) du jour ;
 * - `type=commande&tout=1&semaine=AAAA-MM-JJ` : la même fiche pour TOUTE la semaine, un seul fichier —
 *   jour par jour (lundi → samedi, le dimanche s'il porte une commande ou une livraison), la fiche
 *   cuisine puis la fiche bar, chacune sur sa page (PDF) ou sa feuille « Lun 29 Cuisine » (Excel).
 * `domaine` (NOURRITURE / BOISSON), comme le filtre de l'écran : une seule fiche ; sinon les deux.
 */

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
/** Date PURE valide (« 2026-02-31 » est refusée, jamais remplacée par un autre jour). */
function datePure(brut: string | null): string | null {
  if (!brut || !JOUR.test(brut)) return null;
  const d = new Date(`${brut}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === brut ? brut : null;
}

const JJMM = dateCourte;

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  if (type !== "rapport" && type !== "consommation" && type !== "commande") return new Response("Fiche inconnue.", { status: 400 });
  const format = sp.get("format") === "excel" ? "excel" : "pdf";
  const domaine = sp.get("domaine");
  const espaces: EspaceFiche[] = domaine === "NOURRITURE" ? ["CUISINE"] : domaine === "BOISSON" ? ["BAR"] : ["CUISINE", "BAR"];
  const suffixe = espaces.length === 1 ? (espaces[0] === "CUISINE" ? "_cuisine" : "_bar") : "";

  let titre: string, periode: string, fichier: string, pied: string;
  let fiches: Fiche[];
  if (type === "rapport" || type === "consommation") {
    const brut = sp.get("semaine");
    const choisi = brut === null ? jourKinshasaISO() : datePure(brut);
    if (!choisi) return new Response("Semaine invalide (attendu : AAAA-MM-JJ).", { status: 400 });
    const lundi = lundiDe(new Date(`${choisi}T00:00:00Z`));
    const lundiIso = lundi.toISOString().slice(0, 10);
    const ventes = type === "rapport";
    fiches = ventes ? await chargerRapportsJournaliers(lundi, espaces) : await chargerConsommationsReelles(lundi, espaces);
    // Du lundi au samedi comme le classeur ; au dimanche quand une fiche l'a ajouté.
    const dernier = new Date(lundi); dernier.setUTCDate(dernier.getUTCDate() + (fiches.some((f) => f.colonnes.length === 7) ? 6 : 5));
    periode = `semaine ${semaineIso(lundiIso)}, du ${JJMM(lundiIso)} au ${JJMM(dernier.toISOString().slice(0, 10))}`;
    if (ventes) {
      titre = "Rapport journalier cuisine et bar";
      fichier = `Rapport_journalier${suffixe}_${lundiIso}`;
      pied = ""; // comme le classeur : aucune mention sous la fiche
    } else {
      titre = "Consommation réelle du restaurant";
      fichier = `Consommation_reelle${suffixe}_${lundiIso}`;
      pied = "Consommation réelle au restaurant = stock de la veille (compté, sinon théorique) + reçu du dépôt − compté le jour, dans l'unité de comptage. « — » : pas de comptage ce jour-là (ou stock de la veille inconnu). Le dimanche n'apparaît que s'il porte une consommation.";
    }
  } else if (sp.get("tout") === "1") {
    const brut = sp.get("semaine");
    const choisi = brut === null ? jourKinshasaISO() : datePure(brut);
    if (!choisi) return new Response("Semaine invalide (attendu : AAAA-MM-JJ).", { status: 400 });
    const lundiIso = lundiDe(new Date(`${choisi}T00:00:00Z`)).toISOString().slice(0, 10);
    const tous = await chargerCommandesSemaine(new Date(`${lundiIso}T00:00:00Z`), espaces);
    const jours = fichesCommandeSemaine(tous, espaces);
    fiches = jours.flatMap((j) => j.fiches);
    titre = "Commande journalière";
    periode = `semaine ${semaineIso(lundiIso)}, du ${JJMM(lundiIso)} au ${JJMM(jours[jours.length - 1]!.date)}`;
    fichier = `Commande_journaliere${suffixe}_semaine_${lundiIso}`;
    // Seul fait qui changerait la lecture : des sorties sans motif les jours imprimés.
    const imprimes = new Set(jours.map((j) => j.date));
    const sansMotif = tous.filter((j) => imprimes.has(j.date) && j.sansMotif > 0);
    pied = sansMotif.length
      ? `Sorties sans motif, non comptées comme livrées : ${sansMotif.map((j) => `${formaterNombre(j.sansMotif)} le ${dateLongue(j.date).split(" ")[0]} ${JJMM(j.date).slice(0, 5)}`).join(", ")}.`
      : "";
  } else {
    const date = sp.get("date") === null ? jourKinshasaISO() : datePure(sp.get("date"));
    if (!date) return new Response("Date invalide (attendu : AAAA-MM-JJ).", { status: 400 });
    const r = await chargerCommandesJournalieres(date, espaces);
    fiches = r.fiches;
    titre = "Commande journalière";
    periode = `${dateLongue(date)} (semaine ${semaineIso(date)})`;
    fichier = `Commande_journaliere${suffixe}_${date}`;
    // Comme le classeur : aucune mention, sauf un fait qui changerait la lecture de la fiche.
    pied = r.sansMotif > 0 ? `${formaterNombre(r.sansMotif)} sortie(s) sans motif ce jour-là ne sont pas comptées comme livrées (onglet Consommation).` : "";
  }

  if (format === "excel") {
    const buf = await classeurExcel({ titre, periode, feuilles: fiches.map(feuilleExcel) });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fichier}.xlsx"`,
      },
    });
  }

  const pdf = await renderPdfBuffer(TableauxParPartieDocument({ titre, sousTitre: periode, parties: fiches.map(partiePdf), ...(pied ? { pied } : {}) }));
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichier}.pdf"` },
  });
}
