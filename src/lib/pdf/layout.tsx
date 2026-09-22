import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { pdfColors, entreprise } from "./theme";

const logoPath = path.join(process.cwd(), "public/logo-pates-en-folie.png");
/** Logo TOLYA SARL (utilisé pour les documents contractuels ; les bulletins gardent le logo Pâtes en Folie). */
export const logoTolyaPath = path.join(process.cwd(), "public/logo-tolya.jpg");
export const SIGNATURE_DIRECTRICE_PATH = path.join(
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
  // Variante « grande » (contrat) : boîte pleine largeur, signature plus grande et centrée.
  signatureBoxLarge: { width: "100%", height: 86, justifyContent: "flex-end" },
  signatureImageLarge: { width: 230, height: 78, objectFit: "contain", alignSelf: "center", marginBottom: -3 },
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
  // Mention de signature : posée SOUS le trait, HORS DU FLUX (position absolue ancrée au bas de la
  // case). En flux, elle aurait poussé le trait du salarié vers le haut et les deux traits de
  // signature ne se seraient plus fait face — l'alignement que la hauteur fixe ci-dessus existe
  // précisément pour garantir. Hors du flux, la case garde sa hauteur, la mention déborde sous
  // elle (le bloc de signatures est le dernier de la page, il y a la marge de pied pour ça) et
  // une case NON signée ne paie aucun espace réservé.
  signatureMention: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 2,
    fontSize: 5.8,
    color: pdfColors.textMuted,
    lineHeight: 1.25,
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

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

/**
 * Ce qu'un document imprime du geste de signature du SALARIÉ : le tracé (absent si le document a
 * été modifié depuis — voir `chargerSignature`) et la phrase qui dit qui a signé, quand, et dans
 * quelles conditions. Construit par `signatureImprimable` (`@/lib/signature`) ; `undefined` quand
 * le document n'a jamais été signé.
 */
export type SignatureImprimable = {
  image: { data: Buffer; format: "png" } | null;
  mention: string;
};

export function PdfHeader({ title, subtitle, logo }: { title: string; subtitle?: string; logo?: ImageSrc }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Image src={(logo ?? logoPath) as string} style={styles.logo} />
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
 *
 * `image` est le tracé du SALARIÉ : il prend la place de la signature de la directrice dans la
 * case, et l'appelant ne doit le fournir que si la signature est à jour — un tracé posé sur des
 * montants qui ont bougé depuis ferait croire que le salarié a approuvé ce qu'il n'a jamais vu.
 * `mention` dit le reste : qui, quand, et dans quelles conditions.
 */
export function PdfSignatureBox({
  label,
  signe,
  large = false,
  image,
  mention,
}: {
  label: string;
  signe: boolean;
  large?: boolean;
  /** Tracé du salarié (PNG). La signature de la DIRECTRICE reste pilotée par `signe`. */
  image?: ImageSrc;
  /** Ligne sous le trait : qui a signé, quand, et dans quelles conditions. */
  mention?: string;
}) {
  const aSignature = signe && signatureDirectriceDisponible();
  const styleImage = large ? styles.signatureImageLarge : styles.signatureImage;
  return (
    <View style={large ? styles.signatureBoxLarge : styles.signatureBox}>
      {image ? (
        <Image src={image as string} style={styleImage} />
      ) : (
        aSignature && <Image src={SIGNATURE_DIRECTRICE_PATH} style={styleImage} />
      )}
      <Text style={styles.signatureLine}>{label}</Text>
      {mention && <Text style={styles.signatureMention}>{mention}</Text>}
    </View>
  );
}

export function PdfFooter({ docLabel, ent = entreprise }: { docLabel?: string; ent?: typeof entreprise }) {
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
          <Text style={styles.footerLine}>Téléphone : {ent.telephone}</Text>
          <Text style={styles.footerLine}>
            E-mail : {ent.email} - {ent.site}
          </Text>
          <Text style={styles.footerLine}>Adresse : {ent.adresse}</Text>
          <Text style={styles.footerLine}>{ent.pays}</Text>
        </View>
        <View style={styles.footerDivider} />
        <View style={styles.footerCol}>
          <Text style={styles.footerLine}>
            Numéro de compte Ecobank USD : {ent.compteEcobank}
          </Text>
          <Text style={styles.footerLine}>RCCM : {ent.rccm}</Text>
          <Text style={styles.footerLine}>Id. Nat. : {ent.idNat}</Text>
          <Text style={styles.footerLine}>N. Impôt : {ent.numImpot}</Text>
        </View>
      </View>
    </View>
  );
}
