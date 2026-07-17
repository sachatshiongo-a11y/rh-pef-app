"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { formulaireLisible } from "@/lib/erreur-formulaire";

/** Téléverse une image (logo/signature) vers Supabase Storage (bucket privé). PNG/JPG, max 5 Mo. */
async function televerserImageEntreprise(dossier: string, file: File): Promise<{ url: string; nom: string }> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!["png", "jpg", "jpeg"].includes(ext)) throw new Error("Image PNG ou JPG uniquement.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image trop lourde (max 5 Mo).");
  const path = `parametres/${dossier}-${Date.now()}.${ext}`;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/employes/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!res.ok) throw new Error("Le téléversement de l'image a échoué. Réessayez.");
  return { url: `/fichiers/${path}`, nom: file.name };
}

/** Modèle de checklist d'intégration (onboarding) : une tâche par ligne. Admin. */
export async function mettreAJourModeleOnboarding(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const lignes = String(formData.get("taches") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  await prisma.$transaction([
    prisma.modeleTacheOnboarding.deleteMany({}),
    prisma.modeleTacheOnboarding.createMany({ data: lignes.map((libelle, i) => ({ libelle, ordre: i + 1 })) }),
  ]);
  revalidatePath("/parametres");
}

/** Identité de l'entreprise (en-tête/pied des documents) : coordonnées, logo, signature. Admin. */
export async function mettreAJourEntreprise(formData: FormData) {
  await formulaireLisible("/parametres", async () => {
    const user = await verifySession();
    requireRole(user, ["ADMIN"]);

    const t = (n: string) => String(formData.get(n) ?? "").trim() || null;
    const existante = await prisma.paramEntreprise.findUnique({ where: { id: "singleton" } });

    let logoUrl = existante?.logoUrl ?? null, logoNom = existante?.logoNom ?? null;
    let signatureUrl = existante?.signatureUrl ?? null, signatureNom = existante?.signatureNom ?? null;
    const logo = formData.get("logo");
    if (logo instanceof File && logo.size > 0) { const r = await televerserImageEntreprise("logo", logo); logoUrl = r.url; logoNom = r.nom; }
    const sig = formData.get("signature");
    if (sig instanceof File && sig.size > 0) { const r = await televerserImageEntreprise("signature", sig); signatureUrl = r.url; signatureNom = r.nom; }

    const data = {
      nom: t("nom"), enseigne: t("enseigne"), telephone: t("telephone"), email: t("email"), site: t("site"),
      adresse: t("adresse"), lieuTravail: t("lieuTravail"), pays: t("pays"), compteBancaire: t("compteBancaire"),
      rccm: t("rccm"), idNat: t("idNat"), numImpot: t("numImpot"), logoUrl, logoNom, signatureUrl, signatureNom,
    };
    await prisma.paramEntreprise.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });

    revalidatePath("/parametres");
    revalidatePath("/", "layout");
  });
}

/** Paramètres opérationnels (non légaux) : taux de change et période courante. */
export async function mettreAJourConfig(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.config.update({
    where: { id: "singleton" },
    data: {
      tauxChangeCDF: Number(formData.get("tauxChangeCDF")),
      anneeCourante: Number(formData.get("anneeCourante")),
      moisCourant: Number(formData.get("moisCourant")),
      jourPaie: Math.min(31, Math.max(1, Math.trunc(Number(formData.get("jourPaie"))) || 30)),
    },
  });

  revalidatePath("/parametres");
  revalidatePath("/accueil");
}

/** Active / désactive l'espace salarié (self-service). Réservé à l'ADMIN. OFF par défaut. */
export async function basculerEspaceEmploye(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);
  const actif = String(formData.get("actif")) === "1";
  await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: actif } });
  revalidatePath("/parametres");
  revalidatePath("/", "layout");
}

/**
 * Paramètres légaux versionnés — modification réservée à l'ADMIN (le directeur).
 * Toute modification remet le statut à « À VALIDER » sauf validation explicite.
 */
export async function mettreAJourParametreLegal(id: number, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const valeurRaw = String(formData.get("valeur") ?? "").trim();
  const valider = formData.get("valider") === "on";

  await prisma.parametreLegal.update({
    where: { id },
    data: {
      valeur: valeurRaw === "" ? null : Number(valeurRaw.replace(",", ".")),
      statutValidation: valider ? "VALIDE" : "A_VALIDER",
    },
  });

  revalidatePath("/parametres");
}

export async function mettreAJourTrancheIprCDF(id: number, formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const plafondRaw = String(formData.get("plafondAnnuelCDF") ?? "").trim();
  const valider = formData.get("valider") === "on";

  await prisma.trancheIprCDF.update({
    where: { id },
    data: {
      plafondAnnuelCDF: plafondRaw === "" ? null : Number(plafondRaw.replace(",", ".")),
      taux: Number(String(formData.get("taux")).replace(",", ".")),
      statutValidation: valider ? "VALIDE" : "A_VALIDER",
    },
  });

  revalidatePath("/parametres");
}

export async function ajouterJourFerie(formData: FormData) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  const date = new Date(String(formData.get("date")));
  const designation = String(formData.get("designation"));

  await prisma.jourFerie.create({
    data: { date, designation, annee: date.getFullYear() },
  });

  revalidatePath("/parametres");
}

export async function supprimerJourFerie(id: number) {
  const user = await verifySession();
  requireRole(user, ["ADMIN"]);

  await prisma.jourFerie.delete({ where: { id } });
  revalidatePath("/parametres");
}
