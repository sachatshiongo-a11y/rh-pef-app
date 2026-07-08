"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { logout } from "@/app/login/actions";

const NAV_GROUPS: { titre: string; items: { href: string; label: string; icone: string; adminOnly?: boolean }[] }[] = [
  {
    titre: "Pilotage",
    items: [
      { href: "/stock", label: "Tableau de bord", icone: "" },
      { href: "/stock/a-valider", label: "Demandes à valider", icone: "", adminOnly: true },
    ],
  },
  {
    titre: "Stock",
    items: [
      { href: "/stock/catalogue/nourriture", label: "Catalogue Nourriture", icone: "" },
      { href: "/stock/catalogue/boissons", label: "Catalogue Boissons", icone: "" },
      { href: "/stock/catalogue/autre", label: "Catalogue Autre", icone: "" },
      { href: "/stock/entree", label: "Liste d'achat", icone: "" },
      { href: "/stock/legumes", label: "Achats légumes", icone: "" },
      { href: "/stock/restaurant", label: "Stock restaurant", icone: "" },
      { href: "/stock/mouvements", label: "Mouvements", icone: "" },
      { href: "/stock/journalier", label: "Conso. journalière", icone: "" },
      { href: "/stock/reconciliation", label: "Réconciliation", icone: "" },
      { href: "/stock/archives", label: "Archives comptages", icone: "" },
    ],
  },
  {
    titre: "Achats",
    items: [
      { href: "/stock/commandes", label: "Bons de commande", icone: "" },
      { href: "/stock/fournisseurs", label: "Fournisseurs", icone: "" },
      { href: "/stock/factures", label: "Factures", icone: "" },
      { href: "/stock/rapports", label: "Rapports", icone: "" },
    ],
  },
  {
    titre: "Configuration",
    items: [
      { href: "/stock/parametres", label: "Paramètres", icone: "" },
      { href: "/stock/utilisateurs", label: "Utilisateurs", icone: "", adminOnly: true },
    ],
  },
];

export function StockShell({
  userNom,
  userRole,
  maPhoto,
  doubleAcces,
  badges = {},
  notif,
  children,
}: {
  userNom: string;
  userRole: string;
  maPhoto: string | null;
  doubleAcces: boolean;
  badges?: Record<string, number>;
  notif: React.ComponentProps<typeof NotificationBell> | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const fermer = () => setOpen(false);
  const actif = (href: string) => (href === "/stock" ? pathname === href : pathname.startsWith(href));
  const roleLabel = userRole === "ADMIN" ? "Direction" : "Responsable stock";

  return (
    <div className="flex h-dvh overflow-hidden">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={fermer} aria-hidden />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 max-w-[85%] flex-col overflow-y-auto border-r bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:bg-muted/30 lg:shadow-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-start justify-between px-2">
          <div>
            <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={160} height={55} priority className="h-auto w-full max-w-36" />
            <p className="mt-1 text-xs font-medium text-muted-foreground">Stock &amp; Achats</p>
          </div>
          <button type="button" onClick={fermer} aria-label="Fermer le menu" className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent lg:hidden">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Recherche globale : article, bon de commande, facture, fournisseur */}
        <form method="GET" action="/stock/recherche" className="mb-4" onSubmit={fermer}>
          <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
            <input name="q" placeholder="Article, N° BC, N° facture, fournisseur…" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
        </form>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto">
          {NAV_GROUPS.map((groupe) => {
            const items = groupe.items.filter((it) => !it.adminOnly || userRole === "ADMIN");
            if (items.length === 0) return null;
            return (
            <div key={groupe.titre}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{groupe.titre}</p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={fermer}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm lg:py-1.5 ${
                      actif(item.href) ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                    {(badges[item.href] ?? 0) > 0 && (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white">{badges[item.href]}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
            );
          })}
        </nav>

        <div className="mt-3 border-t pt-3">
          <div className="flex items-center gap-2 px-2">
            <Avatar nom={userNom} taille={32} photoUrl={maPhoto} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userNom}</p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
          {doubleAcces && (
            <Link href="/choix-espace" onClick={fermer} className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground">
              Changer d&apos;espace
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground">Déconnexion</button>
          </form>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="Ouvrir le menu" className="rounded-md p-1.5 hover:bg-accent">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="truncate font-medium">Stock &amp; Achats</span>
          <div className="ml-auto flex items-center gap-2">
            {notif && <NotificationBell {...notif} domaine="STOCK" />}
            <Avatar nom={userNom} taille={28} photoUrl={maPhoto} />
          </div>
        </header>
        {notif && (
          <div className="hidden justify-end border-b bg-background px-8 py-2 lg:flex">
            <NotificationBell {...notif} domaine="STOCK" />
          </div>
        )}
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
