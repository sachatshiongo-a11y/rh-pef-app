import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { registerPdfFonts } from "./fonts";
import { PdfHeader, PdfFooter, PdfSectionHeader } from "./layout";
import { CorpsTableau, type Cellule, type Colonne } from "./tableau";
import { pdfColors } from "./theme";
import { texteSurPdf } from "./texte-sur";

registerPdfFonts();

// Fiche technique en PDF — une fiche par page (une <Page> par fiche : chacune commence en haut de
// page, et une fiche longue continue sur la suivante avec la barre d'en-tête de son tableau répétée).
// Modèle : les fiches de la Direction (classeur du bar, classeur des plats) — identité et photo,
// tableau des ingrédients, coût et prix, technique de préparation.
//
// Ce module NE CALCULE RIEN et ne met aucun montant en forme : il reçoit des TEXTES déjà qualifiés
// par la passerelle (`stock/fiches/_data/fiche-pdf.ts`), qui les tient du moteur de coût. La version
// « sans prix » (affichée au poste, en cuisine ou au bar) arrive SANS `chiffres` : ce document n'a
// alors, par construction, aucun montant à imprimer.

/** Photo embarquée (JPEG), ou `"illisible"` : la fiche en a une, que le serveur n'a pas pu lire. */
export type PhotoPdf = { data: Buffer; format: "jpg" } | "illisible";

export type IndicateurPdf = { libelle: string; valeur: string; alerte?: boolean };

/** Tout ce qui est chiffré sur une fiche. Absent = version sans prix. */
export type ChiffresFichePdf = {
  /** Une entrée par ligne d'ingrédient, dans le même ordre que `ingredients`. */
  lignes: { prixAchat: string; cout: string; motif: string | null }[];
  /** Valeur de la ligne « Total prix de revient HT », déjà qualifiée (« ≥ … (coût partiel) », « — (coût inconnu) »). */
  total: string;
  /** Mises en garde, dans l'ordre (coût partiel, portions inexploitables, prix non fiables). */
  avertissements: string[];
  /** Ingrédients non valorisés, nommés (jamais un chiffre nu). */
  nonValorises: string[];
  cout: IndicateurPdf[];
  /** Bloc « Prix de vente et marge » ; absent pour une sous-recette sans prix (comme à l'écran). */
  prix: { origine: string; alerte: string | null; indicateurs: IndicateurPdf[]; prixConseille: string | null } | null;
};

export type FichePdf = {
  nom: string;
  /** « Bar · Cocktail », « Plat · Pâtes classiques · Sous-recette »… */
  rubrique: string;
  /** « Nombre de verres : 1 », « Rendement : 4 600 g »… */
  mesures: string[];
  photo: PhotoPdf | null;
  ingredients: { nom: string; quantite: string; unite: string }[];
  /** Technique de préparation, une entrée par ligne saisie (lignes vides comprises). */
  recette: string[];
  chiffres: ChiffresFichePdf | null;
};

const AMBRE_FOND = "#FDF3E1";
const AMBRE_BORD = "#E9C68C";
const AMBRE_TEXTE = "#7A4B0C";

