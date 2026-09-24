import "server-only";
import QRCode from "qrcode";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { normaliserEspaces } from "@/lib/montant";
import { renderPdfBuffer } from "./fonts";
import { pdfColors } from "./theme";

// LES FICHES DE CONNEXION, sous deux formes au contenu identique :
//  - la fiche INDIVIDUELLE : une page A6, un salarié, envoyée seule (WhatsApp) ;
//  - la PLANCHE : huit fiches par page A4 (2 colonnes × 4 rangées), séparées par des pointillés
//    pour être découpées aux ciseaux et remises EN MAIN PROPRE.
// Chaque
// fiche porte le nom, le matricule (identifiant), le mot de passe temporaire, l'adresse de
// l'application et un QR qui l'ouvre. Le mot de passe temporaire n'existe NULLE PART ailleurs que
// dans ce PDF, produit en mémoire et jamais stocké.
//
// Police : Optima seule. Tout texte passe par `normaliserEspaces` (espace fine insécable absente
// de la police → texte barré). Les mots de passe n'utilisent que A-Z (sans I ni O), 2-9 et « - » :
// tous présents dans Optima (vérifié par fiches-connexion.render.test.ts).

export const FICHES_PAR_PAGE = 8;
const COLONNES = 2;

export type FicheConnexion = { nom: string; matricule: string; motDePasse: string };

const CM = 72 / 2.54;
const MARGE = 1 * CM; // hors de la zone non imprimable des imprimantes de bureau
const TRAIT = 0.8; // épaisseur des pointillés de découpe
// La grille porte le trait du haut et de gauche, chaque fiche celui de droite et du bas : les
// dimensions se calculent donc SANS le trait extérieur, arrondies vers le bas (une rangée plus
// haute d'un centième de point pousserait la dernière sur la page suivante).
const LARGEUR_FICHE = Math.floor((595.28 - 2 * MARGE - TRAIT) / COLONNES);
const HAUTEUR_FICHE = Math.floor((841.89 - 2 * MARGE - TRAIT) / (FICHES_PAR_PAGE / COLONNES));
const COTE_QR = 2.6 * CM;
const DECOUPE = `${TRAIT} dashed ${pdfColors.brownLight}`;

// La page A4 et sa grille de découpe.
const styles = StyleSheet.create({
  page: { fontFamily: "Optima", padding: MARGE, color: pdfColors.text },
  grille: { borderTop: DECOUPE, borderLeft: DECOUPE, alignSelf: "flex-start" },
  rangee: { flexDirection: "row" },
});

/**
 * Le rendu d'UNE fiche, à une échelle donnée : 1 sur la planche A4 (huit fiches à découper), 1,5
 * sur la fiche individuelle A6 (envoyée seule, lue sur un téléphone). Même contenu, mêmes
 * proportions : seule la taille change.
 */
function stylesFiche(echelle: number) {
  const k = (v: number) => v * echelle;
  const qr = k(COTE_QR);
  return StyleSheet.create({
    entete: { fontSize: k(7.5), color: pdfColors.textMuted, letterSpacing: k(0.4), marginBottom: k(4) },
    nom: { fontSize: k(12.5), fontWeight: 700, color: pdfColors.brownDark, marginBottom: k(8) },
    corps: { flexDirection: "row", justifyContent: "space-between" },
    identifiants: { flexGrow: 1, flexShrink: 1, paddingRight: k(8) },
    libelle: { fontSize: k(7.5), color: pdfColors.textMuted },
    matricule: { fontSize: k(13), fontWeight: 700, marginBottom: k(6) },
    motDePasse: { fontSize: k(16), fontWeight: 700, color: pdfColors.brownDark },
    aChanger: { fontSize: k(8), fontStyle: "italic", marginTop: k(3) },
    qrBloc: { width: qr, alignItems: "center" },
    qr: { width: qr, height: qr },
    adresse: { fontSize: k(7.5), marginTop: k(2), textAlign: "center" },
    consigne: { fontSize: k(7.5), color: pdfColors.textMuted, marginTop: k(8) },
  });
}
const STYLES_PLANCHE = stylesFiche(1);
const PADDING_FICHE = { paddingVertical: 12, paddingHorizontal: 14 };

// La fiche INDIVIDUELLE : une page A6 à l'italienne (148 × 105 mm), la fiche de la planche agrandie
// 1,5 fois — le mot de passe y est en 24 pt, lisible sur l'écran d'un téléphone sans zoomer.
const ECHELLE_INDIVIDUELLE = 1.5;
const A6_PAYSAGE = { largeur: 419.53, hauteur: 297.64 };
const STYLES_INDIVIDUELLE = stylesFiche(ECHELLE_INDIVIDUELLE);
const stylesPageIndividuelle = StyleSheet.create({
  page: { fontFamily: "Optima", color: pdfColors.text },
});

/** Le QR des fiches (l'adresse de l'application), en PNG à modules entiers. */
function qrApplicationPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { type: "png", errorCorrectionLevel: "M", margin: 2, scale: 10, color: { dark: "#000000", light: "#ffffff" } });
}

