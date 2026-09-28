import { exigerEspaceStock } from "@/lib/garde-route";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { TableauxParPartieDocument } from "@/lib/pdf/tableau";
import { classeurExcel } from "@/lib/export-excel";
import { lundiDe } from "@/lib/dates-fr";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { dateLongue, feuilleExcel, partiePdf, semaineIso, type EspaceFiche, type Fiche } from "@/lib/fiches-conso";
import { formaterNombre } from "@/lib/montant";
import { chargerCommandesJournalieres, chargerRapportsJournaliers } from "../fiches-data";

/**
 * Fiches de l'onglet Consommation (Stock → Conso. journalière), en PDF ou en Excel :
 * - `type=rapport&semaine=AAAA-MM-JJ` : « Rapport journalier cuisine et bar » de la semaine ;
 * - `type=commande&date=AAAA-MM-JJ`   : « Commande journalière » (fiche cuisine, fiche bar) du jour.
 * `domaine` (NOURRITURE / BOISSON), comme le filtre de l'écran : une seule fiche ; sinon les deux.
 */

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
/** Date PURE valide (« 2026-02-31 » est refusée, jamais remplacée par un autre jour). */
function datePure(brut: string | null): string | null {
  if (!brut || !JOUR.test(brut)) return null;
  const d = new Date(`${brut}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === brut ? brut : null;
}

const JJMM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  if (type !== "rapport" && type !== "commande") return new Response("Fiche inconnue.", { status: 400 });
  const format = sp.get("format") === "excel" ? "excel" : "pdf";
  const domaine = sp.get("domaine");
  const espaces: EspaceFiche[] = domaine === "NOURRITURE" ? ["CUISINE"] : domaine === "BOISSON" ? ["BAR"] : ["CUISINE", "BAR"];
  const suffixe = espaces.length === 1 ? (espaces[0] === "CUISINE" ? "_cuisine" : "_bar") : "";

  let titre: string, periode: string, fichier: string, pied: string;
  let fiches: Fiche[];
  if (type === "rapport") {
    const brut = sp.get("semaine");
    const choisi = brut === null ? jourKinshasaISO() : datePure(brut);
    if (!choisi) return new Response("Semaine invalide (attendu : AAAA-MM-JJ).", { status: 400 });
    const lundi = lundiDe(new Date(`${choisi}T00:00:00Z`));
    const lundiIso = lundi.toISOString().slice(0, 10);
    fiches = await chargerRapportsJournaliers(lundi, espaces);
    // Du lundi au samedi comme le classeur ; au dimanche quand une fiche l'a ajouté.
    const dernier = new Date(lundi); dernier.setUTCDate(dernier.getUTCDate() + (fiches.some((f) => f.colonnes.length === 7) ? 6 : 5));
    titre = "Rapport journalier cuisine et bar";
    periode = `semaine ${semaineIso(lundiIso)}, du ${JJMM(lundiIso)} au ${JJMM(dernier.toISOString().slice(0, 10))}`;
    fichier = `Rapport_journalier${suffixe}_${lundiIso}`;
    pied = "Consommation réelle au restaurant = stock de la veille (compté, sinon théorique) + reçu du dépôt − compté le jour, dans l'unité de comptage. « — » : pas de comptage ce jour-là (ou stock de la veille inconnu). Le dimanche n'apparaît que s'il porte une consommation.";
  } else {
    const date = sp.get("date") === null ? jourKinshasaISO() : datePure(sp.get("date"));
    if (!date) return new Response("Date invalide (attendu : AAAA-MM-JJ).", { status: 400 });
    const r = await chargerCommandesJournalieres(date, espaces);
    fiches = r.fiches;
    titre = "Commande journalière";
    periode = `${dateLongue(date)} (semaine ${semaineIso(date)})`;
    fichier = `Commande_journaliere${suffixe}_${date}`;
    pied = "Commande : saisie de l'onglet Commande. Livraison : sorties « Livraison restaurant » du jour (légumes frais : achats du jour). Case vide : rien ce jour-là ; « — » : unité non renseignée au catalogue."
      + (r.sansMotif > 0 ? ` ${formaterNombre(r.sansMotif)} sortie(s) sans motif ce jour-là ne sont pas comptées comme livrées (onglet Consommation).` : "");
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

  const pdf = await renderPdfBuffer(TableauxParPartieDocument({ titre, sousTitre: periode, parties: fiches.map(partiePdf), pied }));
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichier}.pdf"` },
  });
}
