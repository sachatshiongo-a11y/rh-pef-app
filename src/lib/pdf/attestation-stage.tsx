import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Employee, Contrat } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSignatureBox, signatureDirectriceDisponible } from "./layout";
import { pdfColors, entreprise } from "./theme";

registerPdfFonts();

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 40,
    paddingBottom: 90,
    fontSize: 10.5,
    fontFamily: "Optima",
    color: pdfColors.text,
    lineHeight: 1.6,
  },
  paragraphe: { marginBottom: 14, textAlign: "justify" },
  bloc: { marginTop: 10, marginBottom: 18 },
  gras: { fontWeight: 700, color: pdfColors.brownDark },
  lieuDate: { marginTop: 22, textAlign: "right" },
  signatures: { marginTop: 26, flexDirection: "row", justifyContent: "flex-end" },
});

const fr = (d: Date | string | null | undefined) =>
  d
    ? new Date(d)
        .toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
        .replace(/^1 /, "1er ")
    : "—";

/**
 * Attestation de fin de stage : lettre d'une page, générée depuis la fiche employé pour un
 * contrat STAGE. Texte volontairement sobre (« pour servir et valoir ce que de droit »).
 */
export function AttestationStageDocument({ employee, contrat }: { employee: Employee; contrat: Contrat }) {
  const femme = (employee.sexe ?? "").toUpperCase().startsWith("F");
  const civilite = femme ? "Madame" : "Monsieur";
  const interesse = femme ? "l'intéressée" : "l'intéressé";

  return (
    <Document title={`Attestation de fin de stage — ${employee.nom}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Attestation de fin de stage" subtitle={employee.nom} />

        <View style={styles.bloc}>
          <Text style={styles.paragraphe}>
            Nous soussignés, <Text style={styles.gras}>{entreprise.nom}</Text> (enseigne «{" "}
            {entreprise.enseigne} »), immatriculée au RCCM sous le numéro {entreprise.rccm},
            dont le siège est situé {entreprise.adresse}, {entreprise.pays},
          </Text>
          <Text style={styles.paragraphe}>
            attestons que <Text style={styles.gras}>{civilite} {employee.nom}</Text> a effectué un
            stage au sein de notre établissement{" "}
            <Text style={styles.gras}>
              du {fr(contrat.dateDebut)} {contrat.dateFin ? `au ${fr(contrat.dateFin)}` : "à ce jour"}
            </Text>
            , en qualité de <Text style={styles.gras}>{contrat.poste || employee.poste}</Text>.
          </Text>
          <Text style={styles.paragraphe}>
            Durant cette période, {interesse} a pris part aux activités du service avec assiduité
            et s&apos;est {femme ? "acquittée" : "acquitté"} des tâches qui lui ont été confiées.
          </Text>
          <Text style={styles.paragraphe}>
            La présente attestation est délivrée à {interesse} pour servir et valoir ce que de droit.
          </Text>
        </View>

        <Text style={styles.lieuDate}>Fait à Kinshasa, le {fr(new Date())}</Text>
        <View style={styles.signatures}>
          <PdfSignatureBox label="La Direction" signe={signatureDirectriceDisponible()} />
        </View>

        <PdfFooter docLabel="Attestation de fin de stage" />
      </Page>
    </Document>
  );
}
