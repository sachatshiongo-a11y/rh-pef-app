import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { pdfColors, entreprise } from "./theme";

const logoPath = path.join(process.cwd(), "public/logo-pates-en-folie.png");
/** Logo TOLYA SARL (utilisé pour les documents contractuels ; les bulletins gardent le logo Pâtes en Folie). */
export const logoTolyaPath = path.join(process.cwd(), "public/logo-tolya.jpg");
const SIGNATURE_DIRECTRICE_PATH = path.join(
  process.cwd(),
  "public/signatures/signature-directrice.png"
);

/** La signature de la directrice n'est disponible que si le fichier a été déposé dans le projet. */
export function signatureDirectriceDisponible(): boolean {
  return fs.existsSync(SIGNATURE_DIRECTRICE_PATH);
}

const styles = StyleSheet.create({
  header: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: `1.5 solid ${pdfColors.gold}`,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  logo: { width: 170, height: 58, objectFit: "contain" },
  headerRight: { alignItems: "flex-end" },
  headerTitle: { fontSize: 14, fontWeight: 700, color: pdfColors.brown },
  headerRightLine: { fontSize: 8, color: pdfColors.textMuted },

  sectionHeader: {
    backgroundColor: pdfColors.goldLight,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 0,
  },
  sectionHeaderText: {
    fontSize: 9.5,
    fontWeight: 700,
    color: pdfColors.brownDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Bloc signature à HAUTEUR FIXE, ligne ancrée en bas (justifyContent flex-end). Ainsi les deux
  // lignes de signature sont toujours alignées horizontalement, que le côté soit signé ou non. La
  // signature de la directrice (agrandie) se place juste au-dessus de la ligne.
  signatureBox: { width: "45%", height: 60, justifyContent: "flex-end" },
  signatureImage: { width: 185, height: 52, objectFit: "contain", alignSelf: "flex-start", marginBottom: -5 },
  signatureLine: {
    borderTop: `0.75 solid ${pdfColors.text}`,
    paddingTop: 4,
    fontSize: 8,
    color: pdfColors.textMuted,
  },
  signatureLineSigned: {
    borderTop: `0.75 solid ${pdfColors.text}`,
    paddingTop: 4,
    fontSize: 8,
    color: pdfColors.textMuted,
  },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
  },
  footerDocLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  footerDocLabel: { fontSize: 6.5, color: pdfColors.textMuted },
  footerRule: { borderTop: `0.75 solid ${pdfColors.brownLight}`, marginBottom: 6 },
  footerRow: { flexDirection: "row", justifyContent: "space-between" },
  footerCol: { width: "47%" },
  footerDivider: { width: 1, backgroundColor: pdfColors.gold },
  footerLine: { fontSize: 7, color: pdfColors.textMuted, lineHeight: 1.5 },
});

export function PdfHeader({ title, subtitle, logo }: { title: string; subtitle?: string; logo?: string }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Image src={logo ?? logoPath} style={styles.logo} />
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle && <Text style={styles.headerRightLine}>{subtitle}</Text>}
        </View>
      </View>
    </View>
  );
}

/** Bandeau de section (fond or clair, texte brun) — inspiré des formulaires RH existants. */
export function PdfSectionHeader({ children }: { children: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{children}</Text>
    </View>
  );
}

/**
 * Bloc signature réutilisable. Si `signe` est vrai et que la signature de la directrice est
 * disponible (public/signatures/signature-directrice.png), elle est insérée automatiquement.
 */
export function PdfSignatureBox({ label, signe }: { label: string; signe: boolean }) {
  const aSignature = signe && signatureDirectriceDisponible();
  return (
    <View style={styles.signatureBox}>
      {aSignature && <Image src={SIGNATURE_DIRECTRICE_PATH} style={styles.signatureImage} />}
      <Text style={styles.signatureLine}>{label}</Text>
    </View>
  );
}

export function PdfFooter({ docLabel }: { docLabel?: string }) {
  return (
    <View style={styles.footer} fixed>
      {docLabel && (
        <View style={styles.footerDocLine}>
          <Text style={styles.footerDocLabel}>{docLabel}</Text>
          <Text
            style={styles.footerDocLabel}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} sur ${totalPages}`}
          />
        </View>
      )}
      <View style={styles.footerRule} />
      <View style={styles.footerRow}>
        <View style={styles.footerCol}>
          <Text style={styles.footerLine}>Téléphone : {entreprise.telephone}</Text>
          <Text style={styles.footerLine}>
            E-mail : {entreprise.email} - {entreprise.site}
          </Text>
          <Text style={styles.footerLine}>Adresse : {entreprise.adresse}</Text>
          <Text style={styles.footerLine}>{entreprise.pays}</Text>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerCol}>
          <Text style={styles.footerLine}>
            Numéro de compte Ecobank USD : {entreprise.compteEcobank}
          </Text>
          <Text style={styles.footerLine}>RCCM : {entreprise.rccm}</Text>
          <Text style={styles.footerLine}>Id. Nat. : {entreprise.idNat}</Text>
          <Text style={styles.footerLine}>N. Impôt : {entreprise.numImpot}</Text>
        </View>
      </View>
    </View>
  );
}
