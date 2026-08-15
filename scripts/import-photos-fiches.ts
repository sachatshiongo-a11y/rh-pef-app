/**
 * Import des PHOTOS de plats embarquées dans le classeur RÉEL des fiches techniques
 * (« Fiche technique plats crash test.xlsx ») vers les fiches déjà importées par
 * `scripts/import-fiches-plats.ts` (module Stock).
 *
 * NE MODIFIE PAS `import-fiches-plats.ts` : ce script en importe les fonctions pures dont il a
 * besoin (`normaliserDesignation`, `analyserClasseur`) — il ne les réécrit pas.
 *
 * ─── LA CHAÎNE DE RATTACHEMENT (aucune bibliothèque ne l'expose, on la lit dans le zip) ────────
 *
 *   xl/workbook.xml                        nom d'onglet → r:id
 *   xl/_rels/workbook.xml.rels             r:id → xl/worksheets/sheetN.xml
 *   xl/worksheets/_rels/sheetN.xml.rels    relation « drawing » → xl/drawings/drawingN.xml
 *   xl/drawings/_rels/drawingN.xml.rels    relation(s) « image » → xl/media/imageN.{png,jpg,…}
 *
 * Un onglet peut n'avoir AUCUNE relation « drawing » (feuille sans image), ou une relation
 * « drawing » sans AUCUNE relation « image » (cadre de dessin vide) : les deux sont des cas
 * normaux, traités comme « 0 image », jamais comme une erreur.
 *
 * ─── LE PIÈGE DU CLASSEUR RÉEL : UNE IMAGE PARTAGÉE PAR (PRESQUE) TOUS LES ONGLETS ─────────────
 *
 * Sur le classeur de la Direction, `xl/media/image1.png` est référencée par 29 des 29 onglets qui
 * portent un dessin : c'est visiblement un logo d'en-tête, pas la photo d'un plat. Ce script ne le
 * DEVINE PAS : toute image référencée par PLUS D'UN onglet est signalée « partagée », jamais
 * rattachée automatiquement à qui que ce soit (deux photos du classeur réel se partagent aussi
 * entre exactement 2 onglets chacune — même traitement, même prudence).
 *
 * ─── RATTACHEMENT ONGLET → FICHE EN BASE ────────────────────────────────────────────────────────
 *
 * Le nom retenu d'une fiche (colonne B13, nettoyé de son suffixe de rendement par
 * `analyserClasseur`) diffère souvent du nom d'onglet, tronqué par Excel. On réutilise donc
 * EXACTEMENT les clés que `analyserClasseur` calcule déjà pour résoudre les sous-recettes
 * (`FicheParsee.cles` : onglet, nom nettoyé, nom brut — toutes normalisées par
 * `normaliserDesignation`) et on les compare au nom, normalisé de la même façon, des fiches DÉJÀ
 * EN BASE. Une seule image dont l'onglet ne retrouve aucune fiche, ou dont le nom normalisé
 * correspond à PLUSIEURS fiches en base (homonymes) est signalée, jamais devinée.
 *
 * ─── COMPRESSION (sharp — déjà une dépendance du projet, pas d'ajout) ──────────────────────────
 *
 * Les photos du classeur pèsent ~3,4 Mo en moyenne (JPEG plein cadre d'un appareil photo) :
 * inutilisables sur une page web et sur le réseau mobile de Kinshasa. Chaque image UNIQUE (une
 * image partagée par 2 onglets n'est compressée qu'une fois) est redimensionnée à 1000 px de
 * large maximum (jamais agrandie) et réencodée en JPEG qualité 78 (repli qualité 60 si le résultat
 * dépasse 500 Ko). Toujours réencodée en JPEG, quel que soit le format source (PNG compris) : une
 * seule voie de sortie, un seul format à tester.
 *
 * ─── IDEMPOTENCE ────────────────────────────────────────────────────────────────────────────────
 *
 * Une fiche dont `photoUrl` pointe déjà vers CE bucket ET ce préfixe
 * (`/fichiers/fiches-techniques/<ficheId>-…`) est considérée déjà importée : rejouer le script ne
 * la touche pas. Une fiche dont `photoUrl` pointe ailleurs (photo ajoutée à la main dans
 * l'application) est également laissée intacte, par défaut — un import ne doit jamais écraser en
 * silence un choix humain. `--remplacer` lève les deux protections et réenvoie / remplace,
 * proprement (l'ancien objet est retiré du bucket après que la base pointe sur le nouveau, jamais
 * avant — cf. `src/lib/fiches/photo-storage.ts`).
 *
 * ─── SÉCURITÉ ────────────────────────────────────────────────────────────────────────────────────
 *
 * `IMPORT_DATABASE_URL` est TOUJOURS exigée (y compris en `--dry-run`, qui a besoin de savoir
 * quelles fiches existent déjà pour rapprocher les onglets) : le `.env` du dépôt pointe la
 * PRODUCTION et n'est volontairement pas lu ici. En `--dry-run`, la lecture se fait dans une
 * transaction `SET TRANSACTION READ ONLY`, systématiquement annulée par un ROLLBACK : aucune
 * écriture n'est possible même si le `SET` était ignoré par un pooler.
 * Hors `--dry-run`, l'envoi vers Supabase Storage exige EN PLUS `IMPORT_SUPABASE_URL` et
 * `IMPORT_SUPABASE_SERVICE_ROLE_KEY` — des variables dédiées, distinctes de celles de
 * l'application (`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`), pour ne jamais
 * dépendre d'un `.env` chargé implicitement.
 *
 * Usage :
 *   npx tsx scripts/import-photos-fiches.ts --dry-run
 *        (IMPORT_DATABASE_URL requise ; AUCUN envoi, AUCUNE écriture — lecture seule + ROLLBACK)
 *   IMPORT_DATABASE_URL=postgresql://... IMPORT_SUPABASE_URL=https://... \
 *     IMPORT_SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/import-photos-fiches.ts [--remplacer]
 *   (le chemin du classeur peut être passé en dernier argument positionnel — sinon, valeur par défaut)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import * as XLSX from "xlsx";
import { analyserClasseur, normaliserDesignation, type FicheParsee } from "./import-fiches-plats";
import {
  PREFIXE_PHOTOS_FICHES,
  identifiantsSupabase,
  verifierBucketPhotos,
  envoyerPhoto,
  supprimerPhoto,
  urlPriveeDe,
  cheminDepuisUrlPrivee,
  type IdentifiantsSupabase,
} from "../src/lib/fiches/photo-storage";

const CHEMIN_PAR_DEFAUT = "/Users/sachatshiongo/Downloads/Tableurs/Fiche technique plats crash test.xlsx";
const ONGLET_ARTICLES = "Liste des articles";

const LARGEUR_MAX_PX = 1000;
const QUALITE_JPEG_DEFAUT = 78;
const QUALITE_JPEG_REPLI = 60;
const POIDS_CIBLE_OCTETS = 500 * 1024;

// ─── Lecture bas niveau du zip OOXML (aucune bibliothèque n'expose cette chaîne) ────────────────

type Relation = { id: string; target: string; type: string };

/** Parseur minimal de `<Relationship Id="…" Type="…" Target="…"/>` : suffisant, le format est fixe. */
export function parseRelationships(xml: string): Relation[] {
  const relations: Relation[] = [];
  const re = /<Relationship\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? "";
    const mode = /\bTargetMode="([^"]+)"/.exec(tag)?.[1];
    if (id && target && mode !== "External") relations.push({ id, target, type });
  }
  return relations;
}

