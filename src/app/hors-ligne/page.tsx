// Page servie par le service worker quand une navigation échoue faute de réseau (voir
// public/sw.js). Elle ne contient AUCUNE donnée, à dessein : c'est la seule page que l'application
// accepte de servir depuis un cache, et une page en cache ne doit jamais porter de chiffre ni de
// nom.
//
// Elle est PUBLIQUE (`PUBLIC_PATHS`, src/lib/supabase/middleware.ts). Ce n'est pas un oubli : si
// elle répondait par une redirection vers /login, le service worker mettrait en cache la PAGE DE
// CONNEXION sous son nom et l'afficherait à sa place — un écran de connexion trompeur au lieu d'un
// message honnête. Pire, une réponse issue d'une redirection ne peut pas servir une navigation : le
// repli échouerait tout court.
export const dynamic = "force-static";

export default function HorsLigne() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">Pas de connexion</h1>
      <p className="text-sm text-muted-foreground">
        L&apos;application n&apos;arrive pas à joindre le serveur. Vos données ne sont pas perdues :
        elles sont sur le serveur, et reviendront dès que la connexion sera rétablie.
      </p>
      <p className="text-sm text-muted-foreground">
        Rien de ce que vous voyez ici n&apos;est enregistré sur cet appareil.
      </p>
    </main>
  );
}
