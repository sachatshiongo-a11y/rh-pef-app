import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { verifySession, estStock } from "@/lib/auth";
import { logout } from "@/app/login/actions";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user.role)) redirect("/entree");
  const doubleAcces = user.role === "ADMIN"; // la Direction peut basculer d'espace

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b bg-background px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:px-8">
        <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={120} height={42} priority className="h-auto w-24" />
        <span className="font-medium">Stock &amp; Achats</span>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {doubleAcces && (
            <Link href="/choix-espace" className="text-muted-foreground underline hover:text-foreground">
              Changer d&apos;espace
            </Link>
          )}
          <span className="text-muted-foreground">{user.nom}</span>
          <form action={logout}>
            <button type="submit" className="rounded-md px-2 py-1 hover:bg-accent">Déconnexion</button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-4 lg:p-8">{children}</main>
    </div>
  );
}