/** `xl/worksheets` + `../drawings/drawing1.xml` → `xl/drawings/drawing1.xml` (jamais de `..` résiduel). */
export function resoudreCheminRelatif(dossierBase: string, cible: string): string {
  return path.posix.normalize(path.posix.join(dossierBase, cible));
}

export type ImageEmbarquee = { mediaPath: string; extension: string; octets: Buffer };

/**
 * Parcourt la chaîne complète workbook → worksheet → drawing → media pour chaque onglet du
 * classeur. Renvoie une entrée (potentiellement vide) pour CHAQUE onglet nommé dans
 * `xl/workbook.xml` — un onglet absent de la Map serait un bug du parseur, jamais un onglet
 * « ignoré silencieusement ».
 */
export async function extraireImagesParOnglet(zip: JSZip): Promise<Map<string, ImageEmbarquee[]>> {
  const resultat = new Map<string, ImageEmbarquee[]>();

  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) throw new Error("xl/workbook.xml introuvable : ce n'est pas un classeur .xlsx valide.");
  const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookRelsXml) throw new Error("xl/_rels/workbook.xml.rels introuvable.");
  const relsParId = new Map(parseRelationships(workbookRelsXml).map((r) => [r.id, r.target]));

  const sheetRe = /<sheet\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = sheetRe.exec(workbookXml))) {
    const tag = m[0];
    const nom = /\bname="([^"]+)"/.exec(tag)?.[1];
    const rId = /\br:id="([^"]+)"/.exec(tag)?.[1];
    if (!nom || !rId) continue;
    resultat.set(dexmlDecode(nom), []);

    const sheetTarget = relsParId.get(rId); // ex. "worksheets/sheet3.xml"
    if (!sheetTarget) continue;
    const sheetPath = resoudreCheminRelatif("xl", sheetTarget); // "xl/worksheets/sheet3.xml"
    const sheetDir = path.posix.dirname(sheetPath); // "xl/worksheets"
    const sheetRelsPath = `${sheetDir}/_rels/${path.posix.basename(sheetPath)}.rels`;

    const sheetRelsXml = await zip.file(sheetRelsPath)?.async("string");
    if (!sheetRelsXml) continue; // pas de relations pour cet onglet : pas de dessin, 0 image

    const relationsDrawing = parseRelationships(sheetRelsXml).filter((r) => r.type.endsWith("/drawing"));
    const images: ImageEmbarquee[] = [];
    for (const rel of relationsDrawing) {
      const drawingPath = resoudreCheminRelatif(sheetDir, rel.target); // "xl/drawings/drawing3.xml"
      const drawingDir = path.posix.dirname(drawingPath);
      const drawingRelsPath = `${drawingDir}/_rels/${path.posix.basename(drawingPath)}.rels`;
      const drawingRelsXml = await zip.file(drawingRelsPath)?.async("string");
      if (!drawingRelsXml) continue; // cadre de dessin sans image (courant : drawing30 du classeur réel)

      for (const relImage of parseRelationships(drawingRelsXml).filter((r) => r.type.endsWith("/image"))) {
        const mediaPath = resoudreCheminRelatif(drawingDir, relImage.target); // "xl/media/image7.jpg"
        const fichier = zip.file(mediaPath);
        if (!fichier) continue;
        const octets = await fichier.async("nodebuffer");
        const extension = path.posix.extname(mediaPath).replace(/^\./, "").toLowerCase() || "bin";
        images.push({ mediaPath, extension, octets });
      }
    }
    resultat.set(dexmlDecode(nom), images);
  }

  return resultat;
}

