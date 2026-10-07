import JSZip from "jszip";
import { echapperXml, estFormatDate, lettreColonne, recrireReferences, type Gabarit } from "./gabarit";
import type { Contenu, FeuilleSortie } from "./remplir";

// ÉCRITURE de l'Excel : le paquet du gabarit (classeur de la Direction) dont on ne réécrit que les
// rangées des feuilles, leurs dimensions, la zone d'impression et, s'il le faut, les colonnes
// (dimanche). Styles, thème, textes partagés, logo, marges, échelle, volets et fusions sont ceux
// du classeur, recopiés tels quels — l'Excel produit EST le modèle, rempli.
//
// Deux écarts imposés par les données, et seulement là où elles sont écrites :
//  - une case du classeur au format DATE (« d/m/yyyy », « d.m » sur des cases Commande) qui reçoit
//    une quantité prend le même style au format Standard (sinon 2,5 s'afficherait « 2.1 ») ;
//  - le texte nouveau (libellé d'une ligne absente du classeur, « — », date du jour) est écrit en
//    ligne (inlineStr) : les textes du classeur gardent leur index partagé.

const TYPE = {
  classeur: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  feuille: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  dessin: "application/vnd.openxmlformats-officedocument.drawing+xml",
};
const REL = {
  feuille: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
  dessin: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
};

/** Nombre en XML : jamais d'exposant pour les quantités usuelles. */
const nombreXml = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(15))));

/** Nom d'onglet admis par Excel (31 caractères, sans []:*?/\). */
export const nomOnglet = (s: string) => s.replace(/[[\]:*?/\\]/g, "-").slice(0, 31);

