import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { FichePoste } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader } from "./layout";
import { pdfColors, entreprise } from "./theme";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10, fontFamily: "Optima", color: pdfColors.text, lineHeight: 1.5 },
  ligne: { flexDirection: "row", marginBottom: 4 },
  label: { width: "38%", color: pdfColors.textMuted },
  valeur: { width: "62%", fontWeight: 700, color: pdfColors.brownDark },
  bloc: { marginTop: 6, marginBottom: 4 },
  blocTitre: { fontSize: 10, fontWeight: 700, color: pdfColors.brownDark, marginTop: 6, marginBottom: 2 },
  prose: { textAlign: "justify", marginBottom: 3 },
  puce: { flexDirection: "row", marginBottom: 1.5 },
  puceMarque: { width: 10 },
  puceTexte: { flex: 1, textAlign: "justify" },
  vide: { color: pdfColors.textMuted, fontStyle: "italic" },
  sectionEspace: { marginTop: 10 },
});

/** Découpe un texte multi-lignes en éléments de liste (une puce par ligne non vide). */
function Liste({ texte }: { texte: string | null | undefined }) {
  const lignes = (texte ?? "").split(/\r?\n/).map((l) => l.replace(/^[•\-–*]\s*/, "").trim()).filter(Boolean);
  if (lignes.length === 0) return <Text style={styles.vide}>—</Text>;
  if (lignes.length === 1) return <Text style={styles.prose}>{lignes[0]}</Text>;
  return (
    <>
      {lignes.map((l, i) => (
        <View key={i} style={styles.puce}>
          <Text style={styles.puceMarque}>•</Text>
          <Text style={styles.puceTexte}>{l}</Text>
        </View>
      ))}
    </>
  );
}

function Ligne({ label, valeur }: { label: string; valeur: string | null | undefined }) {
  return (
    <View style={styles.ligne}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.valeur}>{valeur?.trim() || "—"}</Text>
    </View>
  );
}

function BlocListe({ titre, texte }: { titre: string; texte: string | null | undefined }) {
  return (
    <View style={styles.bloc} wrap={false}>
      <Text style={styles.blocTitre}>{titre}</Text>
      <Liste texte={texte} />
    </View>
  );
}

/**
 * Fiche de poste (PDF, modèle PEF) auto-remplie depuis la fiche enregistrée.
 * La classe / catégorie professionnelle est déduite des salariés du poste (voir buffer).
 */
export function FichePosteDocument({ fiche, classe }: { fiche: FichePoste; classe: string | null }) {
  return (
    <Document title={`Fiche de poste — ${fiche.poste}`}>
      <Page size="A4" style={styles.page}>
        <PdfHeader title="Fiche de poste" subtitle={fiche.poste} />

        <PdfSectionHeader>Identification du poste</PdfSectionHeader>
        <View style={{ marginTop: 6 }}>
          <Ligne label="Intitulé du poste" valeur={fiche.poste} />
          <Ligne label="Type de contrat" valeur={fiche.typeContrat} />
          <Ligne label="Échelle salariale" valeur={fiche.echelleSalariale} />
          <Ligne label="Classe / Catégorie professionnelle" valeur={classe} />
          <Ligne label="Supérieur hiérarchique direct" valeur={fiche.superieurHierarchique} />
          <Ligne label="Lieu de travail" valeur={`${entreprise.enseigne}, ${entreprise.lieuTravail}`} />
          <Ligne label="Temps de travail" valeur={fiche.tempsTravail} />
        </View>

        <View style={styles.sectionEspace}>
          <PdfSectionHeader>Description du poste</PdfSectionHeader>
          {fiche.descriptionPoste?.trim() ? <Text style={[styles.prose, { marginTop: 6 }]}>{fiche.descriptionPoste.trim()}</Text> : null}
          <BlocListe titre="Missions principales du poste :" texte={fiche.description} />
        </View>

        <View style={styles.sectionEspace}>
          <PdfSectionHeader>Compétences requises pour le poste</PdfSectionHeader>
          <BlocListe titre="Compétences techniques :" texte={fiche.competencesTechniques} />
          <BlocListe titre="Savoir-être, soft skills :" texte={fiche.savoirEtre} />
          <BlocListe titre="Formations requises :" texte={fiche.formationsRequises} />
          <BlocListe titre="Diplômes requis :" texte={fiche.diplomesRequis} />
          <BlocListe titre="Expériences exigées :" texte={fiche.experiencesExigees} />
        </View>

        <PdfFooter docLabel={`Fiche de poste — ${fiche.poste}`} />
      </Page>
    </Document>
  );
}
