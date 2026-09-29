import Image from "next/image";
import Link from "next/link";
import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { retourDuScan } from "@/lib/retour-connexion";
import { exigerMotDePassePersonnel } from "@/app/espace/garde";
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
//
// Mot de passe temporaire : il se change avant de pointer, et le scan N'EST PAS PERDU — le retour
// `/scan?c=…` accompagne le salarié jusqu'à la page de changement, qui l'y ramène ensuite ; il
// retrouve alors « Pointer maintenant » (jamais de pointage sans ce geste). Si la page de
// changement ne l'accueillerait pas (espace salarié fermé), on ne l'y envoie pas : elle le
// renverrait vers /entree, et le scan serait perdu en silence. Un message le dit, ici même.
export default async function ScanPage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const user = await verifySession();
  const { c } = await searchParams;
  const code = typeof c === "string" && c !== "" ? c : undefined;

  const [compte, espaceOuvert] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { employeeId: true, motDePasseTemporaire: true },
    }),
    espaceEmployeActif(),
  ]);
  const temporaire = compte?.motDePasseTemporaire ?? false;
  // Même règle que l'espace salarié : le mot de passe temporaire se change avant tout accès —
  // et on revient ici ensuite, code compris.
  exigerMotDePassePersonnel(
    { role: user.role, employeeId: compte?.employeeId ?? null, motDePasseTemporaire: temporaire, espaceOuvert },
    retourDuScan(code),
  );

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
        {!compte?.employeeId ? (
          <CompteNonLie />
        ) : temporaire ? (
          // Mot de passe temporaire que la page de changement n'accueillerait pas : espace fermé.
          <div className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
            Votre mot de passe est encore le mot de passe temporaire : il doit être remplacé avant de
            pointer, mais l&apos;espace salarié est fermé pour le moment. Adressez-vous à la Direction.
          </div>
        ) : (
          <div className="rounded-3xl border bg-card p-5 shadow-sm">
            <ScannerAffiche codeInitial={code} />
          </div>
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
