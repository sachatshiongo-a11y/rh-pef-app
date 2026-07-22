import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Employee, Contrat } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, signatureDirectriceDisponible, SIGNATURE_DIRECTRICE_PATH } from "./layout";
import { pdfColors, entreprise as entrepriseDefaut } from "./theme";

registerPdfFonts();

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };
export type TypeAttestation = "travail" | "salaire";

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10.5, fontFamily: "Optima", color: pdfColors.text, lineHeight: 1.6 },
  paragraphe: { marginBottom: 14, textAlign: "justify" },
  bloc: { marginTop: 10, marginBottom: 18 },
  gras: { fontWeight: 700, color: pdfColors.brownDark },
  lieuDate: { marginTop: 22, textAlign: "right" },
  signatures: { marginTop: 26, flexDirection: "row", justifyContent: "flex-end" },
  signCol: { width: "45%", alignItems: "center" },
  signSpace: { width: "100%", height: 56, justifyContent: "flex-end", alignItems: "center" },
  signImg: { width: 210, height: 56, objectFit: "contain", marginBottom: -2 },
  signLine: { borderTopWidth: 0.8, borderTopColor: pdfColors.text, width: "100%", paddingTop: 3, textAlign: "center", fontSize: 9 },
});

const fr = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }).replace(/^1 /, "1er ") : "—";

const TITRE: Record<TypeAttestation, string> = { travail: "Attestation de travail", salaire: "Attestation de salaire" };

/**
 * Attestation de travail ou de salaire — lettre d'une page générée depuis la fiche employé et son
 * contrat courant. L'identité, le logo et la signature proviennent des Paramètres (ou des défauts).
 */
export function AttestationDocument({
  employee, contrat, type, salaireEstNet, entreprise = entrepriseDefaut, logo, signature,
}: {
  employee: Employee; contrat: Contrat; type: TypeAttestation; salaireEstNet: boolean;
  entreprise?: typeof entrepriseDefaut; logo?: ImageSrc; signature?: ImageSrc | null;
}) {
  const femme = (employee.sexe ?? "").toUpperCase().startsWith("F");
  const civilite = femme ? "Madame" : "Monsieur";
  const interesse = femme ? "l'intéressée" : "l'intéressé";
  const enPoste = employee.actif && contrat.statut === "ACTIF";
  const salaire = `${Number(contrat.salaireMensuel).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${contrat.devise}`;
  const signatureSrc: ImageSrc | null = signature !== undefined ? signature : (signatureDirectriceDisponible() ? SIGNATURE_DIRECTRICE_PATH : null);

  return (
    <Document title={`${TITRE[type]} — ${employee.nom}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title={TITRE[type]} subtitle={employee.nom} logo={logo} />

        <View style={styles.bloc}>
          <Text style={styles.paragraphe}>
            Nous soussignés, <Text style={styles.gras}>{entreprise.nom}</Text> (enseigne «&nbsp;{entreprise.enseigne}&nbsp;»),
            immatriculée au RCCM sous le numéro {entreprise.rccm}, Id. Nat. {entreprise.idNat}, N° Impôt {entreprise.numImpot},
            dont le siège est situé {entreprise.adresse}, {entreprise.pays},
          </Text>

          <Text style={styles.paragraphe}>
            attestons que <Text style={styles.gras}>{civilite} {employee.nom}</Text>
            {employee.matricule ? <>, matricule <Text style={styles.gras}>{employee.matricule}</Text></> : null},{" "}
            {enPoste
              ? <>est {femme ? "employée" : "employé"} au sein de notre établissement depuis le <Text style={styles.gras}>{fr(contrat.dateDebut)}</Text></>
              : <>a été {femme ? "employée" : "employé"} au sein de notre établissement du <Text style={styles.gras}>{fr(contrat.dateDebut)}</Text> au <Text style={styles.gras}>{fr(contrat.dateFin)}</Text></>}
            , en qualité de <Text style={styles.gras}>{contrat.poste || employee.poste}</Text>.
          </Text>

          {type === "salaire" && (
            <Text style={styles.paragraphe}>
              {femme ? "Elle" : "Il"}{" "}perçoit à ce titre une rémunération mensuelle {salaireEstNet ? "nette" : "brute"} de <Text style={styles.gras}>{salaire}</Text>,
              {salaireEstNet ? " après" : " sous"} déduction des cotisations et impôts légaux (CNSS, IPR).
            </Text>
          )}

          <Text style={styles.paragraphe}>
            La présente attestation est délivrée à {interesse}, à sa demande, pour servir et valoir ce que de droit.
          </Text>
        </View>

        <Text style={styles.lieuDate}>Fait à Kinshasa, le {fr(new Date())}</Text>
        <View style={styles.signatures}>
          <View style={styles.signCol}>
            <View style={styles.signSpace}>{signatureSrc && <Image src={signatureSrc as string} style={styles.signImg} />}</View>
            <Text style={styles.signLine}>La Direction</Text>
          </View>
        </View>

        <PdfFooter docLabel={TITRE[type]} ent={entreprise} />
      </Page>
    </Document>
  );
}
