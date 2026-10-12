import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { BonDeCommande, LigneBonDeCommande, Fournisseur, ParametresAchat } from "@prisma/client";
import { acheteurDuBon, type SocieteAcheteur } from "@/lib/bon-commande-acheteur";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader, PdfSignatureBox } from "./layout";
import { pdfColors } from "./theme";
import { delaiPaiementLabel } from "@/lib/stock";
import { formaterNombre } from "@/lib/montant";
import { libelleLigneArticle } from "@/lib/libelle-article";
import { compterSansPrixBon, deviseBon, prixLigneBon, totalBon, totalLigneBon } from "@/lib/bon-commande-devise";

registerPdfFonts();

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingHorizontal: 32, paddingBottom: 90, fontSize: 9, fontFamily: "Optima", color: pdfColors.text },
  parties: { flexDirection: "row", gap: 10, marginBottom: 10 },
  partie: { flex: 1, border: `0.75 solid ${pdfColors.border}` },
  pRow: { flexDirection: "row", paddingVertical: 2, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  pLabel: { width: "38%", color: pdfColors.brownDark, fontWeight: 700 },
  pValue: { flex: 1 },
  table: { marginBottom: 12, border: `0.75 solid ${pdfColors.border}` },
  th: { flexDirection: "row", backgroundColor: pdfColors.goldLight, paddingVertical: 4, paddingHorizontal: 6 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, borderTop: `0.5 solid ${pdfColors.border}` },
  cDes: { flex: 1 },
  cNum: { width: 60, textAlign: "right" },
  cUpc: { width: 74, textAlign: "right" },
  cCartons: { width: 46, textAlign: "right" },
  cQte: { width: 50, textAlign: "right" },
  cUnite: { width: 38, textAlign: "center" },
  cPu: { width: 62, textAlign: "right" },
  cTot: { width: 70, textAlign: "right" },
  cCol: { fontWeight: 700, color: pdfColors.brownDark },
  totalBox: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 10 },
  totalInner: { width: 220, padding: 10, backgroundColor: pdfColors.goldLight, borderRadius: 4, flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 10, color: pdfColors.brownDark, fontWeight: 700 },
  totalValue: { fontSize: 12, fontWeight: 700, color: pdfColors.brownDark },
  meta: { flexDirection: "row", gap: 10, marginBottom: 12 },
  signatures: { marginTop: 12, flexDirection: "row", justifyContent: "space-between" },
  sigLine: { borderTop: `0.75 solid ${pdfColors.text}`, marginTop: 40, paddingTop: 4, fontSize: 8, color: pdfColors.textMuted },
});

