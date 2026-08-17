import "server-only";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { entreprise as defaut } from "@/lib/pdf/theme";

const logoDefaut = path.join(process.cwd(), "public/logo-pates-en-folie.png");
const signatureDefaut = path.join(process.cwd(), "public/signatures/signature-directrice.png");

export type ImagePdf = string | { data: Buffer; format: "png" | "jpg" };
export type EntrepriseResolue = {
  entreprise: typeof defaut;
  logo: ImagePdf;
  signature: ImagePdf | null;
};

/** Récupère un objet du bucket privé Supabase (chemin interne « /fichiers/<path> »). */
async function fetchStorage(pathInterne: string): Promise<Buffer | null> {
  try {
    const rel = pathInterne.replace(/^\/fichiers\//, "");
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) return null;
    const res = await fetch(`${base}/storage/v1/object/employes/${rel}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const fmt = (nom?: string | null): "png" | "jpg" => ((nom ?? "").toLowerCase().endsWith(".png") ? "png" : "jpg");

/**
 * Identité de l'entreprise pour les PDF : valeurs saisies dans Paramètres (ParamEntreprise) par
 * dessus les valeurs par défaut (theme.ts), + logo et signature (téléversés ou groupés par défaut).
 */
export async function chargerEntreprise(): Promise<EntrepriseResolue> {
  const p = await prisma.paramEntreprise.findUnique({ where: { id: "singleton" } }).catch(() => null);

  const entreprise: typeof defaut = {
    ...defaut,
    nom: p?.nom?.trim() || defaut.nom,
    enseigne: p?.enseigne?.trim() || defaut.enseigne,
    telephone: p?.telephone?.trim() || defaut.telephone,
    email: p?.email?.trim() || defaut.email,
    site: p?.site?.trim() || defaut.site,
    adresse: p?.adresse?.trim() || defaut.adresse,
    lieuTravail: p?.lieuTravail?.trim() || defaut.lieuTravail,
    pays: p?.pays?.trim() || defaut.pays,
    compteEcobank: p?.compteBancaire?.trim() || defaut.compteEcobank,
    rccm: p?.rccm?.trim() || defaut.rccm,
    idNat: p?.idNat?.trim() || defaut.idNat,
    numImpot: p?.numImpot?.trim() || defaut.numImpot,
  };

  let logo: ImagePdf = logoDefaut;
  if (p?.logoUrl) {
    const b = await fetchStorage(p.logoUrl);
    if (b) logo = { data: b, format: fmt(p.logoNom) };
  }

  let signature: ImagePdf | null = fs.existsSync(signatureDefaut) ? signatureDefaut : null;
  if (p?.signatureUrl) {
    const b = await fetchStorage(p.signatureUrl);
    if (b) signature = { data: b, format: fmt(p.signatureNom) };
  }

  return { entreprise, logo, signature };
}
