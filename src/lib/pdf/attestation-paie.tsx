import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, signatureDirectriceDisponible, SIGNATURE_DIRECTRICE_PATH } from "./layout";
import { pdfColors, entreprise as entrepriseDefaut, formatCDF } from "./theme";

registerPdfFonts();

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10.5, fontFamily: "Optima", color: pdfColors.text, lineHeight: 1.6 },
  paragraphe: { marginBottom: 14, textAlign: "justify" },
  bloc: { marginTop: 10, marginBottom: 18 },
  gras: { fontWeight: 700, color: pdfColors.brownDark },
  recap: { marginTop: 4, marginBottom: 18, borderWidth: 0.75, borderColor: pdfColors.border, borderRadius: 4, padding: 10 },
  recapTitre: { fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  recapLigne: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  recapLabel: { color: pdfColors.textMuted, fontSize: 9.5 },
  recapValeur: { fontSize: 9.5, fontWeight: 700 },
  recapLigneNet: { flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 4, borderTopWidth: 0.75, borderTopColor: pdfColors.border },
  lieuDate: { marginTop: 4, textAlign: "right" },
  signatures: { marginTop: 26, flexDirection: "row", justifyContent: "flex-end" },
  signCol: { width: "45%", alignItems: "center" },
  signSpace: { width: "100%", height: 56, justifyContent: "flex-end", alignItems: "center" },
  signImg: { width: 210, height: 56, objectFit: "contain", marginBottom: -2 },
  signLine: { borderTopWidth: 0.8, borderTopColor: pdfColors.text, width: "100%", paddingTop: 3, textAlign: "center", fontSize: 9 },
  mention: { marginTop: 18, fontSize: 8, color: pdfColors.textMuted, textAlign: "justify" },
});

const fr = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }).replace(/^1 /, "1er ") : "—";

const moisAnnee = (mois: number, annee: number) =>
  new Date(Date.UTC(annee, mois - 1, 1)).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

const usd = (n: number) => `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const cdf = (n: number) => `${formatCDF(Number(n))} CDF`;

/**
 * Attestation de paie — atteste, pour UN MOIS donné, le salaire net réellement perçu par un
 * salarié, d'après la ligne de paie figée de ce mois (aucun recalcul). Réutilise le style de
 * l'attestation de travail/salaire (attestation.tsx) : en-tête, signature, mentions.
 *
 * Document à usage officiel (banque, administration…) : les montants engagent l'entreprise —
 * toute évolution de son libellé doit être validée avec un juriste avant diffusion large.
 */
export function AttestationPaieDocument({
  employee, ligne, run, entreprise = entrepriseDefaut, logo, signature,
}: {
  employee: Employee;
  ligne: PayrollLine;
  run: PayrollRun;
  entreprise?: typeof entrepriseDefaut;
  logo?: ImageSrc;
  signature?: ImageSrc | null;
}) {
  const femme = (employee.sexe ?? "").toUpperCase().startsWith("F");
  const civilite = femme ? "Madame" : "Monsieur";
  const interesse = femme ? "l'intéressée" : "l'intéressé";
  const periode = moisAnnee(run.mois, run.annee);
  const signatureSrc: ImageSrc | null = signature !== undefined ? signature : (signatureDirectriceDisponible() ? SIGNATURE_DIRECTRICE_PATH : null);

  const salNetUSD = Number(ligne.salNetUSD);
  const salNetCDF = Number(ligne.salNetCDF);
  const taux = Number(run.tauxChangeUtilise) || 1;
  const transportUSD = Number(ligne.transportUSD);
  // Le net perçu inclut le transport : on isole le net « salaire seul » pour l'afficher à côté du
  // transport, sans double compter (2026-07-22, demande client : « juste le net et le transport »).
  const salaireNetHorsTransportUSD = salNetUSD - transportUSD;
  const avecTransport = transportUSD > 0;

  return (
    <Document title={`Attestation de paie — ${employee.nom} — ${periode}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Attestation de paie" subtitle={`${employee.nom} — ${periode}`} logo={logo} />

        <View style={styles.bloc}>
          <Text style={styles.paragraphe}>
            Nous soussignés, <Text style={styles.gras}>{entreprise.nom}</Text> (enseigne «&nbsp;{entreprise.enseigne}&nbsp;»),
            immatriculée au RCCM sous le numéro {entreprise.rccm}, Id. Nat. {entreprise.idNat}, N° Impôt {entreprise.numImpot},
            dont le siège est situé {entreprise.adresse}, {entreprise.pays},
          </Text>

          <Text style={styles.paragraphe}>
            attestons que <Text style={styles.gras}>{civilite} {employee.nom}</Text>
            {employee.matricule ? <>, matricule <Text style={styles.gras}>{employee.matricule}</Text></> : null},
            {" "}en qualité de <Text style={styles.gras}>{employee.poste}</Text> au sein de notre établissement,
            a perçu, au titre du mois de <Text style={styles.gras}>{periode}</Text>, un salaire{" "}
            <Text style={styles.gras}>net</Text> de <Text style={styles.gras}>{usd(salaireNetHorsTransportUSD)}</Text>
            {avecTransport ? <>, ainsi qu&apos;une indemnité de transport de <Text style={styles.gras}>{usd(transportUSD)}</Text> (soit {cdf(transportUSD * taux)})</> : null},
            {avecTransport ? <>{" "}soit un montant net total de <Text style={styles.gras}>{usd(salNetUSD)}</Text> ({cdf(salNetCDF)}),</> : <>{" "}(soit {cdf(salNetCDF)}),</>}
            {" "}selon les éléments de paie arrêtés par l&apos;entreprise pour cette période.
          </Text>

          <View style={styles.recap}>
            <Text style={styles.recapTitre}>Détail perçu — {periode}</Text>
            <View style={styles.recapLigne}>
              <Text style={styles.recapLabel}>Salaire net (hors transport)</Text>
              <Text style={styles.recapValeur}>{usd(salaireNetHorsTransportUSD)}</Text>
            </View>
            {avecTransport && (
              <View style={styles.recapLigne}>
                <Text style={styles.recapLabel}>Frais de transport</Text>
                <Text style={styles.recapValeur}>{usd(transportUSD)} ({cdf(transportUSD * taux)})</Text>
              </View>
            )}
            <View style={styles.recapLigneNet}>
              <Text style={styles.recapLabel}>Total net perçu</Text>
              <Text style={styles.recapValeur}>{usd(salNetUSD)} ({cdf(salNetCDF)})</Text>
            </View>
          </View>

          <Text style={styles.paragraphe}>
            La présente attestation est délivrée à {interesse}, à sa demande, pour servir et valoir ce que de droit.
          </Text>

          <Text style={styles.mention}>
            Ce document reprend les éléments du bulletin de paie du mois de {periode} ; il ne s&apos;y
            substitue pas et ne saurait engager l&apos;entreprise au-delà des montants qui y figurent.
          </Text>
        </View>

        <Text style={styles.lieuDate}>Fait à Kinshasa, le {fr(new Date())}</Text>
        <View style={styles.signatures}>
          <View style={styles.signCol}>
            <View style={styles.signSpace}>{signatureSrc && <Image src={signatureSrc as string} style={styles.signImg} />}</View>
            <Text style={styles.signLine}>La Direction</Text>
          </View>
        </View>

        <PdfFooter docLabel="Attestation de paie" ent={entreprise} />
      </Page>
    </Document>
  );
}
