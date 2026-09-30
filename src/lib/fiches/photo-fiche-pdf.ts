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
// ré-encodée en JPEG, orientée selon l'EXIF, bornée à 900 px : un PDF de 40 cocktails reste léger.


const COTE_MAX_PX = 900;
const EN_PARALLELE = 6;

async function versJpeg(octets: Buffer): Promise<Buffer | null> {
  if (!detecterTypeImage(octets)) return null;
  try {
    return await sharp(octets).rotate().resize(COTE_MAX_PX, COTE_MAX_PX, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

/**
 * Photos des fiches demandées, indexées par identifiant de fiche. Une fiche sans photo n'a pas
 * d'entrée ; une photo introuvable, hors du dossier des fiches ou indécodable vaut `"illisible"` —
 * jamais une erreur qui empêcherait d'imprimer la fiche.
 */
export async function chargerPhotosPdf(fiches: { id: string; photoUrl: string | null }[]): Promise<Map<string, PhotoPdf>> {
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
      const octets = await lirePhoto(ids, chemin);
      const jpeg = octets ? await versJpeg(octets) : null;
      return jpeg ? { data: jpeg, format: "jpg" } : "illisible";
    } catch {
      return "illisible";
    }
  };

  for (let i = 0; i < avecPhoto.length; i += EN_PARALLELE) {
    const lot = avecPhoto.slice(i, i + EN_PARALLELE);
    const lues = await Promise.all(lot.map(lire));
    lot.forEach((f, k) => photos.set(f.id, lues[k]));
  }
  return photos;
}
