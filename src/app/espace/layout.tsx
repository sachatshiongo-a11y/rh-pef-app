import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { Icone } from "@/components/icones";
import { Avatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { PushToggle } from "@/app/(app)/push-toggle";
import { ClocheSalarie } from "./cloche-salarie";
import { chargerNotificationsSalarie } from "@/lib/notifications";
import { logout } from "@/app/login/actions";

// Espace salarié (self-service). Garde stricte : la fonctionnalité doit être ACTIVÉE et le compte
// doit être de rôle EMPLOYE. Sinon on renvoie vers le résolveur d'entrée (qui oriente ailleurs).
export default async function EspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user)) redirect("/entree");

  const [compte, notifs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { employe: { select: { id: true, nom: true, matricule: true, photoUrl: true } } },
    }),
    chargerNotificationsSalarie(user.id),
  ]);
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
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col">
      {/* En-tête + nav COLLANTS, avec padding d'encoche (safe-area) pour le mode PWA plein écran :
          sans ça, l'en-tête passe sous la barre d'état / l'encoche de l'iPhone. */}
      <div className="sticky top-0 z-20 bg-background px-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b py-2.5 sm:py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={132} height={45} priority className="h-8 w-auto shrink-0 sm:h-9" />
            <span className="hidden text-sm text-muted-foreground sm:inline">· Espace salarié</span>
          </div>
          <div className="flex items-center gap-2">
            <PushToggle />
            <ClocheSalarie items={notifs.items} nonLues={notifs.nonLues} />
            <ThemeToggle />
            <form action={logout}>
              <button className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm hover:bg-accent" title="Se déconnecter">
                <Icone nom="deconnexion" /> <span className="hidden sm:inline">Quitter</span>
              </button>
            </form>
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {liens.map((l) => (
            <Link key={l.href} href={l.href} className="flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              <Icone nom={l.icone} className="shrink-0" /> {l.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Contenu : padding bas avec safe-area (barre d'accueil iPhone) + padding latéral d'encoche. */}
      <main className="flex-1 px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-4">
        <div className="mb-5 flex items-center gap-3">
          <Avatar nom={emp?.nom ?? user.nom} taille={40} photoUrl={emp?.photoUrl} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{emp?.nom ?? user.nom}</p>
            <p className="text-xs text-muted-foreground">
              {emp?.matricule ? <>Matricule <span className="font-mono font-medium text-foreground">{emp.matricule}</span></> : "Votre espace personnel"}
            </p>
          </div>
        </div>

        {children}
      </main>
    </div>
  );
}