const s = StyleSheet.create({
  // Pied court : 50 pt suffisent sous le contenu (contre 96 pour le pied de marque complet).
  page: { paddingTop: 26, paddingHorizontal: 30, paddingBottom: 50, fontSize: 9, fontFamily: "Optima", color: pdfColors.text },
  identite: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  identiteTexte: { flex: 1, paddingRight: 14 },
  nom: { fontSize: 18, fontWeight: 700, color: pdfColors.brownDark, marginBottom: 4 },
  rubrique: { fontSize: 10, color: pdfColors.brown, marginBottom: 8 },
  mesure: { fontSize: 10, marginBottom: 2 },
  variante: { marginTop: 8, fontSize: 7.5, fontStyle: "italic", color: pdfColors.textMuted },
  photoCadre: { width: 180, height: 135, border: `0.75 solid ${pdfColors.border}`, backgroundColor: pdfColors.cream, alignItems: "center", justifyContent: "center" },
  photo: { width: 178, height: 133, objectFit: "contain" },
  photoAbsente: { fontSize: 7.5, color: pdfColors.textMuted, textAlign: "center", paddingHorizontal: 10 },
  bloc: { marginBottom: 12 },
  titreBloc: { marginBottom: 4 },
  vide: { fontSize: 8.5, fontStyle: "italic", color: pdfColors.textMuted, paddingVertical: 4 },
  nonValorises: { marginTop: 4, fontSize: 7.5, color: AMBRE_TEXTE },
  alerte: { backgroundColor: AMBRE_FOND, border: `0.75 solid ${AMBRE_BORD}`, color: AMBRE_TEXTE, fontSize: 8, padding: 5, marginBottom: 5 },
  origine: { fontSize: 7.5, color: pdfColors.textMuted, marginBottom: 5 },
  grille: { flexDirection: "row", flexWrap: "wrap", border: `0.75 solid ${pdfColors.border}` },
  indicateur: { width: "50%", flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, paddingHorizontal: 6, borderBottom: `0.5 solid ${pdfColors.border}` },
  indicateurAlerte: { backgroundColor: AMBRE_FOND },
  libelle: { fontSize: 8, color: pdfColors.textMuted, flex: 1, paddingRight: 6 },
  valeur: { fontSize: 9, fontWeight: 700, color: pdfColors.brownDark, textAlign: "right" },
  conseille: { marginTop: 5, fontSize: 8.5 },
  recette: { fontSize: 9.5, lineHeight: 1.45 },
  recetteVide: { height: 6 },
});

const COLONNES_CHIFFREES: Colonne[] = [
  { header: "Article ou sous-recette", width: "38%" },
  { header: "Quantité", width: "12%", align: "right" },
  { header: "Unité", width: "10%" },
  { header: "Prix d'achat HT", width: "22%", align: "right" },
  { header: "Coût HT", width: "18%", align: "right" },
];
const COLONNES_POSTE: Colonne[] = [
  { header: "Article ou sous-recette", width: "60%" },
  { header: "Quantité", width: "20%", align: "right" },
  { header: "Unité", width: "20%" },
];

/** Titre de bloc : ne reste jamais seul en bas de page, il part avec ce qui le suit. */
function TitreBloc({ children, apres = 50 }: { children: string; apres?: number }) {
  return (
    <View style={s.titreBloc} wrap={false} minPresenceAhead={apres}>
      <PdfSectionHeader>{children}</PdfSectionHeader>
    </View>
  );
}

function Photo({ photo }: { photo: PhotoPdf }) {
  return (
    <View style={s.photoCadre}>
      {photo === "illisible" ? (
        <Text style={s.photoAbsente}>Photo enregistrée sur la fiche, mais illisible au moment de l&apos;édition.</Text>
      ) : (
        <Image src={photo as unknown as string} style={s.photo} />
      )}
    </View>
  );
}

function Indicateurs({ items }: { items: IndicateurPdf[] }) {
  return (
    <View style={s.grille}>
      {items.map((it, i) => (
        <View key={i} style={[s.indicateur, it.alerte ? s.indicateurAlerte : {}]} wrap={false}>
          <Text style={s.libelle}>{texteSurPdf(it.libelle)}</Text>
          <Text style={s.valeur}>{texteSurPdf(it.valeur)}</Text>
        </View>
      ))}
    </View>
  );
}