export async function ecrireClasseur(g: Gabarit, feuilles: FeuilleSortie[]): Promise<Buffer> {
  const texte = (chemin: string) => new TextDecoder().decode(g.parties.get(chemin)!);
  const zip = new JSZip();

  // ── Styles : un style « Standard » dérivé pour chaque style DATE qui reçoit une quantité ──
  let styles = g.styles.xml;
  const derives = new Map<number, number>();
  const ajoutes: string[] = [];
  const styleNombre = (s: number) => {
    const st = g.styles.cellules[s];
    if (!st || !estFormatDate(st.format)) return s;
    let d = derives.get(s);
    if (d === undefined) {
      d = g.styles.xfs.length + ajoutes.length;
      ajoutes.push(g.styles.xfs[s]!.replace(/numFmtId="\d+"/, 'numFmtId="0"'));
      derives.set(s, d);
    }
    return d;
  };

  const cellXml = (f: FeuilleSortie, col: number, r: number, s: number, c: Contenu): string => {
    const ref = `${lettreColonne(col)}${r}`;
    const remap = (formule: string) => recrireReferences(formule, (x) => ({ col: x.col, ligne: f.nouvelleLigne(x.ligne) }));
    switch (c.genre) {
      case "vide": return `<c r="${ref}" s="${s}"/>`;
      case "texte": return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${echapperXml(c.texte)}</t></is></c>`;
      case "nombre": return `<c r="${ref}" s="${styleNombre(s)}"><v>${nombreXml(c.valeur)}</v></c>`;
      case "formule": {
        const t = typeof c.cache === "string" ? ' t="str"' : "";
        const v = typeof c.cache === "number" ? nombreXml(c.cache) : echapperXml(c.cache);
        return `<c r="${ref}" s="${s}"${t}><f>${echapperXml(remap(c.formule))}</f><v>${v}</v></c>`;
      }
      case "brut": {
        const b = c.cellule;
        const t = b.t ? ` t="${b.t}"` : "";
        const fx = b.formule ? `<f>${echapperXml(remap(b.formule))}</f>` : "";
        const v = b.v !== null ? `<v>${echapperXml(b.v)}</v>` : "";
        const is = b.is !== null ? `<is>${b.is}</is>` : "";
        return fx || v || is ? `<c r="${ref}" s="${s}"${t}>${fx}${v}${is}</c>` : `<c r="${ref}" s="${s}"/>`;
      }
    }
  };

  const feuillesXml: { nom: string; zone: string | null }[] = [];
  for (const [i, f] of feuilles.entries()) {
    const n = i + 1;
    const lignes: string[] = [];
    let cMin = Infinity, cMax = 0, rMin = Infinity, rMax = 0;
    for (const x of f.rangees) {
      const cellules = x.cellules.map((c) => {
        cMin = Math.min(cMin, c.col); cMax = Math.max(cMax, c.col);
        return cellXml(f, c.col, x.r, c.s, c.contenu);
      });
      rMin = Math.min(rMin, x.r); rMax = Math.max(rMax, x.r);
      const attrs = x.attributs ? ` ${x.attributs}` : "";
      lignes.push(cellules.length ? `<row r="${x.r}"${attrs}>${cellules.join("")}</row>` : `<row r="${x.r}"${attrs}/>`);
    }
    const dimension = rMax ? `${lettreColonne(cMin === Infinity ? 1 : cMin)}${rMin}:${lettreColonne(Math.max(cMax, 1))}${rMax}` : "A1";
    const cols = f.colonnes.length ? `<cols>${f.colonnes.map((c) => c.brut).join("")}</cols>` : "";
    let avant = f.gabarit.avant
      .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="${dimension}"/>`)
      .replace(/<cols>[\s\S]*?<\/cols>/, cols)
      .replace(/\stabSelected="1"/g, "");
    if (i === 0) avant = avant.replace(/<sheetView\b/, '<sheetView tabSelected="1"');
    const apres = f.gabarit.apres
      // Tri mémorisé par Excel sur d'anciennes rangées : sans objet.
      .replace(/<sortState\b[\s\S]*?<\/sortState>/g, "").replace(/<sortState\b[^>]*\/>/g, "")
      .replace(/<brk id="(\d+)"/g, (_, id: string) => `<brk id="${f.nouvelleLigne(Number(id))}"`)
      .replace(/<mergeCell ref="([^"]+)"/g, (_, ref: string) => `<mergeCell ref="${ref.replace(/(\d+)/g, (l) => String(f.nouvelleLigne(Number(l))))}"`);
    zip.file(`xl/worksheets/sheet${n}.xml`, `${avant}<sheetData>${lignes.join("")}</sheetData>${apres}`);

    const d = f.gabarit.dessin;
    if (d) {
      zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.dessin}" Target="../drawings/drawing${n}.xml"/></Relationships>`);
      zip.file(`xl/drawings/drawing${n}.xml`, d.xml);
      zip.file(`xl/drawings/_rels/drawing${n}.xml.rels`, d.rels);
    }
    const z = f.zone;
    feuillesXml.push({ nom: f.nom, zone: z ? `$${lettreColonne(z.c1)}$${z.r1}:$${lettreColonne(z.c2)}$${z.r2}` : null });
  }

  if (ajoutes.length) {
    styles = styles.replace(/<cellXfs\b([^>]*)count="\d+"([^>]*)>([\s\S]*?)<\/cellXfs>/, (_, a: string, b: string, contenu: string) =>
      `<cellXfs${a}count="${g.styles.xfs.length + ajoutes.length}"${b}>${contenu}${ajoutes.join("")}</cellXfs>`);
  }

  // ── Classeur : onglets, zones d'impression, recalcul à l'ouverture ──
  const echapperNom = (s: string) => echapperXml(s.replace(/'/g, "''"));
  let classeur = g.classeur
    .replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${feuillesXml.map((x, i) => `<sheet name="${echapperXml(x.nom)}" sheetId="${i + 1}" r:id="rIdF${i + 1}"/>`).join("")}</sheets>`)
    .replace(/<definedNames>[\s\S]*?<\/definedNames>/, "")
    .replace(/\sactiveTab="\d+"/, "").replace(/\sfirstSheet="\d+"/, "")
    // Chemin du fichier de la Direction sur son ordinateur : rien à faire dans un export.
    .replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, "")
    .replace(/<calcPr\b([^>]*?)\s*\/>/, (_, a: string) => `<calcPr${a.replace(/\sfullCalcOnLoad="\d"/, "")} fullCalcOnLoad="1"/>`);
  const noms = feuillesXml.flatMap((x, i) => (x.zone ? [`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${echapperNom(x.nom)}'!${x.zone}</definedName>`] : []));
  if (noms.length) classeur = classeur.replace("</sheets>", `</sheets><definedNames>${noms.join("")}</definedNames>`);
  zip.file("xl/workbook.xml", classeur);

  const relsAutres = [...g.relsClasseur.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).filter((r) => !r.includes(REL.feuille));
  zip.file("xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsAutres.join("")}${feuilles
      .map((_, i) => `<Relationship Id="rIdF${i + 1}" Type="${REL.feuille}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);

  const types = texte("[Content_Types].xml");
  const defauts = [...types.matchAll(/<Default\b[^>]*\/>/g)].map((m) => m[0]);
  const autres = [...types.matchAll(/<Override\b[^>]*\/>/g)].map((m) => m[0]).filter((o) => !/\/xl\/(worksheets|drawings)\//.test(o) && !/\/xl\/workbook\.xml"/.test(o));
  const nouveaux = [
    `<Override PartName="/xl/workbook.xml" ContentType="${TYPE.classeur}"/>`,
    ...feuilles.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${TYPE.feuille}"/>`),
    ...feuilles.flatMap((f, i) => (f.gabarit.dessin ? [`<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="${TYPE.dessin}"/>`] : [])),
  ];
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defauts.join("")}${nouveaux.join("")}${autres.join("")}</Types>`);

  // ── Le reste du paquet, tel quel ──
  zip.file("xl/styles.xml", styles);
  for (const [chemin, octets] of g.parties) {
    if (/^xl\/(worksheets|drawings)\//.test(chemin) || ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml", "xl/styles.xml"].includes(chemin)) continue;
    zip.file(chemin, octets);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
