import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { formaterNombre } from "@/lib/montant";
import { sansAccents } from "@/lib/texte";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter } from "./layout";
import { pdfColors } from "./theme";
import { LigneDate, TableauFiche, stylePageFiche, type ColonneFiche, type RangeeFiche } from "./fiche-a-remplir";

registerPdfFonts();

/**
 * Fiche « Achat de légumes Marché » (modèle remis par la Direction, 2026-09-28) : Désignation |
 * Unité | QTÉ | Montant pour chaque légume de la liste, puis « Montant donné $ », « Montant total
 * CDF » et « Montant total $ ».
 *
 * - VIERGE : cases QTÉ et Montant vides, totaux vides, date à écrire à la main.
 * - REMPLIE pour une date : les achats (AchatLegume) de ce jour. Un légume de la liste reçoit sa
 *   quantité et son montant en CDF ; un légume non acheté reste vide ; un achat dont le libellé
 *   n'est pas dans la liste s'ajoute en fin de tableau. « Montant donné $ » reste vide : l'argent
 *   remis à l'acheteur n'est pas enregistré par l'application.
 */

export const TITRE_FICHE_ACHAT = "Achat de légumes Marché";
export const COLONNES_FICHE_ACHAT: ColonneFiche[] = [
  { entete: "Désignation", largeur: "40%" },
  { entete: "Unité", largeur: "16%" },
  { entete: "QTÉ", largeur: "20%", align: "right" },
  { entete: "Montant", largeur: "24%", align: "right" },
];

export type LegumeListe = { nom: string; unite: string };
export type AchatDuJour = { legume: string; unite: string | null; quantite: number; montantCDF: number | null; montantUSD: number | null };

export type LigneFicheAchat = {
  designation: string;
  unite: string;
  quantite: number | null; // null = case vide (légume non acheté, ou fiche vierge)
  montantCDF: number | null; // null = case vide (non acheté, ou acheté sans montant saisi)
  horsListe: boolean;
};

export type FicheAchat = {
  lignes: LigneFicheAchat[];
  totalCDF: number | null; // null = fiche vierge
  totalUSD: number | null; // null = fiche vierge, ou aucun montant convertible
  mentions: string[]; // ce qui rend un total incomplet ou provisoire — jamais tu
};

/**
 * Clé de rapprochement d'un libellé : sans accents, sans casse, ponctuation et espaces réduits.
 * « Lemons / Citrons-verts » et « Lemons/ Citrons-verts » désignent le même légume. Rien de plus :
 * « Menthe » et « Feuilles de menthe » restent deux légumes — aucun rapprochement n'est deviné.
 */
