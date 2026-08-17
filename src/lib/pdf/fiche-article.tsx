import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader } from "./layout";
import { pdfColors } from "./theme";
import type { AnalysePrix } from "@/lib/stock-prix";

registerPdfFonts();

const ROUGE = "#B4232A";

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 32, paddingBottom: 90, fontSize: 9, fontFamily: "Optima", color: pdfColors.text },
  infoWrap: { border: `0.75 solid ${pdfColors.border}`, marginBottom: 14 },
  pRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  pLabel: { width: "28%", color: pdfColors.brownDark, fontWeight: 700 },
  pValue: { flex: 1 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 14 },
  kpi: { flex: 1, border: `0.75 solid ${pdfColors.border}`, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7.5, color: pdfColors.textMuted, marginBottom: 3 },
  kpiValue: { fontSize: 12, fontWeight: 700, color: pdfColors.brownDark },
  alerte: { border: `1 solid ${ROUGE}`, backgroundColor: "#FBEAEA", borderRadius: 4, padding: 8, marginBottom: 14 },
  alerteTitre: { fontSize: 9.5, fontWeight: 700, color: ROUGE, marginBottom: 2 },
  alerteTexte: { fontSize: 8.5, color: ROUGE },
  table: { marginBottom: 14, border: `0.75 solid ${pdfColors.border}` },
  th: { flexDirection: "row", backgroundColor: pdfColors.goldLight, paddingVertical: 4, paddingHorizontal: 6 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  cDate: { width: 90 },
  cLibelle: { flex: 1 },
  cNum: { width: 70, textAlign: "right" },
  cCol: { fontWeight: 700, color: pdfColors.brownDark },
  vide: { paddingVertical: 8, paddingHorizontal: 6, fontSize: 8.5, color: pdfColors.textMuted },
});

const usd = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
const nb = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const dCourt = (v: Date) => new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export type MouvementLigne = { id: string; date: Date; type: string; quantite: number; origine: string | null; source: string | null };

function PRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pRow}>
      <Text style={styles.pLabel}>{label}</Text>
      <Text style={styles.pValue}>{value}</Text>
    </View>
  );
}

