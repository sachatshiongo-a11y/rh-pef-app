import Image from "next/image";
import Link from "next/link";
import { FormReinitialiser } from "./form-reinitialiser";

export default async function ReinitialiserPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8 shadow-sm">
        <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={220} height={75} priority className="mx-auto mb-4 h-auto w-48" />
        <h1 className="mb-1 text-center text-base font-semibold">Nouveau mot de passe</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">Choisissez votre nouveau mot de passe (8 caractères minimum).</p>
        {token ? <FormReinitialiser token={token} /> : (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Lien incomplet. Refaites une demande depuis « Mot de passe oublié ».
          </p>
        )}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline hover:text-foreground">← Retour à la connexion</Link>
        </p>
      </div>
    </div>
  );
}
