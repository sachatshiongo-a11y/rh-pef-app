import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, signatureDirectriceDisponible, SIGNATURE_DIRECTRICE_PATH } from "./layout";
import { pdfColors, entreprise as entrepriseDefaut } from "./theme";
import { formaterNombre, normaliserEspaces } from "@/lib/montant";
import { MOIS_FR } from "@/lib/dates-fr";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";
import { LIBELLE_TYPE_ATTESTATION, type DonneesAttestation } from "@/lib/attestations-donnees";

registerPdfFonts();

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10.5, fontFamily: "Optima", color: pdfColors.text, lineHeight: 1.6 },
  numero: { textAlign: "right", fontSize: 9.5, color: pdfColors.textMuted, marginBottom: 4 },
  paragraphe: { marginBottom: 14, textAlign: "justify" },
  bloc: { marginTop: 10, marginBottom: 18 },
  gras: { fontWeight: 700, color: pdfColors.brownDark },
  lieuDate: { marginTop: 22, textAlign: "right" },
  mention: { marginTop: 4, textAlign: "right", fontSize: 9, color: pdfColors.textMuted },
  apercuBandeau: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#B42318", borderWidth: 1, borderColor: "#B42318", padding: 4, marginBottom: 6 },
  filigrane: { position: "absolute", top: 380, left: 60, fontSize: 64, fontWeight: 700, color: "#B42318", opacity: 0.12, transform: "rotate(-30deg)" },
  signatures: { marginTop: 26, flexDirection: "row", justifyContent: "flex-end" },
  signCol: { width: "45%", alignItems: "center" },
  signSpace: { width: "100%", height: 56, justifyContent: "flex-end", alignItems: "center" },
  signImg: { width: 210, height: 56, objectFit: "contain", marginBottom: -2 },
  signLine: { borderTopWidth: 0.8, borderTopColor: pdfColors.text, width: "100%", paddingTop: 3, textAlign: "center", fontSize: 9 },
});

/** « 2 mai 2023 », « 1er juillet 2026 » depuis une date PURE `AAAA-MM-JJ` — sans Intl (aucune espace fine). */
export function dateLongue(iso: string): string {
  const [a, m, j] = iso.split("-").map(Number);
  return `${j === 1 ? "1er" : j} ${MOIS_FR[m - 1]} ${a}`;
}

/** Jour de délivrance, à Kinshasa. */
export function jourDelivrance(d: Date): string {
  return dateLongue(jourCivilKinshasa(d).toISOString().slice(0, 10));
}

