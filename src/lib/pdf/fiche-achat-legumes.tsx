import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { formaterNombre } from "@/lib/montant";
import { registerPdfFonts } from "./fonts";
import { logoPath } from "./layout";
import { type FicheAchat, COLONNES_FICHE_ACHAT, TITRE_FICHE_ACHAT } from "./fiche-achat-legumes-donnees";
import { A4, LOGO, MARGES, NOTE, RANGEE, lignesDeNote, mesuresFiche, type MesuresFiche } from "./fiche-achat-legumes-modele";

registerPdfFonts();

export * from "./fiche-achat-legumes-donnees";

/**
 * Fiche « Achat de légumes Marché » (modèle remis par la Direction, 2026-09-28) : Désignation |
 * Unité | QTÉ | Montant pour chaque légume de la liste, puis « Montant donné $ », « Montant total
 * CDF » et « Montant total $ ».
 *
 * Mise en page : celle du modèle de la Direction, onglet « Achat légumes » du classeur « Fiche
 * inventaire cuisine, bar et achat légumes » (voir fiche-achat-legumes-modele.ts) : Optima gras
 * corps 14 à l'échelle d'Excel, logo, « Date : », titre encadré, tableau à cadre épais et traits
 * pointillés, totaux sans cadre, A4 portrait, marges du classeur. Aucun pied de page de marque : le
 * modèle n'en a pas.
 *
 * - VIERGE : cases QTÉ et Montant vides, totaux vides, date à écrire à la main.
 * - REMPLIE pour une date : les achats (AchatLegume) de ce jour. Un légume de la liste reçoit sa
 *   quantité et son montant en CDF ; un légume non acheté reste vide ; un achat dont le libellé
 *   n'est pas dans la liste s'ajoute en fin de tableau. « Montant donné $ » reste vide : l'argent
 *   remis à l'acheteur n'est pas enregistré par l'application. Un total que les achats ne
 *   permettent pas de calculer s'écrit « — » (et la note dit pourquoi), jamais une case vide.
 */

