/**
 * Gabarits des documents journaliers (Stock → Conso. journalière) : copie ALLÉGÉE des deux
 * classeurs de la Direction, embarquée dans `assets/modeles/`.
 *
 *   npx tsx scripts/modeles-journaliers.ts "<PEF Rapport journalier cuisine et bar .xlsx>" "<PEF Commande Journalière.xlsx>"
 *
 * Les exports Excel et PDF « Rapport journalier » et « Commande journalière » partent de ces
 * gabarits : feuilles, styles, largeurs, hauteurs, fusions, mise en page d'impression et logo sont
 * ceux du classeur, seules les cellules de données sont écrites. Quand la Direction change son
 * modèle, on relance ce script sur le nouveau classeur (rien d'autre à toucher).
 *
 * Allègement, sans rien changer à ce qui s'affiche ou s'imprime :
 *  - le logo TIFF de 25 Mo du rapport devient un PNG, DÉJÀ recadré comme l'affiche Excel (le dessin
 *    perd son `srcRect`) — un PNG par feuille, les deux feuilles ne recadrant pas pareil ;
 *  - retirés : le volet de complément Office (webextensions), la chaîne de calcul (recalculée à
 *    l'ouverture), les métadonnées Google Sheets et `docProps/app.xml` (liste d'onglets périmée dès
 *    qu'un export n'a pas les mêmes feuilles) ;
 *  - retiré aussi : le chemin du fichier sur l'ordinateur de la Direction (x15ac:absPath) ;
 *  - tout le reste est recopié octet pour octet.
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";

const SORTIE = path.join(process.cwd(), "assets/modeles");
const LARGEUR_LOGO = 1000; // px : le logo s'imprime sur ~5 cm, soit plus de 400 dpi

/** Retire une relation (par cible) d'un fichier .rels. */
const sansRelation = (rels: string, cible: RegExp) => rels.replace(/<Relationship\b[^>]*\/>/g, (r) => (cible.test(r) ? "" : r));
/** Retire une déclaration de type (Override) d'une partie. */
const sansOverride = (types: string, partie: RegExp) => types.replace(/<Override\b[^>]*\/>/g, (o) => (partie.test(o) ? "" : o));

async function alleger(source: string, destination: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(source));
  let types = await zip.file("[Content_Types].xml")!.async("string");
  let relsRacine = await zip.file("_rels/.rels")!.async("string");
  let relsClasseur = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");

  // Parties sans effet sur l'affichage ni l'impression.
  for (const nom of Object.keys(zip.files)) {
    if (/^xl\/webextensions\//.test(nom) || nom === "xl/calcChain.xml" || nom === "xl/metadata" || nom === "docProps/app.xml" || nom === "docProps/custom.xml") zip.remove(nom);
  }
  relsRacine = sansRelation(relsRacine, /webextension|taskpane|app\.xml|custom\.xml/);
  relsClasseur = sansRelation(relsClasseur, /calcChain|metadata/);
  types = sansOverride(types, /webextension|taskpane|calcChain|app\.xml|custom\.xml|\/xl\/metadata/);

  // Logo : chaque dessin reçoit son PNG, recadré comme l'affiche Excel (srcRect en millièmes de %).
  let n = 0;
  const logos: { nom: string; png: Buffer }[] = [];
  for (const chemin of Object.keys(zip.files).filter((f) => /^xl\/drawings\/drawing\d+\.xml$/.test(f)).sort()) {
    const cheminRels = chemin.replace("drawings/", "drawings/_rels/") + ".rels";
    let dessin = await zip.file(chemin)!.async("string");
    let rels = await zip.file(cheminRels)!.async("string");
    const cible = /Target="\.\.\/media\/([^"]+)"/.exec(rels)?.[1];
    if (!cible) continue;
    const image = await zip.file(`xl/media/${cible}`)!.async("nodebuffer");
    const meta = await sharp(image).metadata();
    const rect = /<a:srcRect\b([^>]*)\/>/.exec(dessin);
    const pc = (nom: string) => Number(new RegExp(`\\b${nom}="(-?\\d+)"`).exec(rect?.[1] ?? "")?.[1] ?? 0) / 100_000;
    const [l, t, r, b] = [pc("l"), pc("t"), pc("r"), pc("b")];
    const W = meta.width!, H = meta.height!;
    const zone = { left: Math.round(W * l), top: Math.round(H * t), width: Math.round(W * (1 - l - r)), height: Math.round(H * (1 - t - b)) };
    // PNG sans recadrage déjà assez léger : gardé tel quel. Sinon recadré, réduit, palette (un logo).
    const png = !rect && meta.format === "png" && W <= 1500
      ? image
      : await sharp(image).extract(zone).resize({ width: Math.min(LARGEUR_LOGO, zone.width) }).png({ compressionLevel: 9, palette: true }).toBuffer();
    // Deux dessins au même logo (feuilles cuisine et bar du classeur Commande) : un seul fichier.
    const deja = logos.find((x) => x.png.equals(png));
    const nom = deja?.nom ?? `logo${++n}.png`;
    if (!deja) { logos.push({ nom, png }); zip.file(`xl/media/${nom}`, png); }
    rels = rels.replace(`../media/${cible}`, `../media/${nom}`);
    dessin = dessin.replace(/<a:srcRect\b[^>]*\/>/, "");
    zip.file(chemin, dessin);
    zip.file(cheminRels, rels);
  }
  // Anciennes images (TIFF, PNG d'origine) : plus référencées.
  // (jamais le dossier lui-même : `remove` sur un dossier emporte tout son contenu)
  for (const nom of Object.keys(zip.files)) if (/^xl\/media\/./.test(nom) && !zip.files[nom]!.dir && !/\/logo\d+\.png$/.test(nom)) zip.remove(nom);
  types = types.replace(/<Default Extension="tiff"[^>]*\/>/, "");
  if (!/Extension="png"/.test(types)) types = types.replace("<Default ", '<Default Extension="png" ContentType="image/png"/><Default ');

  // Chemin du fichier sur l'ordinateur de la Direction (x15ac:absPath) : rien à faire dans le dépôt.
  const classeur = await zip.file("xl/workbook.xml")!.async("string");
  zip.file("xl/workbook.xml", classeur.replace(/<mc:AlternateContent\b[\s\S]*?<\/mc:AlternateContent>/g, ""));
  zip.file("[Content_Types].xml", types);
  zip.file("_rels/.rels", relsRacine);
  zip.file("xl/_rels/workbook.xml.rels", relsClasseur);
  const octets = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  fs.writeFileSync(destination, octets);
  console.log(`${path.basename(destination)} : ${(octets.length / 1024).toFixed(0)} Ko (source ${(fs.statSync(source).size / 1024).toFixed(0)} Ko)`);
}

const [rapport, commande] = process.argv.slice(2);
if (!rapport || !commande) {
  console.error('Usage : npx tsx scripts/modeles-journaliers.ts "<Rapport journalier cuisine et bar.xlsx>" "<Commande Journalière.xlsx>"');
  process.exit(1);
}
fs.mkdirSync(SORTIE, { recursive: true });
void (async () => {
  await alleger(rapport, path.join(SORTIE, "rapport-journalier.xlsx"));
  await alleger(commande, path.join(SORTIE, "commande-journaliere.xlsx"));
})();
