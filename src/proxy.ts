import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // api/cron exclu : endpoints déclenchés par planning, protégés par leur propre jeton (CRON_SECRET).
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
