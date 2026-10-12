import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { pdfColors } from "./theme";
import { MENTION_PROVISOIRE } from "@/lib/mention-provisoire";

/**
 * MENTION « PROVISOIRE » des documents de paie et de déclarations (audit du 2026-10-10) : un
 * bulletin dont la ligne n'est ni VALIDÉE ni PAYÉE, un livre de paie ou un bordereau qui en contient,
 * ne doit pas pouvoir être pris pour un document arrêté. Un bandeau en haut de CHAQUE page et un
 * filigrane en travers : à l'unité, en liasse comme en ZIP.
 *
 * Les deux éléments sont en position absolue et répétés sur chaque page (`fixed`) : ils ne prennent
 * aucune place dans le flux, donc n'ajoutent jamais une page (le bulletin tient sur une seule).
 * Aucun caractère hors Optima (pas de U+202F, de ⚠ ni de flèche).
 */
export { MENTION_PROVISOIRE };

const styles = StyleSheet.create({
  bandeau: {
    position: "absolute",
    top: 6,
    left: 30,
    right: 30,
    textAlign: "center",
    fontSize: 8,
    fontWeight: 700,
    color: "#b91c1c",
  },
  filigrane: {
    position: "absolute",
    top: 400,
    left: 20,
    right: 20,
    textAlign: "center",
    fontSize: 38,
    fontWeight: 700,
    color: "#c9a0a0",
    opacity: 0.4,
    transform: "rotate(-30deg)",
  },
});

/** À poser dans une `<Page>` : bandeau d'en-tête + filigrane, sur toutes les pages de ce `<Page>`. */
export function MarquePage({ detail }: { detail?: string }) {
  return (
    <>
      <View fixed style={styles.bandeau}>
        <Text>{detail ? `${MENTION_PROVISOIRE} — ${detail}` : `${MENTION_PROVISOIRE} — montants susceptibles de changer`}</Text>
      </View>
      <View fixed style={styles.filigrane}>
        <Text>{MENTION_PROVISOIRE.toUpperCase()}</Text>
      </View>
    </>
  );
}
