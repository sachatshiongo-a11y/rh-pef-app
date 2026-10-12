import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { formaterNombre } from "@/lib/montant";
import { sansAccents } from "@/lib/texte";
import { normaliserUnite } from "@/lib/fiches/conversion";
import { registerPdfFonts } from "./fonts";
import { logoPath } from "./layout";
import { A4, LOGO, MARGES, NOTE, RANGEE, lignesDeNote, mesuresFiche, type MesuresFiche } from "./fiche-achat-legumes-modele";

registerPdfFonts();

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

export const TITRE_FICHE_ACHAT = "Achat de légumes Marché";
/** Colonnes du modèle, dans son ordre ; les nombres (QTÉ, Montant) s'alignent à droite comme dans Excel. */
export const COLONNES_FICHE_ACHAT: { entete: string; align: "left" | "right" }[] = [
  { entete: "Désignation", align: "left" },
  { entete: "Unité", align: "left" },
  { entete: "QTÉ", align: "right" },
  { entete: "Montant", align: "right" },
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

/** Clé de comparaison d'une unité : la normalisation unique de la conversion (« Botte » = « Bottes », « Kg » = « kg »). */
const cleUnite = (u: string | null | undefined) => normaliserUnite(String(u ?? "").trim().replace(/\.$/, ""));

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
    const g = unites.get(cleUnite(uniteSaisie)) ?? { legume: a.legume.trim(), unite: uniteSaisie, quantite: 0, montants: [] };
    g.quantite += a.quantite;
    g.montants.push(a.montantCDF);
    unites.set(cleUnite(uniteSaisie), g);
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
    const memeUnite = groupes.filter((g) => g.unite === "" || cleUnite(g.unite) === cleUnite(l.unite));
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
