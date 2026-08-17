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
 * ─── ARBITRAGE DES IMAGES PARTAGÉES (scripts/arbitrages-photos-partagees.json) ─────────────────
 *
 * Le refus ci-dessus peut être levé, entrée par entrée, par un fichier de données VERSIONNÉ et
 * relu à la main (même esprit que `correspondances-articles-fiches.json` côté articles) :
 * `« cette image partagée va à CETTE fiche, pas aux autres, et voici pourquoi »`. Aucune devinette
 * codée en dur : une image partagée SANS entrée d'arbitrage reste refusée, comme avant. Une entrée
 * d'arbitrage qui ne résout PAS (image absente du classeur relu, fiche cible introuvable ou
 * ambiguë en base, ou aucun onglet porteur ne correspond à la fiche cible) fait REFUSER LE SCRIPT
 * en la nommant — cf. `chargerArbitragesPhotos` et la vérification en tête de
 * `calculerRattachements`.
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
import { fileURLToPath } from "node:url";
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

// ─── Arbitrage des images partagées (fichier de données VERSIONNÉ, relisible) ───────────────────

/**
 * Un arbitrage ARBITRÉ PAR LA DIRECTION : « cette image, partagée par plusieurs onglets, va à
 * CETTE fiche (« fiche »), pas aux autres (« ecartees »), et voici pourquoi (« motif ») ».
 *
 * Même esprit que `Correspondance` (import-fiches-plats.ts) : un fichier JSON versionné à côté du
 * script, jamais une constante enfouie dans le code. Ne redirige RIEN d'autre qu'UNE image vers
 * UNE fiche — ni le classeur, ni le catalogue d'articles, ni aucune autre fiche que celle nommée.
 */
export type ArbitragePhoto = {
  /** Nom du fichier média, tel qu'il apparaît dans `xl/media/` (ex. « image2.jpg »). */
  image: string;
  /** Désignation de la fiche DÉJÀ en base qui reçoit la photo. */
  fiche: string;
  /** Fiches (ou onglets) qui portent la même image mais ne la reçoivent PAS — documentation. */
  ecartees: string[];
  /** Pourquoi cette fiche et pas les autres. Une phrase, relue par la Direction. */
  motif: string;
};

/** Emplacement du fichier de données. Versionné à côté du script, JAMAIS noyé dans le code. */
export const CHEMIN_ARBITRAGES_PHOTOS = fileURLToPath(
  new URL("./arbitrages-photos-partagees.json", import.meta.url),
);

function estTexteNonVideP(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Valide la table d'arbitrages et REFUSE tout ce qui est mal formé ou contradictoire, plutôt que
 * de l'interpréter : entrée mal formée, motif absent, « ecartees » vide (une image qu'on arbitre
 * est par construction partagée avec au moins un autre porteur — le documenter n'est pas
 * optionnel), fiche qui figure aussi dans ses propres « ecartees », ou deux entrées pour LA MÊME
 * image (laquelle ferait foi ?).
 */
export function validerArbitragesPhotos(brut: unknown, source: string): ArbitragePhoto[] {
  const racine = brut as { arbitrages?: unknown } | null;
  if (racine === null || typeof racine !== "object" || !Array.isArray(racine.arbitrages)) {
    throw new Error(
      `Table d'arbitrages de photos (${source}) : il faut un objet JSON avec un tableau ` +
        "« arbitrages ». Rien n'a été lu.",
    );
  }

  const entrees: ArbitragePhoto[] = [];
  racine.arbitrages.forEach((e, index) => {
    const rang = `entrée n°${index + 1}`;
    if (e === null || typeof e !== "object") {
      throw new Error(`Table d'arbitrages de photos (${source}) : ${rang} n'est pas un objet.`);
    }
    const { image, fiche, ecartees, motif } = e as Record<string, unknown>;
    if (!estTexteNonVideP(image) || !estTexteNonVideP(fiche)) {
      throw new Error(
        `Table d'arbitrages de photos (${source}) : ${rang} doit porter « image » et « fiche », deux textes non vides.`,
      );
    }
    if (!estTexteNonVideP(motif)) {
      throw new Error(
        `Table d'arbitrages de photos (${source}) : ${rang} (« ${image} » → « ${fiche} ») n'a pas de « motif ». ` +
          "Un arbitrage sans raison écrite n'est pas relisible par la Direction : refusé.",
      );
    }
    if (!Array.isArray(ecartees) || ecartees.length === 0 || !ecartees.every(estTexteNonVideP)) {
      throw new Error(
        `Table d'arbitrages de photos (${source}) : ${rang} (« ${image} » → « ${fiche} ») doit porter ` +
          "« ecartees », un tableau NON VIDE de textes — les fiches qui portent la même image sans la recevoir.",
      );
    }
    if (ecartees.some((x) => normaliserDesignation(x) === normaliserDesignation(fiche))) {
      throw new Error(
        `Table d'arbitrages de photos (${source}) : ${rang} — « ${fiche} » figure à la fois comme fiche ` +
          "receveuse et dans « ecartees » : contradiction, refusée.",
      );
    }
    entrees.push({ image: image.trim(), fiche: fiche.trim(), ecartees: ecartees.map((x) => x.trim()), motif: motif.trim() });
  });

  const parImage = new Map<string, ArbitragePhoto>();
  for (const e of entrees) {
    const deja = parImage.get(e.image);
    if (deja) {
      throw new Error(
        `Table d'arbitrages de photos (${source}) : « ${e.image} » figure DEUX FOIS, vers « ${deja.fiche} » puis ` +
          `vers « ${e.fiche} ». Laquelle fait foi ? On ne tranche pas à la place de la Direction.`,
      );
    }
    parImage.set(e.image, e);
  }

  return entrees;
}

