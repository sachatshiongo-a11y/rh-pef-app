import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Employee, Contrat } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSignatureBox, signatureDirectriceDisponible } from "./layout";
import { pdfColors, entreprise } from "./theme";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10, fontFamily: "Optima", color: pdfColors.text, lineHeight: 1.55 },
  intro: { marginTop: 8, marginBottom: 6, textAlign: "justify" },
  partie: { marginBottom: 8, textAlign: "justify" },
  gras: { fontWeight: 700, color: pdfColors.brownDark },
  artTitre: { marginTop: 10, marginBottom: 3, fontSize: 10.5, fontWeight: 700, color: pdfColors.brownDark },
  art: { marginBottom: 4, textAlign: "justify" },
  ph: { marginTop: 14, marginBottom: 4, fontWeight: 700, color: pdfColors.brownDark, fontSize: 9, letterSpacing: 0.6 },
  lieuDate: { marginTop: 18, textAlign: "right" },
  signatures: { marginTop: 20, flexDirection: "row", justifyContent: "space-between" },
  accepte: { marginTop: 4, fontSize: 8.5, color: pdfColors.text },
  colSign: { width: "45%", alignItems: "center" },
  signLine: { marginTop: 34, borderTopWidth: 0.8, borderTopColor: pdfColors.text, width: "100%", paddingTop: 3, textAlign: "center", fontSize: 9 },
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
export function ContratDocument({ employee, contrat, params, accepteLe }: { employee: Employee; contrat: Contrat; params: ParamsContrat; accepteLe?: Date | null }) {
  const femme = (employee.sexe ?? "").toUpperCase().startsWith("F");
  const civilite = femme ? "Madame" : "Monsieur";
  const ne = femme ? "née" : "né";
  const cdd = contrat.type === "CDD";
  const heures = Number(contrat.heuresHebdo);
  const salaire = `${Number(contrat.salaireMensuel).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${contrat.devise}`;

  return (
    <Document title={`Contrat de travail — ${employee.nom}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Contrat de travail" subtitle={`${TYPE_LABEL[contrat.type] ?? contrat.type} — ${employee.nom}`} />

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
          matricule {employee.matricule}{employee.telephone ? `, tél. ${employee.telephone}` : ""}, ci-après {femme ? "dénommée" : "dénommé"}{" "}
          «&nbsp;<Text style={styles.gras}>{femme ? "la Salariée" : "le Salarié"}</Text>&nbsp;», d&apos;autre part.
        </Text>

        <Text style={styles.ph}>IL A ÉTÉ CONVENU CE QUI SUIT</Text>

        <Text style={styles.artTitre}>Article 1 — Engagement et fonctions</Text>
        <Text style={styles.art}>
          L&apos;Employeur engage {femme ? "la Salariée" : "le Salarié"}, qui accepte, en qualité de{" "}
          <Text style={styles.gras}>{contrat.poste || employee.poste}</Text>. {femme ? "Elle" : "Il"} exercera ses fonctions
          sous l&apos;autorité et selon les directives de l&apos;Employeur, et s&apos;engage à les accomplir avec diligence et loyauté.
        </Text>

        <Text style={styles.artTitre}>Article 2 — Nature et durée du contrat</Text>
        <Text style={styles.art}>
          Le présent contrat est un contrat de travail <Text style={styles.gras}>{TYPE_LABEL[contrat.type] ?? contrat.type}</Text>.
          Il prend effet le <Text style={styles.gras}>{fr(contrat.dateDebut)}</Text>
          {cdd && contrat.dateFin ? <> et prend fin le <Text style={styles.gras}>{fr(contrat.dateFin)}</Text></> : contrat.type === "CDI" ? " pour une durée indéterminée" : ""}.
          {contrat.renouvellements > 0 ? ` Ce contrat a fait l'objet de ${contrat.renouvellements} renouvellement(s).` : ""}
        </Text>

        {contrat.finPeriodeEssai && (
          <>
            <Text style={styles.artTitre}>Article 3 — Période d&apos;essai</Text>
            <Text style={styles.art}>
              Les parties conviennent d&apos;une période d&apos;essai courant jusqu&apos;au{" "}
              <Text style={styles.gras}>{fr(contrat.finPeriodeEssai)}</Text>, durant laquelle chacune peut mettre fin au
              contrat dans les conditions prévues par la loi.
            </Text>
          </>
        )}

        <Text style={styles.artTitre}>Article {contrat.finPeriodeEssai ? 4 : 3} — Lieu et durée du travail</Text>
        <Text style={styles.art}>
          {femme ? "La Salariée" : "Le Salarié"} exercera principalement ses fonctions au siège de l&apos;établissement,
          {" "}{entreprise.adresse}. La durée du travail est fixée à <Text style={styles.gras}>{heures.toLocaleString("fr-FR")} heures par semaine</Text>,
          répartie selon le planning établi par l&apos;Employeur.
        </Text>

        <Text style={styles.artTitre}>Article {contrat.finPeriodeEssai ? 5 : 4} — Rémunération</Text>
        <Text style={styles.art}>
          En contrepartie de son travail, {femme ? "la Salariée" : "le Salarié"} percevra une rémunération mensuelle brute de{" "}
          <Text style={styles.gras}>{salaire}</Text>, payable à terme échu, sous déduction des cotisations et impôts légaux
          (CNSS, IPR). S&apos;y ajoutent, le cas échéant, les indemnités et primes prévues par la politique de l&apos;établissement
          (transport, allocations, heures supplémentaires) conformément à la réglementation.
        </Text>

        <Text style={styles.artTitre}>Article {contrat.finPeriodeEssai ? 6 : 5} — Congés et sécurité sociale</Text>
        <Text style={styles.art}>
          {femme ? "La Salariée" : "Le Salarié"} bénéficie des congés payés{params.droitsCongesAnnuel ? <> à hauteur de <Text style={styles.gras}>{params.droitsCongesAnnuel} jours ouvrables par an</Text></> : ""},
          acquis dans les conditions légales. {femme ? "Elle" : "Il"} est {femme ? "affiliée" : "affilié"} à la Caisse Nationale
          de Sécurité Sociale (CNSS) et bénéficie de la couverture correspondante.
        </Text>

        <Text style={styles.artTitre}>Article {contrat.finPeriodeEssai ? 7 : 6} — Rupture et préavis</Text>
        <Text style={styles.art}>
          Le contrat peut être rompu par l&apos;une ou l&apos;autre des parties dans les conditions et formes prévues par le Code du
          travail, moyennant un préavis
          {params.preavisDemission || params.preavisLicenciement
            ? <> de <Text style={styles.gras}>{params.preavisDemission ?? "—"} jours en cas de démission</Text> et de <Text style={styles.gras}>{params.preavisLicenciement ?? "—"} jours en cas de licenciement</Text></>
            : " légal"}, sauf faute lourde ou cas de rupture immédiate prévus par la loi.
        </Text>

        <Text style={styles.artTitre}>Article {contrat.finPeriodeEssai ? 8 : 7} — Obligations générales</Text>
        <Text style={styles.art}>
          {femme ? "La Salariée" : "Le Salarié"} s&apos;engage à respecter le règlement intérieur, à observer une stricte
          confidentialité sur les informations de l&apos;établissement, et à consacrer son activité professionnelle à
          l&apos;Employeur pendant la durée du contrat.
        </Text>

        <Text style={styles.artTitre}>Article {contrat.finPeriodeEssai ? 9 : 8} — Dispositions diverses</Text>
        <Text style={styles.art}>
          Pour tout ce qui n&apos;est pas expressément prévu au présent contrat, les parties se réfèrent aux dispositions du
          Code du travail de la République Démocratique du Congo et à ses textes d&apos;application. Le présent contrat est établi
          en deux exemplaires originaux, chacune des parties reconnaissant en avoir reçu un.
        </Text>

        <Text style={styles.lieuDate}>Fait à Kinshasa, le {fr(new Date())}</Text>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.colSign}>
            <PdfSignatureBox label="L'Employeur" signe={signatureDirectriceDisponible()} />
          </View>
          <View style={styles.colSign}>
            <Text style={styles.luApprouve}>Lu et approuvé</Text>
            {accepteLe ? (
              <Text style={styles.signLine}>
                {femme ? "La Salariée" : "Le Salarié"} — {employee.nom}{"\n"}
                <Text style={styles.accepte}>Accepté numériquement le {frDT(accepteLe)}</Text>
              </Text>
            ) : (
              <Text style={styles.signLine}>{femme ? "La Salariée" : "Le Salarié"} — {employee.nom}</Text>
            )}
          </View>
        </View>

        <PdfFooter docLabel={`Contrat de travail — ${employee.matricule}`} />
      </Page>
    </Document>
  );
}
