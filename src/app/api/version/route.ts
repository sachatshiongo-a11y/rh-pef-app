import { NextResponse } from "next/server";

// Version de build (commit Render) — interrogée par le bandeau « Nouvelle version disponible »
// pour proposer un rechargement à la PWA au lieu d'exiger un rafraîchissement forcé manuel.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ v: (process.env.RENDER_GIT_COMMIT ?? "dev").slice(0, 12) });
}
