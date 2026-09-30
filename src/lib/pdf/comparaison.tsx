import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pdfColors } from "./theme";
import type { Colonne } from "./tableau";

registerPdfFonts();

// PDF de l'onglet Comparaison : le tableau « articles × jours » de l'écran, en deux niveaux d'en-tête
// (le jour et sa date au-dessus, « Cmd / Livré / Conso » dessous), un filet marqué et un fond alterné
// entre deux jours, et l'écart écrit en toutes lettres de chiffres (« +2 », « -1 ») sous la valeur :
// jamais la couleur seule. Aucun texte sous 8 pt, aucune capitale criée. Les rangées sont insécables
// mais le TABLEAU ne l'est pas (un bloc insécable plus haut que la page est écrasé par react-pdf) ;
// l'en-tête est `fixed` : il se répète en haut de chaque page que le tableau occupe.

/** Taille minimale de toute écriture du document, en points : le test la lit dans ces constantes. */
export const TAILLES_COMPARAISON = { entete: 8.5, jour: 9.5, corps: 8.5, signe: 8, section: 9, pied: 8 } as const;

const FOND_BANDE = "#F6EFE4"; // un jour sur deux
const FILET_JOUR = pdfColors.brown;
const ENTETE_JOUR = ["#5A3B24", "#7A5537"]; // en-tête du jour, alterné comme les bandes

export type StyleCellule = {
  couleur?: string;
  gras?: boolean;
  /** Fond d'écart (orange : livré ≠ commandé, bleu : livré non consommé, violet : consommé en trop). */
  fond?: string;
  /** Écart signé, écrit sous la valeur (même couleur que le texte de la cellule d'écart). */
  signe?: string;
  couleurSigne?: string;
  /** Valeur neutre (zéro connu) : discrète, pour que les vrais chiffres ressortent. */
  discret?: boolean;
};

export type PartieComparaison = {
  titre: string;
  /** Un groupe par jour (et « Total ») : son libellé, coiffant `nb` colonnes. */
  groupes: { libelle: string; nb: number }[];
  colonnes: Colonne[];
  lignes: string[][];
  sectionRows: number[];
  cellule: (r: number, c: number) => StyleCellule;
};

const styles = StyleSheet.create({
  page: { paddingTop: 26, paddingHorizontal: 30, paddingBottom: 96, fontSize: TAILLES_COMPARAISON.corps, fontFamily: "Optima", color: pdfColors.text },
  meta: { marginBottom: 8, fontSize: 8, color: pdfColors.textMuted },
  titrePartie: { fontSize: 11, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 6 },
  cadre: { border: `0.75 solid ${pdfColors.border}` },
  ligneEntete: { flexDirection: "row" },
  jourEntete: { color: "#ffffff", fontSize: TAILLES_COMPARAISON.jour, fontWeight: 700, textAlign: "center", paddingVertical: 3 },
  colEntete: { color: "#ffffff", fontSize: TAILLES_COMPARAISON.entete, fontWeight: 700, paddingVertical: 3, paddingHorizontal: 4 },
  tr: { flexDirection: "row", borderTop: `0.5 solid ${pdfColors.border}` },
  trSection: { backgroundColor: pdfColors.goldLight },
  tdSection: { fontSize: TAILLES_COMPARAISON.section, fontWeight: 700, color: pdfColors.brownDark, paddingVertical: 3, paddingHorizontal: 4, width: "100%" },
  td: { paddingVertical: 3, paddingHorizontal: 4, fontSize: TAILLES_COMPARAISON.corps },
  tdColonne: { alignItems: "flex-end" },
  signe: { fontSize: TAILLES_COMPARAISON.signe, fontWeight: 700 },
  pied: { marginTop: 10, fontSize: TAILLES_COMPARAISON.pied, fontStyle: "italic", color: pdfColors.textMuted },
});

/** Numéro du groupe (jour) de chaque colonne ; l'article (colonne 0) n'en a pas. */
function groupeDeColonne(groupes: { nb: number }[]): number[] {
  return [-1, ...groupes.flatMap((g, gi) => Array.from({ length: g.nb }, () => gi))];
}

