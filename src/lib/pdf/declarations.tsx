import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader, PdfSignatureBox } from "./layout";
import { pdfColors, formatCDF, entreprise as entrepriseDefaut } from "./theme";
import type { LigneDeclaration } from "@/lib/declarations";

registerPdfFonts();

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

const LIBELLE_STATUT: Record<string, string> = {
  A_DECLARER: "À déclarer",
  DECLARE: "Déclaré",
  PAYE: "Payé",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 90,
    fontSize: 10,
    fontFamily: "Optima",
    color: pdfColors.text,
  },
  intro: { marginTop: 4, marginBottom: 12, fontSize: 9, lineHeight: 1.5, color: pdfColors.textMuted },
  table: { border: `0.75 solid ${pdfColors.border}`, marginBottom: 14 },
  headRow: {
    flexDirection: "row",
    backgroundColor: pdfColors.goldLight,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTop: `0.5 solid ${pdfColors.border}`,
  },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTop: `1 solid ${pdfColors.gold}`,
    backgroundColor: pdfColors.cream,
  },
  cOrg: { width: "16%", fontWeight: 700 },
  cDetail: { width: "34%", paddingRight: 6 },
  cUSD: { width: "16%", textAlign: "right" },
  cCDF: { width: "18%", textAlign: "right" },
  cEch: { width: "16%", textAlign: "right" },
  headText: { fontSize: 8.5, fontWeight: 700, color: pdfColors.brownDark },
  detailText: { fontSize: 8, color: pdfColors.textMuted, lineHeight: 1.4 },
  statutText: { fontSize: 8, color: pdfColors.brown },
  echAValider: { fontSize: 7, color: pdfColors.brown, fontStyle: "italic" },
  note: { marginTop: 4, marginBottom: 20, fontSize: 8, color: pdfColors.textMuted, lineHeight: 1.5 },
  fait: { marginTop: 4, marginBottom: 12, fontSize: 8.5, fontStyle: "italic", color: pdfColors.textMuted },
  signatures: { marginTop: 30, flexDirection: "row", justifyContent: "flex-start" },
});

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export function BordereauDeclarationsDocument({
  lignes,
  mois,
  annee,
  tauxChange,
  entreprise = entrepriseDefaut,
  logo,
}: {
  lignes: LigneDeclaration[];
  mois: number;
  annee: number;
  tauxChange: number;
  entreprise?: typeof entrepriseDefaut;
  logo?: ImageSrc;
}) {
  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const totalUSD = lignes.reduce((s, l) => s + l.montantUSD, 0);
  const totalCDF = lignes.reduce((s, l) => s + l.montantCDF, 0);
  const docLabel = `${entreprise.enseigne.toUpperCase()} — ${entreprise.nom}  •  Bordereau de déclarations - ${annee}-${String(mois).padStart(2, "0")}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Bordereau de déclarations" subtitle={periode} logo={logo} />

        <Text style={styles.intro}>
          Récapitulatif des cotisations sociales et fiscales retenues sur la paie de la période
          ci-dessus, à déclarer et à verser aux organismes concernés. Montants convertis au taux
          de change utilisé pour la paie : 1 $ = {formatCDF(tauxChange)} CDF.
        </Text>

        <PdfSectionHeader>Détail par organisme</PdfSectionHeader>
        <View style={styles.table}>
          <View style={styles.headRow}>
            <Text style={[styles.cOrg, styles.headText]}>Organisme</Text>
            <Text style={[styles.cDetail, styles.headText]}>Nature</Text>
            <Text style={[styles.cUSD, styles.headText]}>Montant USD</Text>
            <Text style={[styles.cCDF, styles.headText]}>Montant CDF</Text>
            <Text style={[styles.cEch, styles.headText]}>Échéance</Text>
          </View>
          {lignes.map((l) => (
            <View style={styles.row} key={l.type} wrap={false}>
              <Text style={styles.cOrg}>{l.libelle}</Text>
              <View style={styles.cDetail}>
                <Text style={styles.detailText}>{l.detail}</Text>
                <Text style={styles.statutText}>Statut : {LIBELLE_STATUT[l.statut]}</Text>
              </View>
              <Text style={styles.cUSD}>{money(l.montantUSD)}</Text>
              <Text style={styles.cCDF}>{formatCDF(l.montantCDF)} CDF</Text>
              <View style={styles.cEch}>
                <Text>{new Date(l.echeance).toLocaleDateString("fr-FR")}</Text>
                {l.echeanceAValider && <Text style={styles.echAValider}>à valider</Text>}
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.cOrg}>TOTAL</Text>
            <Text style={styles.cDetail}></Text>
            <Text style={[styles.cUSD, { fontWeight: 700 }]}>{money(totalUSD)}</Text>
            <Text style={[styles.cCDF, { fontWeight: 700 }]}>{formatCDF(totalCDF)} CDF</Text>
            <Text style={styles.cEch}></Text>
          </View>
        </View>

        <Text style={styles.note}>
          Les échéances marquées « à valider » restent à confirmer par le comptable de
          l’entreprise. L’échéance CNSS est fixée au 15 du mois suivant la période de paie. Les taux
          appliqués (CNSS, IPR, INPP, ONEM) sont ceux enregistrés dans les paramètres légaux de
          l’exercice et doivent être validés par un comptable congolais avant tout usage officiel.
        </Text>

        <Text style={styles.fait}>Fait à Kinshasa, le {new Date().toLocaleDateString("fr-FR")}</Text>

        <View style={styles.signatures}>
          <PdfSignatureBox label="La Direction" signe={false} />
        </View>

        <PdfFooter docLabel={docLabel} ent={entreprise} />
      </Page>
    </Document>
  );
}