const usd = (v: number) => `${formaterNombre(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const fc = (v: number) => `${formaterNombre(Math.round(v))} FC`;
/** Montant dans la devise du bon ; « - » pour une absence (jamais 0). */
const montant = (v: number | null, devise: "USD" | "CDF") => (v === null ? "-" : devise === "CDF" ? fc(v) : usd(v));

/** Nombre à la française, « — » pour une absence (jamais 0 à sa place). */
const nombreOuTiret = (v: { toString(): string } | null | undefined) => (v === null || v === undefined || v.toString().trim() === "" ? "—" : formaterNombre(Number(v.toString()), { maximumFractionDigits: 2 }));

function PRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pRow}>
      <Text style={styles.pLabel}>{label}</Text>
      <Text style={styles.pValue}>{value}</Text>
    </View>
  );
}

export function BonCommandeDocument({
  bc,
  fournisseur,
  acheteur,
  societe,
  achats,
}: {
  /** `article` (facultatif) : contenance de l'article lié (libellé de la ligne), unité et unités par carton (colonnes). */
  bc: BonDeCommande & { lignes: (LigneBonDeCommande & { article?: { contenance: { toString(): string } | null; contenanceUnite: string | null; unite?: string | null; uniteParCarton?: { toString(): string } | null } | null })[] };
  fournisseur: Fournisseur | null;
  acheteur: ParametresAchat | null;
  /** Identité de la société (Paramètres) : sert de repli aux informations de l'acheteur (`acheteurDuBon`). */
  societe?: SocieteAcheteur | null;
  achats?: { adresseLivraison: string | null; contact: string | null } | null;
}) {
  const date = new Date(bc.date).toLocaleDateString("fr-FR");
  const devise = deviseBon(bc);
  const sansPrix = compterSansPrixBon(bc.lignes, devise);
  const ach = acheteurDuBon(acheteur, societe, achats);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <PdfHeader title={`BON DE COMMANDE N° ${bc.numero}`} subtitle={`Date : ${date}`} />

        <View style={styles.parties}>
          <View style={styles.partie}>
            <PdfSectionHeader>Fournisseur</PdfSectionHeader>
            <PRow label="Nom" value={fournisseur?.nom ?? "—"} />
            <PRow label="Adresse" value={fournisseur?.adresse?.trim() || "—"} />
            <PRow label="Ville" value={fournisseur?.ville ?? "—"} />
            <PRow label="Pays" value={fournisseur?.pays ?? "—"} />
            <PRow label="Téléphone" value={fournisseur?.telephone ?? "—"} />
            <PRow label="ID National" value={fournisseur?.idNational?.trim() || "—"} />
            <PRow label="RCCM" value={fournisseur?.rccm ?? "—"} />
            <PRow label="Contact" value={fournisseur?.contactNom ?? "—"} />
          </View>
          <View style={styles.partie}>
            <PdfSectionHeader>Acheteur</PdfSectionHeader>
            <PRow label="Nom" value={ach.nom} />
            <PRow label="Adresse" value={ach.adresse ?? "—"} />
            <PRow label="Adresse de livraison" value={ach.adresseLivraison ?? "—"} />
            <PRow label="Ville" value={ach.ville ?? "—"} />
            <PRow label="Pays" value={ach.pays ?? "—"} />
            <PRow label="Téléphone" value={ach.telephone ?? "—"} />
            <PRow label="ID National" value={ach.idNational ?? "—"} />
            <PRow label="RCCM" value={ach.rccm ?? "—"} />
            <PRow label="Contact" value={ach.contact ?? "—"} />
          </View>
        </View>

        <View style={styles.table}>
          {/* `fixed` : la ligne d'en-tête se répète en haut de chaque page quand le tableau déborde. */}
          <View style={styles.th} fixed>
            <Text style={[styles.cDes, styles.cCol]}>Désignation</Text>
            <Text style={[styles.cUpc, styles.cCol]}>Nbre d&apos;unités par paquet/carton</Text>
            <Text style={[styles.cCartons, styles.cCol]}>Nbre de cartons</Text>
            <Text style={[styles.cQte, styles.cCol]}>Quantité</Text>
            <Text style={[styles.cUnite, styles.cCol]}>Unité</Text>
            <Text style={[styles.cPu, styles.cCol]}>P.U. ({devise})</Text>
            <Text style={[styles.cTot, styles.cCol]}>Total ({devise})</Text>
          </View>
          {bc.lignes.map((l) => (
            <View key={l.id} style={styles.tr}>
              <Text style={styles.cDes}>{libelleLigneArticle(l)}</Text>
              <Text style={styles.cUpc}>{nombreOuTiret(l.uniteParCarton ?? l.article?.uniteParCarton)}</Text>
              <Text style={styles.cCartons}>{l.nbCartons ? formaterNombre(Number(l.nbCartons), { maximumFractionDigits: 2 }) : "—"}</Text>
              <Text style={styles.cQte}>{formaterNombre(Number(l.quantite), { maximumFractionDigits: 3 })}</Text>
              <Text style={styles.cUnite}>{l.unite?.trim() || l.article?.unite?.trim() || "—"}</Text>
              <Text style={styles.cPu}>{montant(prixLigneBon(l, devise), devise)}</Text>
              <Text style={styles.cTot}>{montant(totalLigneBon(l, devise), devise)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalBox}>
          <View style={styles.totalInner}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{montant(totalBon(bc), devise)}</Text>
          </View>
        </View>
        {sansPrix > 0 ? <Text style={{ textAlign: "right", fontSize: 8, color: pdfColors.textMuted, marginBottom: 10 }}>Total incomplet : {sansPrix} ligne(s) sans prix ne sont pas chiffrées.</Text> : null}

        <View style={styles.meta}>
          <View style={styles.partie}>
            <PdfSectionHeader>Conditions</PdfSectionHeader>
            <PRow label="Délai de paiement" value={delaiPaiementLabel(bc.delaiPaiement)} />
            <PRow label="Délai de livraison" value={fournisseur?.delaiLivraison ?? "—"} />
            <PRow label="Mode de paiement" value={bc.modePaiement ?? "—"} />
            {bc.commentaire ? <PRow label="Note" value={bc.commentaire} /> : null}
          </View>
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={{ width: "45%" }}>
            <Text style={styles.sigLine}>Signature du fournisseur</Text>
          </View>
          <PdfSignatureBox label="Signature de la direction" signe={bc.statut !== "BROUILLON"} />
        </View>

        <PdfFooter docLabel={`PÂTES EN FOLIE — TOLYA SARL  •  Bon de commande ${bc.numero}`} />
      </Page>
    </Document>
  );
}