function dexmlDecode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// ─── Rattachement onglet/image → fiche en base ──────────────────────────────────────────────────

export type FicheBase = { id: string; nom: string; photoUrl: string | null };

export type Rattachement =
  | { statut: "RATTACHEE"; onglet: string; mediaPath: string; extension: string; octetsOriginaux: number; fiche: FicheBase }
  | { statut: "NON_RATTACHEE"; onglet: string; mediaPath: string; extension: string; octetsOriginaux: number; raison: string };

/**
 * Calcule, pour chaque image de chaque onglet, si elle se rattache SANS AMBIGUÏTÉ à une fiche déjà
 * en base. Pure (aucune E/S) : entièrement testable sur des données construites à la main.
 */
export function calculerRattachements(
  images: Map<string, ImageEmbarquee[]>,
  fichesClasseur: FicheParsee[],
  fichesBase: FicheBase[],
): Rattachement[] {
  // Portée de chaque image : sur combien d'onglets DISTINCTS apparaît-elle ? > 1 = partagée
  // (logo, motif générique…) — jamais rattachée automatiquement, quel que soit l'onglet.
  const ongletsParMedia = new Map<string, Set<string>>();
  for (const [onglet, liste] of images) {
    for (const img of liste) {
      if (!ongletsParMedia.has(img.mediaPath)) ongletsParMedia.set(img.mediaPath, new Set());
      ongletsParMedia.get(img.mediaPath)!.add(onglet);
    }
  }

  const ficheClasseurParOnglet = new Map(fichesClasseur.map((f) => [f.onglet, f]));

  const baseParCle = new Map<string, FicheBase>();
  const occurrencesCle = new Map<string, number>();
  for (const f of fichesBase) {
    const cle = normaliserDesignation(f.nom);
    occurrencesCle.set(cle, (occurrencesCle.get(cle) ?? 0) + 1);
    if (!baseParCle.has(cle)) baseParCle.set(cle, f);
  }
  const clesHomonymes = new Set([...occurrencesCle].filter(([, n]) => n > 1).map(([cle]) => cle));

  type Provisoire = { onglet: string; mediaPath: string; extension: string; octetsOriginaux: number; fiche: FicheBase | null; raison: string | null };
  const provisoires: Provisoire[] = [];

  for (const [onglet, liste] of images) {
    for (const img of liste) {
      const porteurs = ongletsParMedia.get(img.mediaPath)!;
      const base = { onglet, mediaPath: img.mediaPath, extension: img.extension, octetsOriginaux: img.octets.length };

      if (porteurs.size > 1) {
        provisoires.push({
          ...base,
          fiche: null,
          raison: `image partagée par ${porteurs.size} onglets (${[...porteurs].sort().join(", ")}) — probablement un logo ou un motif générique, aucun rattachement automatique.`,
        });
        continue;
      }
      if (onglet === ONGLET_ARTICLES) {
        provisoires.push({ ...base, fiche: null, raison: `onglet « ${ONGLET_ARTICLES} » : ce n'est pas une fiche technique.` });
        continue;
      }
      const ficheClasseur = ficheClasseurParOnglet.get(onglet);
      if (!ficheClasseur) {
        provisoires.push({ ...base, fiche: null, raison: "l'onglet ne se lit pas comme une fiche technique (cf. anomalies du parseur d'import-fiches-plats)." });
        continue;
      }

      let trouvee: FicheBase | null = null;
      let raisonHomonyme: string | null = null;
      for (const cle of ficheClasseur.cles) {
        if (clesHomonymes.has(cle)) {
          raisonHomonyme = `plusieurs fiches en base sont homonymes sous le nom normalisé « ${cle} » — rattachement refusé, à distinguer manuellement.`;
          break;
        }
        const f = baseParCle.get(cle);
        if (f) { trouvee = f; break; }
      }
      if (raisonHomonyme) { provisoires.push({ ...base, fiche: null, raison: raisonHomonyme }); continue; }
      if (!trouvee) {
        provisoires.push({ ...base, fiche: null, raison: `aucune fiche en base ne correspond (recherché sous : ${ficheClasseur.cles.join(", ")}).` });
        continue;
      }
      provisoires.push({ ...base, fiche: trouvee, raison: null });
    }
  }

  // Concurrence : deux onglets (donc deux images) visent la MÊME fiche en base. Aucune des deux
  // n'est retenue au hasard — c'est exactement le genre de rattachement deviné qu'on refuse.
  const parFicheId = new Map<string, Provisoire[]>();
  for (const p of provisoires) {
    if (!p.fiche) continue;
    const liste = parFicheId.get(p.fiche.id) ?? [];
    liste.push(p);
    parFicheId.set(p.fiche.id, liste);
  }
  for (const [, liste] of parFicheId) {
    if (liste.length <= 1) continue;
    const onglets = liste.map((p) => p.onglet).sort();
    for (const p of liste) {
      p.raison = `concurrence : les onglets ${onglets.join(", ")} visent tous la même fiche en base (« ${p.fiche!.nom} ») — à trancher manuellement.`;
      p.fiche = null;
    }
  }

  return provisoires.map((p) =>
    p.fiche
      ? { statut: "RATTACHEE", onglet: p.onglet, mediaPath: p.mediaPath, extension: p.extension, octetsOriginaux: p.octetsOriginaux, fiche: p.fiche }
      : { statut: "NON_RATTACHEE", onglet: p.onglet, mediaPath: p.mediaPath, extension: p.extension, octetsOriginaux: p.octetsOriginaux, raison: p.raison! },
  );
}

