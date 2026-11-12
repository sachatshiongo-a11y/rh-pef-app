import type { ReactNode } from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader } from "./layout";
import { pdfColors } from "./theme";
import { lignesDeLaFiche, type FicheFournisseurExport } from "@/lib/fiche-fournisseur-export";
import { verifierPlafondPdf } from "./plafond";

registerPdfFonts();

// FICHE FOURNISSEUR (PDF) — le SEUL endroit qui décide de la mise en page. Il reçoit une fiche déjà
// composée en texte (`construireFiche`, lib/fiche-fournisseur-export.ts) : changer la présentation ne
// touche ni les chiffres ni la base. Une fiche = une ou plusieurs pages ; un lot = une fiche après l'autre.

const ROUGE = "#B4232A";
const VERT = "#065F46";
const ORANGE = "#B45309";

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 32, paddingBottom: 90, fontSize: 9, fontFamily: "Optima", color: pdfColors.text },
  infoWrap: { border: `0.75 solid ${pdfColors.border}`, marginBottom: 14 },
  pRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  pLabel: { width: "28%", color: pdfColors.brownDark, fontWeight: 700 },
  pValue: { flex: 1 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 10 },
  kpi: { flex: 1, border: `0.75 solid ${pdfColors.border}`, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 7.5, color: pdfColors.textMuted, marginBottom: 3 },
  kpiValue: { fontSize: 11, fontWeight: 700, color: pdfColors.brownDark },
  kpiSous: { fontSize: 7, color: pdfColors.textMuted, marginTop: 2 },
  avertissement: { border: `1 solid ${ROUGE}`, backgroundColor: "#FBEAEA", borderRadius: 4, padding: 6, marginBottom: 10, fontSize: 8, color: ROUGE },
  table: { marginBottom: 6, border: `0.75 solid ${pdfColors.border}` },
  th: { flexDirection: "row", backgroundColor: pdfColors.goldLight, paddingVertical: 4, paddingHorizontal: 6 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  cCol: { fontWeight: 700, color: pdfColors.brownDark },
  cNumero: { width: 95 },
  cDate: { width: 62 },
  cFlex: { flex: 1 },
  cMontant: { width: 90, textAlign: "right" },
  cStatut: { width: 80, textAlign: "right" },
  note: { fontSize: 8, color: pdfColors.textMuted, marginBottom: 14 },
  vide: { paddingVertical: 8, paddingHorizontal: 6, fontSize: 8.5, color: pdfColors.textMuted },
});

const TEINTE: Record<string, string> = { entree: VERT, attention: ORANGE, alerte: ROUGE };
const COULEUR_STATUT: Record<string, string> = { REGLEE: VERT, ECHUE_NON_REGLEE: ROUGE, A_REGLER: ORANGE };

/** « 15 plus récentes sur 42 » / « 3 » : le nombre réel est toujours écrit. */
const comptage = (montre: number, total: number) => (total > montre ? `${montre} plus récent(e)s sur ${total}` : String(total));

function Rubrique({ titre, enteteCols, vide, children, note }: { titre: string; enteteCols: { texte: string; style: Style }[]; vide: string | null; children?: ReactNode; note?: string | null }) {
  return (
    <View>
      <PdfSectionHeader>{titre}</PdfSectionHeader>
      <View style={[styles.table, { marginTop: 0 }]}>
        <View style={styles.th} wrap={false}>
          {enteteCols.map((c) => <Text key={c.texte} style={[c.style, styles.cCol]}>{c.texte}</Text>)}
        </View>
        {vide ? <Text style={styles.vide}>{vide}</Text> : children}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : <View style={{ marginBottom: 8 }} />}
    </View>
  );
}

