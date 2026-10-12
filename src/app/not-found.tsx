import Link from "next/link";

// Page 404 en français (sans elle, Next affiche « 404 This page could not be found. » en anglais).
// Aucune donnée : elle sert aussi bien à un visiteur non connecté qu'à un compte de n'importe quel espace ;
// /entree oriente chacun vers SON espace.
export default function NonTrouvee() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">Page introuvable</h1>
      <p className="text-sm text-muted-foreground">
        Cette page n&apos;existe pas ou n&apos;existe plus. Vérifiez l&apos;adresse, ou revenez à votre espace.
      </p>
      <Link href="/entree" className="mt-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground">
        Retour à mon espace
      </Link>
    </main>
  );
}
