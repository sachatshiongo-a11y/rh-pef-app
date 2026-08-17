import Image from "next/image";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reinitialise?: string }> }) {
  const { reinitialise } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8 shadow-sm">
        <Image
          src="/logo-pates-en-folie.png"
          alt="Pâtes en Folie"
          width={220}
          height={75}
          priority
          className="mx-auto mb-4 h-auto w-48"
        />
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Connectez-vous à votre compte
        </p>
        {reinitialise && (
          <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-800">Mot de passe changé — connectez-vous.</p>
        )}
        <LoginForm />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Besoin d&apos;aide ? <a href="mailto:info@patesenfolie.cd" className="underline hover:text-foreground">Contactez la direction</a>
        </p>
      </div>
    </div>
  );
}