const usd = (v: string | number) => `${formaterNombre(Number(v), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const cdf = (v: number) => `${formaterNombre(Math.round(v), { maximumFractionDigits: 0 })} CDF`;

/** Le corps d'une attestation de STAGE — le texte du modèle d'attestation de fin de stage. */
function CorpsStage({ d, civilite, interesse, femme }: { d: DonneesAttestation; civilite: string; interesse: string; femme: boolean }) {
  const stage = d.stage!;
  return (
    <>
      <Text style={styles.paragraphe}>
        attestons que <Text style={styles.gras}>{civilite} {d.nom}</Text> a effectué un stage au sein de notre établissement{" "}
        <Text style={styles.gras}>du {dateLongue(stage.debut)} {stage.fin ? `au ${dateLongue(stage.fin)}` : "à ce jour"}</Text>
        , en qualité de <Text style={styles.gras}>{d.poste}</Text>.
      </Text>
      <Text style={styles.paragraphe}>
        Durant cette période, {interesse} a pris part aux activités du service avec assiduité et s&apos;est{" "}
        {femme ? "acquittée" : "acquitté"} des tâches qui lui ont été confiées.
      </Text>
    </>
  );
}

/**
 * Attestation de travail, de salaire ou de stage — rendue depuis l'INSTANTANÉ figé à la délivrance
 * (`Attestation.donnees`), jamais depuis la fiche du jour. Porte son numéro, « délivrée le … » et
 * la signature de la Direction (signature scannée des Paramètres).
 *
 * Tous les nombres passent par `formaterNombre`, les dates par `dateLongue` : aucun caractère absent
 * d'Optima (U+202F, « ⚠ »…) ne peut y entrer.
 */
export function AttestationDocument({
  donnees: d, numero, delivreeLe, entreprise = entrepriseDefaut, logo, signature, apercu = false,
}: {
  donnees: DonneesAttestation;
  numero: string;
  delivreeLe: Date;
  /**
   * APERÇU avant délivrance : ni numéro, ni signature de la Direction, un bandeau et un filigrane
   * « APERÇU — non valable ». Un aperçu imprimé ou transmis ne doit jamais pouvoir passer pour
   * une attestation délivrée.
   */
  apercu?: boolean;
  entreprise?: typeof entrepriseDefaut;
  logo?: ImageSrc;
  signature?: ImageSrc | null;
}) {
  const femme = (d.sexe ?? "").toUpperCase().startsWith("F");
  const civilite = femme ? "Madame" : "Monsieur";
  const interesse = femme ? "l'intéressée" : "l'intéressé";
  const employe = femme ? "employée" : "employé";
  const titre = LIBELLE_TYPE_ATTESTATION[d.type];
  const signatureSrc: ImageSrc | null = apercu
    ? null
    : signature !== undefined ? signature : (signatureDirectriceDisponible() ? SIGNATURE_DIRECTRICE_PATH : null);
  const s = d.salaire;
  const taux = s ? Number(s.tauxChange) : 0;
  const periode = s ? `${MOIS_FR[s.mois - 1]} ${s.annee}` : "";
  const delivree = jourDelivrance(delivreeLe);

  return (
    <Document title={normaliserEspaces(apercu ? `${titre} (aperçu) — ${d.nom}` : `${titre} ${numero} — ${d.nom}`)}>
      <Page size="A4" style={styles.page}>
        {apercu && <Text style={styles.filigrane} fixed>APERÇU — non valable</Text>}
        <PdfHeader title={titre} subtitle={d.nom} logo={logo} />
        {apercu ? (
          <Text style={styles.apercuBandeau}>APERÇU — non valable : ni numérotée ni signée, cette attestation n&apos;est pas délivrée.</Text>
        ) : (
          <Text style={styles.numero}>N° {numero}</Text>
        )}

        <View style={styles.bloc}>
          <Text style={styles.paragraphe}>
            Nous soussignés, <Text style={styles.gras}>{entreprise.nom}</Text> (enseigne «&nbsp;{entreprise.enseigne}&nbsp;»),
            immatriculée au RCCM sous le numéro {entreprise.rccm}, Id. Nat. {entreprise.idNat}, N° Impôt {entreprise.numImpot},
            dont le siège est situé {entreprise.adresse}, {entreprise.pays},
          </Text>

          {d.type === "STAGE" ? (
            <CorpsStage d={d} civilite={civilite} interesse={interesse} femme={femme} />
          ) : (
            <Text style={styles.paragraphe}>
              attestons que <Text style={styles.gras}>{civilite} {d.nom}</Text>, matricule <Text style={styles.gras}>{d.matricule}</Text>,{" "}
              {d.enPoste ? (
                <>
                  est {employe} au sein de notre établissement depuis le <Text style={styles.gras}>{dateLongue(d.dateEmbauche)}</Text>, en qualité de{" "}
                  <Text style={styles.gras}>{d.poste}</Text> ({d.typeContrat}), et est toujours en fonction à ce jour.
                </>
              ) : (
                <>
                  a été {employe} au sein de notre établissement du <Text style={styles.gras}>{dateLongue(d.dateEmbauche)}</Text> jusqu&apos;au{" "}
                  <Text style={styles.gras}>{dateLongue(d.dateSortie!)}</Text>, en qualité de <Text style={styles.gras}>{d.poste}</Text> ({d.typeContrat}).
                </>
              )}
            </Text>
          )}

          {d.type === "SALAIRE" && s && (
            <>
              <Text style={styles.paragraphe}>
                {femme ? "Elle" : "Il"} perçoit un salaire mensuel net de <Text style={styles.gras}>{usd(s.netUSD)}</Text> (soit{" "}
                {cdf(Number(s.netUSD) * taux)}), pour un salaire brut hors transport de <Text style={styles.gras}>{usd(s.brutUSD)}</Text>{" "}
                (soit {cdf(Number(s.brutUSD) * taux)}), au titre de la paie du mois de <Text style={styles.gras}>{periode}</Text>{" "}
                arrêtée par l&apos;entreprise. Le salaire net s&apos;entend hors transport et frais médicaux remboursés, avant acompte et
                retenue de prêt ; le brut hors transport est l&apos;assiette des cotisations et de l&apos;impôt ; l&apos;équivalent en francs
                congolais est calculé au taux du bulletin ({formaterNombre(taux, { maximumFractionDigits: 2 })} CDF pour 1 $).
              </Text>
              {Number(s.allocationsUSD) > 0 && (
                <Text style={styles.paragraphe}>
                  Ce salaire net comprend des allocations familiales de <Text style={styles.gras}>{usd(s.allocationsUSD)}</Text> (soit{" "}
                  {cdf(Number(s.allocationsUSD) * taux)}).
                </Text>
              )}
            </>
          )}

          <Text style={styles.paragraphe}>
            La présente attestation est délivrée à {interesse}{d.aSaDemande ? ", à sa demande," : ""} pour servir et valoir ce que de droit.
          </Text>
        </View>

        <Text style={styles.lieuDate}>Fait à Kinshasa, le {delivree}</Text>
        {!apercu && <Text style={styles.mention}>Attestation n° {numero}, délivrée le {delivree}.</Text>}
        <View style={styles.signatures}>
          <View style={styles.signCol}>
            <View style={styles.signSpace}>{signatureSrc && <Image src={signatureSrc as string} style={styles.signImg} />}</View>
            <Text style={styles.signLine}>La Direction</Text>
          </View>
        </View>

        <PdfFooter docLabel={apercu ? `${titre} (aperçu, non valable)` : `${titre} n° ${numero}`} ent={entreprise} />
      </Page>
    </Document>
  );
}
