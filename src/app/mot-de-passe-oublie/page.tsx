import Image from "next/image";
import Link from "next/link";
import { FormOubli } from "./form-oubli";

export default function MotDePasseOubliePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8 shadow-sm">
        <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={220} height={75} priority className="mx-auto mb-4 h-auto w-48" />
        <h1 className="mb-1 text-center text-base font-semibold">Mot de passe oublié</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Indiquez votre adresse e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.
        </p>
        <FormOubli />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline hover:text-foreground">← Retour à la connexion</Link>
        </p>
      </div>
    </div>
  );
}
