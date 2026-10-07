import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import { registerPdfFonts } from "@/lib/pdf/fonts";
import { formaterNombre } from "@/lib/montant";
import { estFormatDate, largeurColonne, texteCellule, type Gabarit, type StyleCellule, type Trait, type Zone } from "./gabarit";
import type { CelluleSortie, Contenu, FeuilleSortie, RangeeSortie } from "./remplir";

registerPdfFonts();

// IMPRESSION d'une feuille du gabarit remplie, comme Excel l'imprime : zone d'impression, marges,
// échelle, logo à son ancrage, largeurs de colonnes et hauteurs de rangées du classeur, polices,
// fonds, bordures et alignements de chaque cellule. Une feuille commence sur une nouvelle page.
//
// Mesures relevées sur l'impression PDF des deux modèles par Excel (Mac, 2026-10-07) : une unité de
// largeur de colonne s'imprime 6,0 pt (avant l'échelle) et une rangée à 0,91 de sa hauteur nominale.
// L'échelle est celle du classeur (ajustement à la page), réduite s'il le faut pour que chaque page
// du modèle tienne sur sa page.
//
// Règles maison : rangées insécables (jamais le tableau entier), une rubrique ne reste jamais seule
// en bas de page, en-tête de colonnes répété en haut de chaque page de suite ; nombres par
// `formaterNombre` (jamais d'espace fine U+202F, absente d'Optima).

const PT_PAR_UNITE = 6.0;
const FACTEUR_HAUTEUR = 0.91;
/** Interligne du texte imprimé (hauteur d'une ligne / corps). */
const INTERLIGNE = 1.15;
const A4 = { largeur: 595.28, hauteur: 841.89 };
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const RANG_TRAIT: Record<string, number> = { hair: 1, dotted: 2, dashDotDot: 2, dashDot: 2, dashed: 2, thin: 3, mediumDashDotDot: 4, mediumDashDot: 4, mediumDashed: 4, medium: 5, double: 6, thick: 7 };
const EPAISSEUR = (t: Trait) => ((RANG_TRAIT[t.style] ?? 3) >= 7 ? 1.4 : (RANG_TRAIT[t.style] ?? 3) >= 4 ? 0.9 : 0.45);
const plusFort = (a: Trait | null | undefined, b: Trait | null | undefined): Trait | null =>
  !a ? b ?? null : !b ? a : (RANG_TRAIT[b.style] ?? 3) > (RANG_TRAIT[a.style] ?? 3) ? b : a;

