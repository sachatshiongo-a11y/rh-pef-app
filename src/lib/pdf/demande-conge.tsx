import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Employee, LeaveRequest } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader, PdfSignatureBox, type SignatureImprimable } from "./layout";
import { pdfColors } from "./theme";
import { dateDuSolde, joursDuSolde, libelleSolde, type SoldeImprime } from "@/lib/solde-conge-imprime";
import { dateRepriseConge } from "@/lib/reprise-conge";

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
    alignItems: "center",
  },
  soldeLabel: { fontSize: 9, color: pdfColors.brownDark },
  soldeDate: { fontSize: 8, color: pdfColors.textMuted, marginTop: 2 },
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
  remplacant,
  solde,
  signatureSalarie,
  feries = [],
}: {
  employee: Employee;
  demande: LeaveRequest;
  /** Jours fériés (AAAA-MM-JJ) : la reprise est le prochain jour ouvrable, ni dimanche ni férié. */
  feries?: string[];
  remplacant: Employee | null;
  /** Le solde à imprimer et sa date : figé à l'approbation, ou du jour d'édition (`lib/solde-conge-imprime.ts`). */
  solde: SoldeImprime;
  /** Tracé et mention de signature du salarié (`signatureImprimable`) ; absent = jamais signé. */
  signatureSalarie?: SignatureImprimable;
}) {
  const dateDebut = new Date(demande.dateDebut);
  const dateFin = new Date(demande.dateFin);
  const dateReprise = dateRepriseConge(dateFin, feries);
  const docLabel = `PÂTES EN FOLIE — TOLYA SARL  •  Demande de congé - ${employee.matricule}`;
  const estTranchee = demande.statut === "APPROUVE" || demande.statut === "REFUSE";
  // Mois de la demande (celui du début de congé), affiché en haut à droite comme sur le bulletin.
  const moisDemande = dateDebut.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const moisCapitalise = moisDemande.charAt(0).toUpperCase() + moisDemande.slice(1);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Demande de congé" subtitle={moisCapitalise} />

        <View style={styles.section}>
          <PdfSectionHeader>Salarié</PdfSectionHeader>
          <Ligne label="Matricule" value={employee.matricule} />
          <Ligne label="Nom et prénom" value={employee.nom} />
          <Ligne label="Poste" value={employee.poste} />
          <Ligne label="Secteur" value={employee.secteur} />
        </View>

        <View style={styles.soldeBox}>
          <View>
            <Text style={styles.soldeLabel}>{libelleSolde(solde)}</Text>
            <Text style={styles.soldeDate}>{dateDuSolde(solde)}</Text>
          </View>
          <Text style={styles.soldeValue}>{joursDuSolde(solde)}</Text>
        </View>

        <View style={styles.section}>
          <PdfSectionHeader>Détail de la demande</PdfSectionHeader>
          <Ligne label="Type de congé" value={demande.type} />
          <Ligne label="Date de début" value={dateDebut.toLocaleDateString("fr-FR", { timeZone: "UTC" })} />
          <Ligne label="Date de fin" value={dateFin.toLocaleDateString("fr-FR", { timeZone: "UTC" })} />
          <Ligne label="Date de reprise" value={dateReprise.toLocaleDateString("fr-FR", { timeZone: "UTC" })} />
          <Ligne
            label="Nb jours ouvrables"
            value={String(demande.nbJours)}
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
          {/* La décision est celle de LA DIRECTION, sans le nom de la personne qui a cliqué (décision 2026-10-09). */}
          <Ligne label="Décision" value={demande.statut === "APPROUVE" ? "Approuvé par la Direction" : demande.statut === "REFUSE" ? "Refusé par la Direction" : "En attente de décision"} />
          {demande.statut === "REFUSE" && <Ligne label="Motif du refus" value={demande.motifRefus ?? "—"} />}
        </View>

        <View style={styles.signatures}>
          {/* Même gabarit que la case de la direction (45 %) : le tracé et la mention se posent
              exactement comme sur le bulletin, et les deux traits restent alignés. */}
          <PdfSignatureBox
            label="Signature du salarié"
            signe={false}
            image={signatureSalarie?.image ?? undefined}
            mention={signatureSalarie?.mention}
          />
          <PdfSignatureBox label="Signature de la direction" signe={estTranchee} />
        </View>

        <PdfFooter docLabel={docLabel} />
      </Page>
    </Document>
  );
}
