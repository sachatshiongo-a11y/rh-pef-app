import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { FichePoste } from "@prisma/client";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pdfColors, entreprise as entrepriseDefaut } from "./theme";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

type ImageSrc = string | { data: Buffer; format: "png" | "jpg" };

registerPdfFonts();

/**
 * Mention COMMUNE à toutes les fiches (texte fixe du modèle Word, reproduit à l'identique), placée
 * sous les « Risques et contraintes du poste ».
 */
export const MENTION_NON_EXHAUSTIVE =
  "La fiche de poste ne décrit pas les activités de façon exhaustive. L’agent peut être amené à réaliser d’autres activités selon les besoins du service.";

// Mise en forme du modèle Word « PEF_FICHE_DE_POSTE_* » : titre centré, bandeaux de section dorés
// au titre centré, intitulés de rubrique en brun gras à gauche, contenu à droite, puces rondes.
// Les couleurs et la police restent celles de la charte des autres PDF de l'app.
// PAS de `lineHeight` sur la page : hérité par le pied de page, il fait DISPARAÎTRE sa ligne
// « Fiche … Page x sur y » (défaut constaté sur ce PDF, et aussi sur le contrat / l'attestation). L'interligne
// se pose donc sur un bloc qui enveloppe le contenu (`corps`), pas sur la page, avec sa propre taille de police.

/** Pas de césure : react-pdf coupe sinon « hygrométrie » en « hy- / grométrie » (cf. rapports Exploitation). */
const sansCesure = (mot: string) => [mot];

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 40, paddingBottom: 90, fontSize: 10, fontFamily: "Optima", color: pdfColors.text },
  corps: { fontSize: 10, lineHeight: 1.4 }, // fontSize répété : sans lui, lineHeight se calcule sur 18 pt (interligne doublé)
  titre: { fontSize: 20, fontWeight: 700, color: pdfColors.brownDark, textAlign: "center", marginBottom: 8 },
  bandeau: { backgroundColor: pdfColors.gold, paddingVertical: 3, paddingHorizontal: 8, marginTop: 10, marginBottom: 5 },
  bandeauTexte: { fontSize: 13, fontWeight: 700, color: pdfColors.brownDark, textAlign: "center" },
  // Une rubrique = intitulé à gauche, contenu à droite.
  rubrique: { flexDirection: "row", marginBottom: 4 },
  intitule: { width: "34%", paddingRight: 8, fontWeight: 700, color: pdfColors.brownDark },
  contenu: { width: "66%" },
  valeur: { width: "66%", color: pdfColors.text },
  valeurGras: { width: "66%", fontWeight: 700, color: pdfColors.brownDark },
  puce: { flexDirection: "row", marginBottom: 1.5 },
  puceSigne: { width: 12, color: pdfColors.brownDark },
  puceTexte: { flex: 1, textAlign: "left" },
  vide: { color: pdfColors.textMuted, fontStyle: "italic" },
  mention: { marginTop: 4, marginBottom: 2, textAlign: "justify" },
});

/** Découpe un texte en éléments (une ligne = un élément), sans puce ni tiret de saisie. */
export function elementsDeListe(texte: string | null | undefined): string[] {
  return (texte ?? "").split(/\r?\n/).map((l) => l.replace(/^[•\-–*]\s*/, "").trim()).filter(Boolean);
}

/** Bandeau de section. `minPresenceAhead` : il ne reste jamais seul en bas de page. */
function Bandeau({ children }: { children: string }) {
  return (
    <View style={styles.bandeau} wrap={false} minPresenceAhead={40}>
      <Text style={styles.bandeauTexte}>{children}</Text>
    </View>
  );
}

/** Rubrique « Intitulé : » + valeur sur une ligne (bloc Identification). */
function Ligne({ label, valeur, gras = false }: { label: string; valeur: string | null | undefined; gras?: boolean }) {
  return (
    <View style={styles.rubrique} wrap={false}>
      <Text style={styles.intitule}>{label} :</Text>
      <Text style={gras ? styles.valeurGras : styles.valeur}>{valeur?.trim() || "—"}</Text>
    </View>
  );
}

