import JSZip from "jszip";

// Lecture d'un GABARIT de document journalier : le classeur de la Direction lui-même (copie allégée,
// assets/modeles/, cf. scripts/modeles-journaliers.ts). On en garde tout ce qui fait sa mise en
// page — rangées et cellules telles qu'écrites (styles par numéro), largeurs, hauteurs, fusions,
// zone d'impression, marges, échelle, logo et son ancrage — pour que l'Excel produit soit CE
// classeur, cellule pour cellule, et que le PDF l'imprime comme Excel.
//
// Fonctions pures sur des octets : aucun accès disque ici (cf. ./charger.ts).

// ─── XML ─────────────────────────────────────────────────────────────────────

export const echapperXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function decoderXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function attributs(balise: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of balise.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = decoderXml(m[2]!);
  return out;
}

/** Texte d'un <si> ou d'un <is> : tous les <t> bout à bout (texte enrichi), sans la phonétique. */
export const texteRiche = (xml: string) =>
  decoderXml([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

// ─── Adresses ────────────────────────────────────────────────────────────────

/** « A » → 1, « AA » → 27. */
export function indexColonne(lettres: string): number {
  let n = 0;
  for (const c of lettres) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}
/** 1 → « A ». */
export function lettreColonne(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}
export function lireAdresse(ref: string): { col: number; ligne: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref);
  if (!m) throw new Error(`Adresse illisible : ${ref}`);
  return { col: indexColonne(m[1]!), ligne: Number(m[2]) };
}

export type Zone = { c1: number; r1: number; c2: number; r2: number };

export function lireZone(ref: string): Zone {
  const [a, b] = ref.replace(/^.*!/, "").split(":");
  const x = lireAdresse(a!), y = lireAdresse(b ?? a!);
  return { c1: x.col, r1: x.ligne, c2: y.col, r2: y.ligne };
}

/**
 * Récrit les références A1 d'une formule (hors chaînes entre guillemets) : `f` reçoit colonne et
 * ligne (et si elles sont absolues) et rend les nouvelles. Sert au dépliage des formules partagées,
 * au déplacement des rangées (lignes insérées) et à la colonne du dimanche.
 */
export function recrireReferences(formule: string, f: (r: { col: number; ligne: number; colAbs: boolean; ligneAbs: boolean }) => { col: number; ligne: number }): string {
  return formule
    .split('"')
    .map((morceau, i) =>
      i % 2 === 1
        ? morceau
        : morceau.replace(/(?<![A-Za-z0-9_.!])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (_, ca: string, c: string, la: string, l: string) => {
            const n = f({ col: indexColonne(c), ligne: Number(l), colAbs: ca === "$", ligneAbs: la === "$" });
            return `${ca}${lettreColonne(n.col)}${la}${n.ligne}`;
          }),
    )
    .join('"');
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export type Trait = { style: string; couleur: string };
export type StyleCellule = {
  police: { taille: number; gras: boolean; italique: boolean; souligne: boolean; couleur: string };
  /** Fond plein (« #RRGGBB »), null = aucun. */
  fond: string | null;
  bordure: { gauche: Trait | null; droite: Trait | null; haut: Trait | null; bas: Trait | null };
  horizontal: string | null;
  vertical: string | null;
  retour: boolean;
  /** Code du format de nombre (« General », « d/m/yyyy », « [$-40C]d\-mmm;@ »…). */
  format: string;
  numFmtId: number;
};

const FORMATS_INTEGRES: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
  20: "h:mm", 22: "m/d/yyyy h:mm", 49: "@",
};

/** Le format affiche-t-il une date ? (jours, mois ou années hors chaîne littérale) */
export function estFormatDate(format: string): boolean {
  const sansLitteraux = format.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmy]/i.test(sansLitteraux) && !/^general$/i.test(format);
}