// ─── Compression (sharp) ─────────────────────────────────────────────────────────────────────────

export type ImageCompressee = { bytes: Buffer; largeur: number; hauteur: number; octetsApres: number };

/**
 * Redimensionne (largeur max `LARGEUR_MAX_PX`, jamais agrandie) et réencode TOUJOURS en JPEG —
 * qualité 78, repli à 60 si le résultat dépasse `POIDS_CIBLE_OCTETS`. `sharp` (déjà une dépendance
 * du projet, aucun ajout) : basé sur libvips, rapide, redresse l'orientation EXIF automatiquement
 * avant de l'effacer (`.rotate()` sans argument), ce qu'une recompression brute laisserait de travers
 * sur les photos prises au téléphone à la verticale.
 */
export async function compresserImage(bytes: Buffer): Promise<ImageCompressee> {
  const base = sharp(bytes).rotate();
  const meta = await base.metadata();
  const largeurCible = meta.width && meta.width < LARGEUR_MAX_PX ? meta.width : LARGEUR_MAX_PX;

  let sortie = await base.clone().resize({ width: largeurCible, withoutEnlargement: true }).jpeg({ quality: QUALITE_JPEG_DEFAUT, mozjpeg: true }).toBuffer();
  if (sortie.length > POIDS_CIBLE_OCTETS) {
    sortie = await base.clone().resize({ width: largeurCible, withoutEnlargement: true }).jpeg({ quality: QUALITE_JPEG_REPLI, mozjpeg: true }).toBuffer();
  }
  const infosFinales = await sharp(sortie).metadata();
  return { bytes: sortie, largeur: infosFinales.width ?? largeurCible, hauteur: infosFinales.height ?? 0, octetsApres: sortie.length };
}

