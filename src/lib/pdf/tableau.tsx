import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pdfColors } from "./theme";

registerPdfFonts();

export type Colonne = { header: string; width: string; align?: "left" | "right" | "center" };

/** Cellule : texte simple, ou texte suivi d'une précision en petit (ex. « 12,50 » puis « 3 h »). */
export type Cellule = string | number | { texte: string; note?: string };
const texteCellule = (c: Cellule | undefined) => (c != null && typeof c === "object" ? c.texte : String(c ?? ""));
const noteCellule = (c: Cellule | undefined) => (c != null && typeof c === "object" ? c.note : undefined);

const styles = StyleSheet.create({
  // paddingBottom généreux : laisse la place au pied de page (coordonnées + n° de page).
  page: { paddingTop: 26, paddingHorizontal: 30, paddingBottom: 96, fontSize: 8.5, fontFamily: "Optima", color: pdfColors.text },
  meta: { marginBottom: 8, fontSize: 8, color: pdfColors.textMuted },
  th: { flexDirection: "row", backgroundColor: pdfColors.brownDark },
  thCell: { color: "#ffffff", fontSize: 7, fontWeight: 700, paddingVertical: 4, paddingHorizontal: 4, textTransform: "uppercase" },
  tr: { flexDirection: "row", borderTop: `0.5 solid ${pdfColors.border}` },
  trTotal: { backgroundColor: pdfColors.goldLight },
  trSection: { backgroundColor: pdfColors.goldLight },
  td: { fontSize: 8, paddingVertical: 3, paddingHorizontal: 4 },
  tdTotal: { fontWeight: 700, color: pdfColors.brownDark },
  tdSection: { fontSize: 8.5, fontWeight: 700, color: pdfColors.brownDark, paddingVertical: 3, paddingHorizontal: 4 },
  wrap: { border: `0.75 solid ${pdfColors.border}` },
  pied: { marginTop: 10, fontSize: 7, fontStyle: "italic", color: pdfColors.textMuted },
  note: { fontSize: 6, fontWeight: 400, color: pdfColors.textMuted },
  titrePartie: { fontSize: 11, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 6 },
});

