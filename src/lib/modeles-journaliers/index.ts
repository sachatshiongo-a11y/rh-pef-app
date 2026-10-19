import fs from "node:fs";
import path from "node:path";
import { cleTexte, lireFeuillesXlsx } from "@/lib/xlsx-leger";
import { lireClasseurVentes } from "@/lib/classeur-ventes";
import { lireClasseurCommande } from "@/lib/classeur-commande";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { reunirPdf } from "@/lib/pdf/reunir-pdf";
import { semaineIso, type EspaceFiche, type Fiche } from "@/lib/fiches-conso";
import { lireGabarit, type FeuilleGabarit, type Gabarit } from "./gabarit";
import { squelette, type LigneModele, type Squelette } from "./squelette";
import { feuilleTelleQuelle, remplirFeuille, type FeuilleSortie, type LigneDonnees } from "./remplir";
import { ecrireClasseur, nomOnglet } from "./classeur";
import { DocumentModele } from "./impression";

// Documents « Rapport journalier cuisine et bar » et « Commande journalière » sur les MODÈLES de la
// Direction (assets/modeles/, copies allégées de ses classeurs — cf. scripts/modeles-journaliers.ts).
// Les chiffres sont ceux des fiches existantes (lib/fiches-conso, aucun calcul ici) ; ce module ne
// fait que les poser sur le classeur, en Excel (le classeur lui-même, rempli) comme en PDF (le
// classeur tel qu'Excel l'imprime).

export type TypeModele = "RAPPORT" | "COMMANDE";
const FICHIERS: Record<TypeModele, string> = { RAPPORT: "rapport-journalier.xlsx", COMMANDE: "commande-journaliere.xlsx" };

export type FeuilleModele = { feuille: FeuilleGabarit; espace: EspaceFiche | null; squelette: Squelette | null };
export type Modele = { type: TypeModele; gabarit: Gabarit; feuilles: FeuilleModele[] };

/** Espace d'une feuille du classeur, d'après son nom (« Cuisine », « Fiche commande Bar »…). */
function espaceDe(type: TypeModele, nom: string): EspaceFiche | null {
  const n = cleTexte(nom);
  if (type === "RAPPORT") return n === "cuisine" ? "CUISINE" : n === "bar" ? "BAR" : null;
  return n.includes("commande cuisine") ? "CUISINE" : n.includes("commande bar") ? "BAR" : null;
}

/** Analyse un gabarit (octets du .xlsx) : feuilles, squelettes, clés des lignes (celles de l'import). */
export async function analyserModele(type: TypeModele, octets: Uint8Array): Promise<Modele> {
  const gabarit = await lireGabarit(octets);
  const lu = await lireFeuillesXlsx(octets, () => true);
  if (!lu.ok) throw new Error(`Gabarit ${type} illisible : ${lu.erreur}`);
  const lecture = type === "RAPPORT" ? await lireClasseurVentes(octets) : await lireClasseurCommande(octets);
  if (!lecture.ok) throw new Error(`Gabarit ${type} : ${lecture.erreur}`);
  const lignes = lecture.lignes as (LigneModele & { feuille: EspaceFiche })[];
  const feuilles = gabarit.feuilles.map((feuille): FeuilleModele => {
    const espace = espaceDe(type, feuille.nom);
    const cellules = lu.feuilles.get(cleTexte(feuille.nom));
    if (!espace || !cellules) return { feuille, espace, squelette: null };
    return { feuille, espace, squelette: squelette(gabarit, feuille, cellules, lignes.filter((l) => l.feuille === espace), type) };
  });
  return { type, gabarit, feuilles };
}

const caches = new Map<TypeModele, Promise<Modele>>();

/** Modèle embarqué (lu une fois par processus : ~150 Ko). */
export function chargerModele(type: TypeModele): Promise<Modele> {
  let p = caches.get(type);
  if (!p) {
    p = analyserModele(type, new Uint8Array(fs.readFileSync(path.join(process.cwd(), "assets/modeles", FICHIERS[type]))));
    p.catch(() => caches.delete(type));
    caches.set(type, p);
  }
  return p;
}

/** Les lignes d'une fiche, à placer sur le classeur. */
export function lignesDonnees(fiche: Fiche): LigneDonnees[] {
  return fiche.sections.flatMap((s) =>
    s.lignes.map((l) => ({
      rubrique: l.cle?.rubrique ?? s.titre,
      noms: l.cle?.noms ?? [l.designation],
      legume: l.cle?.legume,
      mention: l.cle?.mention,
      libelle: l.designation,
      valeurs: l.cases.map((c) => c.valeur),
    })),
  );
}

