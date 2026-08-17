import "server-only";

const BUCKET = "employes";

/** Téléverse un fichier dans le bucket privé et renvoie son chemin interne (« /fichiers/<path> »). */
export async function televerserFichier(path: string, data: Buffer, contentType: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Stockage non configuré.");
  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType, "x-upsert": "true" },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new Error("Le téléversement du fichier a échoué.");
  return `/fichiers/${path}`;
}

/** Relit un fichier du bucket privé depuis son chemin interne. Renvoie null si absent/illisible. */
export async function lireFichier(pathInterne: string): Promise<Buffer | null> {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return null;
    const rel = pathInterne.replace(/^\/fichiers\//, "");
    const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${rel}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