/** Date Excel (numéro de série) → texte, au format de la case (« 28-sept. » pour « d-mmm »). */
function texteDate(serie: number, format: string): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serie) * 86_400_000);
  const j = d.getUTCDate(), m = d.getUTCMonth();
  const f = format.replace(/\[[^\]]*\]/g, "").replace(/;.*$/, "");
  if (/mmm/i.test(f) && !/y/i.test(f)) return `${j}-${MOIS_COURTS[m]}`;
  return `${String(j).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Texte imprimé d'une cellule. */
export function texteImprime(c: Contenu, st: StyleCellule | undefined, g: Gabarit): string {
  const format = st?.format ?? "General";
  const nombre = (n: number) => (estFormatDate(format) ? texteDate(n, format) : formaterNombre(n, { maximumFractionDigits: 3 }));
  switch (c.genre) {
    case "vide": return "";
    case "texte": return c.texte;
    case "nombre": return formaterNombre(c.valeur, { maximumFractionDigits: 3 }); // quantité : jamais au format date
    case "formule": return typeof c.cache === "number" ? nombre(c.cache) : c.cache;
    case "brut": {
      const t = texteCellule(c.cellule, g.partages);
      if (t !== null) return t;
      if (c.cellule.v === null || c.cellule.t === "b" || c.cellule.t === "e") return "";
      const n = Number(c.cellule.v);
      return Number.isFinite(n) ? nombre(n) : c.cellule.v;
    }
  }
}

type Mesures = {
  g: Gabarit;
  f: FeuilleSortie;
  zone: Zone;
  echelle: number;
  x: (col: number) => number; // bord gauche de la colonne, en points (échelle comprise), depuis la zone
  l: (col: number) => number;
  h: (r: number) => number;
  rangee: Map<number, RangeeSortie>;
  cellule: (r: number, col: number) => CelluleSortie | undefined;
  style: (r: number, col: number) => StyleCellule | undefined;
};

function zoneDe(f: FeuilleSortie): Zone {
  if (f.zone) return f.zone;
  const cols = f.rangees.flatMap((r) => r.cellules.map((c) => c.col));
  return { c1: 1, r1: 1, c2: Math.max(1, ...cols), r2: Math.max(1, ...f.rangees.map((r) => r.r)) };
}

/**
 * Échelle : comme Excel avec « Ajuster à » — la largeur de la zone sur une page, la hauteur sur le
 * nombre de pages du classeur, calculées sur la feuille REMPLIE (une ligne ajoutée resserre la page,
 * comme dans Excel). La feuille Bar du rapport imprime une page par en-tête répété : chaque page
 * doit tenir. Plancher : 70 % de l'échelle du classeur — au-delà, on passe à la page suivante
 * (en-tête répété) plutôt que d'imprimer illisible.
 */
function echelleDe(f: FeuilleSortie, zone: Zone, utile: { largeur: number; hauteur: number }, hauteurNominale: (r: number) => number): number {
  const gf = f.gabarit;
  const sq = f.squelette!;
  let largeur = 0;
  for (let c = zone.c1; c <= zone.c2; c++) largeur += (f.colonnes.find((k) => k.min <= c && c <= k.max)?.largeur ?? gf.largeurDefaut) * PT_PAR_UNITE;
  const presentes = new Set(f.rangees.map((r) => r.r));
  const somme = (de: number, a: number, toutes = false) => { let s = 0; for (let r = de; r <= a; r++) if (toutes || presentes.has(r)) s += hauteurNominale(r); return s; };
  const titre = somme(zone.r1, sq.ligneEntete - 1, true);
  const entete = somme(sq.ligneEntete, sq.finEntete, true);
  const bornes = [sq.debutCorps, ...f.entetesRepetes.map((gr) => gr[0]!), zone.r2 + 1];
  const pages = bornes.slice(0, -1).map((de, i) => somme(de, bornes[i + 1]! - 1) + (i === 0 ? titre + entete : 0));
  const n = gf.pagesEnHauteur ?? 1;
  const enHauteur = pages.length === 1 ? (n * utile.hauteur) / (pages[0]! + (n - 1) * entete) : Math.min(...pages.map((p) => utile.hauteur / p));
  const enLargeur = utile.largeur / largeur;
  if (gf.pagesEnHauteur === null) return Math.min(gf.echelle ?? 1, enLargeur);
  const plancher = 0.7 * (gf.echelle ?? enLargeur);
  return Math.min(enLargeur, Math.max(enHauteur, plancher));
}

/** Bordures d'une case : chaque trait mitoyen n'est tracé qu'une fois (le plus fort des deux côtés). */
function bordures(m: Mesures, r: number, col: number, bas: number, droite: number, premiereColonne: boolean, premiereRangee: boolean, rangeeDessous: number | null): Style {
  const st = m.style(r, col);
  const out: Style = {};
  const trait = (cote: "Left" | "Right" | "Top" | "Bottom", t: Trait | null) => {
    if (!t) return;
    out[`border${cote}Width`] = EPAISSEUR(t);
    out[`border${cote}Color`] = t.couleur;
    out[`border${cote}Style`] = "solid";
  };
  let d: Trait | null = null;
  for (let rr = r; rr <= bas; rr++) d = plusFort(d, plusFort(m.style(rr, droite)?.bordure.droite, m.style(rr, droite + 1)?.bordure.gauche));
  trait("Right", d);
  let b: Trait | null = null;
  for (let c = col; c <= droite; c++) b = plusFort(b, plusFort(m.style(bas, c)?.bordure.bas, rangeeDessous !== null ? m.style(rangeeDessous, c)?.bordure.haut : null));
  trait("Bottom", b);
  if (premiereColonne) trait("Left", plusFort(st?.bordure.gauche, col > m.zone.c1 ? m.style(r, col - 1)?.bordure.droite : null));
  if (premiereRangee) trait("Top", st?.bordure.haut ?? null);
  return out;
}

function styleTexte(st: StyleCellule | undefined, echelle: number, estNombre: boolean): Style {
  const p = st?.police;
  const h = st?.horizontal ?? (estNombre ? "right" : "left");
  return {
    fontFamily: "Optima",
    fontSize: (p?.taille ?? 11) * echelle,
    fontWeight: p?.gras ? 700 : 400,
    fontStyle: p?.italique ? "italic" : "normal",
    textDecoration: p?.souligne ? "underline" : "none",
    color: p?.couleur ?? "#000000",
    textAlign: h === "center" || h === "centerContinuous" ? "center" : h === "right" ? "right" : "left",
    lineHeight: INTERLIGNE,
  };
}

const alignementVertical = (st: StyleCellule | undefined): Style["justifyContent"] =>
  st?.vertical === "center" ? "center" : st?.vertical === "top" ? "flex-start" : "flex-end";

/** Bloc de rangées à hauteur fixe, cases placées à leur position (fusions, logo) : titre et en-têtes. */
function BlocFixe({ m, lignes, premier }: { m: Mesures; lignes: number[]; premier: boolean }) {
  const { zone, echelle } = m;
  const haut = new Map<number, number>();
  let y = 0;
  for (const r of lignes) { haut.set(r, y); y += m.h(r); }
  const largeurTotale = m.x(zone.c2 + 1);
  const cases: React.ReactNode[] = [];
  for (const r of lignes) {
    for (let col = zone.c1; col <= zone.c2; col++) {
      const fusion = m.f.gabarit.fusions.find((z) => z.c1 <= col && col <= z.c2 && m.f.nouvelleLigne(z.r1) <= r && r <= m.f.nouvelleLigne(z.r2));
      if (fusion && (fusion.c1 !== col || m.f.nouvelleLigne(fusion.r1) !== r)) continue;
      const bas = fusion ? Math.min(m.f.nouvelleLigne(fusion.r2), lignes.at(-1)!) : r;
      const droite = fusion ? fusion.c2 : col;
      const c = m.cellule(r, col);
      const st = m.style(r, col);
      const texte = c ? texteImprime(c.contenu, st, m.g) : "";
      const largeur = m.x(droite + 1) - m.x(col);
      let hauteur = 0;
      for (let rr = r; rr <= bas; rr++) hauteur += m.h(rr);
      const iBas = lignes.indexOf(bas);
      const dessous = iBas >= 0 && iBas < lignes.length - 1 ? lignes[iBas + 1]! : null;
      const bord = bordures(m, r, col, bas, droite, col === zone.c1, r === lignes[0], dessous);
      if (!texte && !st?.fond && !Object.keys(bord).length) continue;
      // Texte non renvoyé à la ligne et aligné à gauche : il déborde sur les cases vides voisines, comme dans Excel.
      let largeurTexte = largeur;
      if (texte && !st?.retour && (st?.horizontal ?? "left") === "left") {
        let k = droite + 1;
        while (k <= zone.c2 && !(m.cellule(r, k) && texteImprime(m.cellule(r, k)!.contenu, m.style(r, k), m.g))) k++;
        largeurTexte = m.x(k) - m.x(col);
      }
      cases.push(
        <View key={`${r}-${col}`} style={{ position: "absolute", left: m.x(col), top: haut.get(r)!, width: largeur, height: hauteur, backgroundColor: st?.fond ?? undefined, ...bord }} />,
      );
      if (texte) {
        // Boîte du texte jamais plus basse que sa ligne : react-pdf ÉCARTE en silence un texte qui ne
        // tient pas dans une hauteur imposée (les jours de l'en-tête disparaissaient). Excel laisse
        // le texte déborder de sa rangée : la boîte est centrée sur la rangée, au moins une ligne haute.
        const ligne = (st?.police.taille ?? 11) * echelle * INTERLIGNE + 1;
        const boite = Math.max(hauteur, ligne);
        const v = st?.vertical === "center" ? (hauteur - boite) / 2 : st?.vertical === "top" ? 0 : hauteur - boite;
        cases.push(
          <View key={`t${r}-${col}`} style={{ position: "absolute", left: m.x(col), top: haut.get(r)! + v, width: largeurTexte, height: boite, justifyContent: alignementVertical(st), paddingHorizontal: 1.5 * echelle + 0.5 }}>
            <Text style={styleTexte(st, echelle, c?.contenu.genre === "nombre")}>{texte}</Text>
          </View>,
        );
      }
    }
  }
  // Logo, à son ancrage, s'il commence dans ce bloc.
  const d = m.f.gabarit.dessin;
  if (premier && d) {
    const a = d.ancre;
    const col = a.col + 1, rangee = a.ligne + 1;
    if (col >= zone.c1 && haut.has(rangee)) {
      // Décalages de l'ancre : proportionnels à la case (Excel les compte dans sa propre mesure des colonnes).
      const largeurExcel = Math.max(1, largeurColonne(m.f.gabarit, col) * 7 + 5) * 0.75;
      const fx = Math.min(1, a.decalageCol / largeurExcel);
      const fy = Math.min(1, a.decalageLigne / ((m.rangee.get(rangee)?.hauteur ?? m.f.gabarit.hauteurDefaut) || 1));
      const png = m.g.parties.get(d.media);
      if (png) {
        cases.push(
          // eslint-disable-next-line jsx-a11y/alt-text -- Image de react-pdf : pas d'attribut alt dans un PDF
          <Image key="logo" src={{ data: Buffer.from(png), format: "png" }} style={{
            position: "absolute",
            left: m.x(col) + fx * (m.x(col + 1) - m.x(col)),
            top: haut.get(rangee)! + fy * m.h(rangee),
            width: a.largeur * echelle,
            height: a.hauteur * echelle,
          }} />,
        );
      }
    }
  }
  return <View style={{ position: "relative", width: largeurTotale, height: y }}>{cases}</View>;
}

/** Rangée du corps : cases côte à côte, hauteur du classeur (un libellé long agrandit la rangée au lieu d'être coupé). */
function RangeeCorps({ m, r, dessous }: { m: Mesures; r: number; dessous: number | null }) {
  const { zone, echelle } = m;
  const genre = m.rangee.get(r)?.genre;
  const cases: React.ReactNode[] = [];
  for (let col = zone.c1; col <= zone.c2; col++) {
    const c = m.cellule(r, col);
    const st = m.style(r, col);
    const texte = c ? texteImprime(c.contenu, st, m.g) : "";
    const bord = bordures(m, r, col, r, col, col === zone.c1, false, dessous);
    cases.push(
      <View key={col} style={{ width: m.l(col), backgroundColor: st?.fond ?? undefined, justifyContent: alignementVertical(st), paddingHorizontal: 1.5 * echelle + 0.5, ...bord }}>
        {texte ? <Text style={styleTexte(st, echelle, c?.contenu.genre === "nombre")}>{texte}</Text> : null}
      </View>,
    );
  }
  return (
    // Une rubrique ne reste jamais seule en bas de page : elle exige la place de deux rangées après elle.
    <View wrap={false} minPresenceAhead={genre === "rubrique" ? m.h(r) * 2 : undefined} style={{ flexDirection: "row", minHeight: m.h(r) }}>
      {cases}
    </View>
  );
}

const rangeeDe = (f: FeuilleSortie, r: number) => f.rangees.find((x) => x.r === r);

function PageFeuille({ g, f, pied }: { g: Gabarit; f: FeuilleSortie; pied?: string }) {
  const gf = f.gabarit;
  const sq = f.squelette!;
  const zone = zoneDe(f);
  const marges = {
    gauche: Math.max(12, gf.marges.gauche * 72), droite: Math.max(12, gf.marges.droite * 72),
    haut: Math.max(8, gf.marges.haut * 72), bas: Math.max(8, gf.marges.bas * 72),
  };
  const page = gf.paysage ? { largeur: A4.hauteur, hauteur: A4.largeur } : A4;
  // La mention de pied (sorties sans motif) prend sa place sur la dernière page, jamais une page à elle seule.
  const utile = { largeur: page.largeur - marges.gauche - marges.droite, hauteur: page.hauteur - marges.haut - marges.bas - (pied ? 24 : 0) };
  // Hauteur d'une rangée (avant l'échelle) : celle du classeur, ou celle de sa plus grande ligne de
  // texte si elle est plus haute (le corps s'agrandit plutôt que de couper un texte).
  const hauteurRangee = (r: number) => {
    const x = rangeeDe(f, r);
    const police = Math.max(0, ...(x?.cellules ?? []).filter((c) => texteImprime(c.contenu, g.styles.cellules[c.s], g)).map((c) => g.styles.cellules[c.s]?.police.taille ?? 0));
    return Math.max((x?.hauteur ?? gf.hauteurDefaut) * FACTEUR_HAUTEUR, police * INTERLIGNE + 1);
  };
  const echelle = echelleDe(f, zone, utile, hauteurRangee) * 0.99;
  const rangee = new Map(f.rangees.map((x) => [x.r, x]));
  const largeurs = new Map<number, number>();
  for (let c = zone.c1; c <= zone.c2 + 1; c++) largeurs.set(c, (f.colonnes.find((k) => k.min <= c && c <= k.max)?.largeur ?? gf.largeurDefaut) * PT_PAR_UNITE * echelle);
  const xs = new Map<number, number>();
  let x = 0;
  for (let c = zone.c1; c <= zone.c2 + 1; c++) { xs.set(c, x); x += largeurs.get(c)!; }
  const m: Mesures = {
    g, f, zone, echelle,
    x: (c) => xs.get(c) ?? x,
    l: (c) => largeurs.get(c) ?? 0,
    h: (r) => hauteurRangee(r) * echelle,
    rangee,
    cellule: (r, c) => rangee.get(r)?.cellules.find((k) => k.col === c),
    style: (r, c) => {
      const k = rangee.get(r)?.cellules.find((y) => y.col === c);
      return k ? g.styles.cellules[k.s] : undefined;
    },
  };

  const titre: number[] = [];
  for (let r = zone.r1; r < sq.ligneEntete; r++) titre.push(r);
  const entete: number[] = [];
  for (let r = sq.ligneEntete; r <= sq.finEntete; r++) entete.push(r);
  // Segments : le corps, coupé à chaque en-tête répété du classeur (nouvelle page, comme imprimé).
  const repetes = new Set(f.entetesRepetes.flat());
  const segments: { entete: number[]; corps: number[] }[] = [{ entete, corps: [] }];
  for (const x of f.rangees) {
    if (x.r <= sq.finEntete || x.r > zone.r2) continue;
    const groupe = f.entetesRepetes.find((gr) => gr[0] === x.r);
    if (groupe) { segments.push({ entete: groupe, corps: [] }); continue; }
    if (repetes.has(x.r)) continue;
    if (x.genre === "hors" && !x.cellules.some((c) => texteImprime(c.contenu, g.styles.cellules[c.s], g))) continue;
    segments.at(-1)!.corps.push(x.r);
  }

  return (
    <Page size="A4" orientation={gf.paysage ? "landscape" : "portrait"} style={{ paddingTop: marges.haut, paddingBottom: marges.bas, paddingLeft: marges.gauche, paddingRight: marges.droite, fontFamily: "Optima" }}>
      {titre.length > 0 && <BlocFixe m={m} lignes={titre} premier />}
      {segments.map((s, i) => (
        <View key={i} break={i > 0}>
          {/* En-tête de colonnes : répété en haut de chaque page de suite. */}
          <View fixed>
            <BlocFixe m={m} lignes={s.entete} premier={false} />
          </View>
          {s.corps.map((r, k) => <RangeeCorps key={r} m={m} r={r} dessous={s.corps[k + 1] ?? null} />)}
        </View>
      ))}
      {pied ? <Text style={{ marginTop: 8, fontSize: 7, fontStyle: "italic", color: "#555555", fontFamily: "Optima" }}>{pied}</Text> : null}
    </Page>
  );
}

/** Document PDF : une page (ou plus) par feuille, dans l'ordre. `pied` : mention sous la dernière feuille. */
export function DocumentModele({ titre, feuilles, pied }: { titre: string; feuilles: { g: Gabarit; f: FeuilleSortie }[]; pied?: string }) {
  return (
    <Document title={titre} author="Pâtes en Folie">
      {/* Une feuille sans tableau (« Fiche commande Salle », vide) n'imprime rien, comme dans Excel. */}
      {feuilles.filter(({ f }) => f.squelette).map(({ g, f }, i, t) => <PageFeuille key={i} g={g} f={f} pied={i === t.length - 1 ? pied : undefined} />)}
    </Document>
  );
}
