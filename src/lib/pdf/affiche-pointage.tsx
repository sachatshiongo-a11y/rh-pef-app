import "server-only";
import QRCode from "qrcode";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { normaliserEspaces } from "@/lib/montant";
import type { ImagePdf } from "@/lib/entreprise";
import { renderPdfBuffer } from "./fonts";
import { pdfColors } from "./theme";

// L'AFFICHE DE POINTAGE (A4) : le logo des bulletins, « Pointage », le QR en grand, trois
// consignes. Elle est collée à l'entrée du restaurant et lue de loin, à bout de bras, parfois
// dans la pénombre : le QR fait 15 cm de côté (plancher : 12 cm), en correction d'erreur « M »
// (une affiche un peu salie ou pliée se lit encore). Le code de l'affiche n'apparaît QUE dans le
// QR, jamais en clair.

const CM = 72 / 2.54;
/** Côté du QR imprimé, en points PDF (15 cm). */
export const COTE_QR_PT = Math.round(15 * CM * 100) / 100;

const CONSIGNES = ["Ouvrez l'application", "Appuyez sur Pointer", "Visez ce code"];

const styles = StyleSheet.create({
  page: { fontFamily: "Optima", paddingVertical: 44, paddingHorizontal: 48, color: pdfColors.text, alignItems: "center" },
  logo: { width: 200, height: 70, objectFit: "contain" },
  filet: { width: 120, borderBottom: `1.5 solid ${pdfColors.gold}`, marginTop: 14, marginBottom: 12 },
  titre: { fontSize: 46, fontWeight: 700, color: pdfColors.brownDark, letterSpacing: 1 },
  qr: { width: COTE_QR_PT, height: COTE_QR_PT, marginTop: 14, marginBottom: 18 },
  consignes: { alignSelf: "center" },
  consigne: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  numero: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: pdfColors.goldLight,
    alignItems: "center", justifyContent: "center", marginRight: 14,
  },
  numeroTexte: { fontSize: 15, fontWeight: 700, color: pdfColors.brownDark },
  consigneTexte: { fontSize: 22, color: pdfColors.brownDark },
});

/** Le QR de l'affiche en PNG : un module = 16 pixels entiers (bords nets), marge de 4 modules. */
export function qrAffichePng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 4, scale: 16, color: { dark: "#000000", light: "#ffffff" } });
}

export function AffichePointageDocument({ qrPng, logo }: { qrPng: Buffer; logo: ImagePdf }) {
  return (
    <Document title="Affiche de pointage">
      <Page size="A4" style={styles.page}>
        <Image src={logo as string} style={styles.logo} />
        <View style={styles.filet} />
        <Text style={styles.titre}>{normaliserEspaces("Pointage")}</Text>
        <Image src={{ data: qrPng, format: "png" }} style={styles.qr} />
        <View style={styles.consignes}>
          {CONSIGNES.map((c, i) => (
            <View key={c} style={styles.consigne}>
              <View style={styles.numero}>
                <Text style={styles.numeroTexte}>{String(i + 1)}</Text>
              </View>
              <Text style={styles.consigneTexte}>{normaliserEspaces(c)}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

/** Le PDF de l'affiche pour une URL d'affiche (cf. `urlAffiche`) et le logo des bulletins. */
export async function genererAffichePdf(p: { url: string; logo: ImagePdf }): Promise<Buffer> {
  const qrPng = await qrAffichePng(p.url);
  return renderPdfBuffer(AffichePointageDocument({ qrPng, logo: p.logo }));
}
