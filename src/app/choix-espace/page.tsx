import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { verifySession, espacesAutorises } from "@/lib/auth";
import { logout } from "@/app/login/actions";

// Sélecteur d'espace — réservé aux comptes à double accès (la Direction).
// Un compte à accès unique n'a rien à choisir : on le renvoie au résolveur d'entrée.
export default async function ChoixEspacePage() {
  const user = await verifySession();
  const espaces = espacesAutorises(user.role);
  if (espaces.length < 2) redirect("/entree");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-2">
        <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={200} height={70} priority className="h-auto w-44" />
        <p className="text-sm text-muted-foreground">Bonjour {user.nom} — choisissez un espace</p>
      </div>

      <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        <EspaceCard href="/accueil" icone="👥" titre="Ressources humaines" sous="Employés, paie, congés, présences" />
        <EspaceCard href="/stock" icone="📦" titre="Stock & Achats" sous="Catalogue, fournisseurs, bons de commande" />
      </div>

      <form action={logout}>
        <button type="submit" className="text-sm text-muted-foreground underline hover:text-foreground">
          Déconnexion
        </button>
      </form>
    </div>
  );
}

function EspaceCard({ href, icone, titre, sous }: { href: string; icone: string; titre: string; sous: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-xl border p-8 text-center transition-colors hover:border-primary hover:bg-accent"
    >
      <span className="text-4xl" aria-hidden>{icone}</span>
      <span className="text-lg font-semibold">{titre}</span>
      <span className="text-xs text-muted-foreground">{sous}</span>
    </Link>
  );
}
