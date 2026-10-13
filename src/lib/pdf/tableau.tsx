import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pdfColors } from "./theme";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { verifierPlafondPdf } from "./plafond";
import { documentDuPlan, totalPlaces, type Groupe, type Piece, type Plan } from "./blocs";

registerPdfFonts();

export type Colonne = { header: string; width: string; align?: "left" | "right" | "center" };

/** Cellule : texte simple, ou texte suivi d'une précision en petit (ex. « 12,50 » puis « 3 h »). */
export type Cellule = string | number | { texte: string; note?: string };
const texteCellule = (c: Cellule | undefined) => (c != null && typeof c === "object" ? c.texte : String(c ?? ""));
const noteCellule = (c: Cellule | undefined) => (c != null && typeof c === "object" ? c.note : undefined);

const styles = StyleSheet.create({
  // paddingBottom généreux : laisse la place au pied de page (coordonnées + n° de page).
  page: { paddingTop: 26, paddingHorizontal: 30, paddingBottom: 96, fontSize: 8.5, fontFamily: "Optima", color: pdfColors.text },
  meta: { marginBottom: 8, fontSize: 8, color: pdfColors.textMuted },
  th: { flexDirection: "row", backgroundColor: pdfColors.brownDark },
  thCell: { color: "#ffffff", fontSize: 7, fontWeight: 700, paddingVertical: 4, paddingHorizontal: 4, textTransform: "uppercase" },
  tr: { flexDirection: "row", borderTop: `0.5 solid ${pdfColors.border}` },
  trTotal: { backgroundColor: pdfColors.goldLight },
  trSection: { backgroundColor: pdfColors.goldLight },
  td: { fontSize: 8, paddingVertical: 3, paddingHorizontal: 4 },
  tdTotal: { fontWeight: 700, color: pdfColors.brownDark },
  tdSection: { fontSize: 8.5, fontWeight: 700, color: pdfColors.brownDark, paddingVertical: 3, paddingHorizontal: 4 },
  wrap: { border: `0.75 solid ${pdfColors.border}` },
  pied: { marginTop: 10, fontSize: 7, fontStyle: "italic", color: pdfColors.textMuted },
  note: { fontSize: 6, fontWeight: 400, color: pdfColors.textMuted },
  titrePartie: { fontSize: 11, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 6 },
  sousTitrePartie: { fontSize: 9.5, fontWeight: 700, color: pdfColors.text, marginBottom: 6 },
  blocTableau: { marginBottom: 14 },
  titreTableau: { fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 3, textTransform: "uppercase" },
});

export { styles as stylesTableau };

/** « 13 octobre 2026 » : jour civil de Kinshasa, pour la ligne « Édité le ». */
export const dateEdition = () => jourCivilKinshasa(new Date()).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