/** Couleurs du thème, dans l'ordre des index Excel : 0 lt1, 1 dk1, 2 lt2, 3 dk2, 4…9 accent1…6, 10 hlink, 11 folHlink. */
export function lireTheme(xml: string): string[] {
  const schema = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0] ?? "";
  const couleur = (nom: string) => {
    const bloc = new RegExp(`<a:${nom}>([\\s\\S]*?)</a:${nom}>`).exec(schema)?.[1] ?? "";
    return (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(bloc)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(bloc)?.[1] ?? "000000").toUpperCase();
  };
  const [dk1, lt1, dk2, lt2] = ["dk1", "lt1", "dk2", "lt2"].map(couleur);
  return [lt1!, dk1!, lt2!, dk2!, ...["accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(couleur)];
}

/** Teinte Excel (`tint`, −1 → 1) appliquée à une couleur RGB, sur la luminance (HLS). */
export function teinter(hex: string, tint: number): string {
  if (!tint) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!);
  let h = 0, s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g! - b!) / d + (g! < b! ? 6 : 0) : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const canal = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  const rgb = s === 0 ? [l, l, l] : [canal(h + 1 / 3), canal(h), canal(h - 1 / 3)];
  return rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function couleurDe(balise: string | undefined, theme: string[], defaut: string): string {
  if (!balise) return defaut;
  const a = attributs(balise);
  let hex: string | null = null;
  if (a.rgb) hex = a.rgb.slice(-6).toUpperCase();
  else if (a.theme !== undefined) hex = theme[Number(a.theme)] ?? null;
  else if (a.indexed !== undefined) hex = Number(a.indexed) === 64 ? defaut.replace("#", "") : Number(a.indexed) === 9 ? "FFFFFF" : "000000";
  if (!hex) return defaut;
  return `#${teinter(hex, Number(a.tint ?? 0))}`;
}

export type Styles = {
  xml: string;
  /** Styles de cellule (cellXfs), résolus. */
  cellules: StyleCellule[];
  /** Balises <xf> brutes de cellXfs (pour en dériver un style). */
  xfs: string[];
};

export function lireStyles(xml: string, theme: string[]): Styles {
  const bloc = (nom: string) => new RegExp(`<${nom}\\b[^>]*>([\\s\\S]*?)</${nom}>`).exec(xml)?.[1] ?? "";
  const formats = new Map<number, string>(Object.entries(FORMATS_INTEGRES).map(([k, v]) => [Number(k), v]));
  for (const m of bloc("numFmts").matchAll(/<numFmt\b[^>]*\/>/g)) {
    const a = attributs(m[0]);
    formats.set(Number(a.numFmtId), a.formatCode ?? "General");
  }
  const polices = [...bloc("fonts").matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) => {
    const c = m[1] ?? "";
    const actif = (nom: string) => {
      const b = new RegExp(`<${nom}\\b([^>]*)/?>`).exec(c);
      return !!b && !/val="(0|false|none)"/.test(b[1] ?? "");
    };
    return {
      taille: Number(/<sz val="([\d.]+)"/.exec(c)?.[1] ?? 11),
      gras: actif("b"), italique: actif("i"), souligne: actif("u"),
      couleur: couleurDe(/<color\b[^>]*\/>/.exec(c)?.[0], theme, "#000000"),
    };
  });
  const fonds = [...bloc("fills").matchAll(/<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g)].map((m) => {
    const c = m[1] ?? "";
    if (!/patternType="solid"/.test(c)) return null;
    return couleurDe(/<fgColor\b[^>]*\/>/.exec(c)?.[0], theme, "#FFFFFF");
  });
  const bordures = [...bloc("borders").matchAll(/<border\b[^>]*?(?:\/>|>([\s\S]*?)<\/border>)/g)].map((m) => {
    const c = m[1] ?? "";
    const trait = (nom: string): Trait | null => {
      const b = new RegExp(`<${nom}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${nom}>)`).exec(c);
      const style = b ? attributs(`<x ${b[1]}>`).style : undefined;
      if (!style || style === "none") return null;
      return { style, couleur: couleurDe(/<color\b[^>]*\/>/.exec(b![2] ?? "")?.[0], theme, "#000000") };
    };
    return { gauche: trait("left"), droite: trait("right"), haut: trait("top"), bas: trait("bottom") };
  });
  const xfs = [...bloc("cellXfs").matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
  const cellules = xfs.map((x): StyleCellule => {
    const a = attributs(/<xf\b[^>]*>/.exec(x)![0]);
    const al = /<alignment\b[^>]*\/?>/.exec(x)?.[0];
    const aa = al ? attributs(al) : {};
    const numFmtId = Number(a.numFmtId ?? 0);
    return {
      police: polices[Number(a.fontId ?? 0)] ?? polices[0]!,
      fond: fonds[Number(a.fillId ?? 0)] ?? null,
      bordure: bordures[Number(a.borderId ?? 0)] ?? { gauche: null, droite: null, haut: null, bas: null },
      horizontal: aa.horizontal ?? null,
      vertical: aa.vertical ?? null,
      retour: aa.wrapText === "1" || aa.wrapText === "true",
      format: formats.get(numFmtId) ?? "General",
      numFmtId,
    };
  });
  return { xml, cellules, xfs };
}