/** Lit et valide le fichier de données versionné. Toute anomalie ARRÊTE tout, avant la moindre lecture de base. */
export function chargerArbitragesPhotos(chemin: string = CHEMIN_ARBITRAGES_PHOTOS): ArbitragePhoto[] {
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(chemin, "utf8"));
  } catch (e) {
    throw new Error(
      `Table d'arbitrages de photos : impossible de lire « ${chemin} » (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
  return validerArbitragesPhotos(brut, chemin);
}

// ─── Rattachement onglet/image → fiche en base ──────────────────────────────────────────────────

export type FicheBase = { id: string; nom: string; photoUrl: string | null };

export type Rattachement =
  | { statut: "RATTACHEE"; onglet: string; mediaPath: string; extension: string; octetsOriginaux: number; fiche: FicheBase; arbitrage?: ArbitragePhoto | null }
  | { statut: "NON_RATTACHEE"; onglet: string; mediaPath: string; extension: string; octetsOriginaux: number; raison: string; arbitrage?: ArbitragePhoto | null };

/**
 * Calcule, pour chaque image de chaque onglet, si elle se rattache SANS AMBIGUÏTÉ à une fiche déjà
 * en base. Pure (aucune E/S) : entièrement testable sur des données construites à la main.
 *
 * `arbitrages` (optionnel, défaut aucun) lève le refus d'une image PARTAGÉE, entrée par entrée —
 * cf. `ArbitragePhoto` et `scripts/arbitrages-photos-partagees.json`. Toute entrée qui ne résout
 * PAS sur ce classeur / cette base fait ÉCHOUER l'appel entier, avant qu'aucun rattachement ne
 * soit calculé : un arbitrage mort qui passerait inaperçu laisserait une photo sans destination
 * sûre, sans que personne ne s'en aperçoive.
 */
export function calculerRattachements(
  images: Map<string, ImageEmbarquee[]>,
  fichesClasseur: FicheParsee[],
  fichesBase: FicheBase[],
  arbitrages: ArbitragePhoto[] = [],
): Rattachement[] {
  // Portée de chaque image : sur combien d'onglets DISTINCTS apparaît-elle ? > 1 = partagée
  // (logo, motif générique…) — jamais rattachée automatiquement, quel que soit l'onglet, SAUF
  // arbitrage explicite (ci-dessous).
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

  // ── Arbitrages : vérifiés AVANT tout calcul de rattachement. Chaque entrée doit résoudre sur
  // CE classeur ET cette base, sans quoi elle est refusée nommément — jamais silencieusement.
  const basenamesConnus = new Map<string, string>(); // basename → mediaPath (un seul par basename dans un .xlsx)
  for (const mediaPath of ongletsParMedia.keys()) basenamesConnus.set(path.posix.basename(mediaPath), mediaPath);

  const arbitragesParImage = new Map(arbitrages.map((a) => [a.image, a]));
  const gagnantParImage = new Map<string, string>(); // basename → onglet qui reçoit effectivement la photo
  const problemesArbitrages: string[] = [];

  for (const arb of arbitrages) {
    const mediaPath = basenamesConnus.get(arb.image);
    if (!mediaPath) {
      problemesArbitrages.push(
        `« ${arb.image} » (arbitrage → « ${arb.fiche} ») : image inconnue de ce classeur — aucune image nommée ainsi n'y est embarquée.`,
      );
      continue;
    }

    const cleCible = normaliserDesignation(arb.fiche);
    if (clesHomonymes.has(cleCible)) {
      problemesArbitrages.push(
        `« ${arb.image} » → fiche cible « ${arb.fiche} » : ambiguë, plusieurs fiches en base portent ce nom normalisé — refusé.`,
      );
      continue;
    }
    if (!baseParCle.has(cleCible)) {
      problemesArbitrages.push(`« ${arb.image} » → fiche cible « ${arb.fiche} » : introuvable en base.`);
      continue;
    }

    const porteurs = ongletsParMedia.get(mediaPath)!;
    if (porteurs.size <= 1) continue; // image plus partagée dans ce classeur : arbitrage sans objet ici, pas une erreur.

    const ongletGagnant = [...porteurs]
      .sort()
      .find((o) => ficheClasseurParOnglet.get(o)?.cles.includes(cleCible));
    if (!ongletGagnant) {
      problemesArbitrages.push(
        `« ${arb.image} » est partagée par ${porteurs.size} onglets (${[...porteurs].sort().join(", ")}) mais ` +
          `AUCUN ne correspond à la fiche cible « ${arb.fiche} » — arbitrage mort, à corriger.`,
      );
      continue;
    }
    gagnantParImage.set(arb.image, ongletGagnant);
  }

  if (problemesArbitrages.length > 0) {
    throw new Error(
      `ABANDON : ${problemesArbitrages.length} arbitrage(s) de photos partagées ne résolvent pas ` +
        `(scripts/arbitrages-photos-partagees.json) :\n` +
        problemesArbitrages.map((p) => `  • ${p}`).join("\n") +
        "\nRien n'a été rattaché. Corrige le fichier d'arbitrage (ou le classeur), puis relance.",
    );
  }

  type Provisoire = { onglet: string; mediaPath: string; extension: string; octetsOriginaux: number; fiche: FicheBase | null; raison: string | null; arbitrage: ArbitragePhoto | null };
  const provisoires: Provisoire[] = [];

  for (const [onglet, liste] of images) {
    for (const img of liste) {
      const porteurs = ongletsParMedia.get(img.mediaPath)!;
      const base = { onglet, mediaPath: img.mediaPath, extension: img.extension, octetsOriginaux: img.octets.length };

      if (porteurs.size > 1) {
        const arb = arbitragesParImage.get(path.posix.basename(img.mediaPath));
        if (arb) {
          const ongletGagnant = gagnantParImage.get(arb.image)!; // garanti présent : la vérification ci-dessus a réussi
          if (onglet === ongletGagnant) {
            const fiche = baseParCle.get(normaliserDesignation(arb.fiche))!; // garanti présent, même vérification
            provisoires.push({ ...base, fiche, raison: null, arbitrage: arb });
          } else {
            provisoires.push({
              ...base,
              fiche: null,
              raison:
                `image partagée par ${porteurs.size} onglets (${[...porteurs].sort().join(", ")}) — arbitrage Direction : ` +
                `attribuée à « ${arb.fiche} » (onglet « ${ongletGagnant} »), pas à cet onglet. Motif : ${arb.motif}`,
              arbitrage: arb,
            });
          }
          continue;
        }
        provisoires.push({
          ...base,
          fiche: null,
          raison: `image partagée par ${porteurs.size} onglets (${[...porteurs].sort().join(", ")}) — probablement un logo ou un motif générique, aucun rattachement automatique.`,
          arbitrage: null,
        });
        continue;
      }
      if (onglet === ONGLET_ARTICLES) {
        provisoires.push({ ...base, fiche: null, raison: `onglet « ${ONGLET_ARTICLES} » : ce n'est pas une fiche technique.`, arbitrage: null });
        continue;
      }
      const ficheClasseur = ficheClasseurParOnglet.get(onglet);
      if (!ficheClasseur) {
        provisoires.push({ ...base, fiche: null, raison: "l'onglet ne se lit pas comme une fiche technique (cf. anomalies du parseur d'import-fiches-plats).", arbitrage: null });
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
      if (raisonHomonyme) { provisoires.push({ ...base, fiche: null, raison: raisonHomonyme, arbitrage: null }); continue; }
      if (!trouvee) {
        provisoires.push({ ...base, fiche: null, raison: `aucune fiche en base ne correspond (recherché sous : ${ficheClasseur.cles.join(", ")}).`, arbitrage: null });
        continue;
      }
      provisoires.push({ ...base, fiche: trouvee, raison: null, arbitrage: null });
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
      ? { statut: "RATTACHEE", onglet: p.onglet, mediaPath: p.mediaPath, extension: p.extension, octetsOriginaux: p.octetsOriginaux, fiche: p.fiche, arbitrage: p.arbitrage }
      : { statut: "NON_RATTACHEE", onglet: p.onglet, mediaPath: p.mediaPath, extension: p.extension, octetsOriginaux: p.octetsOriginaux, raison: p.raison!, arbitrage: p.arbitrage },
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
    const arbitrageNote = r.arbitrage
      ? ` [arbitrage Direction : ${r.arbitrage.motif} — écartée(s) : ${r.arbitrage.ecartees.join(", ")}]`
      : "";
    out.push(`  onglet « ${r.onglet} » → fiche « ${r.fiche.nom} » (${r.fiche.id}) — ${poids}${dejaPresente}${arbitrageNote}`);
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

  // La table d'arbitrages est chargée et VALIDÉE avant tout le reste : un fichier illisible doit
  // arrêter le script, pas se manifester en cours d'exécution.
  const arbitrages = chargerArbitragesPhotos();
  console.log(`Arbitrages de photos partagées chargés : ${arbitrages.length} (${CHEMIN_ARBITRAGES_PHOTOS}).`);

  const { PrismaClient } = await import("@prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const fichesBase = dryRun
      ? await chargerFichesBaseEnLectureSeule(prisma)
      : await prisma.ficheTechnique.findMany({ select: { id: true, nom: true, photoUrl: true } });

    const rattachements = calculerRattachements(images, res.fiches, fichesBase, arbitrages);

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