type CorpsProps = {
  colonnes: Colonne[];
  lignes: Cellule[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[];
  couleurLigne?: (r: number) => string | undefined;
  couleurCellule?: (r: number, c: number) => string | undefined;
};

/**
 * Le tableau lui-même : ligne d'en-tête `fixed` (répétée en haut de chaque page que le tableau
 * occupe), lignes insécables, lignes-titres de section, dernière ligne de total optionnelle.
 */
function CorpsTableau({ colonnes, lignes, totalDerniereLigne = false, sectionRows, couleurLigne, couleurCellule }: CorpsProps) {
  const sections = new Set(sectionRows ?? []);
  return (
    <View style={styles.wrap}>
      <View style={styles.th} fixed>
        {colonnes.map((c, i) => (
          <Text key={i} style={[styles.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>
            {c.header}
          </Text>
        ))}
      </View>
      {lignes.map((ligne, r) => {
        if (sections.has(r)) {
          return (
            <View key={r} style={[styles.tr, styles.trSection]} wrap={false}>
              <Text style={[styles.tdSection, { width: "100%" }]}>{texteCellule(ligne[0])}</Text>
            </View>
          );
        }
        const total = totalDerniereLigne && r === lignes.length - 1;
        const bg = !total ? couleurLigne?.(r) : undefined;
        return (
          <View key={r} style={[styles.tr, total ? styles.trTotal : {}, bg ? { backgroundColor: bg } : {}]} wrap={false}>
            {colonnes.map((c, i) => {
              const couleur = !total ? couleurCellule?.(r, i) : undefined;
              return (
                <Text key={i} style={[styles.td, total ? styles.tdTotal : {}, { width: c.width, textAlign: c.align ?? "left" }, couleur ? { color: couleur, fontWeight: 700 } : {}]}>
                  {texteCellule(ligne[i])}
                  {noteCellule(ligne[i]) ? <Text style={styles.note}>{` ${noteCellule(ligne[i])}`}</Text> : null}
                </Text>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** Document PDF générique : en-tête de marque + tableau (colonnes/lignes), dernière ligne en gras optionnelle. */
export function TableauDocument({
  titre,
  sousTitre,
  colonnes,
  lignes,
  totalDerniereLigne = false,
  sectionRows,
  couleurLigne,
  couleurCellule,
  paysage = false,
  pied,
}: {
  titre: string;
  sousTitre: string;
  colonnes: Colonne[];
  lignes: (string | number)[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[]; // indices de lignes-titres de section (catégorie) : pleine largeur, en gras
  couleurLigne?: (r: number) => string | undefined; // fond de ligne optionnel (ex. code couleur de statut)
  couleurCellule?: (r: number, c: number) => string | undefined; // couleur de texte d'une cellule (ex. commande verte / livraison rouge)
  paysage?: boolean; // orientation paysage (tableaux larges, ex. grille hebdo)
  pied?: string;
}) {
  const exporteLe = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" orientation={paysage ? "landscape" : "portrait"} style={styles.page}>
        <PdfHeader title={titre} subtitle={sousTitre} />
        <Text style={styles.meta}>Période : {sousTitre} · Édité le {exporteLe}</Text>
        <CorpsTableau
          colonnes={colonnes}
          lignes={lignes}
          totalDerniereLigne={totalDerniereLigne}
          sectionRows={sectionRows}
          couleurLigne={couleurLigne}
          couleurCellule={couleurCellule}
        />
        {pied && <Text style={styles.pied}>{pied}</Text>}
        <PdfFooter docLabel={`${titre} — ${sousTitre}`} />
      </Page>
    </Document>
  );
}

export type TableSpec = { sousTitre?: string; colonnes: Colonne[]; lignes: (string | number)[][]; totalDerniereLigne?: boolean };

/** Document PDF à PLUSIEURS tableaux sur une même page (ex. synthèse + détail jour par jour). */
export function TablesDocument({ titre, sousTitre, tables, paysage = false }: { titre: string; sousTitre: string; tables: TableSpec[]; paysage?: boolean }) {
  const exporteLe = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <Document>
      <Page size="A4" orientation={paysage ? "landscape" : "portrait"} style={styles.page}>
        <PdfHeader title={titre} subtitle={sousTitre} />
        <Text style={styles.meta}>Période : {sousTitre} · Édité le {exporteLe}</Text>
        {tables.map((t, ti) => (
          <View key={ti} style={{ marginBottom: 14 }} wrap={false}>
            {t.sousTitre && <Text style={{ fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 3, textTransform: "uppercase" }}>{t.sousTitre}</Text>}
            <View style={styles.wrap}>
              <View style={styles.th}>
                {t.colonnes.map((c, i) => (
                  <Text key={i} style={[styles.thCell, { width: c.width, textAlign: c.align ?? "left" }]}>{c.header}</Text>
                ))}
              </View>
              {t.lignes.map((ligne, r) => {
                const total = t.totalDerniereLigne && r === t.lignes.length - 1;
                return (
                  <View key={r} style={[styles.tr, total ? styles.trTotal : {}]} wrap={false}>
                    {t.colonnes.map((c, i) => (
                      <Text key={i} style={[styles.td, total ? styles.tdTotal : {}, { width: c.width, textAlign: c.align ?? "left" }]}>{String(ligne[i] ?? "")}</Text>
                    ))}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
        <PdfFooter docLabel={`${titre} — ${sousTitre}`} />
      </Page>
    </Document>
  );
}

export type PartieTableau = {
  titre: string; // titre de la partie, affiché au-dessus de son tableau (ex. « Brigade — 12 salariés »)
  colonnes: Colonne[];
  lignes: Cellule[][];
  totalDerniereLigne?: boolean;
  sectionRows?: number[];
};

/**
 * Document PDF en PLUSIEURS PARTIES, chacune commençant sur une NOUVELLE page (une <Page> par
 * partie) : titre de la partie, puis son tableau, dont la ligne d'en-tête se répète si la partie
 * déborde sur plusieurs pages. La numérotation « Page x sur y » court sur tout le document.
 */
export function TableauxParPartieDocument({
  titre,
  sousTitre,
  parties,
  paysage = false,
  pied,
}: {
  titre: string;
  sousTitre: string;
  parties: PartieTableau[];
  paysage?: boolean;
  pied?: string; // mention en bas de la DERNIÈRE partie
}) {
  const exporteLe = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return (
    <Document>
      {parties.map((p, pi) => (
        <Page key={pi} size="A4" orientation={paysage ? "landscape" : "portrait"} style={styles.page}>
          <PdfHeader title={titre} subtitle={sousTitre} />
          <Text style={styles.meta}>Période : {sousTitre} · Édité le {exporteLe}</Text>
          <Text style={styles.titrePartie}>{p.titre}</Text>
          <CorpsTableau colonnes={p.colonnes} lignes={p.lignes} totalDerniereLigne={p.totalDerniereLigne} sectionRows={p.sectionRows} />
          {pied && pi === parties.length - 1 && <Text style={styles.pied}>{pied}</Text>}
          <PdfFooter docLabel={`${titre} — ${sousTitre}`} />
        </Page>
      ))}
    </Document>
  );
}
