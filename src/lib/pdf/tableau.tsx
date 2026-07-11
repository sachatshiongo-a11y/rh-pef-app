import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pdfColors } from "./theme";

registerPdfFonts();

export type Colonne = { header: string; width: string; align?: "left" | "right" | "center" };

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
});

/** Document PDF générique : en-tête de marque + tableau (colonnes/lignes), dernière ligne en gras optionnelle. */
export function TableauDocument({
  titre,
  sousTitre,
  colonnes,
  lignes,
  totalDerniereLigne = false,
  sectionRows,
  couleurLigne,
  paysage = false,
  pied,
}: {
  titre: string;
  sousTitre: string;
  colonnes: Colonne[];
  lignes: (string | number)[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[]; // indices de lignes-titres de section (catégorie) : pleine largeur, en gras
  couleurLigne?: (r: number) => string | undefined; // fond de ligne optionnel (ex. code couleur de statut)
  paysage?: boolean; // orientation paysage (tableaux larges, ex. grille hebdo)
  pied?: string;
}) {
  const sections = new Set(sectionRows ?? []);
  const exporteLe = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" orientation={paysage ? "landscape" : "portrait"} style={styles.page}>
        <PdfHeader title={titre} subtitle={sousTitre} />
        <Text style={styles.meta}>Période : {sousTitre} · Édité le {exporteLe}</Text>
        <View style={styles.wrap}>
          <View style={styles.th} fixed>
            {colonnes.map((c, i) => (
              <Text key={i} style={[styles.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>
                {c.header}
              </Text>
            ))}
          </View>
          {lignes.map((ligne, r) => {
            if (sections.has(r)) {
              return (
                <View key={r} style={[styles.tr, styles.trSection]} wrap={false}>
                  <Text style={[styles.tdSection, { width: "100%" }]}>{String(ligne[0] ?? "")}</Text>
                </View>
              );
            }
            const total = totalDerniereLigne && r === lignes.length - 1;
            const bg = !total ? couleurLigne?.(r) : undefined;
            return (
              <View key={r} style={[styles.tr, total ? styles.trTotal : {}, bg ? { backgroundColor: bg } : {}]} wrap={false}>
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
        <PdfFooter docLabel={`${titre} — ${sousTitre}`} />
      </Page>
    </Document>
  );
}

export type TableSpec = { sousTitre?: string; colonnes: Colonne[]; lignes: (string | number)[][]; totalDerniereLigne?: boolean };

/** Document PDF à PLUSIEURS tableaux sur une même page (ex. synthèse + détail jour par jour). */
export function TablesDocument({ titre, sousTitre, tables, paysage = false }: { titre: string; sousTitre: string; tables: TableSpec[]; paysage?: boolean }) {
  const exporteLe = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" orientation={paysage ? "landscape" : "portrait"} style={styles.page}>
        <PdfHeader title={titre} subtitle={sousTitre} />
        <Text style={styles.meta}>Période : {sousTitre} · Édité le {exporteLe}</Text>
        {tables.map((t, ti) => (
          <View key={ti} style={{ marginBottom: 14 }} wrap={false}>
            {t.sousTitre && <Text style={{ fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 3, textTransform: "uppercase" }}>{t.sousTitre}</Text>}
            <View style={styles.wrap}>
              <View style={styles.th}>
                {t.colonnes.map((c, i) => (
                  <Text key={i} style={[styles.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>{c.header}</Text>
                ))}
              </View>
              {t.lignes.map((ligne, r) => {
                const total = t.totalDerniereLigne && r === t.lignes.length - 1;
                return (
                  <View key={r} style={[styles.tr, total ? styles.trTotal : {}]} wrap={false}>
                    {t.colonnes.map((c, i) => (
                      <Text key={i} style={[styles.td, total ? styles.tdTotal : {}, { width: c.width, textAlign: c.align ?? "left" }]}>{String(ligne[i] ?? "")}</Text>
                    ))}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
        <PdfFooter docLabel={`${titre} — ${sousTitre}`} />
      </Page>
    </Document>
  );
}
