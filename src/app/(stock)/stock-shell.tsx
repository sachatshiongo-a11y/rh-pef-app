"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/app/login/actions";
import { Icone } from "@/components/icones";
import { BoutonRetour } from "@/components/bouton-retour";
import { NAV_GESTION, filtrerNavGestion } from "@/components/gestion-nav";

export function StockShell({
  userNom,
  userRole,
  maPhoto,
  accesRH,
  accesStock,
  doubleAcces,
  badges = {},
  notif,
  children,
}: {
  userNom: string;
  userRole: string;
  maPhoto: string | null;
  accesRH: boolean;
  accesStock: boolean;
  doubleAcces: boolean;
  badges?: Record<string, number>;
  notif: React.ComponentProps<typeof NotificationBell> | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const fermer = () => setOpen(false);
  // Barre de navigation UNIFIÉE (RH + Stock), filtrée selon les accès du compte.
  const groupes = filtrerNavGestion(NAV_GESTION, { accesRH, accesStock, isAdmin: userRole === "ADMIN" });
  // État actif : les tableaux de bord (/accueil, /stock) en correspondance exacte, sinon par préfixe.
  const actif = (href: string) => (href === "/accueil" || href === "/stock" ? pathname === href : pathname.startsWith(href));
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
            <p className="mt-1 text-xs font-medium text-muted-foreground">Gestion</p>
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
          {groupes.map((groupe) => {
            return (
            <div key={groupe.titre}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{groupe.titre}</p>
              <div className="flex flex-col gap-0.5">
                {groupe.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={fermer}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:py-1.5 ${
                      actif(item.href) ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Icone nom={item.icone} className="w-4 shrink-0 text-muted-foreground" />
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
            <Link href="/choix-espace" onClick={fermer} className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring">
              <Icone nom="permuter" /> Changer d&apos;espace
            </Link>
          )}
          <form action={logout}>
            <button type="submit" className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"><Icone nom="deconnexion" /> Déconnexion</button>
          </form>
          <div className="mt-2 px-2"><ThemeToggle /></div>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
          <BoutonRetour />
          <button type="button" onClick={() => setOpen(true)} aria-label="Ouvrir le menu" className="rounded-md p-1.5 hover:bg-accent">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="truncate font-medium">Pâtes en Folie — Gestion</span>
          <div className="ml-auto flex items-center gap-2">
            {notif && <NotificationBell {...notif} domaine="STOCK" />}
            <Avatar nom={userNom} taille={28} photoUrl={maPhoto} />
          </div>
        </header>
        {notif && (
          <div className="hidden items-center justify-between border-b bg-background px-8 py-2 lg:flex">
            <BoutonRetour />
            <NotificationBell {...notif} domaine="STOCK" />
          </div>
        )}
        <div className="p-4 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
