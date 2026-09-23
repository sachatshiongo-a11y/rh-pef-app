import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CompteNonLie } from "@/components/pointage/compte-non-lie";
import { ScannerAffiche } from "@/components/pointage/scanner-affiche";

// `/scan?c=CODE` — l'adresse imprimée sur l'affiche, le chemin « appareil photo du téléphone ».
// Second recours : le chemin principal est la caméra DANS l'application (sur iPhone, l'appareil
// photo ouvre Safari, dont la session est distincte de l'application installée).
//
// Sans session, le garde d'authentification (src/lib/supabase/middleware.ts) renvoie vers
// `/login?retour=/scan?c=…` AVANT cette page — c'est lui qui mémorise le retour, pas elle
// (`verifySession` ne sait renvoyer que vers /login nu). La page vérifie ensuite ce que le garde
// ne sait pas : le mot de passe temporaire, et le lien du compte à une fiche employé. Le code
// lui-même n'est jugé que par le serveur, au scan (`scannerAffiche`).
export default async function ScanPage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const user = await verifySession();
  const { c } = await searchParams;
  const code = typeof c === "string" && c !== "" ? c : undefined;

  const compte = await prisma.user.findUnique({
    where: { id: user.id },
    select: { employeeId: true, motDePasseTemporaire: true },
  });
  // Même règle que l'espace salarié : le mot de passe temporaire se change avant tout accès.
  if (compte?.motDePasseTemporaire) redirect("/espace/mot-de-passe");

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <Image
          src="/logo-pates-en-folie.png"
          alt="Pâtes en Folie"
          width={220}
          height={75}
          priority
          className="mx-auto h-auto w-36"
        />
        <h1 className="text-xl font-semibold">Pointer</h1>
        {compte?.employeeId ? (
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <ScannerAffiche codeInitial={code} />
          </div>
        ) : (
          <CompteNonLie />
        )}
        <p className="text-center">
          <Link href="/entree" className="text-sm text-primary underline">
            Aller à mon espace
          </Link>
        </p>
      </div>
    </div>
  );
}
