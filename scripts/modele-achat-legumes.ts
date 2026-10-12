/**
 * Modèle de la fiche « Achat de légumes Marché » : l'onglet « Achat légumes » du classeur de la
 * Direction (« Fiche inventaire cuisine, bar et achat légumes.xlsx »), seul, dans `assets/modeles/`.
 *
 *   npx tsx scripts/modele-achat-legumes.ts "<Fiche inventaire cuisine, bar et achat légumes.xlsx>"
 *
 * La fiche PDF (lib/pdf/fiche-achat-legumes) en reprend la mise en page ; le test de fidélité
 * (fiche-achat-legumes.fidelite.test.ts) relit ce classeur et compare. Quand la Direction change
 * son modèle, on relance ce script sur le nouveau classeur.
 *
 * Allègement, sans rien changer à ce qui s'affiche ou s'imprime : les onglets « Bar » et
 * « Cuisine » (et leurs tableaux et dessins), `docProps/app.xml` (liste d'onglets périmée) et le
 * chemin du fichier sur l'ordinateur de la Direction (x15ac:absPath) sont retirés ; le reste est
 * recopié octet pour octet.
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const sansRelation = (rels: string, cible: RegExp) => rels.replace(/<Relationship\b[^>]*\/>/g, (r) => (cible.test(r) ? "" : r));
const sansOverride = (types: string, partie: RegExp) => types.replace(/<Override\b[^>]*\/>/g, (o) => (partie.test(o) ? "" : o));

async function main(source: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(source));
  const lire = (nom: string) => zip.file(nom)!.async("string");
  const ecrire = (nom: string, texte: string) => zip.file(nom, texte, { createFolders: false });

  let classeur = await lire("xl/workbook.xml");
  const feuille = /<sheet name="Achat légumes" sheetId="\d+" r:id="(rId\d+)"\/>/.exec(classeur);
  if (!feuille) throw new Error("Onglet « Achat légumes » introuvable dans le classeur.");
  classeur = classeur
    .replace(/<sheets>[\s\S]*<\/sheets>/, `<sheets>${feuille[0]}</sheets>`)
    .replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/, "")
    .replace(/\sactiveTab="\d+"/, "");
  ecrire("xl/workbook.xml", classeur);

  // Les deux autres onglets, leurs tableaux, leurs dessins ; le dessin de l'onglet gardé est le 3.
  const rels = await lire("xl/_rels/workbook.xml.rels");
  const cible = /Target="worksheets\/(sheet1|sheet2)\.xml"/;
  ecrire("xl/_rels/workbook.xml.rels", sansRelation(rels, cible));
  let types = await lire("[Content_Types].xml");
  types = sansOverride(types, /PartName="\/(xl\/worksheets\/sheet[12]\.xml|xl\/drawings\/drawing[12]\.xml|xl\/tables\/table[12]\.xml|docProps\/app\.xml)"/);
  ecrire("[Content_Types].xml", types);
  for (const f of ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/_rels/sheet1.xml.rels", "xl/worksheets/_rels/sheet2.xml.rels",
    "xl/drawings/drawing1.xml", "xl/drawings/drawing2.xml", "xl/drawings/_rels/drawing1.xml.rels", "xl/drawings/_rels/drawing2.xml.rels",
    "xl/tables/table1.xml", "xl/tables/table2.xml", "docProps/app.xml"]) zip.remove(f);
  ecrire("_rels/.rels", sansRelation(await lire("_rels/.rels"), /Target="docProps\/app\.xml"/));

  const sortie = path.join(process.cwd(), "assets/modeles/achat-legumes.xlsx");
  fs.writeFileSync(sortie, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`${sortie} : ${fs.statSync(sortie).size} octets`);
}

const source = process.argv[2];
if (!source) { console.error("Usage : npx tsx scripts/modele-achat-legumes.ts <classeur.xlsx>"); process.exit(1); }
main(source).catch((e) => { console.error(e); process.exit(1); });