// ─── Feuilles ────────────────────────────────────────────────────────────────

/** Cellule telle qu'écrite dans le classeur. Une formule partagée y est DÉPLIÉE (formule propre). */
export type CelluleBrute = {
  col: number;
  s: number;
  /** Type de la cellule (« s » texte partagé, « str » résultat texte de formule, « inlineStr »…), null = nombre. */
  t: string | null;
  formule: string | null;
  /** Valeur en cache / valeur (index du texte partagé pour « s »). */
  v: string | null;
  /** Contenu d'un <is> (texte en ligne). */
  is: string | null;
};

export type RangeeBrute = {
  r: number;
  /** Attributs de la rangée, sans `r` ni `spans` (hauteur, style de rangée, thickBot…). */
  attributs: string;
  /** Hauteur en points, null = hauteur par défaut de la feuille. */
  hauteur: number | null;
  cellules: CelluleBrute[];
};

export type Ancre = { col: number; decalageCol: number; ligne: number; decalageLigne: number; largeur: number; hauteur: number };

export type FeuilleGabarit = {
  nom: string;
  chemin: string;
  /** XML avant <sheetData> et après </sheetData>. */
  avant: string;
  apres: string;
  rangees: RangeeBrute[];
  /** Largeurs des colonnes (unités Excel) : [min, max, largeur, attributs bruts]. */
  colonnes: { min: number; max: number; largeur: number; brut: string }[];
  largeurDefaut: number;
  hauteurDefaut: number;
  fusions: Zone[];
  zone: Zone | null;
  /** Marges en pouces. */
  marges: { gauche: number; droite: number; haut: number; bas: number };
  echelle: number | null;
  pagesEnHauteur: number | null;
  paysage: boolean;
  /** Relations de la feuille (XML brut), dessin (logo) et son image. */
  rels: string | null;
  dessin: { chemin: string; xml: string; rels: string; media: string; ancre: Ancre } | null;
};

export type Gabarit = {
  /** Toutes les parties du paquet, telles quelles. */
  parties: Map<string, Uint8Array>;
  classeur: string;
  relsClasseur: string;
  styles: Styles;
  partages: string[];
  theme: string[];
  feuilles: FeuilleGabarit[];
};

const EMU_PAR_POINT = 12_700;

function lireAncre(xml: string): Ancre | null {
  const de = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(xml)?.[1];
  if (!de) return null;
  const n = (bloc: string, nom: string) => Number(new RegExp(`<xdr:${nom}>(-?\\d+)</xdr:${nom}>`).exec(bloc)?.[1] ?? 0);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(xml) ?? /<xdr:ext cx="(\d+)" cy="(\d+)"/.exec(xml);
  return {
    col: n(de, "col"), decalageCol: n(de, "colOff") / EMU_PAR_POINT,
    ligne: n(de, "row"), decalageLigne: n(de, "rowOff") / EMU_PAR_POINT,
    largeur: Number(ext?.[1] ?? 0) / EMU_PAR_POINT, hauteur: Number(ext?.[2] ?? 0) / EMU_PAR_POINT,
  };
}

