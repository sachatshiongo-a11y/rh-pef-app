import "server-only";

const BUCKET = "employes";

// Type MIME par extension : le bucket restreint les types autorisés et le navigateur renvoie
// souvent un file.type vide (Word/PDF) → on force le bon type d'après l'extension.
const MIME_PAR_EXT: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const EXT_OK = Object.keys(MIME_PAR_EXT);

/**
 * Téléverse un fichier d'employé vers le bucket privé Supabase (préfixe `dossier`) et renvoie son
 * lien applicatif `/fichiers/…` (servi derrière session). Partagé RH ↔ espace salarié.
 */
export async function televerserFichierEmploye(employeeId: string, file: File, prefixe = "documents"): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!EXT_OK.includes(ext)) throw new Error("Format non supporté (PDF, image, Word ou Excel).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Fichier trop lourd (max 15 Mo).");

  const path = `${prefixe}/${employeeId}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Stockage non configuré (variables Supabase manquantes).");

  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": MIME_PAR_EXT[ext] ?? file.type ?? "application/octet-stream",
      "x-upsert": "true",
    },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Échec du téléversement (${res.status})${detail ? ` : ${detail.slice(0, 160)}` : ""}`);
  }
  return `/fichiers/${path}`;
}