export function FicheArticleDocument({
  designation, code, domaineLabel, categorieNom, fournisseurNom, unite,
  stock, stockMinimum, seuilUrgent, valeur, prixReference, alerteLabel,
  analyse, mouvements,
}: {
  designation: string; code: string | null; domaineLabel: string; categorieNom: string; fournisseurNom: string; unite: string | null;
  stock: number | null; stockMinimum: number | null; seuilUrgent: number | null; valeur: number; prixReference: number | null; alerteLabel: string;
  analyse: AnalysePrix; mouvements: MouvementLigne[];
}) {
  const uSuffix = unite ? ` ${unite}` : "";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="FICHE ARTICLE" subtitle={designation} />

        <View style={styles.infoWrap}>
          <PdfSectionHeader>Identité</PdfSectionHeader>
          <PRow label="Désignation" value={designation} />
          <PRow label="Domaine" value={domaineLabel} />
          <PRow label="Catégorie" value={categorieNom} />
          <PRow label="Fournisseur" value={fournisseurNom} />
          {code ? <PRow label="Code" value={code} /> : null}
          {unite ? <PRow label="Unité" value={unite} /> : null}
        </View>

        <View style={styles.kpis}>
          <View style={styles.kpi}><Text style={styles.kpiLabel}>Stock actuel</Text><Text style={styles.kpiValue}>{stock === null ? "—" : `${nb(stock)}${uSuffix}`}</Text></View>
          <View style={styles.kpi}><Text style={styles.kpiLabel}>Valeur du stock</Text><Text style={styles.kpiValue}>{usd(valeur)}</Text></View>
          <View style={styles.kpi}><Text style={styles.kpiLabel}>Prix de référence</Text><Text style={styles.kpiValue}>{usd(prixReference)}</Text></View>
          <View style={styles.kpi}><Text style={styles.kpiLabel}>Alerte</Text><Text style={styles.kpiValue}>{alerteLabel}</Text></View>
        </View>

        {(stockMinimum !== null || (seuilUrgent ?? 0) > 0) && (
          <Text style={{ fontSize: 8, color: pdfColors.textMuted, marginBottom: 12 }}>
            Seuil minimum : {stockMinimum === null ? "—" : nb(stockMinimum)}
            {(seuilUrgent ?? 0) > 0 ? `   ·   Seuil urgent : ${nb(seuilUrgent!)}` : ""}
          </Text>
        )}

        {analyse.hausse && (
          <View style={styles.alerte}>
            <Text style={styles.alerteTitre}>⚠ Hausse du prix d&apos;achat</Text>
            <Text style={styles.alerteTexte}>
              Dernier achat à {usd(analyse.hausse.prix)}, soit +{analyse.hausse.pct.toFixed(0)}% au-dessus de la moyenne précédente ({usd(analyse.hausse.moyenneAnterieure)}).
            </Text>
          </View>
        )}

        <PdfSectionHeader>Évolution du prix d&apos;achat</PdfSectionHeader>
        <View style={[styles.table, { marginTop: 0 }]}>
          <View style={styles.th}>
            <Text style={[styles.cDate, styles.cCol]}>Date</Text>
            <Text style={[styles.cLibelle, styles.cCol]}>Facture</Text>
            <Text style={[styles.cNum, styles.cCol]}>Quantité</Text>
            <Text style={[styles.cNum, styles.cCol]}>Prix unit.</Text>
          </View>
          {analyse.points.length === 0 ? (
            <Text style={styles.vide}>Aucun achat facturé — le prix évoluera au fil des factures.</Text>
          ) : (
            [...analyse.points].reverse().map((p, i) => (
              <View key={i} style={styles.tr}>
                <Text style={styles.cDate}>{dCourt(p.date)}</Text>
                <Text style={styles.cLibelle}>{p.numero ?? "Facture"}</Text>
                <Text style={styles.cNum}>{nb(p.qte)}</Text>
                <Text style={styles.cNum}>{usd(p.prix)}</Text>
              </View>
            ))
          )}
        </View>
        {analyse.points.length > 0 && (
          <Text style={{ fontSize: 8, color: pdfColors.textMuted, marginTop: -6, marginBottom: 14 }}>
            Min {usd(analyse.min)} · Max {usd(analyse.max)}
            {analyse.variation !== null ? `   ·   ${analyse.variation >= 0 ? "+" : ""}${analyse.variation.toFixed(1)}% vs achat précédent` : ""}
            {analyse.dernier && prixReference !== null && prixReference > 0
              ? `   ·   ${analyse.dernier.prix >= prixReference ? "+" : ""}${(((analyse.dernier.prix - prixReference) / prixReference) * 100).toFixed(1)}% vs prix de référence (${usd(prixReference)})`
              : ""}
          </Text>
        )}

        <PdfSectionHeader>Mouvements ({mouvements.length})</PdfSectionHeader>
        <View style={[styles.table, { marginTop: 0 }]}>
          <View style={styles.th}>
            <Text style={[styles.cDate, styles.cCol]}>Date</Text>
            <Text style={[styles.cLibelle, styles.cCol]}>Origine</Text>
            <Text style={[styles.cNum, styles.cCol]}>Quantité</Text>
          </View>
          {mouvements.length === 0 ? (
            <Text style={styles.vide}>Aucun mouvement de stock.</Text>
          ) : (
            mouvements.map((m) => {
              const sortie = m.type === "SORTIE";
              return (
                <View key={m.id} style={styles.tr} wrap={false}>
                  <Text style={styles.cDate}>{dCourt(m.date)}</Text>
                  <Text style={styles.cLibelle}>{[m.origine, m.source].filter(Boolean).join(" · ") || "—"}</Text>
                  <Text style={[styles.cNum, { color: sortie ? ROUGE : pdfColors.brownDark, fontWeight: 700 }]}>{sortie ? "−" : "+"}{nb(m.quantite)}</Text>
                </View>
              );
            })
          )}
        </View>

        <PdfFooter docLabel={`PÂTES EN FOLIE — TOLYA SARL  •  Fiche article : ${designation}`} />
      </Page>
    </Document>
  );
}
