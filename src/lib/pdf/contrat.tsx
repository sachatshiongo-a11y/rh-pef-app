import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { Employee, Contrat } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, signatureDirectriceDisponible, SIGNATURE_DIRECTRICE_PATH } from "./layout";
import { pdfColors, entreprise as entrepriseDefaut } from "./theme";
import { listeEnProse } from "@/lib/texte";

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10, fontFamily: "Optima", color: pdfColors.text, lineHeight: 1.55 },
  intro: { marginTop: 8, marginBottom: 6, textAlign: "justify" },
  partie: { marginBottom: 8, textAlign: "justify" },
  // Tableau « ENTRE LES PARTIES » (identification de l'employeur), façon modèle Word.
  tbl: { marginTop: 4, marginBottom: 6, borderTopWidth: 0.75, borderTopColor: "#DDD", borderBottomWidth: 0.75, borderBottomColor: "#DDD" },
  tblRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#EEE" },
  tblLabel: { width: "26%", backgroundColor: pdfColors.goldLight, paddingVertical: 3, paddingHorizontal: 6, fontWeight: 700, color: pdfColors.brownDark, fontSize: 9 },
  tblValue: { width: "74%", paddingVertical: 3, paddingHorizontal: 6, fontSize: 9.5 },
  gras: { fontWeight: 700, color: pdfColors.brownDark },
  artTitre: { marginTop: 10, marginBottom: 3, fontSize: 10.5, fontWeight: 700, color: pdfColors.brownDark },
  art: { marginBottom: 4, textAlign: "justify" },
  ph: { marginTop: 14, marginBottom: 4, fontWeight: 700, color: pdfColors.brownDark, fontSize: 9, letterSpacing: 0.6 },
  lieuDate: { marginTop: 18, textAlign: "right" },
  signatures: { marginTop: 20, flexDirection: "row", justifyContent: "space-between" },
  accepte: { marginTop: 4, fontSize: 8.5, color: pdfColors.text },
  colSign: { width: "45%", alignItems: "center" },
  signLine: { marginTop: 34, borderTopWidth: 0.8, borderTopColor: pdfColors.text, width: "100%", paddingTop: 3, textAlign: "center", fontSize: 9 },
  // Bloc signature aligné : espace fixe au-dessus, puis la ligne à la même hauteur des deux côtés.
  signSpace: { width: "100%", height: 56, justifyContent: "flex-end", alignItems: "center" },
  signImg: { width: 210, height: 56, objectFit: "contain", marginBottom: -2 },
  signLineBase: { borderTopWidth: 0.8, borderTopColor: pdfColors.text, width: "100%", paddingTop: 3, textAlign: "center", fontSize: 9 },
  luApprouve: { fontSize: 8.5, fontStyle: "italic", marginBottom: 2 },
});

const fr = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(/^1 /, "1er ") : "—";
const frDT = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + " à " + new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const TYPE_LABEL: Record<string, string> = {
  CDI: "à durée indéterminée (CDI)", CDD: "à durée déterminée (CDD)",
  STAGE: "de stage", JOURNALIER: "journalier", INTERIM: "d'intérim",
};

export type ParamsContrat = { preavisDemission: number | null; preavisLicenciement: number | null; droitsCongesAnnuel: number | null };

/**
 * Contrat de travail (PDF, modèle RDC) auto-rempli depuis la fiche + les termes du contrat.
 * ⚠️ Modèle générique — à FAIRE VALIDER par un juriste avant usage réel (comme les barèmes de paie).
 */
