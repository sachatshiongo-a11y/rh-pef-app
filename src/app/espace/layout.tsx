import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { verifySession } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { Icone } from "@/components/icones";
import { Avatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/app/login/actions";

// Espace salarié (self-service). Garde stricte : la fonctionnalité doit être ACTIVÉE et le compte
// doit être de rôle EMPLOYE. Sinon on renvoie vers le résolveur d'entrée (qui oriente ailleurs).
export default async function EspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif())) redirect("/entree");
  if (user.role !== "EMPLOYE") redirect("/entree");

  const compte = await prisma.user.findUnique({
    where: { id: user.id },
    select: { employe: { select: { id: true, nom: true, photoUrl: true } } },
  });
  const emp = compte?.employe;

  const liens = [
    { href: "/espace", icone: "accueil", label: "Accueil" },
    { href: "/espace/pointer", icone: "horloge", label: "Pointer" },
    { href: "/espace/planning", icone: "calendrier", label: "Planning & heures" },
    { href: "/espace/conges", icone: "parasol", label: "Congés" },
    { href: "/espace/dossier", icone: "dossier", label: "Dossier" },
    { href: "/espace/documents", icone: "document", label: "Documents" },
  ];

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-3 pb-16 sm:px-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b py-3 sm:py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={132} height={45} priority className="h-9 w-auto shrink-0 sm:h-10" />
          <span className="hidden text-sm text-muted-foreground sm:inline">· Espace salarié</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={logout}>
            <button className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent" title="Se déconnecter">
              <Icone nom="deconnexion" /> <span className="hidden sm:inline">Quitter</span>
            </button>
          </form>
        </div>
      </header>

      <div className="mb-5 flex items-center gap-3">
        <Avatar nom={emp?.nom ?? user.nom} taille={40} photoUrl={emp?.photoUrl} />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{emp?.nom ?? user.nom}</p>
          <p className="text-xs text-muted-foreground">Votre espace personnel</p>
        </div>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {liens.map((l) => (
          <Link key={l.href} href={l.href} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            <Icone nom={l.icone} className="shrink-0" /> {l.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