function EnteteTableau({ p }: { p: PartieComparaison }) {
  const parGroupe = groupeDeColonne(p.groupes);
  return (
    <View fixed>
      <View style={styles.ligneEntete}>
        <View style={{ width: p.colonnes[0]!.width, backgroundColor: ENTETE_JOUR[0] }} />
        {p.groupes.map((g, gi) => {
          const debut = parGroupe.indexOf(gi);
          const largeur = p.colonnes.slice(debut, debut + g.nb).reduce((t, c) => t + Number.parseFloat(c.width), 0);
          return (
            <Text key={gi} style={[styles.jourEntete, { width: `${largeur}%`, backgroundColor: ENTETE_JOUR[gi % 2], borderLeft: `1.5 solid ${FILET_JOUR}` }]}>
              {g.libelle}
            </Text>
          );
        })}
      </View>
      <View style={[styles.ligneEntete, { backgroundColor: ENTETE_JOUR[0] }]}>
        {p.colonnes.map((c, i) => {
          const gi = parGroupe[i]!;
          return (
            <Text key={i} style={[styles.colEntete, { width: c.width, textAlign: c.align ?? "left", ...(gi >= 0 ? { backgroundColor: ENTETE_JOUR[gi % 2] } : {}), ...(gi >= 0 && parGroupe[i - 1] !== gi ? { borderLeft: `1.5 solid ${FILET_JOUR}` } : {}) }]}>
              {c.header}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

function CorpsTableau({ p }: { p: PartieComparaison }) {
  const sections = new Set(p.sectionRows);
  const parGroupe = groupeDeColonne(p.groupes);
  return (
    <View style={styles.cadre}>
      <EnteteTableau p={p} />
      {p.lignes.map((ligne, r) => {
        if (sections.has(r)) {
          // Un titre de rubrique ne reste jamais seul en bas de page : il exige la place d'une rangée après lui.
          return (
            <View key={r} style={[styles.tr, styles.trSection]} wrap={false} minPresenceAhead={30}>
              <Text style={styles.tdSection}>{ligne[0]}</Text>
            </View>
          );
        }
        return (
          <View key={r} style={styles.tr} wrap={false}>
            {p.colonnes.map((c, i) => {
              const gi = parGroupe[i]!;
              const st = p.cellule(r, i);
              const fond = st.fond ?? (gi >= 0 && gi % 2 === 1 ? FOND_BANDE : undefined);
              const debutGroupe = gi >= 0 && parGroupe[i - 1] !== gi;
              return (
                <View
                  key={i}
                  style={[styles.td, i > 0 ? styles.tdColonne : {}, { width: c.width }, fond ? { backgroundColor: fond } : {}, debutGroupe ? { borderLeft: `1.5 solid ${FILET_JOUR}` } : {}]}
                >
                  <Text style={[{ textAlign: i > 0 ? "right" : "left" }, st.couleur ? { color: st.couleur } : {}, st.gras ? { fontWeight: 700 } : {}, st.discret ? { color: pdfColors.textMuted } : {}]}>
                    {ligne[i] ?? ""}
                  </Text>
                  {st.signe ? <Text style={[styles.signe, { color: st.couleurSigne ?? st.couleur ?? pdfColors.text }]}>{st.signe}</Text> : null}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** Document PDF de la Comparaison : une page paysage par partie (jours, puis fin de semaine et totaux). */
export function ComparaisonDocument({ titre, sousTitre, parties, pied }: { titre: string; sousTitre: string; parties: PartieComparaison[]; pied?: string }) {
  const exporteLe = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <Document>
      {parties.map((p, pi) => (
        <Page key={pi} size="A4" orientation="landscape" style={styles.page}>
          <PdfHeader title={titre} subtitle={sousTitre} />
          <Text style={styles.meta}>Période : {sousTitre} · Édité le {exporteLe}</Text>
          <Text style={styles.titrePartie}>{p.titre}</Text>
          <CorpsTableau p={p} />
          {pied && pi === parties.length - 1 && <Text style={styles.pied}>{pied}</Text>}
          <PdfFooter docLabel={`${titre} — ${sousTitre}`} />
        </Page>
      ))}
    </Document>
  );
}