/**
 * Rubrique à puces : l'intitulé à gauche, une puce par ligne à droite. Seules les LIGNES sont
 * insécables (`wrap={false}`) : une liste plus haute qu'une page se répartit sur plusieurs pages au
 * lieu d'être écrasée. L'intitulé ne reste jamais seul en bas de page (`minPresenceAhead`).
 */
function RubriqueListe({ titre, texte }: { titre: string; texte: string | null | undefined }) {
  const elements = elementsDeListe(texte);
  return (
    <View style={styles.rubrique} minPresenceAhead={40}>
      <Text style={styles.intitule}>{titre} :</Text>
      <View style={styles.contenu}>
        {elements.length === 0 ? (
          <Text style={styles.vide}>Non renseigné</Text>
        ) : (
          elements.map((e, i) => (
            <View key={i} style={styles.puce} wrap={false}>
              <Text style={styles.puceSigne}>•</Text>
              <Text style={styles.puceTexte} hyphenationCallback={sansCesure}>{e}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

/**
 * Fiche de poste (PDF, modèle PEF) auto-remplie depuis la fiche enregistrée. Rubriques dans l'ordre
 * du modèle Word : Identification du poste ; Description du poste (missions, activités, risques et
 * contraintes, mention de non-exhaustivité) ; Compétences requises pour le poste.
 * La classe / catégorie professionnelle est déduite des salariés du poste (voir buffer) ; elle
 * s'ajoute à l'identification quand elle est connue (le modèle Word ne la porte pas).
 * « Diplômes requis » n'est imprimé que s'il est renseigné (le modèle n'a pas cette rubrique).
 */
export function FichePosteDocument({ fiche, classe, entreprise = entrepriseDefaut, logo }: { fiche: FichePoste; classe: string | null; entreprise?: typeof entrepriseDefaut; logo?: ImageSrc }) {
  const miseAJour = jourCivilKinshasa(fiche.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  return (
    <Document title={`Fiche de poste — ${fiche.poste}`}>
      <Page size="A4" style={styles.page}>
        {/* L'en-tête se répète : dès la page 2, on sait de quel poste il s'agit. */}
        <PdfHeader title={fiche.poste} logo={logo} />

        <View style={styles.corps}>
          <Text style={styles.titre}>FICHE DE POSTE</Text>

          <Bandeau>Identification du poste</Bandeau>
          <Ligne label="Intitulé" valeur={fiche.poste} gras />
          <Ligne label="Type de contrat" valeur={fiche.typeContrat} />
          <Ligne label="Échelle salariale" valeur={fiche.echelleSalariale} />
          {classe ? <Ligne label="Classe / Catégorie professionnelle" valeur={classe} /> : null}
          <Ligne label="Supérieur hiérarchique direct" valeur={fiche.superieurHierarchique} />
          <Ligne label="Lieu de travail" valeur={`${entreprise.enseigne}, ${entreprise.lieuTravail}`} />
          <Ligne label="Temps de travail" valeur={fiche.tempsTravail} />

          <Bandeau>Description du poste</Bandeau>
          <RubriqueListe titre="Missions principales du poste" texte={fiche.descriptionPoste} />
          <RubriqueListe titre="Activités et tâches principales" texte={fiche.description} />
          <RubriqueListe titre="Risques et contraintes du poste" texte={fiche.risquesContraintes} />
          <Text style={styles.mention} wrap={false} hyphenationCallback={sansCesure}>{MENTION_NON_EXHAUSTIVE}</Text>

          <Bandeau>Compétences requises pour le poste</Bandeau>
          <RubriqueListe titre="Compétences techniques" texte={fiche.competencesTechniques} />
          <RubriqueListe titre="Savoir-être, soft skills" texte={fiche.savoirEtre} />
          <RubriqueListe titre="Formations requises" texte={fiche.formationsRequises} />
          {elementsDeListe(fiche.diplomesRequis).length > 0 ? <RubriqueListe titre="Diplômes requis" texte={fiche.diplomesRequis} /> : null}
          <RubriqueListe titre="Expériences exigées" texte={fiche.experiencesExigees} />
        </View>

        <PdfFooter docLabel={`Fiche de poste — ${fiche.poste} — mise à jour le ${miseAJour}`} ent={entreprise} />
      </Page>
    </Document>
  );
}
