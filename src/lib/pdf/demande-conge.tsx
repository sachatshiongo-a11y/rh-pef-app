import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Employee, LeaveRequest, User } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader, PdfSignatureBox } from "./layout";
import { pdfColors } from "./theme";
import { calculerJoursOuvrables } from "@/lib/payroll";

registerPdfFonts();

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 90,
    fontSize: 9.5,
    fontFamily: "Optima",
    color: pdfColors.text,
  },
  section: { marginBottom: 14, border: `0.75 solid ${pdfColors.border}` },
  row: {
    flexDirection: "row",
    paddingVertical: 3.5,
    paddingHorizontal: 8,
    borderTop: `0.5 solid ${pdfColors.border}`,
  },
  label: { width: "45%", fontWeight: 700, color: pdfColors.brownDark },
  value: { flex: 1 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderTop: `0.5 solid ${pdfColors.border}`,
  },
  checkboxLabel: { width: "45%", color: pdfColors.textMuted },
  checkbox: {
    width: 16,
    height: 16,
    border: `1 solid ${pdfColors.brown}`,
    marginRight: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxMark: { fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, lineHeight: 1 },
  soldeBox: {
    marginTop: 6,
    marginBottom: 14,
    padding: 10,
    backgroundColor: pdfColors.goldLight,
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  soldeLabel: { fontSize: 9, color: pdfColors.brownDark },
  soldeValue: { fontSize: 12, fontWeight: 700, color: pdfColors.brownDark },
  statutBox: {
    margin: 8,
    marginTop: 4,
    padding: 12,
    borderRadius: 4,
    alignItems: "center",
  },
  statutBoxApprouve: { backgroundColor: "#DCEEDC" },
  statutBoxRefuse: { backgroundColor: "#F5DEDE" },
  statutBoxEnAttente: { backgroundColor: pdfColors.goldLight },
  statutValue: { fontSize: 16, fontWeight: 700, letterSpacing: 1 },
  statutValueApprouve: { color: "#276B27" },
  statutValueRefuse: { color: "#8C2E2E" },
  statutValueEnAttente: { color: pdfColors.brownDark },
  signatures: { marginTop: 30, flexDirection: "row", justifyContent: "space-between" },
  signatureLine: {
    borderTop: `0.75 solid ${pdfColors.text}`,
    marginTop: 48,
    paddingTop: 4,
    fontSize: 8,
    color: pdfColors.textMuted,
  },
});

const STATUT_LABEL: Record<string, string> = {
  EN_ATTENTE: "EN ATTENTE",
  APPROUVE: "APPROUVÉ",
  REFUSE: "REFUSÉ",
};

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function DemandeCongeDocument({
  employee,
  demande,
  approuvePar,
  remplacant,
  soldeConges,
}: {
  employee: Employee;
  demande: LeaveRequest;
  approuvePar: User | null;
  remplacant: Employee | null;
  soldeConges: number;
}) {
  const dateDebut = new Date(demande.dateDebut);
  const dateFin = new Date(demande.dateFin);
  const dateReprise = new Date(dateFin);
  dateReprise.setUTCDate(dateReprise.getUTCDate() + 1);
  const docLabel = `PÂTES EN FOLIE — TOLYA SARL  •  Demande de congé - ${employee.matricule}`;
  const estTranchee = demande.statut === "APPROUVE" || demande.statut === "REFUSE";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Demande de congé" />

        <View style={styles.section}>
          <PdfSectionHeader>Salarié</PdfSectionHeader>
          <Ligne label="Matricule" value={employee.matricule} />
          <Ligne label="Nom et prénom" value={employee.nom} />
          <Ligne label="Poste" value={employee.poste} />
          <Ligne label="Secteur" value={employee.secteur} />
        </View>

        <View style={styles.soldeBox}>
          <Text style={styles.soldeLabel}>Solde de congés disponible</Text>
          <Text style={styles.soldeValue}>{soldeConges} jours</Text>
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Détail de la demande</PdfSectionHeader>
          <Ligne label="Type de congé" value={demande.type} />
          <Ligne label="Date de début" value={dateDebut.toLocaleDateString("fr-FR")} />
          <Ligne label="Date de reprise" value={dateReprise.toLocaleDateString("fr-FR")} />
          <Ligne
            label="Nb jours ouvrables"
            value={String(calculerJoursOuvrables(dateDebut, dateFin))}
          />
          <Ligne
            label="Remplaçant(e)"
            value={remplacant ? `${remplacant.matricule} — ${remplacant.nom}` : "—"}
          />
          <Ligne label="Motif" value={demande.motif ?? "—"} />
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Décision de la direction</PdfSectionHeader>
          <View style={styles.checkboxRow}>
            <Text style={styles.checkboxLabel}>Autorisé</Text>
            <View style={styles.checkbox}>
              {demande.statut === "APPROUVE" && <Text style={styles.checkboxMark}>X</Text>}
            </View>
          </View>
          <View style={styles.checkboxRow}>
            <Text style={styles.checkboxLabel}>Refusé</Text>
            <View style={styles.checkbox}>
              {demande.statut === "REFUSE" && <Text style={styles.checkboxMark}>X</Text>}
            </View>
          </View>
          <View
            style={[
              styles.statutBox,
              demande.statut === "APPROUVE"
                ? styles.statutBoxApprouve
                : demande.statut === "REFUSE"
                  ? styles.statutBoxRefuse
                  : styles.statutBoxEnAttente,
            ]}
          >
            <Text
              style={[
                styles.statutValue,
                demande.statut === "APPROUVE"
                  ? styles.statutValueApprouve
                  : demande.statut === "REFUSE"
                    ? styles.statutValueRefuse
                    : styles.statutValueEnAttente,
              ]}
            >
              {STATUT_LABEL[demande.statut] ?? demande.statut}
            </Text>
          </View>
          <Ligne label="Traité par" value={approuvePar?.nom ?? "—"} />
        </View>

        <View style={styles.signatures}>
          <View style={{ width: "45%" }}>
            <Text style={styles.signatureLine}>Signature du salarié</Text>
          </View>
          <PdfSignatureBox label="Signature de la direction" signe={estTranchee} />
        </View>

        <PdfFooter docLabel={docLabel} />
      </Page>
    </Document>
  );
}
