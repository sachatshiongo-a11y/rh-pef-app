// Stockage des photos de plats (fiches techniques) : Supabase Storage, bucket PRIVÉ.
//
// On réutilise le bucket « employes » (déjà créé, déjà privé, déjà servi par
// src/app/fichiers/[...chemin]/route.ts) sous un préfixe de chemin dédié — aucune création
// Supabase n'est nécessaire pour ce module. Le patron d'upload (envoi brut par fetch, URL privée
// enregistrée en base sous la forme `/fichiers/<chemin>`) est repris tel quel de
// src/app/(app)/employes/photo-actions.ts.
//
// PAS de `import "server-only"` ici : ce module est aussi importé par le script d'import
// (scripts/import-photos-fiches.ts), exécuté en Node nu via tsx — hors du bundler Next, qui est
// le seul endroit où le paquet `server-only` est disponible (cf. src/lib/fiches/cout.ts et
// conversion.ts, pour la même raison).

export const BUCKET_PHOTOS_FICHES = "employes";
export const PREFIXE_PHOTOS_FICHES = "fiches-techniques";

const TYPES_OK = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type TypeImageReconnu = keyof typeof TYPES_OK;

export function extensionImage(mime: TypeImageReconnu): string {
  return TYPES_OK[mime];
}

/**
 * Détecte le type réel d'une image par sa signature binaire (magic bytes) — jamais le `type`
 * déclaré par le navigateur/le client, qui n'est qu'une étiquette et se falsifie trivialement.
 */
export function detecterTypeImage(bytes: Buffer): TypeImageReconnu | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export type IdentifiantsSupabase = { base: string; key: string };

/**
 * Identifiants de service pour Supabase Storage. `depuisEnv` permet au script d'import de fournir
 * des variables dédiées (`IMPORT_SUPABASE_URL` / `IMPORT_SUPABASE_SERVICE_ROLE_KEY`) plutôt que
 * les variables d'environnement de l'application (`NEXT_PUBLIC_SUPABASE_URL` /
 * `SUPABASE_SERVICE_ROLE_KEY`), pour ne jamais dépendre d'un `.env` chargé implicitement.
 */
export function identifiantsSupabase(
  vars: { url: string; key: string } = { url: "NEXT_PUBLIC_SUPABASE_URL", key: "SUPABASE_SERVICE_ROLE_KEY" },
): IdentifiantsSupabase {
  const base = process.env[vars.url];
  const key = process.env[vars.key];
  if (!base || !key) {
    throw new Error(`Configuration Supabase manquante : ${vars.url} et ${vars.key} doivent être définies.`);
  }
  return { base, key };
}

/**
 * Vérifie que le bucket existe AVANT tout envoi. Un bucket manquant fait échouer les envois EN
 * SILENCE côté Supabase Storage (piège déjà rencontré sur un autre projet) : on préfère un échec
 * bruyant, avec le nom exact du bucket à créer.
 */
export async function verifierBucketPhotos(ids: IdentifiantsSupabase): Promise<void> {
  const res = await fetch(`${ids.base}/storage/v1/bucket/${BUCKET_PHOTOS_FICHES}`, {
    headers: { apikey: ids.key, Authorization: `Bearer ${ids.key}` },
  });
  if (res.status === 404) {
    throw new Error(
      `Bucket Supabase Storage « ${BUCKET_PHOTOS_FICHES} » introuvable. Ce module réutilise le bucket des ` +
        "photos d'employé (privé) : vérifiez qu'il existe toujours dans le dashboard Supabase " +
        "(Storage → Buckets) avant d'envoyer une photo de fiche technique.",
    );
  }
  if (!res.ok) {
    throw new Error(`Impossible de vérifier le bucket « ${BUCKET_PHOTOS_FICHES} » (HTTP ${res.status}).`);
  }
}

export async function envoyerPhoto(ids: IdentifiantsSupabase, chemin: string, bytes: Buffer, contentType: string): Promise<void> {
  const res = await fetch(`${ids.base}/storage/v1/object/${BUCKET_PHOTOS_FICHES}/${chemin}`, {
    method: "POST",
    headers: { apikey: ids.key, Authorization: `Bearer ${ids.key}`, "Content-Type": contentType, "x-upsert": "true" },
    // `new Uint8Array(bytes)` plutôt que `bytes` (Buffer) : évite un conflit de typage entre le
    // `Buffer<ArrayBufferLike>` générique de @types/node et `BodyInit` du lib DOM — mêmes octets.
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`Échec de l'envoi de la photo « ${chemin} » (HTTP ${res.status}).`);
}

/** Silencieux en cas d'échec : une suppression ratée laisse une orpheline dans le bucket, elle ne doit jamais faire échouer l'écriture en base qui l'a déjà remplacée. */
export async function supprimerPhoto(ids: IdentifiantsSupabase, chemin: string): Promise<void> {
  try {
    await fetch(`${ids.base}/storage/v1/object/${BUCKET_PHOTOS_FICHES}/${chemin}`, {
      method: "DELETE",
      headers: { apikey: ids.key, Authorization: `Bearer ${ids.key}` },
    });
  } catch {
    // best-effort
  }
}

/** URL privée telle qu'enregistrée en base — servie par /fichiers/[...chemin] (session obligatoire). */
export function urlPriveeDe(chemin: string): string {
  return `/fichiers/${chemin}`;
}

/** Chemin de stockage à partir de l'URL privée enregistrée en base (pour retirer l'ancienne photo). */
export function cheminDepuisUrlPrivee(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("/fichiers/")) return null;
  return url.slice("/fichiers/".length);
}

/** Nom de fichier stable pour une fiche donnée, horodaté pour ne jamais collisionner un remplacement concurrent. */
export function cheminPhotoFiche(ficheId: string, extension: string, maintenant: () => number = Date.now): string {
  return `${PREFIXE_PHOTOS_FICHES}/${ficheId}-${maintenant()}.${extension}`;
}