export function ContratDocument({ employee, contrat, params, accepteLe, fonctions, entreprise = entrepriseDefaut, logo, signature }: { employee: Employee; contrat: Contrat; params: ParamsContrat; accepteLe?: Date | null; fonctions?: string | null; entreprise?: typeof entrepriseDefaut; logo?: ImageSrc; signature?: ImageSrc | null }) {
  // Signature de la Direction : téléversée (paramètres) si fournie, sinon celle groupée dans le projet.
  const signatureSrc: ImageSrc | null = signature !== undefined ? signature : (signatureDirectriceDisponible() ? SIGNATURE_DIRECTRICE_PATH : null);
  const femme = (employee.sexe ?? "").toUpperCase().startsWith("F");
  const civilite = femme ? "Madame" : "Monsieur";
  const ne = femme ? "née" : "né";
  const cdd = contrat.type === "CDD";
  const heures = Number(contrat.heuresHebdo);
  const salaire = `${Number(contrat.salaireMensuel).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${contrat.devise}`;
  // Numérotation continue des articles (la période d'essai est facultative → un compteur évite tout décalage).
  let noArt = 0;
  const artNo = () => ++noArt;

  return (
    <Document title={`Contrat de travail — ${employee.nom}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Contrat de travail" subtitle={`${TYPE_LABEL[contrat.type] ?? contrat.type} — ${employee.nom}`} logo={logo} />

        <Text style={styles.intro}>
          Le présent contrat est conclu entre les soussignés, sous l&apos;empire de la législation du travail en vigueur en{" "}
          {entreprise.pays} (Code du travail) :
        </Text>

        <Text style={styles.ph}>ENTRE LES PARTIES</Text>
        <Text style={styles.partie}>
          <Text style={styles.gras}>{entreprise.nom}</Text>, exploitant l&apos;enseigne «&nbsp;{entreprise.enseigne}&nbsp;»,
          immatriculée au RCCM sous le numéro {entreprise.rccm}, Id. Nat. {entreprise.idNat}, N° Impôt {entreprise.numImpot},
          dont le siège est situé {entreprise.adresse}, ci-après dénommée «&nbsp;<Text style={styles.gras}>l&apos;Employeur</Text>&nbsp;»,
          d&apos;une part ;
        </Text>
        <Text style={styles.partie}>
          Et <Text style={styles.gras}>{civilite} {employee.nom}</Text>, {ne} et de nationalité {employee.type === "EXPATRIE" ? "étrangère" : "congolaise"},
          matricule {employee.matricule}{employee.telephone ? `, tél. ${employee.telephone}` : ""}{employee.adresse ? `, demeurant à ${employee.adresse}` : ""}, ci-après {femme ? "dénommée" : "dénommé"}{" "}
          «&nbsp;<Text style={styles.gras}>{femme ? "la Salariée" : "le Salarié"}</Text>&nbsp;», d&apos;autre part.
        </Text>

        <Text style={styles.ph}>IL A ÉTÉ CONVENU CE QUI SUIT</Text>

        <Text style={styles.artTitre}>Article {artNo()} — Engagement et fonctions</Text>
        <Text style={styles.art}>
          L&apos;Employeur engage {femme ? "la Salariée" : "le Salarié"}, qui accepte, en qualité de{" "}
          <Text style={styles.gras}>{contrat.poste || employee.poste}</Text>. {femme ? "Elle" : "Il"}{" "}exercera ses fonctions
          sous l&apos;autorité et selon les directives de l&apos;Employeur, et s&apos;engage à les accomplir avec diligence et loyauté.
        </Text>
        {fonctions?.trim() ? (
          <Text style={styles.art}>
            À ce titre, {femme ? "elle" : "il"} assure notamment les missions suivantes&nbsp;: {listeEnProse(fonctions)}
          </Text>
        ) : null}

        <Text style={styles.artTitre}>Article {artNo()} — Nature et durée du contrat</Text>
        <Text style={styles.art}>
          Le présent contrat est un contrat de travail <Text style={styles.gras}>{TYPE_LABEL[contrat.type] ?? contrat.type}</Text>.
          Il prend effet le <Text style={styles.gras}>{fr(contrat.dateDebut)}</Text>
          {cdd && contrat.dateFin ? <> et prend fin le <Text style={styles.gras}>{fr(contrat.dateFin)}</Text></> : contrat.type === "CDI" ? " pour une durée indéterminée" : ""}.
          {contrat.renouvellements > 0 ? ` Ce contrat a fait l'objet de ${contrat.renouvellements} renouvellement(s).` : ""}
        </Text>

        {contrat.finPeriodeEssai && (
          <>
            <Text style={styles.artTitre}>Article {artNo()} — Période d&apos;essai</Text>
            <Text style={styles.art}>
              Les parties conviennent d&apos;une période d&apos;essai courant jusqu&apos;au{" "}
              <Text style={styles.gras}>{fr(contrat.finPeriodeEssai)}</Text>, conformément à l&apos;article 43 de la loi
              n°&nbsp;15/2002 du 16 octobre 2002 portant Code du travail, durant laquelle chacune des parties peut mettre fin au
              contrat sans préavis ni indemnité.
            </Text>
          </>
        )}

        <Text style={styles.artTitre}>Article {artNo()} — Lieu et durée du travail</Text>
        <Text style={styles.art}>
          {femme ? "La Salariée" : "Le Salarié"}{" "}exercera principalement ses fonctions au restaurant «&nbsp;{entreprise.enseigne}&nbsp;»,
          {" "}sis {entreprise.lieuTravail}. La durée du travail est fixée à <Text style={styles.gras}>{heures.toLocaleString("fr-FR")} heures par semaine</Text>,
          répartie selon le planning établi par l&apos;Employeur.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Rémunération</Text>
        <Text style={styles.art}>
          En contrepartie de son travail, {femme ? "la Salariée" : "le Salarié"}{" "}percevra une rémunération mensuelle brute de{" "}
          <Text style={styles.gras}>{salaire}</Text>, payable à terme échu, sous déduction des cotisations et impôts légaux
          (CNSS, IPR). S&apos;y ajoutent, le cas échéant, les indemnités et primes prévues par la politique de l&apos;établissement
          (transport, allocations, heures supplémentaires) conformément à la réglementation.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Congés et sécurité sociale</Text>
        <Text style={styles.art}>
          Après douze (12) mois de service ininterrompu, {femme ? "la Salariée" : "le Salarié"}{" "}bénéficie de congés payés
          {params.droitsCongesAnnuel ? <> à hauteur de <Text style={styles.gras}>{params.droitsCongesAnnuel} jours ouvrables</Text></> : ""},
          acquis dans les conditions prévues par le Code du travail. {femme ? "Elle" : "Il"}{" "}est{" "}{femme ? "affiliée" : "affilié"}{" "}à la Caisse
          Nationale de Sécurité Sociale (CNSS) et bénéficie de la couverture correspondante.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Soins médicaux</Text>
        <Text style={styles.art}>
          L&apos;Employeur assure à {femme ? "la Salariée" : "le Salarié"} les soins médicaux et pharmaceutiques dans les limites
          et aux conditions fixées par les articles 177 à 184 de la loi n°&nbsp;15/2002 du 16 octobre 2002 portant Code du travail
          et ses textes d&apos;application. Les membres de la famille effectivement à charge et n&apos;exerçant pas d&apos;activité
          lucrative bénéficient des mêmes avantages.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Rupture et préavis</Text>
        <Text style={styles.art}>
          Le contrat peut être rompu par l&apos;une ou l&apos;autre des parties dans les conditions et formes prévues par le Code du
          travail, moyennant un préavis
          {params.preavisDemission || params.preavisLicenciement
            ? <> de <Text style={styles.gras}>{params.preavisDemission ?? "—"} jours en cas de démission</Text> et de <Text style={styles.gras}>{params.preavisLicenciement ?? "—"} jours en cas de licenciement</Text></>
            : " légal"}. En cas de faute lourde — notamment vol, fraude, malversation, divulgation d&apos;informations
          confidentielles, ou tout acte portant gravement atteinte à la réputation ou aux intérêts de l&apos;établissement — le
          contrat peut être rompu immédiatement, sans préavis ni indemnité, conformément au Code du travail.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Obligations et confidentialité</Text>
        <Text style={styles.art}>
          {femme ? "La Salariée" : "Le Salarié"}{" "}s&apos;engage à respecter le règlement intérieur, à consacrer, pendant les
          heures de service, son activité professionnelle à l&apos;Employeur, et à faire preuve d&apos;une discrétion absolue.
          {femme ? " Elle" : " Il"} s&apos;interdit de divulguer ou d&apos;utiliser à son profit ou au profit de tiers les
          informations confidentielles de l&apos;établissement, aussi bien pendant la durée du contrat que pendant une (1) année
          après sa cessation, quelle qu&apos;en soit la cause. Tout manquement constitue une faute lourde.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Aptitude médicale</Text>
        <Text style={styles.art}>
          L&apos;aptitude physique de {femme ? "la Salariée" : "le Salarié"} à l&apos;emploi est constatée conformément à
          l&apos;article 38 de la loi n°&nbsp;15/2002 du 16 octobre 2002 portant Code du travail, préalablement à sa prise de fonction.
        </Text>

        <Text style={styles.artTitre}>Article {artNo()} — Litiges et dispositions diverses</Text>
        <Text style={styles.art}>
          Pour tout ce qui n&apos;est pas expressément prévu au présent contrat, et en cas de litige, les parties se réfèrent aux
          dispositions de la loi n°&nbsp;15/2002 du 16 octobre 2002 portant Code du travail de la République Démocratique du Congo
          et à ses textes d&apos;application. Le présent contrat est établi en deux exemplaires originaux, chacune des parties
          reconnaissant en avoir reçu un.
        </Text>

        <Text style={styles.art}>
          {femme ? "La Salariée" : "Le Salarié"}{" "}reconnaît avoir reçu, au moins deux jours ouvrables avant la signature, un
          exemplaire du projet de contrat dont {femme ? "elle déclare" : "il déclare"}{" "}avoir pris parfaite connaissance. La
          signature est précédée de la mention manuscrite «&nbsp;Lu et approuvé&nbsp;».
        </Text>

        <Text style={styles.lieuDate}>Fait à Kinshasa, le {fr(new Date())}</Text>

        <View style={styles.signatures} wrap={false}>
          {/* Employeur : signature de la Direction dans un espace fixe, puis la ligne. */}
          <View style={styles.colSign}>
            <View style={styles.signSpace}>
              {signatureSrc && <Image src={signatureSrc as string} style={styles.signImg} />}
            </View>
            <Text style={styles.signLineBase}>L&apos;Employeur</Text>
          </View>
          {/* Salarié : « Lu et approuvé » dans le même espace fixe → lignes alignées. */}
          <View style={styles.colSign}>
            <View style={styles.signSpace}>
              <Text style={styles.luApprouve}>Lu et approuvé</Text>
            </View>
            <Text style={styles.signLineBase}>{femme ? "La Salariée" : "Le Salarié"} — {employee.nom}</Text>
            {accepteLe && <Text style={styles.accepte}>Accepté numériquement le {frDT(accepteLe)}</Text>}
          </View>
        </View>

        <PdfFooter docLabel={`Contrat de travail — ${employee.matricule}`} ent={entreprise} />
      </Page>
    </Document>
  );
}