// Formats d'affichage : toujours formaterNombre (jamais toLocaleString, cf. glyphes-manquants).
export const texteQuantite = (q: number | null) => (q === null ? "" : formaterNombre(q, { maximumFractionDigits: 3 }));
export const texteCDF = (n: number | null) => (n === null ? "" : formaterNombre(n, { maximumFractionDigits: 2 }));
export const texteUSD = (n: number | null) => (n === null ? "" : formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const NOIR = "#000000";
/**
 * Libellés tels que la fiche de la Direction les écrit, quand la liste de l'application en diffère
 * : « Lemons/ Citrons-verts » garde dans la liste son espacement d'origine (la grille de commande du
 * restaurant est indexée sur le libellé exact, cf. legumes-data.ts) ; la fiche imprimée reprend celui
 * du modèle.
 */
const LIBELLE_IMPRIME: Record<string, string> = { "Lemons / Citrons-verts": "Lemons/ Citrons-verts" };
/** Désignation d'un légume de la liste telle qu'elle s'imprime. */
export const libelleImprime = (nom: string) => LIBELLE_IMPRIME[nom] ?? nom;
/** Interligne du texte imprimé : une ligne ne dépasse jamais la rangée du modèle (sinon la rangée s'agrandit et la page déborde). */
const INTERLIGNE = 0.8;

type Bords = Partial<Record<"haut" | "bas" | "gauche" | "droite", "epais" | "fin">>;

/**
 * Bordures d'une case : le trait épais (cadre) est posé par-dessus la case, centré sur son bord
 * comme dans Excel, sans prendre de place (il n'agrandit pas la rangée) ; le pointillé fin
 * (intérieur) est une vraie bordure de 0,5 pt, sans effet sensible sur la hauteur.
 */
function bordures(m: MesuresFiche, b: Bords): { style: Style; epais: Style[] } {
  const style: Style = {};
  const epais: Style[] = [];
  const cote = { haut: "Top", bas: "Bottom", gauche: "Left", droite: "Right" } as const;
  for (const k of Object.keys(b) as (keyof Bords)[]) {
    const trait = b[k];
    if (!trait) continue;
    if (trait === "fin") {
      style[`border${cote[k]}Width`] = m.fin;
      style[`border${cote[k]}Color`] = NOIR;
      style[`border${cote[k]}Style`] = "dashed";
    } else {
      const d = -m.epais / 2;
      const base: Style = { position: "absolute", backgroundColor: NOIR };
      if (k === "haut") epais.push({ ...base, left: d, right: d, top: d, height: m.epais });
      else if (k === "bas") epais.push({ ...base, left: d, right: d, bottom: d, height: m.epais });
      else if (k === "gauche") epais.push({ ...base, top: d, bottom: d, left: d, width: m.epais });
      else epais.push({ ...base, top: d, bottom: d, right: d, width: m.epais });
    }
  }
  return { style, epais };
}

/**
 * Distance de la ligne de base au bas de la rangée, en corps de police : celle de l'impression
 * d'Excel (texte aligné en bas, la rangée garde la place des jambages), relevée par rangée.
 */
const REMONTEE = { donnees: 0.249, entete: 0.361, titre: 0.44, date: 0.457, totaux: 0.297 } as const;

/** Une case : texte gras du modèle, aligné en bas de la rangée comme Excel. */
function Case({ m, largeur, texte, align = "left", bords = {}, hauteur, remontee = REMONTEE.donnees }: {
  m: MesuresFiche; largeur: number; texte: string; align?: "left" | "right" | "center"; bords?: Bords; hauteur: number; remontee?: number;
}) {
  const b = bordures(m, bords);
  return (
    <View style={{ width: largeur, minHeight: hauteur, justifyContent: "flex-end", paddingHorizontal: m.marge, paddingBottom: m.police * remontee, ...b.style }}>
      {texte !== "" ? <Text style={{ fontSize: m.police, fontWeight: 700, color: NOIR, textAlign: align, lineHeight: INTERLIGNE }}>{texte}</Text> : null}
      {b.epais.map((e, i) => <View key={i} style={e} />)}
    </View>
  );
}

/** Rangée sans cadre (haut de page, totaux) : cases juxtaposées sur les colonnes B à E. */
function RangeeLibre({ m, hauteur, cases, remontee }: { m: MesuresFiche; hauteur: number; remontee: number; cases: { colonne: 0 | 1 | 2 | 3; texte: string; largeur?: number }[] }) {
  // Les cases vides ne s'impriment pas : on place chaque texte à l'abscisse de sa colonne.
  const x = (c: number) => m.colonnes.slice(0, c).reduce((t, w) => t + w, 0);
  return (
    <View style={{ position: "relative", height: hauteur, width: m.tableau }}>
      {cases.map((c, i) => (
        <View key={i} style={{ position: "absolute", left: x(c.colonne), bottom: m.police * remontee, width: c.largeur ?? m.colonnes[c.colonne], paddingHorizontal: m.marge }}>
          <Text style={{ fontSize: m.police, fontWeight: 700, color: NOIR, lineHeight: INTERLIGNE }}>{c.texte}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Le document. `date` : la date imprimée (fiche remplie) ; absente, « Date : » seul, à compléter à la
 * main. Même échelle qu'Excel (« Ajuster à 1 page ») : les 38 légumes, l'en-tête et les totaux tiennent
 * sur une page A4 ; des lignes en plus resserrent l'échelle jusqu'au plancher, puis passent à la page
 * suivante avec l'en-tête du tableau répété. Les rangées sont insécables (`wrap={false}`).
 */
export function FicheAchatLegumesDocument({ fiche, date }: { fiche: FicheAchat; date?: string }) {
  const hauteurNotes = fiche.mentions.reduce((t, n) => t + lignesDeNote(n) * NOTE.police * NOTE.interligne, 0) + (fiche.mentions.length ? NOTE.marge + 6 : 0);
  const m = mesuresFiche(fiche.lignes.length, hauteurNotes);
  const libelle = date ? `${TITRE_FICHE_ACHAT} — ${date}` : `${TITRE_FICHE_ACHAT} — fiche vierge`;
  const { h } = m;
  const dernier = fiche.lignes.length - 1;
  // Total inconnu sur une fiche remplie : « — », jamais une case vide qu'on lirait comme zéro.
  const totalUSD = fiche.totalCDF !== null && fiche.totalUSD === null ? "—" : texteUSD(fiche.totalUSD);
  const logoRestant = LOGO.largeur * m.echelle;

  return (
    <Document title={libelle}>
      <Page size="A4" style={{ paddingTop: MARGES.hautBas, paddingBottom: MARGES.hautBas, paddingLeft: MARGES.cotes, paddingRight: MARGES.cotes, fontFamily: "Optima", color: NOIR, backgroundColor: "#ffffff" }}>
        <View style={{ marginLeft: m.gauche, width: A4.largeur - 2 * MARGES.cotes - m.gauche }}>
          {/* Rangées 1 à 3 : logo (deux rangées), puis « Date : » sur la colonne D. */}
          <View style={{ position: "relative", height: h(RANGEE.defaut) * 2 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf : pas d'attribut alt dans un PDF */}
            <Image src={logoPath} style={{ position: "absolute", left: 0, top: 0, width: logoRestant, height: LOGO.hauteur * m.echelle, objectFit: "contain" }} />
          </View>
          <RangeeLibre m={m} hauteur={h(RANGEE.defaut)} remontee={REMONTEE.date} cases={[{ colonne: 2, texte: date ? `Date : ${date}` : "Date :", largeur: m.colonnes[2] + m.colonnes[3] + 120 }]} />
          <View style={{ height: h(RANGEE.defaut) }} />
          {/* Rangée 5 : titre encadré, sur les quatre colonnes. */}
          <Case m={m} largeur={m.tableau} texte={TITRE_FICHE_ACHAT} align="center" hauteur={h(RANGEE.titre)} remontee={REMONTEE.titre} bords={{ haut: "epais", bas: "epais", gauche: "epais", droite: "epais" }} />
          <View style={{ height: h(RANGEE.defaut) }} />
          {/* Rangée 7 : en-tête, répété en haut de chaque page ; puis une rangée par légume. */}
          <View fixed style={{ flexDirection: "row" }}>
            {COLONNES_FICHE_ACHAT.map((c, j) => (
              <Case key={j} m={m} largeur={m.colonnes[j]!} texte={c.entete} align="center" hauteur={h(RANGEE.entete)} remontee={REMONTEE.entete}
                bords={{ haut: "epais", bas: "epais", gauche: j === 0 ? "epais" : "fin", droite: j === 3 ? "epais" : undefined }} />
            ))}
          </View>
          {fiche.lignes.map((l, i) => {
            const { designation } = l; // une seule lecture : le garde-fou libelle-article recense les lectures de `.designation`
            const cellules = [l.horsListe ? designation : libelleImprime(designation), l.unite, texteQuantite(l.quantite), texteCDF(l.montantCDF)];
            return (
              <View key={i} wrap={false} style={{ flexDirection: "row" }}>
                {cellules.map((t, j) => (
                  <Case key={j} m={m} largeur={m.colonnes[j]!} texte={t} align={COLONNES_FICHE_ACHAT[j]!.align} hauteur={h(i === 0 ? RANGEE.premiere : RANGEE.defaut)}
                    bords={{ bas: i === dernier ? "epais" : "fin", gauche: j === 0 ? "epais" : "fin", droite: j === 3 ? "epais" : undefined }} />
                ))}
              </View>
            );
          })}
          {/* Rangées 47 et 48 : totaux, un nombre écrit à droite de son libellé, sans cadre (comme le modèle). */}
          <View wrap={false}>
            <View style={{ height: h(RANGEE.defaut) }} />
            <RangeeLibre m={m} hauteur={h(RANGEE.defaut)} remontee={REMONTEE.totaux} cases={[
              { colonne: 0, texte: "Montant donné $" },
              { colonne: 2, texte: "Montant total CDF" },
              { colonne: 3, texte: texteCDF(fiche.totalCDF), largeur: m.colonnes[3] + 120 },
            ]} />
            <RangeeLibre m={m} hauteur={h(RANGEE.defaut)} remontee={REMONTEE.totaux} cases={[
              { colonne: 2, texte: "Montant total $" },
              { colonne: 3, texte: totalUSD, largeur: m.colonnes[3] + 120 },
            ]} />
          </View>
          {fiche.mentions.map((n, i) => (
            <Text key={i} style={{ marginTop: i === 0 ? NOTE.marge : 1, fontSize: NOTE.police, lineHeight: NOTE.interligne, fontStyle: "italic", fontWeight: 400, color: "#555555" }}>{n}</Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}
