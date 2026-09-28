import { NextRequest, NextResponse } from "next/server";
import { exigerAccesFichier } from "@/lib/garde-route";

// Sert les fichiers du bucket PRIVÉ « employes » (contrats, sanctions, documents, photos,
// preuves de paiement, PDF de factures et bons de commande). Session obligatoire ET droit sur CE
// fichier (`exigerAccesFichier` → `lib/acces-fichier.ts` : la RH ouvre tout, les autres comptes
// n'ouvrent que ce que la base leur attribue), puis redirection vers une URL signée temporaire
// (1 h). Les liens stockés en base sont de la forme /fichiers/<chemin>.

const BUCKET = "employes";
const DUREE_SIGNATURE_S = 3600;

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chemin: string[] }> }
) {
  const { chemin } = await params;
  if (!chemin?.length || chemin.some((s) => s === "" || s === "." || s === ".." || s.includes("\\"))) {
    return new NextResponse("Chemin invalide", { status: 400 });
  }
  // Redirige vers /login sans session ; 403 si ce fichier n'est pas à ce compte. Le lien comparé
  // est celui que la base enregistre (`/fichiers/<chemin>`), segments décodés comme à l'écriture.
  const g = await exigerAccesFichier(`/fichiers/${chemin.join("/")}`);
  if (!g.ok) return g.reponse;
  const path = chemin.map(encodeURIComponent).join("/");

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: DUREE_SIGNATURE_S }),
  });
  if (!res.ok) return new NextResponse("Fichier introuvable", { status: 404 });

  const { signedURL } = (await res.json()) as { signedURL: string };
  // L'API renvoie un chemin relatif (« /object/sign/… » ou « /storage/v1/object/sign/… »).
  const cible = signedURL.startsWith("/storage/")
    ? `${base}${signedURL}`
    : `${base}/storage/v1${signedURL}`;
  return NextResponse.redirect(cible, { status: 302 });
}