function feuilleDe(m: Modele, espace: EspaceFiche): FeuilleModele {
  const f = m.feuilles.find((x) => x.espace === espace && x.squelette);
  if (!f) throw new Error(`Modèle ${m.type} : aucune feuille ${espace}.`);
  return f;
}

/** Rapport journalier de la semaine du `lundi` : une feuille par fiche (Cuisine, Bar), celles du classeur. */
export async function feuillesRapport(fiches: Fiche[], lundi: string): Promise<{ modele: Modele; feuilles: FeuilleSortie[] }> {
  const modele = await chargerModele("RAPPORT");
  const feuilles = fiches.map((fiche) => {
    const f = feuilleDe(modele, fiche.espace);
    return remplirFeuille(modele.gabarit, f.feuille, f.squelette!, {
      lignes: lignesDonnees(fiche),
      semaine: semaineIso(lundi),
      lundi,
      dimanche: fiche.colonnes.length > f.squelette!.colsDonnees.length,
    });
  });
  return { modele, feuilles };
}

export type JourCommande = { date: string; fiches: Fiche[] };

/**
 * Commande journalière : pour chaque jour, ses fiches (cuisine, bar) sur les feuilles du classeur.
 * Un seul jour avec les deux fiches : le classeur entier, onglet « Salle » (vide) compris. Plusieurs
 * jours : une feuille par jour et par fiche, au nom de la fiche (« Lun 29 Cuisine »).
 */
export async function feuillesCommande(jours: JourCommande[]): Promise<{ modele: Modele; feuilles: FeuilleSortie[] }> {
  const modele = await chargerModele("COMMANDE");
  const plusieurs = jours.length > 1;
  const feuilles = jours.flatMap((j) =>
    j.fiches.map((fiche) => {
      const f = feuilleDe(modele, fiche.espace);
      return remplirFeuille(modele.gabarit, f.feuille, f.squelette!, {
        nom: plusieurs ? nomOnglet(fiche.feuille) : undefined,
        lignes: lignesDonnees(fiche),
        semaine: semaineIso(j.date),
        date: j.date,
      });
    }),
  );
  const espaces = new Set(jours.flatMap((j) => j.fiches.map((f) => f.espace)));
  if (!plusieurs && espaces.size === 2) {
    for (const f of modele.feuilles) if (!f.espace) feuilles.push(feuilleTelleQuelle(f.feuille));
  }
  return { modele, feuilles };
}

export async function excelModele(r: { modele: Modele; feuilles: FeuilleSortie[] }): Promise<Buffer> {
  return ecrireClasseur(r.modele.gabarit, r.feuilles);
}

/**
 * Feuilles rendues par document PDF. Une semaine de commande, c'est 14 feuilles : rendues d'un seul
 * bloc, react-pdf garde toute la mise en page en mémoire (~256 Mo de plus que pour un jour, mesuré),
 * ce qui dépasse l'instance de production (512 Mo, Next compris) : le processus est tué et le
 * téléchargement échoue. Rendues deux par deux (un jour : fiche cuisine + fiche bar) puis réunies,
 * le pic reste celui d'un jour (~30 Mo).
 */
export const FEUILLES_PAR_DOCUMENT_PDF = 2;

export async function pdfModele(r: { modele: Modele; feuilles: FeuilleSortie[] }, titre: string, pied?: string): Promise<Buffer> {
  // Une feuille sans tableau (« Fiche commande Salle », vide) n'imprime rien : elle ne compte pas.
  const imprimees = r.feuilles.filter((f) => f.squelette);
  const lots: FeuilleSortie[][] = [];
  for (let i = 0; i < imprimees.length; i += FEUILLES_PAR_DOCUMENT_PDF) lots.push(imprimees.slice(i, i + FEUILLES_PAR_DOCUMENT_PDF));
  const rendre = (feuilles: FeuilleSortie[], dernier: boolean) =>
    renderPdfBuffer(DocumentModele({ titre, feuilles: feuilles.map((f) => ({ g: r.modele.gabarit, f })), ...(dernier && pied ? { pied } : {}) }));
  if (lots.length <= 1) return rendre(lots[0] ?? [], true);

  // Un lot après l'autre (jamais en parallèle : c'est le but), puis les pages mises bout à bout.
  const parties: Uint8Array[] = [];
  for (const [i, lot] of lots.entries()) parties.push(await rendre(lot, i === lots.length - 1));
  return Buffer.from(await reunirPdf(parties, { titre, auteur: "Pâtes en Folie" }));
}
