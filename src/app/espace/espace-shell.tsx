"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icone } from "@/components/icones";
import { Avatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { PushToggle } from "@/app/(app)/push-toggle";
import { ClocheSalarie } from "./cloche-salarie";
import { logout } from "@/app/login/actions";
import type { NotificationItem } from "@/lib/notifications";

type Lien = { href: string; icone: string; label: string };

/** Coquille de l'espace salarié : menu latéral sur ordinateur, tiroir sur mobile — façon app RH. */
export function EspaceShell({
  liens,
  nom,
  matricule,
  photoUrl,
  notifs,
  children,
}: {
  liens: Lien[];
  nom: string;
  matricule: string | null;
  photoUrl: string | null;
  notifs: { items: NotificationItem[]; nonLues: number };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [tiroir, setTiroir] = useState(false);
  const actif = (href: string) => (href === "/espace" ? pathname === "/espace" : pathname.startsWith(href));

  const navLinks = (
    <nav className="flex flex-col gap-0.5">
      {liens.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          onClick={() => setTiroir(false)}
          aria-current={actif(l.href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
            actif(l.href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Icone nom={l.icone} className="shrink-0" /> {l.label}
        </Link>
      ))}
    </nav>
  );

  const bas = (
    <div className="mt-auto space-y-3 border-t pt-3">
      <div className="flex items-center gap-2.5">
        <Avatar nom={nom} taille={34} photoUrl={photoUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{nom}</p>
          {matricule && <p className="truncate font-mono text-[11px] text-muted-foreground">{matricule}</p>}
        </div>
      </div>
      <ThemeToggle />
      <form action={logout}>
        <button className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <Icone nom="deconnexion" /> Se déconnecter
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh]">
      {/* Tiroir mobile : voile + panneau */}
      {tiroir && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setTiroir(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85%] flex-col overflow-y-auto border-r bg-background p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl transition-transform duration-200 ease-out lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:shadow-none ${
          tiroir ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-5 flex items-center justify-between">
          <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={132} height={45} priority className="h-8 w-auto" />
          <button onClick={() => setTiroir(false)} aria-label="Fermer le menu" className="rounded-md p-1.5 hover:bg-accent lg:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Espace salarié</p>
        {navLinks}
        {bas}
      </aside>

      {/* Contenu */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure : hamburger (mobile) + notifications */}
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-5">
          <button onClick={() => setTiroir(true)} aria-label="Ouvrir le menu" className="rounded-md border p-2 hover:bg-accent lg:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={110} height={38} className="h-7 w-auto lg:hidden" />
          <div className="ml-auto flex items-center gap-2">
            <PushToggle />
            <ClocheSalarie items={notifs.items} nonLues={notifs.nonLues} />
          </div>
        </header>

        <main className="flex-1 px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:px-5">
          <div className="mx-auto max-w-3xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
