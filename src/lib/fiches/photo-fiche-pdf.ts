import "server-only";

import sharp from "sharp";
import {
  PREFIXE_PHOTOS_FICHES, cheminDepuisUrlPrivee, detecterTypeImage, identifiantsSupabase, lirePhoto,
} from "@/lib/fiches/photo-storage";
import type { PhotoPdf } from "@/lib/pdf/fiche-technique";

// Photos des fiches techniques pour leur PDF. Le bucket est PRIVÉ : la photo est lue ICI, côté
// serveur, avec la clé de service (comme la route `/fichiers/[...chemin]`, mais sans jamais produire
// d'URL — ni publique, ni signée), puis embarquée dans le document.
//
// Le moteur PDF ne sait dessiner que du JPEG et du PNG ; les photos du classeur du bar et celles
// prises au téléphone peuvent être en WEBP, et peser plusieurs centaines de Ko. Chaque photo est donc
// ré-encodée en JPEG, orientée selon l'EXIF, bornée à 600 px (le cadre fait 180 × 135 pt : ~240 ppp
// à l'impression) : mesuré sur 60 fiches à photo de 300 Ko, le PDF passe de 8,6 Mo (900 px) à 3,6 Mo.
//
// MÉMOIRE : PEF tourne sur une instance de 512 Mo. Au plus `EN_PARALLELE` photos sont lues et
// décodées à la fois (file d'attente : un emplacement libéré prend la photo suivante) ; seules les
// versions réduites (quelques dizaines de Ko) restent en mémoire jusqu'au rendu, jamais les
// originaux décodés de tout l'onglet.

const COTE_MAX_PX = 600;
export const EN_PARALLELE = 3;
/**
 * Au-delà, la photo n'est pas décodée (« illisible ») : 5 Mo de PNG peuvent cacher des dizaines de
 * mégapixels, soit des centaines de Mo une fois décodés. 40 Mpx couvre largement un téléphone (12-48 Mpx
 * en JPEG) sans mettre l'instance à genoux.
 */
export const PIXELS_MAX = 40_000_000;

async function versJpeg(octets: Buffer): Promise<Buffer | null> {
  if (!detecterTypeImage(octets)) return null;
  try {
    return await sharp(octets, { limitInputPixels: PIXELS_MAX }).rotate().resize(COTE_MAX_PX, COTE_MAX_PX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  } catch {
    return null;
  }
}

/**
 * Photos des fiches demandées, indexées par identifiant de fiche. Une fiche sans photo n'a pas
 * d'entrée ; une photo introuvable, hors du dossier des fiches ou indécodable vaut `"illisible"` —
 * jamais une erreur qui empêcherait d'imprimer la fiche.
 */
export async function chargerPhotosPdf(
  fiches: { id: string; photoUrl: string | null }[],
  { delaiMs }: { delaiMs?: number } = {},
): Promise<Map<string, PhotoPdf>> {
  const avecPhoto = fiches.filter((f) => f.photoUrl);
  const photos = new Map<string, PhotoPdf>();
  if (avecPhoto.length === 0) return photos;

  let ids: ReturnType<typeof identifiantsSupabase> | null = null;
  try {
    ids = identifiantsSupabase();
  } catch {
    ids = null; // configuration absente : chaque photo est annoncée illisible, la fiche s'imprime
  }

  const lire = async (f: { id: string; photoUrl: string | null }): Promise<PhotoPdf> => {
    const chemin = cheminDepuisUrlPrivee(f.photoUrl);
    // Seul le dossier des photos de fiches est lu : une URL en base qui pointerait ailleurs dans le
    // bucket (contrats, bulletins…) ne finit jamais imprimée dans une fiche technique.
    if (!ids || !chemin || !chemin.startsWith(`${PREFIXE_PHOTOS_FICHES}/`) || chemin.includes("..")) return "illisible";
    try {
      const octets = await lirePhoto(ids, chemin, { delaiMs });
      const jpeg = octets ? await versJpeg(octets) : null;
      return jpeg ? { data: jpeg, format: "jpg" } : "illisible";
    } catch {
      return "illisible";
    }
  };

  let suivante = 0;
  const ouvrier = async () => {
    while (suivante < avecPhoto.length) {
      const f = avecPhoto[suivante++];
      photos.set(f.id, await lire(f));
    }
  };
  await Promise.all(Array.from({ length: Math.min(EN_PARALLELE, avecPhoto.length) }, ouvrier));
  return photos;
}
