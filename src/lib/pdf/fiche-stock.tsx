import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader } from "./layout";
import { pdfColors } from "./theme";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 32, paddingBottom: 70, fontSize: 8.5, fontFamily: "Optima", color: pdfColors.text },
  th: { flexDirection: "row", backgroundColor: pdfColors.goldLight, paddingVertical: 4, paddingHorizontal: 4 },
  tr: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 4, borderTop: `0.5 solid ${pdfColors.border}` },
  cDes: { flex: 1 },
  cUnite: { width: 45 },
  cTheo: { width: 55, textAlign: "right" },
  cVide: { width: 70, textAlign: "right", color: pdfColors.textMuted },
  cCol: { fontWeight: 700, color: pdfColors.brownDark },
  box: { marginBottom: 12, border: `0.75 solid ${pdfColors.border}` },
  intro: { marginBottom: 12, fontSize: 9, color: pdfColors.textMuted },
});

type Art = { designation: string; unite: string | null; theorique: string };
const DOM_LABEL: Record<string, string> = { NOURRITURE: "Nourriture", BOISSON: "Boissons" };

export function FicheStockDocument({ groupes, sousTitre }: { groupes: { domaine: string; articles: Art[] }[]; sousTitre: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Fiche de comptage — Inventaire" subtitle={sousTitre} />
        <Text style={styles.intro}>
          Reportez la quantité comptée dans « Physique » et l&apos;écart éventuel. Le stock théorique est
          celui enregistré dans l&apos;application au moment de l&apos;impression.
        </Text>

        {groupes.map((g) => (
          <View key={g.domaine} style={styles.box} wrap>
            <PdfSectionHeader>{DOM_LABEL[g.domaine] ?? g.domaine}</PdfSectionHeader>
            <View style={styles.th}>
              <Text style={[styles.cDes, styles.cCol]}>Désignation</Text>
              <Text style={[styles.cUnite, styles.cCol]}>Unité</Text>
              <Text style={[styles.cTheo, styles.cCol]}>Théorique</Text>
              <Text style={[styles.cVide, styles.cCol]}>Physique</Text>
              <Text style={[styles.cVide, styles.cCol]}>Écart</Text>
            </View>
            {g.articles.map((a, i) => (
              <View key={i} style={styles.tr} wrap={false}>
                <Text style={styles.cDes}>{a.designation}</Text>
                <Text style={styles.cUnite}>{a.unite ?? ""}</Text>
                <Text style={styles.cTheo}>{a.theorique}</Text>
                <Text style={styles.cVide}>. . . . . .</Text>
                <Text style={styles.cVide}>. . . . . .</Text>
              </View>
            ))}
          </View>
        ))}

        <PdfFooter docLabel={`PÂTES EN FOLIE — TOLYA SARL  •  Fiche de comptage inventaire`} />
      </Page>
    </Document>
  );
}