export type CorpsProps = {
  colonnes: Colonne[];
  lignes: Cellule[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[];
  couleurLigne?: (r: number) => string | undefined;
  couleurCellule?: (r: number, c: number) => string | undefined;
  /**
   * Rendu PAR BLOCS (`blocs.tsx`) : seules les lignes `plage[0]` à `plage[1]` (exclue) sont posées, avec leurs indices
   * d'origine (sections, couleurs, total). Absent : toutes les lignes.
   */
  plage?: [number, number];
  /** Rendu par blocs : repère de la ligne r (prop `data-i`, lue dans la mise en page pour couper aux limites de page). */
  repere?: (r: number) => { "data-i"?: number };
  /** Rendu par blocs : ce bloc REPREND un tableau commencé plus haut — pas de trait de tête, comme la suite d'un tableau coupé par react-pdf. */
  suite?: boolean;
};

/**
 * Le tableau lui-même : ligne d'en-tête `fixed` (répétée en haut de chaque page que le tableau
 * occupe), lignes insécables, lignes-titres de section, dernière ligne de total optionnelle.
 */
export function CorpsTableau({ colonnes, lignes, totalDerniereLigne = false, sectionRows, couleurLigne, couleurCellule, plage, repere, suite = false }: CorpsProps) {
  const sections = new Set(sectionRows ?? []);
  const debut = plage?.[0] ?? 0;
  return (
    <View style={suite ? [styles.wrap, { borderTopWidth: 0 }] : styles.wrap}>
      <View style={styles.th} fixed>
        {colonnes.map((c, i) => (
          <Text key={i} style={[styles.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>
            {c.header}
          </Text>
        ))}
      </View>
      {(plage ? lignes.slice(plage[0], plage[1]) : lignes).map((ligne, i) => {
        const r = debut + i;
        if (sections.has(r)) {
          return (
            // Un titre de rubrique ne reste jamais seul en bas de page : il exige la place d'une
            // rangée après lui, sinon il passe à la page suivante avec ses lignes.
            <View key={r} style={[styles.tr, styles.trSection]} wrap={false} minPresenceAhead={18} {...repere?.(r)}>
              <Text style={[styles.tdSection, { width: "100%" }]}>{texteCellule(ligne[0])}</Text>
            </View>
          );
        }
        const total = totalDerniereLigne && r === lignes.length - 1;
        const bg = !total ? couleurLigne?.(r) : undefined;
        return (
          <View key={r} style={[styles.tr, total ? styles.trTotal : {}, bg ? { backgroundColor: bg } : {}]} wrap={false} {...repere?.(r)}>
            {colonnes.map((c, i) => {
              const couleur = !total ? couleurCellule?.(r, i) : undefined;
              return (
                <Text key={i} style={[styles.td, total ? styles.tdTotal : {}, { width: c.width, textAlign: c.align ?? "left" }, couleur ? { color: couleur, fontWeight: 700 } : {}]}>
                  {texteCellule(ligne[i])}
                  {noteCellule(ligne[i]) ? <Text style={styles.note}>{` ${noteCellule(ligne[i])}`}</Text> : null}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

type SpecCorps = Omit<CorpsProps, "plage" | "repere" | "suite">;

/** Pièce « ligne Période » : une place. */
const pieceMeta = (sousTitre: string, exporteLe: string): Piece => ({
  places: 1,
  rendre: (c) => (c.de < c.a ? <Text style={styles.meta} {...c.repere(0)}>Période : {sousTitre} · Édité le {exporteLe}</Text> : null),
});

/**
 * Pièce « tableau » : une place pour son titre (même s'il n'y en a pas), puis une par ligne. `enveloppe` : le tableau est
 * dans un bloc `blocTableau` avec son titre (plusieurs tableaux sur une page).
 */
function pieceTableau(t: SpecCorps & { titre?: string }, enveloppe: boolean): Piece {
  return {
    places: 1 + t.lignes.length,
    rendre: (c) => {
      const avecTitre = c.de === 0 && c.a > 0;
      const de = Math.max(c.de, 1) - 1;
      const a = Math.max(c.a, 1) - 1;
      if (!avecTitre && a <= de) return null; // rien de ce tableau dans la fenêtre
      const corps = <CorpsTableau colonnes={t.colonnes} lignes={t.lignes} totalDerniereLigne={t.totalDerniereLigne} sectionRows={t.sectionRows} couleurLigne={t.couleurLigne} couleurCellule={t.couleurCellule} plage={[de, a]} repere={(r) => c.repere(1 + r)} suite={c.suite} />;
      if (!enveloppe) return corps;
      // PAS de `wrap={false}` sur le tableau entier : un bloc insécable plus haut que la page est ÉCRASÉ par react-pdf pour
      // tenir sur une seule page (rangées superposées, en-tête réduit à une barre vide, titre recouvert) — le rapport
      // « Achats de légumes frais — détail » sortait illisible. Le tableau se découpe donc entre les pages, ses rangées
      // restent insécables et sa ligne d'en-tête se répète (CorpsTableau).
      return (
        <View style={styles.blocTableau}>
          {t.titre && avecTitre && (
            // Le titre ne reste jamais seul en bas de page : il exige la place de l'en-tête et de quelques rangées après
            // lui, sinon il passe à la page suivante avec son tableau.
            <Text style={styles.titreTableau} minPresenceAhead={60} {...c.repere(0)}>{t.titre}</Text>
          )}
          {corps}
        </View>
      );
    },
  };
}

function planTableaux(titre: string, sousTitre: string, paysage: boolean, groupes: Groupe[]): Plan {
  return {
    mode: "fenetres",
    groupes,
    page: { orientation: paysage ? "landscape" : "portrait", style: styles.page },
    pied: <PdfFooter docLabel={`${titre} — ${sousTitre}`} />,
    places: totalPlaces(groupes),
  };
}

/** Document PDF générique : en-tête de marque + tableau (colonnes/lignes), dernière ligne en gras optionnelle. */
export function TableauDocument({
  titre,
  sousTitre,
  colonnes,
  lignes,
  totalDerniereLigne = false,
  sectionRows,
  couleurLigne,
  couleurCellule,
  paysage = false,
  pied,
}: {
  titre: string;
  sousTitre: string;
  colonnes: Colonne[];
  lignes: Cellule[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[]; // indices de lignes-titres de section (catégorie) : pleine largeur, en gras
  couleurLigne?: (r: number) => string | undefined; // fond de ligne optionnel (ex. code couleur de statut)
  couleurCellule?: (r: number, c: number) => string | undefined; // couleur de texte d'une cellule (ex. commande verte / livraison rouge)
  paysage?: boolean; // orientation paysage (tableaux larges, ex. grille hebdo)
  pied?: string;
}): ReactElement<DocumentProps> {
  verifierPlafondPdf(lignes.length); // refus AVANT rendu au-delà du plafond (lib/pdf/plafond.ts)
  const exporteLe = dateEdition();
  return documentDuPlan(planTableaux(titre, sousTitre, paysage, [{
    entete: <PdfHeader title={titre} subtitle={sousTitre} />,
    pieces: [pieceMeta(sousTitre, exporteLe), pieceTableau({ colonnes, lignes, totalDerniereLigne, sectionRows, couleurLigne, couleurCellule }, false)],
    fin: pied ? <Text style={styles.pied}>{pied}</Text> : null,
  }]));
}

export type TableSpec = { sousTitre?: string; colonnes: Colonne[]; lignes: Cellule[][]; totalDerniereLigne?: boolean };

/** Document PDF à PLUSIEURS tableaux sur une même page (ex. synthèse + détail jour par jour). */
export function TablesDocument({ titre, sousTitre, tables, paysage = false }: { titre: string; sousTitre: string; tables: TableSpec[]; paysage?: boolean }): ReactElement<DocumentProps> {
  verifierPlafondPdf(tables.reduce((n, t) => n + t.lignes.length, 0)); // toutes les tables du document comptent
  const exporteLe = dateEdition();
  return documentDuPlan(planTableaux(titre, sousTitre, paysage, [{
    entete: <PdfHeader title={titre} subtitle={sousTitre} />,
    pieces: [pieceMeta(sousTitre, exporteLe), ...tables.map((t) => pieceTableau({ titre: t.sousTitre, colonnes: t.colonnes, lignes: t.lignes, totalDerniereLigne: t.totalDerniereLigne }, true))],
  }]));
}

export type PartieTableau = {
  titre: string; // titre de la partie, affiché au-dessus de son tableau (ex. « Brigade — 12 salariés »)
  sousTitre?: string; // ligne sous le titre de la partie (ex. « Date : 22/09/2026 »)
  colonnes: Colonne[];
  lignes: Cellule[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[];
  couleurCellule?: (r: number, c: number) => string | undefined; // couleur de texte d'une cellule (optionnelle)
};

/**
 * Document PDF en PLUSIEURS PARTIES, chacune commençant sur une NOUVELLE page (une <Page> par
 * partie) : titre de la partie, puis son tableau, dont la ligne d'en-tête se répète si la partie
 * déborde sur plusieurs pages. La numérotation « Page x sur y » court sur tout le document.
 */
export function TableauxParPartieDocument({
  titre,
  sousTitre,
  parties,
  paysage = false,
  pied,
}: {
  titre: string;
  sousTitre: string;
  parties: PartieTableau[];
  paysage?: boolean;
  pied?: string; // mention en bas de la DERNIÈRE partie
}): ReactElement<DocumentProps> {
  verifierPlafondPdf(parties.reduce((n, p) => n + p.lignes.length, 0)); // toutes les parties du document comptent
  const exporteLe = dateEdition();
  return documentDuPlan(planTableaux(titre, sousTitre, paysage, parties.map((p, pi): Groupe => ({
    entete: <PdfHeader title={titre} subtitle={sousTitre} />,
    pieces: [
      {
        // Ligne Période, puis le titre de la partie. Daté (« Date : 22/09/2026 »), il est répété en haut de chaque page
        // de la partie (`fixed`), pour qu'une page de suite dise toujours de quel jour elle est.
        places: 1,
        rendre: (c) => (
          <>
            {c.de < c.a && <Text style={styles.meta} {...c.repere(0)}>Période : {sousTitre} · Édité le {exporteLe}</Text>}
            {p.sousTitre ? (
              <View fixed>
                <Text style={[styles.titrePartie, { marginBottom: 2 }]}>{p.titre}</Text>
                <Text style={styles.sousTitrePartie}>{p.sousTitre}</Text>
              </View>
            ) : (
              c.de < c.a && <Text style={styles.titrePartie}>{p.titre}</Text>
            )}
          </>
        ),
      },
      pieceTableau({ colonnes: p.colonnes, lignes: p.lignes, totalDerniereLigne: p.totalDerniereLigne, sectionRows: p.sectionRows, couleurCellule: p.couleurCellule }, false),
    ],
    fin: pied && pi === parties.length - 1 ? <Text style={styles.pied}>{pied}</Text> : null,
  }))));
}
