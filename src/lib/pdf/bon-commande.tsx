import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { BonDeCommande, LigneBonDeCommande, Fournisseur, ParametresAchat } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader, PdfSignatureBox } from "./layout";
import { pdfColors } from "./theme";
import { delaiPaiementLabel } from "@/lib/stock";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 32, paddingBottom: 90, fontSize: 9, fontFamily: "Optima", color: pdfColors.text },
  parties: { flexDirection: "row", gap: 10, marginBottom: 14 },
  partie: { flex: 1, border: `0.75 solid ${pdfColors.border}` },
  pRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  pLabel: { width: "38%", color: pdfColors.brownDark, fontWeight: 700 },
  pValue: { flex: 1 },
  table: { marginBottom: 12, border: `0.75 solid ${pdfColors.border}` },
  th: { flexDirection: "row", backgroundColor: pdfColors.goldLight, paddingVertical: 4, paddingHorizontal: 6 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  cDes: { flex: 1 },
  cNum: { width: 60, textAlign: "right" },
  cCol: { fontWeight: 700, color: pdfColors.brownDark },
  totalBox: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 14 },
  totalInner: { width: 220, padding: 10, backgroundColor: pdfColors.goldLight, borderRadius: 4, flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 10, color: pdfColors.brownDark, fontWeight: 700 },
  totalValue: { fontSize: 12, fontWeight: 700, color: pdfColors.brownDark },
  meta: { flexDirection: "row", gap: 10, marginBottom: 20 },
  signatures: { marginTop: 20, flexDirection: "row", justifyContent: "space-between" },
  sigLine: { borderTop: `0.75 solid ${pdfColors.text}`, marginTop: 40, paddingTop: 4, fontSize: 8, color: pdfColors.textMuted },
});

const usd = (v: number) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

function PRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pRow}>
      <Text style={styles.pLabel}>{label}</Text>
      <Text style={styles.pValue}>{value}</Text>
    </View>
  );
}

export function BonCommandeDocument({
  bc,
  fournisseur,
  acheteur,
}: {
  bc: BonDeCommande & { lignes: LigneBonDeCommande[] };
  fournisseur: Fournisseur | null;
  acheteur: ParametresAchat | null;
}) {
  const date = new Date(bc.date).toLocaleDateString("fr-FR");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title={`BON DE COMMANDE N° ${bc.numero}`} subtitle={`Date : ${date}`} />

        <View style={styles.parties}>
          <View style={styles.partie}>
            <PdfSectionHeader>Fournisseur</PdfSectionHeader>
            <PRow label="Nom" value={fournisseur?.nom ?? "—"} />
            <PRow label="Ville" value={fournisseur?.ville ?? "—"} />
            <PRow label="Pays" value={fournisseur?.pays ?? "—"} />
            <PRow label="Téléphone" value={fournisseur?.telephone ?? "—"} />
            <PRow label="RCCM" value={fournisseur?.rccm ?? "—"} />
            <PRow label="Contact" value={fournisseur?.contactNom ?? "—"} />
          </View>
          <View style={styles.partie}>
            <PdfSectionHeader>Acheteur</PdfSectionHeader>
            <PRow label="Nom" value={acheteur?.acheteurNom ?? "TOLYA SARL"} />
            <PRow label="Ville" value={acheteur?.acheteurVille ?? "—"} />
            <PRow label="Adresse" value={acheteur?.acheteurAdresse ?? "—"} />
            <PRow label="Téléphone" value={acheteur?.acheteurTelephone ?? "—"} />
            <PRow label="RCCM" value={acheteur?.acheteurRccm ?? "—"} />
            <PRow label="ID National" value={acheteur?.acheteurIdNational ?? "—"} />
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.cDes, styles.cCol]}>Désignation</Text>
            <Text style={[styles.cNum, styles.cCol]}>Quantité</Text>
            <Text style={[styles.cNum, styles.cCol]}>Cartons</Text>
            <Text style={[styles.cNum, styles.cCol]}>P.U. (USD)</Text>
            <Text style={[styles.cNum, styles.cCol]}>Total (USD)</Text>
          </View>
          {bc.lignes.map((l) => (
            <View key={l.id} style={styles.tr}>
              <Text style={styles.cDes}>{l.designation}</Text>
              <Text style={styles.cNum}>{Number(l.quantite).toLocaleString("fr-FR", { maximumFractionDigits: 3 })}</Text>
              <Text style={styles.cNum}>{l.nbCartons ? Number(l.nbCartons).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—"}</Text>
              <Text style={styles.cNum}>{usd(Number(l.prixUnitaireUSD))}</Text>
              <Text style={styles.cNum}>{usd(Number(l.totalLigneUSD))}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalBox}>
          <View style={styles.totalInner}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{usd(Number(bc.totalUSD))}</Text>
          </View>
        </View>

        <View style={styles.meta}>
          <View style={styles.partie}>
            <PdfSectionHeader>Conditions</PdfSectionHeader>
            <PRow label="Délai de paiement" value={delaiPaiementLabel(bc.delaiPaiement)} />
            <PRow label="Délai de livraison" value={fournisseur?.delaiLivraison ?? "—"} />
            <PRow label="Mode de paiement" value={bc.modePaiement ?? "—"} />
            {bc.commentaire ? <PRow label="Note" value={bc.commentaire} /> : null}
          </View>
        </View>

        <View style={styles.signatures}>
          <View style={{ width: "45%" }}>
            <Text style={styles.sigLine}>Signature du fournisseur</Text>
          </View>
          <PdfSignatureBox label="Signature de la direction" signe={bc.statut !== "BROUILLON"} />
        </View>

        <PdfFooter docLabel={`PÂTES EN FOLIE — TOLYA SARL  •  Bon de commande ${bc.numero}`} />
      </Page>
    </Document>
  );
}
