import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Employee } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader } from "./layout";
import { pdfColors } from "./theme";

registerPdfFonts();

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingHorizontal: 32,
    paddingBottom: 78,
    fontSize: 9,
    fontFamily: "Optima",
    color: pdfColors.text,
  },
  section: { marginBottom: 10, border: `0.75 solid ${pdfColors.border}` },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: "33.33%",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderTop: `0.5 solid ${pdfColors.border}`,
  },
  cellLabel: { fontSize: 6.5, color: pdfColors.textMuted, textTransform: "uppercase" },
  cellValue: { fontSize: 9.5, fontWeight: 500, marginTop: 1 },

  row: {
    flexDirection: "row",
    borderTop: `0.5 solid ${pdfColors.border}`,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  rowHead: { backgroundColor: pdfColors.cream },
  th: { fontSize: 7.5, fontWeight: 700, color: pdfColors.brownDark },
  td: { fontSize: 8.5 },
  empty: { padding: 8, fontSize: 8, fontStyle: "italic", color: pdfColors.textMuted },
});

type Ligne = { label: string; value: string };
type Conge = { type: string; debut: string; fin: string; jours: number; statut: string };
type Paie = { periode: string; netUSD: string; netCDF: string; statut: string };
type Contrat = { type: string; debut: string; fin: string; essai: string; statut: string };

function Grid({ items }: { items: Ligne[] }) {
  return (
    <View style={styles.grid}>
      {items.map((it, i) => (
        <View key={i} style={styles.cell}>
          <Text style={styles.cellLabel}>{it.label}</Text>
          <Text style={styles.cellValue}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function FicheEmployeDocument({
  employee,
  general,
  salaire,
  presences,
  periodePresences,
  soldes,
  conges,
  paies,
  contrats,
}: {
  employee: Employee;
  general: Ligne[];
  salaire: Ligne[];
  presences: Ligne[];
  periodePresences: string;
  soldes: Ligne[];
  conges: Conge[];
  paies: Paie[];
  contrats: Contrat[];
}) {
  const docLabel = `PÂTES EN FOLIE — TOLYA SARL  •  Fiche employé - ${employee.matricule}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Fiche employé" subtitle={`${employee.nom} — ${employee.matricule}`} />

        <View style={styles.section}>
          <PdfSectionHeader>Informations générales</PdfSectionHeader>
          <Grid items={general} />
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Détails salariaux</PdfSectionHeader>
          <Grid items={salaire} />
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Présences — {periodePresences}</PdfSectionHeader>
          <Grid items={presences} />
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Congés et absences</PdfSectionHeader>
          <Grid items={soldes} />
          <View style={[styles.row, styles.rowHead]}>
            <Text style={[styles.th, { width: "34%" }]}>Type</Text>
            <Text style={[styles.th, { width: "20%" }]}>Début</Text>
            <Text style={[styles.th, { width: "20%" }]}>Fin</Text>
            <Text style={[styles.th, { width: "12%" }]}>Jours</Text>
            <Text style={[styles.th, { width: "14%" }]}>Statut</Text>
          </View>
          {conges.length === 0 ? (
            <Text style={styles.empty}>Aucune demande de congé enregistrée.</Text>
          ) : (
            conges.map((c, i) => (
              <View key={i} style={styles.row}>
                <Text style={[styles.td, { width: "34%" }]}>{c.type}</Text>
                <Text style={[styles.td, { width: "20%" }]}>{c.debut}</Text>
                <Text style={[styles.td, { width: "20%" }]}>{c.fin}</Text>
                <Text style={[styles.td, { width: "12%" }]}>{c.jours}</Text>
                <Text style={[styles.td, { width: "14%" }]}>{c.statut}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Historique de paie</PdfSectionHeader>
          <View style={[styles.row, styles.rowHead]}>
            <Text style={[styles.th, { width: "34%" }]}>Période</Text>
            <Text style={[styles.th, { width: "24%" }]}>Net $</Text>
            <Text style={[styles.th, { width: "27%" }]}>Net CDF</Text>
            <Text style={[styles.th, { width: "15%" }]}>Paiement</Text>
          </View>
          {paies.length === 0 ? (
            <Text style={styles.empty}>Aucune paie calculée pour cet employé.</Text>
          ) : (
            paies.map((p, i) => (
              <View key={i} style={styles.row}>
                <Text style={[styles.td, { width: "34%" }]}>{p.periode}</Text>
                <Text style={[styles.td, { width: "24%" }]}>{p.netUSD}</Text>
                <Text style={[styles.td, { width: "27%" }]}>{p.netCDF}</Text>
                <Text style={[styles.td, { width: "15%" }]}>{p.statut}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Contrats</PdfSectionHeader>
          <View style={[styles.row, styles.rowHead]}>
            <Text style={[styles.th, { width: "22%" }]}>Type</Text>
            <Text style={[styles.th, { width: "22%" }]}>Début</Text>
            <Text style={[styles.th, { width: "22%" }]}>Fin</Text>
            <Text style={[styles.th, { width: "22%" }]}>Fin essai</Text>
            <Text style={[styles.th, { width: "12%" }]}>Statut</Text>
          </View>
          {contrats.length === 0 ? (
            <Text style={styles.empty}>Aucun contrat enregistré.</Text>
          ) : (
            contrats.map((c, i) => (
              <View key={i} style={styles.row}>
                <Text style={[styles.td, { width: "22%" }]}>{c.type}</Text>
                <Text style={[styles.td, { width: "22%" }]}>{c.debut}</Text>
                <Text style={[styles.td, { width: "22%" }]}>{c.fin}</Text>
                <Text style={[styles.td, { width: "22%" }]}>{c.essai}</Text>
                <Text style={[styles.td, { width: "12%" }]}>{c.statut}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={{ fontSize: 7, color: pdfColors.textMuted, marginTop: 2 }}>
          Fiche générée le {new Date().toLocaleDateString("fr-FR")}. Document interne confidentiel.
        </Text>

        <PdfFooter docLabel={docLabel} />
      </Page>
    </Document>
  );
}