export const cleLibelle = (s: string | null | undefined) =>
  sansAccents(String(s ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const somme = (xs: (number | null)[]) => {
  const connus = xs.filter((x): x is number => x !== null);
  return connus.length ? connus.reduce((a, b) => a + b, 0) : null;
};

/** Fiche vierge : la liste, cases et totaux vides. */
export function ficheAchatVierge(liste: LegumeListe[]): FicheAchat {
  return {
    lignes: liste.map((l) => ({ designation: l.nom, unite: l.unite, quantite: null, montantCDF: null, horsListe: false })),
    totalCDF: null,
    totalUSD: null,
    mentions: [],
  };
}

/**
 * Fiche remplie avec les achats d'un jour. Plusieurs achats d'un même légume dans la même unité
 * s'additionnent. Un achat enregistré dans une AUTRE unité que celle de la liste ne s'additionne
 * pas à tort : il prend la ligne du légume s'il est seul, sinon il s'ajoute en fin de tableau
 * avec sa propre unité.
 *
 * Total en dollars : la contre-valeur ENREGISTRÉE avec chaque achat (`montantUSD`, calculée au
 * taux du jour de la saisie). Un achat enregistré sans contre-valeur est converti au taux actuel,
 * et la fiche le dit ; sans taux du tout, le total en dollars est annoncé incomplet.
 */
export function ficheAchatRemplie(liste: LegumeListe[], achats: AchatDuJour[], tauxActuel: number): FicheAchat {
  // Regroupe les achats par légume puis par unité, dans l'ordre de saisie.
  type Groupe = { legume: string; unite: string; quantite: number; montants: (number | null)[] };
  const parLegume = new Map<string, Map<string, Groupe>>();
  for (const a of achats) {
    const cle = cleLibelle(a.legume);
    const unites = parLegume.get(cle) ?? parLegume.set(cle, new Map()).get(cle)!;
    const uniteSaisie = (a.unite ?? "").trim();
    const g = unites.get(cleLibelle(uniteSaisie)) ?? { legume: a.legume.trim(), unite: uniteSaisie, quantite: 0, montants: [] };
    g.quantite += a.quantite;
    g.montants.push(a.montantCDF);
    unites.set(cleLibelle(uniteSaisie), g);
  }

  const lignes: LigneFicheAchat[] = [];
  const enFin: LigneFicheAchat[] = [];
  const pris = new Set<string>();
  for (const l of liste) {
    const cle = cleLibelle(l.nom);
    const unites = parLegume.get(cle);
    if (!unites) {
      lignes.push({ designation: l.nom, unite: l.unite, quantite: null, montantCDF: null, horsListe: false });
      continue;
    }
    pris.add(cle);
    const groupes = [...unites.values()];
    // Sur la ligne du légume : les achats dans l'unité de la liste ou sans unité saisie ; à
    // défaut, l'unique groupe d'achats (dans son unité à lui). Les autres vont en fin de tableau.
    const memeUnite = groupes.filter((g) => g.unite === "" || cleLibelle(g.unite) === cleLibelle(l.unite));
    const surLaLigne = memeUnite.length ? memeUnite : groupes.length === 1 ? groupes : [];
    const uniteAffichee = memeUnite.length ? l.unite : surLaLigne[0]?.unite ?? l.unite;
    lignes.push({
      designation: l.nom,
      unite: uniteAffichee,
      quantite: surLaLigne.length ? surLaLigne.reduce((t, g) => t + g.quantite, 0) : null,
      montantCDF: surLaLigne.length ? somme(surLaLigne.flatMap((g) => g.montants)) : null,
      horsListe: false,
    });
    for (const g of groupes) if (!surLaLigne.includes(g)) enFin.push({ designation: g.legume, unite: g.unite, quantite: g.quantite, montantCDF: somme(g.montants), horsListe: true });
  }
  for (const [cle, unites] of parLegume) {
    if (pris.has(cle)) continue;
    for (const g of unites.values()) enFin.push({ designation: g.legume, unite: g.unite, quantite: g.quantite, montantCDF: somme(g.montants), horsListe: true });
  }

  // Totaux.
  const mentions: string[] = [];
  const avecMontant = achats.filter((a) => a.montantCDF !== null);
  const sansMontant = achats.length - avecMontant.length;
  const totalCDF = avecMontant.reduce((t, a) => t + (a.montantCDF ?? 0), 0);
  let totalUSD = 0;
  let convertisAuTauxActuel = 0;
  let nonConvertibles = 0;
  for (const a of avecMontant) {
    if (a.montantUSD !== null) totalUSD += a.montantUSD;
    else if (tauxActuel > 0) { totalUSD += (a.montantCDF ?? 0) / tauxActuel; convertisAuTauxActuel++; }
    else nonConvertibles++;
  }
  if (achats.length === 0) mentions.push("Aucun achat de légumes enregistré ce jour.");
  if (sansMontant > 0) mentions.push(`${formaterNombre(sansMontant)} achat(s) enregistré(s) sans montant : les totaux ne les comptent pas.`);
  if (convertisAuTauxActuel > 0) mentions.push(`${formaterNombre(convertisAuTauxActuel)} achat(s) sans contre-valeur enregistrée, convertis au taux actuel (1 USD = ${formaterNombre(tauxActuel)} CDF) : total en dollars provisoire.`);
  if (nonConvertibles > 0) mentions.push(`${formaterNombre(nonConvertibles)} achat(s) sans taux de change : total en dollars incomplet.`);

  return { lignes: [...lignes, ...enFin], totalCDF, totalUSD: avecMontant.length > nonConvertibles || avecMontant.length === 0 ? totalUSD : null, mentions };
}

// Formats d'affichage : toujours formaterNombre (jamais toLocaleString, cf. glyphes-manquants).
export const texteQuantite = (q: number | null) => (q === null ? "" : formaterNombre(q, { maximumFractionDigits: 3 }));
export const texteCDF = (n: number | null) => (n === null ? "" : formaterNombre(n, { maximumFractionDigits: 2 }));
export const texteUSD = (n: number | null) => (n === null ? "" : formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const styles = StyleSheet.create({
  totaux: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  colonneTotaux: { width: "46%" },
  ligneTotal: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  libelleTotal: { width: "55%", fontSize: 9.5, fontWeight: 700, color: pdfColors.brownDark },
  caseTotal: { width: "45%", minHeight: 18, border: `0.75 solid ${pdfColors.brownLight}`, justifyContent: "center", paddingHorizontal: 5 },
  valeurTotal: { fontSize: 9.5, fontWeight: 700, textAlign: "right" },
  mention: { marginTop: 4, fontSize: 7, fontStyle: "italic", color: pdfColors.textMuted },
});

function CaseTotal({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <View style={styles.ligneTotal}>
      <Text style={styles.libelleTotal}>{libelle}</Text>
      <View style={styles.caseTotal}><Text style={styles.valeurTotal}>{valeur}</Text></View>
    </View>
  );
}

/**
 * Le document. `date` : la date imprimée (fiche remplie) ; absente, un trait à remplir.
 * Rangées de 14 pt : les 38 légumes, l'en-tête et les totaux tiennent sur une page A4.
 */
export function FicheAchatLegumesDocument({ fiche, date }: { fiche: FicheAchat; date?: string }) {
  const rangees: RangeeFiche[] = fiche.lignes.map((l) => ({
    cellules: [l.designation, l.unite, texteQuantite(l.quantite), texteCDF(l.montantCDF)],
    horsListe: l.horsListe,
  }));
  const libelle = date ? `${TITRE_FICHE_ACHAT} — ${date}` : `${TITRE_FICHE_ACHAT} — fiche vierge`;
  return (
    <Document title={libelle}>
      <Page size="A4" style={stylePageFiche}>
        <PdfHeader title={TITRE_FICHE_ACHAT} subtitle="Montants en CDF" />
        <LigneDate date={date} />
        <TableauFiche colonnes={COLONNES_FICHE_ACHAT} rangees={rangees} hauteurRangee={14} />
        <View style={styles.totaux} wrap={false}>
          <View style={styles.colonneTotaux}>
            <CaseTotal libelle="Montant donné $" valeur="" />
          </View>
          <View style={styles.colonneTotaux}>
            <CaseTotal libelle="Montant total CDF" valeur={texteCDF(fiche.totalCDF)} />
            <CaseTotal libelle="Montant total $" valeur={texteUSD(fiche.totalUSD)} />
          </View>
        </View>
        {fiche.mentions.map((m, i) => <Text key={i} style={styles.mention}>{m}</Text>)}
        <PdfFooter docLabel={libelle} />
      </Page>
    </Document>
  );
}
