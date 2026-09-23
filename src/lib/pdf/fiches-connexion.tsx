import "server-only";
import QRCode from "qrcode";
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { normaliserEspaces } from "@/lib/montant";
import { renderPdfBuffer } from "./fonts";
import { pdfColors } from "./theme";

// LES FICHES DE CONNEXION : une fiche par salarié, huit par page A4 (2 colonnes × 4 rangées),
// séparées par des pointillés pour être découpées aux ciseaux et remises EN MAIN PROPRE. Chaque
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

const styles = StyleSheet.create({
  page: { fontFamily: "Optima", padding: MARGE, color: pdfColors.text },
  grille: { borderTop: DECOUPE, borderLeft: DECOUPE, alignSelf: "flex-start" },
  rangee: { flexDirection: "row" },
  fiche: {
    width: LARGEUR_FICHE, height: HAUTEUR_FICHE, borderRight: DECOUPE, borderBottom: DECOUPE,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  entete: { fontSize: 7.5, color: pdfColors.textMuted, letterSpacing: 0.4, marginBottom: 4 },
  nom: { fontSize: 12.5, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 8 },
  corps: { flexDirection: "row", justifyContent: "space-between" },
  identifiants: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  libelle: { fontSize: 7.5, color: pdfColors.textMuted },
  matricule: { fontSize: 13, fontWeight: 700, marginBottom: 6 },
  motDePasse: { fontSize: 16, fontWeight: 700, color: pdfColors.brownDark },
  aChanger: { fontSize: 8, fontStyle: "italic", marginTop: 3 },
  qrBloc: { width: COTE_QR, alignItems: "center" },
  qr: { width: COTE_QR, height: COTE_QR },
  adresse: { fontSize: 7.5, marginTop: 2, textAlign: "center" },
  consigne: { fontSize: 7.5, color: pdfColors.textMuted, marginTop: 8 },
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

function Fiche({ fiche, qrPng, adresse }: { fiche: FicheConnexion; qrPng: Buffer; adresse: string }) {
  return (
    <View style={styles.fiche} wrap={false}>
      <Text style={styles.entete}>{t("PÂTES EN FOLIE — ESPACE SALARIÉ")}</Text>
      <Text style={styles.nom}>{t(fiche.nom)}</Text>
      <View style={styles.corps}>
        <View style={styles.identifiants}>
          <Text style={styles.libelle}>{t("Identifiant (matricule)")}</Text>
          <Text style={styles.matricule}>{t(fiche.matricule)}</Text>
          <Text style={styles.libelle}>{t("Mot de passe temporaire")}</Text>
          <Text style={styles.motDePasse}>{t(fiche.motDePasse)}</Text>
          <Text style={styles.aChanger}>{t("À changer à la première connexion.")}</Text>
        </View>
        <View style={styles.qrBloc}>
          <Image src={{ data: qrPng, format: "png" }} style={styles.qr} />
          <Text style={styles.adresse}>{t(adresse)}</Text>
        </View>
      </View>
      <Text style={styles.consigne}>
        {t(`Ouvrez l'application (QR ou ${adresse}), saisissez votre matricule puis ce mot de passe.`)}
      </Text>
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