// ─── Rapport ─────────────────────────────────────────────────────────────────────────────────────

const octetsLisibles = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} Mo` : `${(n / 1024).toFixed(0)} Ko`);

export function formaterRapport(
  rattachements: Rattachement[],
  compressions: Map<string, ImageCompressee>,
  fichesBase: FicheBase[],
  mode: "DRY_RUN" | "ECRITURE",
): string {
  const out: string[] = [];
  const rattachees = rattachements.filter((r): r is Extract<Rattachement, { statut: "RATTACHEE" }> => r.statut === "RATTACHEE");
  const nonRattachees = rattachements.filter((r): r is Extract<Rattachement, { statut: "NON_RATTACHEE" }> => r.statut === "NON_RATTACHEE");

  out.push(`Mode : ${mode === "DRY_RUN" ? "MARCHE À VIDE — aucun envoi, aucune écriture" : "IMPORT"}`);
  out.push(`Images embarquées distinctes (par chemin) : ${new Set(rattachements.map((r) => r.mediaPath)).size}`);
  out.push(`Occurrences image × onglet analysées : ${rattachements.length}`);

  out.push(`\n─── Rattachées (${rattachees.length}) ───`);
  for (const r of rattachees) {
    const c = compressions.get(r.mediaPath);
    const poids = c ? `${octetsLisibles(r.octetsOriginaux)} → ${octetsLisibles(c.octetsApres)} (${c.largeur}×${c.hauteur})` : octetsLisibles(r.octetsOriginaux);
    const dejaPresente = r.fiche.photoUrl ? " [fiche déjà pourvue d'une photo — ignorée sauf --remplacer]" : "";
    out.push(`  onglet « ${r.onglet} » → fiche « ${r.fiche.nom} » (${r.fiche.id}) — ${poids}${dejaPresente}`);
  }

  out.push(`\n─── NON rattachées (${nonRattachees.length}) — signalées, jamais devinées ───`);
  for (const r of nonRattachees) {
    out.push(`  onglet « ${r.onglet} » — ${r.mediaPath} (${octetsLisibles(r.octetsOriginaux)}) : ${r.raison}`);
  }

  const ficheIdsRattachees = new Set(rattachees.map((r) => r.fiche.id));
  const sansPhoto = fichesBase.filter((f) => !ficheIdsRattachees.has(f.id) && !f.photoUrl);
  out.push(`\n─── Fiches en base SANS photo, ni existante ni candidate dans ce classeur (${sansPhoto.length}) ───`);
  for (const f of sansPhoto) out.push(`  « ${f.nom} » (${f.id})`);

  return out.join("\n");
}

// ─── Base de données (lecture, puis écriture hors dry-run) ─────────────────────────────────────

export class RollbackVolontaire extends Error {}

/** Lecture des fiches en base sous transaction `READ ONLY`, systématiquement annulée : la marche à vide ne peut RIEN écrire, même si `SET TRANSACTION READ ONLY` était ignoré par un pooler. */
export async function chargerFichesBaseEnLectureSeule(prisma: import("@prisma/client").PrismaClient): Promise<FicheBase[]> {
  let lues: FicheBase[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      lues = await tx.ficheTechnique.findMany({ select: { id: true, nom: true, photoUrl: true } });
      throw new RollbackVolontaire();
    });
  } catch (e) {
    if (!(e instanceof RollbackVolontaire)) throw e;
  }
  return lues;
}

/** `true` si `photoUrl` a été écrite par CE script (préfixe et bucket lui appartenant). */
export function importeeParCeScript(photoUrl: string | null): boolean {
  const chemin = cheminDepuisUrlPrivee(photoUrl);
  return chemin !== null && chemin.startsWith(`${PREFIXE_PHOTOS_FICHES}/`);
}

export async function importerPhotos(
  prisma: import("@prisma/client").PrismaClient,
  ids: IdentifiantsSupabase,
  rattachements: Extract<Rattachement, { statut: "RATTACHEE" }>[],
  compressions: Map<string, ImageCompressee>,
  options: { remplacer: boolean },
): Promise<{ envoyees: string[]; ignorees: string[] }> {
  await verifierBucketPhotos(ids);

  const envoyees: string[] = [];
  const ignorees: string[] = [];

  for (const r of rattachements) {
    const dejaImportee = importeeParCeScript(r.fiche.photoUrl);
    const dejaManuelle = !!r.fiche.photoUrl && !dejaImportee;
    if ((dejaImportee || dejaManuelle) && !options.remplacer) {
      ignorees.push(`« ${r.fiche.nom} » (${dejaManuelle ? "photo déjà présente, ajoutée hors import" : "déjà importée"})`);
      continue;
    }

    const c = compressions.get(r.mediaPath);
    if (!c) throw new Error(`Compression manquante pour ${r.mediaPath} (bug interne : toute image rattachée doit avoir été compressée).`);

    const chemin = `${PREFIXE_PHOTOS_FICHES}/${r.fiche.id}-${Date.now()}.jpg`;
    await envoyerPhoto(ids, chemin, c.bytes, "image/jpeg");

    const ancienChemin = cheminDepuisUrlPrivee(r.fiche.photoUrl);
    await prisma.ficheTechnique.update({ where: { id: r.fiche.id }, data: { photoUrl: urlPriveeDe(chemin) } });
    if (ancienChemin && ancienChemin !== chemin) await supprimerPhoto(ids, ancienChemin);

    envoyees.push(`« ${r.fiche.nom} » (${r.fiche.id}) ← ${r.onglet}`);
  }

  return { envoyees, ignorees };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const remplacer = args.includes("--remplacer");
  const cheminFichier = args.find((a) => !a.startsWith("--")) ?? CHEMIN_PAR_DEFAUT;

  const databaseUrl = process.env.IMPORT_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "IMPORT_DATABASE_URL manquante. Le .env du dépôt pointe la PRODUCTION et n'est volontairement pas lu ici — " +
        "fournissez-la explicitement, y compris pour --dry-run (qui en a besoin pour rapprocher les onglets des " +
        "fiches déjà en base ; elle n'y est utilisée qu'en lecture seule, sous ROLLBACK systématique).",
    );
  }

  console.log(`Fichier source : ${cheminFichier}`);
  console.log(`Mode : ${dryRun ? "MARCHE À VIDE (lecture seule + ROLLBACK ; aucun envoi)" : `IMPORT${remplacer ? " (--remplacer)" : ""}`}`);

  const octetsFichier = readFileSync(cheminFichier);
  const [zip, wb] = await Promise.all([
    JSZip.loadAsync(octetsFichier),
    Promise.resolve(XLSX.read(octetsFichier, { cellFormula: false, cellHTML: false, cellStyles: false, bookDeps: false })),
  ]);

  const images = await extraireImagesParOnglet(zip);
  const res = analyserClasseur(wb);

  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const fichesBase = dryRun
      ? await chargerFichesBaseEnLectureSeule(prisma)
      : await prisma.ficheTechnique.findMany({ select: { id: true, nom: true, photoUrl: true } });

    const rattachements = calculerRattachements(images, res.fiches, fichesBase);

    // Compression : une fois par média DISTINCT (jamais deux fois la même image partagée).
    const compressions = new Map<string, ImageCompressee>();
    const mediaVus = new Set<string>();
    for (const [, liste] of images) {
      for (const img of liste) {
        if (mediaVus.has(img.mediaPath)) continue;
        mediaVus.add(img.mediaPath);
        compressions.set(img.mediaPath, await compresserImage(img.octets));
      }
    }

    console.log(formaterRapport(rattachements, compressions, fichesBase, dryRun ? "DRY_RUN" : "ECRITURE"));

    if (dryRun) {
      console.log("\nMARCHE À VIDE — transaction annulée (ROLLBACK). Aucune écriture, aucun envoi, nulle part.");
      return;
    }

    const ids = identifiantsSupabase({ url: "IMPORT_SUPABASE_URL", key: "IMPORT_SUPABASE_SERVICE_ROLE_KEY" });
    const rattachees = rattachements.filter((r): r is Extract<Rattachement, { statut: "RATTACHEE" }> => r.statut === "RATTACHEE");
    const { envoyees, ignorees } = await importerPhotos(prisma, ids, rattachees, compressions, { remplacer });

    console.log(`\n${envoyees.length} photo(s) envoyée(s) :`);
    for (const e of envoyees) console.log(`  ${e}`);
    console.log(`\n${ignorees.length} fiche(s) ignorée(s) (déjà pourvue(s), --remplacer non fourni) :`);
    for (const i of ignorees) console.log(`  ${i}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith("import-photos-fiches.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