function FichePage({ fiche }: { fiche: FicheFournisseurExport }) {
  return (
    <Page size="A4" style={styles.page}>
      <PdfHeader title="FICHE FOURNISSEUR" subtitle={fiche.nom} />

      <View style={styles.infoWrap}>
        <PdfSectionHeader>Identité et coordonnées</PdfSectionHeader>
        <View style={styles.pRow}><Text style={styles.pLabel}>Nom</Text><Text style={styles.pValue}>{fiche.nom}</Text></View>
        {fiche.identite.map((l) => (
          <View key={l.libelle} style={styles.pRow} wrap={false}><Text style={styles.pLabel}>{l.libelle}</Text><Text style={styles.pValue}>{l.valeur}</Text></View>
        ))}
        {fiche.identite.length === 0 && <Text style={styles.vide}>Aucune coordonnée renseignée.</Text>}
      </View>

      <View style={styles.kpis} wrap={false}>
        {fiche.chiffres.map((c) => (
          <View key={c.libelle} style={styles.kpi}>
            <Text style={styles.kpiLabel}>{c.libelle}</Text>
            <Text style={[styles.kpiValue, c.teinte ? { color: TEINTE[c.teinte] } : {}]}>{c.valeur}</Text>
            {c.sousTexte ? <Text style={styles.kpiSous}>{c.sousTexte}</Text> : null}
          </View>
        ))}
      </View>
      {fiche.avertissement ? <Text style={styles.avertissement}>{fiche.avertissement}</Text> : null}

      <Rubrique
        titre={`Articles fournis (${fiche.nbArticles})`}
        enteteCols={[{ texte: "Désignation", style: styles.cFlex }, { texte: "Catégorie", style: { width: 110 } }, { texte: "Pour cet article", style: { width: 70 } }, { texte: "Prix", style: styles.cMontant }]}
        vide={fiche.articles.length === 0 ? "Aucun article rattaché." : null}
        note={fiche.nbArticles > fiche.articles.length ? `${fiche.articles.length} articles affichés sur ${fiche.nbArticles} : exportez en Excel pour la liste complète.` : null}
      >
        {fiche.articles.map((a, i) => (
          <View key={i} style={styles.tr} wrap={false}>
            <Text style={styles.cFlex}>{a.designation}</Text>
            <Text style={{ width: 110 }}>{a.categorie}</Text>
            <Text style={{ width: 70 }}>{a.lien}</Text>
            <View style={styles.cMontant}>
              <Text>{a.prix}</Text>
              {a.prixAutre ? <Text style={{ fontSize: 7, color: pdfColors.textMuted }}>{a.prixAutre}</Text> : null}
            </View>
          </View>
        ))}
      </Rubrique>

      <Rubrique
        titre={`Factures — ${comptage(fiche.factures.length, fiche.nbFactures)}`}
        enteteCols={[{ texte: "Numéro", style: styles.cNumero }, { texte: "Date", style: styles.cDate }, { texte: "Échéance", style: styles.cDate }, { texte: "Montant", style: styles.cMontant }, { texte: "Reste à payer", style: styles.cMontant }, { texte: "Statut", style: styles.cStatut }]}
        vide={fiche.factures.length === 0 ? "Aucune facture." : null}
      >
        {fiche.factures.map((f, i) => (
          <View key={i} style={styles.tr} wrap={false}>
            <Text style={styles.cNumero}>{f.numero}</Text>
            <Text style={styles.cDate}>{f.date}</Text>
            <Text style={styles.cDate}>{f.echeance}</Text>
            <Text style={styles.cMontant}>{f.montant}</Text>
            <Text style={styles.cMontant}>{f.reste}</Text>
            <Text style={[styles.cStatut, { color: COULEUR_STATUT[f.statutCle] ?? pdfColors.text, fontWeight: 700 }]}>{f.statut}</Text>
          </View>
        ))}
      </Rubrique>

      <Rubrique
        titre={`Bons de commande — ${comptage(fiche.bons.length, fiche.nbBons)}`}
        enteteCols={[{ texte: "Numéro", style: { width: 120 } }, { texte: "Date", style: styles.cDate }, { texte: "Statut", style: styles.cFlex }, { texte: "Total", style: { width: 170, textAlign: "right" } }]}
        vide={fiche.bons.length === 0 ? "Aucun bon de commande." : null}
      >
        {fiche.bons.map((b, i) => (
          <View key={i} style={styles.tr} wrap={false}>
            <Text style={{ width: 120 }}>{b.numero}</Text>
            <Text style={styles.cDate}>{b.date}</Text>
            <Text style={styles.cFlex}>{b.statut}</Text>
            <Text style={{ width: 170, textAlign: "right" }}>{b.total}</Text>
          </View>
        ))}
      </Rubrique>

      <PdfFooter docLabel={`PÂTES EN FOLIE — TOLYA SARL  •  Fiche fournisseur : ${fiche.nom}`} />
    </Page>
  );
}

/** Une ou plusieurs fiches (un lot = une fiche après l'autre). Refuse, avant tout rendu, un document au-delà du plafond de lignes. */
export function FicheFournisseurDocument({ fiches }: { fiches: FicheFournisseurExport[] }) {
  verifierPlafondPdf(fiches.reduce((n, f) => n + lignesDeLaFiche(f), 0));
  return (
    <Document>
      {fiches.map((f, i) => <FichePage key={i} fiche={f} />)}
    </Document>
  );
}
