import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { Icone } from "@/components/icones";
import { Avatar } from "@/components/avatar";
import { logout } from "@/app/login/actions";

// Espace salarié (self-service). Garde stricte : la fonctionnalité doit être ACTIVÉE et le compte
// doit être de rôle EMPLOYE. Sinon on renvoie vers le résolveur d'entrée (qui oriente ailleurs).
export default async function EspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif())) redirect("/entree");
  if (user.role !== "EMPLOYE") redirect("/entree");

  const compte = await prisma.user.findUnique({
    where: { id: user.id },
    select: { motDePasseTemporaire: true, employe: { select: { id: true, nom: true, photoUrl: true } } },
  });
  const emp = compte?.employe;

  const liens = [
    { href: "/espace", icone: "accueil", label: "Accueil" },
    { href: "/espace/planning", icone: "calendrier", label: "Mon planning" },
    { href: "/espace/conges", icone: "parasol", label: "Mes congés" },
    { href: "/espace/dossier", icone: "dossier", label: "Mon dossier" },
    { href: "/espace/documents", icone: "document", label: "Mes documents" },
  ];

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-4 pb-16">
      <header className="mb-4 flex items-center justify-between gap-3 border-b py-4">
        <div className="flex items-center gap-3">
          <Avatar nom={emp?.nom ?? user.nom} taille={38} photoUrl={emp?.photoUrl} />
          <div>
            <p className="text-sm font-semibold">{emp?.nom ?? user.nom}</p>
            <p className="text-xs text-muted-foreground">Espace salarié — Pâtes en Folie</p>
          </div>
        </div>
        <form action={logout}>
          <button className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            <Icone nom="deconnexion" /> Quitter
          </button>
        </form>
      </header>

      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
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
