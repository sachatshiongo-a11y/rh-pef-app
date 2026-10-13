import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { pdfColors } from "./theme";
import type { Piece } from "./blocs";

/**
 * Briques communes aux FICHES À REMPLIR À LA MAIN de l'espace Stock (fiche d'achat de légumes,
 * fiches d'inventaire Cuisine et Bar) : même en-tête de marque que les autres documents (posé
 * par l'appelant), puis une ligne « Date : » en haut à droite et un tableau aux cases vides
 * assez hautes pour y écrire au stylo.
 *
 * Règles de mise en page :
 * - la ligne d'en-tête du tableau est `fixed` : elle se répète en haut de chaque page ;
 * - chaque rangée est insécable (`wrap={false}`) : aucune ligne n'est coupée entre deux pages ;
 * - une ligne de rubrique exige de la place pour au moins deux rangées derrière elle
 *   (`minPresenceAhead`) : elle ne reste jamais seule en bas de page.
 */

export type ColonneFiche = { entete: string; largeur: string; align?: "left" | "right" | "center" };

/** Rangée de la fiche : une ligne d'article (cellules) ou une ligne de rubrique (catégorie). */
export type RangeeFiche = { rubrique: string } | { cellules: string[]; horsListe?: boolean };

const styles = StyleSheet.create({
  // Mêmes marges que les autres documents : le bas laisse la place au pied de page de marque.
  page: { paddingTop: 26, paddingHorizontal: 30, paddingBottom: 96, fontSize: 8.5, fontFamily: "Optima", color: pdfColors.text },
  ligneDate: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-end", marginBottom: 10 },
  libelleDate: { fontSize: 11, fontWeight: 700, color: pdfColors.brownDark, marginRight: 6 },
  valeurDate: { fontSize: 11, color: pdfColors.text, minWidth: 150, paddingBottom: 1, borderBottom: `0.75 solid ${pdfColors.text}` },
  tableau: { border: `0.75 solid ${pdfColors.brownLight}` },
  th: { flexDirection: "row", backgroundColor: pdfColors.brownDark },
  thCellule: { color: "#ffffff", fontSize: 8.5, fontWeight: 700, paddingVertical: 3.5, paddingHorizontal: 5 },
  tr: { flexDirection: "row", borderTop: `0.5 solid ${pdfColors.brownLight}` },
  trHorsListe: { backgroundColor: pdfColors.cream },
  td: { paddingHorizontal: 5, justifyContent: "center", borderLeft: `0.5 solid ${pdfColors.border}` },
  tdPremier: { borderLeftWidth: 0 },
  tdTexte: { fontSize: 8.5 },
  rubrique: { flexDirection: "row", backgroundColor: pdfColors.goldLight, borderTop: `0.5 solid ${pdfColors.brownLight}` },
  rubriqueTexte: { fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, paddingVertical: 3, paddingHorizontal: 5 },
});

export const stylePageFiche = styles.page;

/** « Date : » en haut à droite, suivie de la date imprimée ou d'un trait à remplir. */
export function LigneDate({ date, repere }: { date?: string; repere?: { "data-i"?: number } }) {
  return (
    <View style={styles.ligneDate} {...repere}>
      <Text style={styles.libelleDate}>Date :</Text>
      <Text style={styles.valeurDate}>{date ?? " "}</Text>
    </View>
  );
}

/**
 * Tableau de la fiche. `hauteurRangee` : hauteur minimale d'une rangée (place pour écrire).
 * `plage`, `repere`, `suite` : rendu PAR BLOCS (voir `CorpsTableau` de tableau.tsx).
 */
export function TableauFiche({ colonnes, rangees, hauteurRangee, plage, repere, suite = false }: {
  colonnes: ColonneFiche[]; rangees: RangeeFiche[]; hauteurRangee: number;
  plage?: [number, number]; repere?: (r: number) => { "data-i"?: number }; suite?: boolean;
}) {
  const debut = plage?.[0] ?? 0;
  return (
    <View style={suite ? [styles.tableau, { borderTopWidth: 0 }] : styles.tableau}>
      <View style={styles.th} fixed>
        {colonnes.map((c, i) => (
          <Text key={i} style={[styles.thCellule, { width: c.largeur, textAlign: c.align ?? "left" }]}>{c.entete}</Text>
        ))}
      </View>
      {(plage ? rangees.slice(plage[0], plage[1]) : rangees).map((r, k) => {
        const i = debut + k;
        return "rubrique" in r ? (
          <View key={i} style={styles.rubrique} wrap={false} minPresenceAhead={hauteurRangee * 2} {...repere?.(i)}>
            <Text style={styles.rubriqueTexte}>{r.rubrique}</Text>
          </View>
        ) : (
          <View key={i} style={[styles.tr, { minHeight: hauteurRangee }, r.horsListe ? styles.trHorsListe : {}]} wrap={false} {...repere?.(i)}>
            {colonnes.map((c, j) => (
              <View key={j} style={[styles.td, j === 0 ? styles.tdPremier : {}, { width: c.largeur }]}>
                <Text style={[styles.tdTexte, { textAlign: c.align ?? "left" }]}>{r.cellules[j] ?? ""}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** Pièce « tableau de la fiche » du rendu par blocs : une place pour le tableau lui-même, puis une par rangée. */
export function pieceTableauFiche(colonnes: ColonneFiche[], rangees: RangeeFiche[], hauteurRangee: number): Piece {
  return {
    places: 1 + rangees.length,
    rendre: (c) => {
      const de = Math.max(c.de, 1) - 1;
      const a = Math.max(c.a, 1) - 1;
      if (!(c.de === 0 && c.a > 0) && a <= de) return null;
      return <TableauFiche colonnes={colonnes} rangees={rangees} hauteurRangee={hauteurRangee} plage={[de, a]} repere={(r) => c.repere(1 + r)} suite={c.suite} />;
    },
  };
}

/** Pièce « Date : » (une place, en tête de la fiche). */
export const pieceLigneDate: Piece = {
  places: 1,
  rendre: (c) => (c.de < c.a ? <LigneDate repere={c.repere(0)} /> : null),
};