function PageFiche({ fiche, editeLe }: { fiche: FichePdf; editeLe: string }) {
  const c = fiche.chiffres;
  const nom = texteSurPdf(fiche.nom);
  const lignes: Cellule[][] = fiche.ingredients.map((ing, i) => {
    const base: Cellule[] = [texteSurPdf(ing.nom), ing.quantite, texteSurPdf(ing.unite)];
    if (!c) return base;
    const ch = c.lignes[i];
    return [
      ch.motif ? { texte: texteSurPdf(ing.nom), note: `non valorisé : ${texteSurPdf(ch.motif)}` } : base[0],
      base[1], base[2], texteSurPdf(ch.prixAchat), ch.cout,
    ];
  });
  if (c) lignes.push(["Total prix de revient HT", "", "", "", c.total]);
  const variante = c ? "Fiche chiffrée" : "Version poste, sans prix";

  return (
    <Page size="A4" style={s.page}>
      <PdfHeader title="Fiche technique" subtitle={`${nom}${c ? "" : " · sans prix"}`} />

      <View style={s.identite} wrap={false}>
        <View style={s.identiteTexte}>
          <Text style={s.nom}>{nom}</Text>
          <Text style={s.rubrique}>{texteSurPdf(fiche.rubrique)}</Text>
          {fiche.mesures.map((m, i) => <Text key={i} style={s.mesure}>{texteSurPdf(m)}</Text>)}
          <Text style={s.variante}>{variante} · éditée le {editeLe}</Text>
        </View>
        {fiche.photo && <Photo photo={fiche.photo} />}
      </View>

      <View style={s.bloc}>
        <TitreBloc>{`Ingrédients (${fiche.ingredients.length})`}</TitreBloc>
        {fiche.ingredients.length === 0 ? (
          <Text style={s.vide}>Aucun ingrédient saisi sur cette fiche.</Text>
        ) : (
          <CorpsTableau colonnes={c ? COLONNES_CHIFFREES : COLONNES_POSTE} lignes={lignes} totalDerniereLigne={!!c} />
        )}
        {c && fiche.ingredients.length === 0 && (
          <Text style={s.nonValorises}>Total prix de revient HT : {c.total}</Text>
        )}
        {c && c.nonValorises.length > 0 && (
          <Text style={s.nonValorises}>
            Non valorisés (ils ne sont pas comptés pour zéro, ils ne sont pas comptés du tout) : {c.nonValorises.map(texteSurPdf).join(" ; ")}
          </Text>
        )}
      </View>

      {/* Les blocs Coût et Prix sont de hauteur BORNÉE (quelques indicateurs, jamais une liste) :
          insécables, ils partent entiers à la page suivante plutôt que de laisser leur titre seul en
          bas de page — ce que `minPresenceAhead` ne garantissait pas. Le tableau des ingrédients,
          lui, reste sécable (rangées insécables, en-tête répété). */}
      {c && (
        <View style={s.bloc} wrap={false}>
          <TitreBloc apres={70}>Coût de revient</TitreBloc>
          {c.avertissements.map((a, i) => <Text key={i} style={s.alerte} wrap={false}>{a}</Text>)}
          <Indicateurs items={c.cout} />
        </View>
      )}

      {c?.prix && (
        <View style={s.bloc} wrap={false}>
          <TitreBloc apres={70}>Prix de vente et marge</TitreBloc>
          <Text style={s.origine}>{c.prix.origine}</Text>
          {c.prix.alerte && <Text style={s.alerte} wrap={false}>{c.prix.alerte}</Text>}
          <Indicateurs items={c.prix.indicateurs} />
          {c.prix.prixConseille && <Text style={s.conseille} wrap={false}>{c.prix.prixConseille}</Text>}
        </View>
      )}

      <View style={s.bloc}>
        {/* Le titre part avec la PREMIÈRE ligne de la technique (insécables ensemble) ; la suite, de
            longueur libre, se découpe entre les pages ligne à ligne. */}
        <View wrap={false}>
          <TitreBloc>Technique de préparation</TitreBloc>
          {fiche.recette.length === 0
            ? <Text style={s.vide}>Aucune technique de préparation saisie sur cette fiche.</Text>
            : <Text style={s.recette}>{texteSurPdf(fiche.recette[0])}</Text>}
        </View>
        {fiche.recette.slice(1).map((l, i) => (l.trim() ? <Text key={i} style={s.recette}>{texteSurPdf(l)}</Text> : <View key={i} style={s.recetteVide} />))}
      </View>

      {/* Pied court (sans les coordonnées bancaires de la société) : document de travail interne. */}
      <PdfFooter coordonnees={false} docLabel={`Fiche technique · ${nom} · ${variante.toLowerCase()} · éditée le ${editeLe}`} />
    </Page>
  );
}

/** Une ou plusieurs fiches techniques, une par page (dans l'ordre reçu). `editeLe` : « 30/09/2026 ». */
export function FichesTechniquesDocument({ fiches, editeLe }: { fiches: FichePdf[]; editeLe: string }) {
  return (
    <Document title={fiches.length === 1 ? `Fiche technique ${fiches[0].nom}` : "Fiches techniques"}>
      {fiches.map((f, i) => <PageFiche key={i} fiche={f} editeLe={editeLe} />)}
    </Document>
  );
}