function lireRangees(sheetData: string): RangeeBrute[] {
  const partagees = new Map<string, { formule: string; col: number; ligne: number }>();
  const rangees: RangeeBrute[] = [];
  let precedente = 0;
  for (const m of sheetData.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const a = attributs(`<row ${m[1]}>`);
    const r = Number(a.r ?? precedente + 1);
    precedente = r;
    const reste = (m[1] ?? "").replace(/\s(r|spans)="[^"]*"/g, "").trim();
    const cellules: CelluleBrute[] = [];
    let colPrecedente = 0;
    for (const c of (m[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attributs(`<c ${c[1]}>`);
      const col = ca.r ? lireAdresse(ca.r).col : colPrecedente + 1;
      colPrecedente = col;
      const contenu = c[2] ?? "";
      const fb = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(contenu);
      let formule: string | null = null;
      if (fb) {
        const fa = attributs(`<f ${fb[1]}>`);
        const texte = fb[2] !== undefined ? decoderXml(fb[2]) : null;
        if (fa.t === "shared" && fa.si !== undefined) {
          if (texte) { partagees.set(fa.si, { formule: texte, col, ligne: r }); formule = texte; }
          else {
            const maitre = partagees.get(fa.si);
            formule = maitre
              ? recrireReferences(maitre.formule, (x) => ({ col: x.colAbs ? x.col : x.col + col - maitre.col, ligne: x.ligneAbs ? x.ligne : x.ligne + r - maitre.ligne }))
              : null;
          }
        } else formule = texte;
      }
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(contenu)?.[1];
      const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(contenu)?.[1];
      cellules.push({ col, s: Number(ca.s ?? 0), t: ca.t ?? null, formule, v: v !== undefined ? decoderXml(v) : null, is: is ?? null });
    }
    rangees.push({ r, attributs: reste, hauteur: a.ht !== undefined ? Number(a.ht) : null, cellules });
  }
  return rangees;
}

/** Lit un gabarit (octets du .xlsx). */
export async function lireGabarit(octets: Uint8Array): Promise<Gabarit> {
  const zip = await JSZip.loadAsync(octets);
  const parties = new Map<string, Uint8Array>();
  for (const [nom, f] of Object.entries(zip.files)) if (!f.dir) parties.set(nom, await f.async("uint8array"));
  const texte = (chemin: string) => {
    const p = parties.get(chemin);
    return p ? new TextDecoder().decode(p) : null;
  };
  const classeur = texte("xl/workbook.xml")!;
  const relsClasseur = texte("xl/_rels/workbook.xml.rels")!;
  const theme = lireTheme(texte("xl/theme/theme1.xml") ?? "");
  const styles = lireStyles(texte("xl/styles.xml")!, theme);
  const partages = [...(texte("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texteRiche(m[1]!));

  const cibles = new Map<string, string>();
  for (const m of relsClasseur.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attributs(m[0]);
    if (a.Id && a.Target) cibles.set(a.Id, a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const zones = new Map<number, Zone>();
  for (const m of classeur.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)) {
    const a = attributs(`<d ${m[1]}>`);
    if (a.name === "_xlnm.Print_Area" && a.localSheetId !== undefined) zones.set(Number(a.localSheetId), lireZone(decoderXml(m[2]!)));
  }

  const feuilles: FeuilleGabarit[] = [];
  for (const [i, m] of [...classeur.matchAll(/<sheet\b[^>]*\/>/g)].entries()) {
    const a = attributs(m[0]);
    const chemin = cibles.get(a["r:id"] ?? "")!;
    const xml = texte(chemin)!;
    const debut = xml.indexOf("<sheetData");
    const finOuverture = xml.indexOf(">", debut);
    const vide = xml[finOuverture - 1] === "/";
    const fin = vide ? finOuverture + 1 : xml.indexOf("</sheetData>") + "</sheetData>".length;
    const sheetData = vide ? "" : xml.slice(finOuverture + 1, xml.indexOf("</sheetData>"));
    const avant = xml.slice(0, debut), apres = xml.slice(fin);

    const colonnes = [...avant.matchAll(/<col\b[^>]*\/>/g)].map((c) => {
      const ca = attributs(c[0]);
      return { min: Number(ca.min), max: Number(ca.max), largeur: Number(ca.width ?? 0), brut: c[0] };
    });
    const format = attributs(/<sheetFormatPr\b[^>]*\/>/.exec(avant)?.[0] ?? "<x/>");
    const marges = attributs(/<pageMargins\b[^>]*\/>/.exec(apres)?.[0] ?? "<x/>");
    const page = attributs(/<pageSetup\b[^>]*\/>/.exec(apres)?.[0] ?? "<x/>");
    const ajuste = /<pageSetUpPr\b[^>]*fitToPage="1"/.test(avant);

    const cheminRels = chemin.replace(/([^/]+)$/, "_rels/$1.rels");
    const rels = texte(cheminRels);
    let dessin: FeuilleGabarit["dessin"] = null;
    const cibleDessin = rels && /Target="\.\.\/drawings\/([^"]+)"/.exec(rels)?.[1];
    if (cibleDessin) {
      const cheminDessin = `xl/drawings/${cibleDessin}`;
      const xmlDessin = texte(cheminDessin)!;
      const relsDessin = texte(cheminDessin.replace(/([^/]+)$/, "_rels/$1.rels")) ?? "";
      const media = /Target="\.\.\/media\/([^"]+)"/.exec(relsDessin)?.[1];
      const ancre = lireAncre(xmlDessin);
      if (media && ancre) dessin = { chemin: cheminDessin, xml: xmlDessin, rels: relsDessin, media: `xl/media/${media}`, ancre };
    }

    feuilles.push({
      nom: a.name!,
      chemin,
      avant,
      apres,
      rangees: lireRangees(sheetData),
      colonnes,
      largeurDefaut: Number(format.defaultColWidth ?? (Number(format.baseColWidth ?? 8) + 0.83)),
      hauteurDefaut: Number(format.defaultRowHeight ?? 15),
      fusions: [...apres.matchAll(/<mergeCell ref="([^"]+)"/g)].map((f) => lireZone(f[1]!)),
      zone: zones.get(i) ?? null,
      marges: {
        gauche: Number(marges.left ?? 0.7), droite: Number(marges.right ?? 0.7), haut: Number(marges.top ?? 0.75), bas: Number(marges.bottom ?? 0.75),
      },
      echelle: page.scale !== undefined ? Number(page.scale) / 100 : null,
      pagesEnHauteur: ajuste ? Number(page.fitToHeight ?? 1) : null,
      paysage: page.orientation === "landscape",
      rels,
      dessin,
    });
  }
  return { parties, classeur, relsClasseur, styles, partages, theme, feuilles };
}

/** Largeur d'une colonne (unités Excel). */
export function largeurColonne(f: Pick<FeuilleGabarit, "colonnes" | "largeurDefaut">, col: number): number {
  return f.colonnes.find((c) => c.min <= col && col <= c.max)?.largeur ?? f.largeurDefaut;
}

/** Texte affiché par une cellule brute (texte partagé, en ligne, ou résultat texte d'une formule). */
export function texteCellule(c: CelluleBrute | undefined, partages: string[]): string | null {
  if (!c) return null;
  if (c.t === "s") return c.v !== null ? partages[Number(c.v)] ?? null : null;
  if (c.t === "inlineStr") return c.is !== null ? texteRiche(c.is) : null;
  if (c.t === "str") return c.v;
  return null;
}
