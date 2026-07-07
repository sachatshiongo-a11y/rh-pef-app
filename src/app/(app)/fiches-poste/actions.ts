"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { journaliser } from "@/lib/audit";

const BUCKET = "employes";
const EXT_OK = ["pdf", "doc", "docx"];

/** Téléverse une fiche de poste (PDF/Word) vers Supabase Storage et renvoie son URL publique. */
async function televerserFiche(poste: string, file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!EXT_OK.includes(ext)) throw new Error("Format non supporté (PDF ou Word uniquement).");
  if (file.size > 15 * 1024 * 1024) throw new Error("Fichier trop lourd (max 15 Mo).");

  const slug = poste.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const path = `fiches-poste/${slug || "poste"}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const res = await fetch(`${base}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).toLowerCase();
    if (res.status === 413 || detail.includes("exceeded") || detail.includes("size"))
      throw new Error("Fichier trop volumineux (max 15 Mo).");
    if (detail.includes("mime") || detail.includes("415"))
      throw new Error("Type de fichier non accepté par le stockage (PDF ou Word attendu).");
    throw new Error("Le téléversement du fichier a échoué. Réessayez.");
  }
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** Crée ou met à jour la fiche d'un poste (description + fichier optionnel). Admin/Manager. */
export async function enregistrerFichePoste(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const poste = String(formData.get("poste") ?? "").trim();
  if (!poste) redirect(`/fiches-poste?erreur=${encodeURIComponent("Intitulé de poste manquant.")}`);

  // Les erreurs (format/taille refusés, échec de téléversement…) sont renvoyées à la page sous
  // forme de message lisible plutôt que de faire planter la page en « server error ».
  let erreur: string | null = null;
  try {
    const description = String(formData.get("description") ?? "").trim() || null;
    const existante = await prisma.fichePoste.findUnique({ where: { poste } });

    let fichierUrl = existante?.fichierUrl ?? null;
    let fichierNom = existante?.fichierNom ?? null;
    const file = formData.get("fichier");
    if (file instanceof File && file.size > 0) {
      fichierUrl = await televerserFiche(poste, file);
      fichierNom = file.name;
    }

    await prisma.fichePoste.upsert({
      where: { poste },
      create: { poste, description, fichierUrl, fichierNom, creeParId: user.id },
      update: { description, fichierUrl, fichierNom },
    });

    await journaliser(prisma, {
      entite: "FichePoste",
      entiteId: poste,
      champ: existante ? "modification" : "creation",
      nouvelleValeur: `${description ? "description" : "—"}${fichierNom ? ` + ${fichierNom}` : ""}`,
      userId: user.id,
    });
  } catch (e) {
    erreur = e instanceof Error ? e.message : "Erreur lors de l'enregistrement de la fiche.";
  }

  if (erreur) redirect(`/fiches-poste?erreur=${encodeURIComponent(erreur)}`);
  revalidatePath("/fiches-poste");
  redirect(`/fiches-poste?msg=${encodeURIComponent(`Fiche du poste « ${poste} » enregistrée.`)}`);
}

/** Supprime la fiche d'un poste (la description et le lien ; le fichier reste dans Storage). Admin. */
export async function supprimerFichePoste(poste: string) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const existante = await prisma.fichePoste.findUnique({ where: { poste } });
  if (!existante) return;
  await prisma.fichePoste.delete({ where: { poste } });
  await journaliser(prisma, {
    entite: "FichePoste",
    entiteId: poste,
    champ: "suppression",
    ancienneValeur: existante.fichierNom ?? "fiche",
    userId: user.id,
  });
  revalidatePath("/fiches-poste");
}
