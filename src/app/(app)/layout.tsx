import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { chargerNotifications } from "@/lib/notifications";
import { NotificationBell } from "@/components/notification-bell";
import { Avatar } from "@/components/avatar";

// Menu groupé façon PayFit : sections + icônes.
const NAV_GROUPS: { titre: string; items: { href: string; label: string; icone: string }[] }[] = [
  {
    titre: "Les essentiels",
    items: [
      { href: "/accueil", label: "Tableau de bord", icone: "🏠" },
      { href: "/a-valider", label: "Demandes de validation", icone: "✅" },
      { href: "/employes", label: "Employés", icone: "👥" },
      { href: "/paie", label: "Paie", icone: "💵" },
    ],
  },
  {
    titre: "Temps de travail",
    items: [
      { href: "/planning", label: "Planning", icone: "🗓" },
      { href: "/presences", label: "Présences", icone: "📋" },
      { href: "/heures-supp", label: "Heures supp.", icone: "⏱" },
      { href: "/conges", label: "Congés", icone: "🏖" },
      { href: "/absences", label: "Calendrier absences", icone: "📆" },
    ],
  },
  {
    titre: "Finances & archives",
    items: [
      { href: "/declarations", label: "Déclarations", icone: "🧾" },
      { href: "/historique", label: "Historique de paie", icone: "📊" },
      { href: "/documents", label: "Documents", icone: "📁" },
    ],
  },
  {
    titre: "Configuration",
    items: [{ href: "/parametres", label: "Paramètres", icone: "⚙️" }],
  },
];

// Cache mémoire court des compteurs de badges : évite de refaire ces requêtes à CHAQUE
// navigation (coûteux sur lien lent). 20 s de fraîcheur suffisent pour des badges d'attente.
let cacheBadges: { at: number; badges: Record<string, number> } | null = null;
const TTL_BADGES = 20_000;

async function chargerBadges(): Promise<Record<string, number>> {
  if (cacheBadges && Date.now() - cacheBadges.at < TTL_BADGES) return cacheBadges.badges;

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const filtreRun = config ? { payrollRun: { mois: config.moisCourant, annee: config.anneeCourante } } : {};
  const [congesEnAttente, bulletinsPasValide, bulletinsValide, acomptesEnAttente] = await Promise.all([
    prisma.leaveRequest.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.payrollLine.count({ where: { statutPaiement: "PAS_VALIDE", ...filtreRun } }),
    prisma.payrollLine.count({ where: { statutPaiement: "VALIDE", ...filtreRun } }),
    prisma.acompteSalaire.count({ where: { statut: "EN_ATTENTE" } }),
  ]);
  const badges = {
    "/a-valider": congesEnAttente + bulletinsPasValide + bulletinsValide + acomptesEnAttente,
    "/conges": congesEnAttente,
    "/paie": bulletinsPasValide + bulletinsValide,
  };
  cacheBadges = { at: Date.now(), badges };
  return badges;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  const estAdmin = user.role === "ADMIN";
  const [badges, notif, moi] = await Promise.all([
    chargerBadges(),
    estAdmin ? chargerNotifications() : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } }),
  ]);
  const maPhoto = moi?.employe?.photoUrl ?? null;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 flex-col border-r bg-muted/30 p-4">
        <div className="mb-4 px-2">
          <Image
            src="/logo-pates-en-folie.png"
            alt="Pâtes en Folie"
            width={160}
            height={55}
            priority
            className="h-auto w-full max-w-36"
          />
          <p className="mt-1 text-xs text-muted-foreground">Gestion RH & Paie</p>
        </div>

        {/* Recherche (par nom / matricule d'employé) */}
        <form method="GET" action="/employes" className="mb-4">
          <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
            <span className="text-sm text-muted-foreground" aria-hidden>🔍</span>
            <input
              name="q"
              placeholder="Rechercher un employé…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </form>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {NAV_GROUPS.map((groupe) => (
            <div key={groupe.titre}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {groupe.titre}
              </p>
              <div className="flex flex-col gap-0.5">
                {groupe.items.map((item) => {
                  const badge = badges[item.href] ?? 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 && (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                          {badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-3 border-t pt-3">
          <div className="flex items-center gap-2 px-2">
            <Avatar nom={user.nom} taille={32} photoUrl={maPhoto} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.nom}</p>
              <p className="text-xs text-muted-foreground">
                {user.role === "ADMIN" ? "Direction" : user.role === "MANAGER" ? "Responsable RH" : "Consultation"}
              </p>
            </div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {notif && (
          <div className="flex justify-end border-b bg-background px-8 py-2">
            <NotificationBell items={notif.items} nonLues={notif.nonLues} cloture={notif.cloture} />
          </div>
        )}
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
