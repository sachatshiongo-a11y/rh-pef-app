import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader } from "./layout";
import { pdfColors } from "./theme";

registerPdfFonts();

export type Colonne = { header: string; width: string; align?: "left" | "right" | "center" };

const styles = StyleSheet.create({
  page: { paddingTop: 26, paddingHorizontal: 30, paddingBottom: 30, fontSize: 8.5, fontFamily: "Optima", color: pdfColors.text },
  th: { flexDirection: "row", backgroundColor: pdfColors.brownDark },
  thCell: { color: "#ffffff", fontSize: 7, fontWeight: 700, paddingVertical: 4, paddingHorizontal: 4, textTransform: "uppercase" },
  tr: { flexDirection: "row", borderTop: `0.5 solid ${pdfColors.border}` },
  trTotal: { backgroundColor: pdfColors.goldLight },
  td: { fontSize: 8, paddingVertical: 3, paddingHorizontal: 4 },
  tdTotal: { fontWeight: 700, color: pdfColors.brownDark },
  wrap: { border: `0.75 solid ${pdfColors.border}` },
  pied: { marginTop: 10, fontSize: 7, fontStyle: "italic", color: pdfColors.textMuted },
});

/** Document PDF générique : en-tête de marque + tableau (colonnes/lignes), dernière ligne en gras optionnelle. */
export function TableauDocument({
  titre,
  sousTitre,
  colonnes,
  lignes,
  totalDerniereLigne = false,
  pied,
}: {
  titre: string;
  sousTitre: string;
  colonnes: Colonne[];
  lignes: (string | number)[][];
  totalDerniereLigne?: boolean;
  pied?: string;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title={titre} subtitle={sousTitre} />
        <View style={styles.wrap}>
          <View style={styles.th} fixed>
            {colonnes.map((c, i) => (
              <Text key={i} style={[styles.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>
                {c.header}
              </Text>
            ))}
          </View>
          {lignes.map((ligne, r) => {
            const total = totalDerniereLigne && r === lignes.length - 1;
            return (
              <View key={r} style={[styles.tr, total ? styles.trTotal : {}]} wrap={false}>
                {colonnes.map((c, i) => (
                  <Text key={i} style={[styles.td, total ? styles.tdTotal : {}, { width: c.width, textAlign: c.align ?? "left" }]}>
                    {String(ligne[i] ?? "")}
                  </Text>
                ))}
              </View>
            );
          })}
        </View>
        {pied && <Text style={styles.pied}>{pied}</Text>}
      </Page>
    </Document>
  );
}