/** L'adresse telle qu'on la tape : sans « https:// ». */
function adresseLisible(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const t = (s: string) => normaliserEspaces(s);

/** Le contenu d'une fiche — le même sur la planche A4 et sur la fiche individuelle. */
function ContenuFiche({ fiche, qrPng, adresse, st }: { fiche: FicheConnexion; qrPng: Buffer; adresse: string; st: ReturnType<typeof stylesFiche> }) {
  return (
    <>
      <Text style={st.entete}>{t("PÂTES EN FOLIE — ESPACE SALARIÉ")}</Text>
      <Text style={st.nom}>{t(fiche.nom)}</Text>
      <View style={st.corps}>
        <View style={st.identifiants}>
          <Text style={st.libelle}>{t("Identifiant (matricule)")}</Text>
          <Text style={st.matricule}>{t(fiche.matricule)}</Text>
          <Text style={st.libelle}>{t("Mot de passe temporaire")}</Text>
          <Text style={st.motDePasse}>{t(fiche.motDePasse)}</Text>
          <Text style={st.aChanger}>{t("À changer à la première connexion.")}</Text>
        </View>
        <View style={st.qrBloc}>
          <Image src={{ data: qrPng, format: "png" }} style={st.qr} />
          <Text style={st.adresse}>{t(adresse)}</Text>
        </View>
      </View>
      <Text style={st.consigne}>
        {t(`Ouvrez l'application (QR ou ${adresse}), saisissez votre matricule puis ce mot de passe.`)}
      </Text>
    </>
  );
}

/** Une fiche de la planche A4 : cadre fixe, pointillés de découpe à droite et en bas. */
function Fiche({ fiche, qrPng, adresse }: { fiche: FicheConnexion; qrPng: Buffer; adresse: string }) {
  return (
    <View
      style={{ width: LARGEUR_FICHE, height: HAUTEUR_FICHE, borderRight: DECOUPE, borderBottom: DECOUPE, ...PADDING_FICHE }}
      wrap={false}
    >
      <ContenuFiche fiche={fiche} qrPng={qrPng} adresse={adresse} st={STYLES_PLANCHE} />
    </View>
  );
}

/** Rangées EXPLICITES de deux fiches : aucune fiche ne dépend d'un retour à la ligne automatique. */
function rangees(lot: FicheConnexion[]): FicheConnexion[][] {
  const r: FicheConnexion[][] = [];
  for (let i = 0; i < lot.length; i += COLONNES) r.push(lot.slice(i, i + COLONNES));
  return r;
}

export function FichesConnexionDocument({ fiches, qrPng, adresse }: { fiches: FicheConnexion[]; qrPng: Buffer; adresse: string }) {
  const pages: FicheConnexion[][] = [];
  for (let i = 0; i < fiches.length; i += FICHES_PAR_PAGE) pages.push(fiches.slice(i, i + FICHES_PAR_PAGE));
  return (
    <Document title="Fiches de connexion">
      {pages.map((lot, i) => (
        <Page key={i} size="A4" style={styles.page}>
          <View style={styles.grille}>
            {rangees(lot).map((rangee, j) => (
              <View key={j} style={styles.rangee}>
                {rangee.map((f) => (
                  <Fiche key={f.matricule} fiche={f} qrPng={qrPng} adresse={adresse} />
                ))}
              </View>
            ))}
          </View>
        </Page>
      ))}
    </Document>
  );
}

/**
 * Le PDF des fiches, EN MÉMOIRE (jamais écrit sur disque). `urlApplication` : l'origine officielle
 * de l'application (`ORIGINE_AFFICHE`), que le QR encode et que la fiche écrit en clair.
 */
export async function genererFichesConnexionPdf(p: { fiches: FicheConnexion[]; urlApplication: string }): Promise<Buffer> {
  if (p.fiches.length === 0) throw new Error("Aucune fiche à imprimer.");
  const qrPng = await qrApplicationPng(p.urlApplication);
  return renderPdfBuffer(FichesConnexionDocument({ fiches: p.fiches, qrPng, adresse: adresseLisible(p.urlApplication) }));
}

/** La fiche d'UN salarié, seule sur sa page A6 : c'est elle qu'on envoie par WhatsApp. */
export function FicheConnexionIndividuelleDocument({ fiche, qrPng, adresse }: { fiche: FicheConnexion; qrPng: Buffer; adresse: string }) {
  return (
    <Document title={`Fiche de connexion — ${fiche.nom}`}>
      <Page size={[A6_PAYSAGE.largeur, A6_PAYSAGE.hauteur]} style={stylesPageIndividuelle.page}>
        <View
          style={{
            width: Math.floor(A6_PAYSAGE.largeur),
            height: Math.floor(A6_PAYSAGE.hauteur),
            paddingVertical: PADDING_FICHE.paddingVertical * ECHELLE_INDIVIDUELLE,
            paddingHorizontal: PADDING_FICHE.paddingHorizontal * ECHELLE_INDIVIDUELLE,
          }}
          wrap={false}
        >
          <ContenuFiche fiche={fiche} qrPng={qrPng} adresse={adresse} st={STYLES_INDIVIDUELLE} />
        </View>
      </Page>
    </Document>
  );
}

/**
 * Les fiches INDIVIDUELLES d'un lot, une par salarié, dans l'ordre reçu : `resultat[i]` est la
 * fiche de `fiches[i]`, et d'elle seule. En mémoire, jamais écrites sur disque.
 */
export async function genererFichesIndividuellesPdf(p: { fiches: FicheConnexion[]; urlApplication: string }): Promise<Buffer[]> {
  if (p.fiches.length === 0) throw new Error("Aucune fiche à imprimer.");
  const qrPng = await qrApplicationPng(p.urlApplication);
  const adresse = adresseLisible(p.urlApplication);
  const pdfs: Buffer[] = [];
  // Une à une : le rendu react-pdf est gourmand, dix-huit rendus simultanés n'iraient pas plus vite.
  for (const fiche of p.fiches) pdfs.push(await renderPdfBuffer(FicheConnexionIndividuelleDocument({ fiche, qrPng, adresse })));
  return pdfs;
}
