import Link from "next/link";
import type { ReactNode } from "react";
import { OngletsDefilants } from "@/components/onglets-defilants";
import { BarreSemaineMobile } from "@/components/barre-semaine-mobile";
import { BasculeVueSemaine, SelecteurJour } from "@/components/selecteur-jour";
import { MenuFicheCommande, MenuFichesConso } from "./menu-fiches-conso";
import { TelechargerLien } from "@/components/telecharger-lien";

// Haut de page de la Conso. journalière : titre, onglets, semaine, filtre Cuisine / Bar et exports.
// Ordinateur : les rangées d'origine. Téléphone : titre, onglets qui défilent de côté, semaine sur
// UNE ligne avec « Plus » (filtre, exports, aide), puis le sélecteur de jour.

export type VueJournalier = "commande" | "conso" | "comparaison" | "ventes";
export type DomaineJournalier = "NOURRITURE" | "BOISSON" | undefined;

const VUES: [VueJournalier, string][] = [["commande", "Commande"], ["conso", "Consommation"], ["comparaison", "Comparaison"], ["ventes", "Rapport journalier"]];
const DOMAINES: [string, string][] = [["", "Tous"], ["NOURRITURE", "Cuisine (nourriture)"], ["BOISSON", "Bar (boissons)"]];
const LIBELLE_DOMAINE = { NOURRITURE: "Cuisine", BOISSON: "Bar" } as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

/** Adresse de l'écran pour une vue, une semaine et un filtre donnés (le reste est repris de l'écran courant). */
export function lienJournalier(p: { vue: VueJournalier; semaine: string; domaine?: string }) {
  const q = new URLSearchParams({ vue: p.vue, semaine: p.semaine });
  if (p.domaine) q.set("domaine", p.domaine);
  return `/stock/journalier?${q}`;
}

export function EnteteJournalier({ vue, domaine, lundi, jourDefaut, aujourdhui, joursSelecteur, aide, importer }: {
  vue: VueJournalier; domaine: DomaineJournalier;
  /** Lundi de la semaine affichée. */
  lundi: Date;
  jourDefaut: string; aujourdhui: string;
  /** Jours proposés par le sélecteur du téléphone (le Rapport journalier n'a que 6 jours sans dimanche). */
  joursSelecteur: { iso: string }[];
  /** Note de l'onglet : sous le haut de page sur ordinateur, dans « Plus » sur téléphone. */
  aide?: ReactNode;
  /** Import du classeur (Direction) : dans « Plus » sur téléphone ; sur ordinateur, la page le pose dans son corps. */
  importer?: ReactNode;
}) {
  const semaine = iso(lundi);
  const fin = addDays(lundi, 6);
  const libelleSemaine = `Semaine du ${lundi.getUTCDate()}/${lundi.getUTCMonth() + 1} au ${fin.getUTCDate()}/${fin.getUTCMonth() + 1}`;
  const libelleCourt = `Sem. du ${lundi.getUTCDate()}/${lundi.getUTCMonth() + 1} au ${fin.getUTCDate()}/${fin.getUTCMonth() + 1}`;
  const lien = (p: { vue?: VueJournalier; semaine?: string; domaine?: string }) =>
    lienJournalier({ vue: p.vue ?? vue, semaine: p.semaine ?? semaine, domaine: p.domaine !== undefined ? p.domaine : domaine });
  const semainePrec = lien({ semaine: iso(addDays(lundi, -7)) });
  const semaineSuiv = lien({ semaine: iso(addDays(lundi, 7)) });
  const dom = domaine ? `&domaine=${domaine}` : "";
  const exportVue = (format: "pdf" | "excel") => `/stock/journalier/${format}?vue=${vue}&semaine=${semaine}${dom}`;
  const joursDeLaSemaine = Array.from({ length: 7 }, (_, i) => iso(addDays(lundi, i)));
  const avecExportVue = vue === "conso" || vue === "comparaison";

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold sm:text-2xl">Consommation journalière</h1>
        <p className="mt-1 text-sm text-muted-foreground max-lg:hidden">
          Suivi par jour : ce qui est <strong>commandé</strong> par le restaurant, ce qui lui est <strong>livré</strong> (sorties « Livraison restaurant ») et ce qu&apos;il <strong>consomme</strong> (comptages du restaurant). Enregistrez les livraisons datées depuis l&apos;onglet Mouvements.
        </p>
      </div>

      {/* Sélecteur de vue : sur téléphone, les onglets défilent de côté (l'actif est ramené dans la vue). */}
      <OngletsDefilants
        libelle="Vues de la consommation journalière"
        onglets={VUES.map(([v, label]) => ({ href: lien({ vue: v }), label, actif: vue === v }))}
      />

      {/* Ordinateur : semaine, filtre et exports sur une rangée. */}
      <div className="flex flex-wrap items-center gap-3 text-sm max-lg:hidden">
        <div className="flex items-center gap-1">
          <Link href={semainePrec} className="rounded-md border px-2 py-1 hover:bg-accent">←</Link>
          <span className="px-2 font-medium">{libelleSemaine}</span>
          <Link href={semaineSuiv} className="rounded-md border px-2 py-1 hover:bg-accent">→</Link>
          <Link href={lien({ semaine: iso(new Date()) })} className="ml-1 rounded-md border px-2 py-1 hover:bg-accent">Cette semaine</Link>
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="flex gap-1.5">
          {DOMAINES.map(([k, label]) => (
            <Link key={k} href={lien({ domaine: k })} className={`rounded-full border px-3 py-1 ${(domaine ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</Link>
          ))}
        </div>
        {vue !== "ventes" && <span className="text-muted-foreground">·</span>}
        {/* Onglet Commande : la fiche sur le modèle du classeur (le tableau brut y reste, en second). */}
        {vue === "commande" && (
          <MenuFicheCommande semaine={semaine} jours={joursDeLaSemaine} jourDefaut={jourDefaut} domaine={domaine} libelleSemaine={libelleSemaine} />
        )}
        {avecExportVue && <div className="flex items-center overflow-hidden rounded-md border">
          <span className="px-2 py-1 text-xs text-muted-foreground">Exporter</span>
          <TelechargerLien href={exportVue("pdf")} className="border-l px-2.5 py-1 hover:bg-accent">PDF</TelechargerLien>
          <TelechargerLien href={exportVue("excel")} className="border-l px-2.5 py-1 hover:bg-accent">Excel</TelechargerLien>
        </div>}
        {(vue === "conso" || vue === "ventes") && (
          <MenuFichesConso semaine={semaine} domaine={domaine} libelleSemaine={libelleSemaine} jourDefaut={jourDefaut} />
        )}
      </div>

      {/* Téléphone : la semaine sur une ligne, « Plus » pour le reste, puis le jour. */}
      <BarreSemaineMobile
        precedente={semainePrec} suivante={semaineSuiv} libelle={libelleCourt}
        filtre={domaine ? { libelle: LIBELLE_DOMAINE[domaine], retirer: lien({ domaine: "" }) } : undefined}
      >
        <div>
          <p className="mb-1.5 font-medium text-muted-foreground">Afficher</p>
          <div className="flex flex-wrap gap-1.5">
            {DOMAINES.map(([k, label]) => (
              <Link key={k} href={lien({ domaine: k })} aria-current={(domaine ?? "") === k ? "true" : undefined} className={`flex min-h-11 items-center rounded-full border px-3 ${(domaine ?? "") === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={lien({ semaine: iso(new Date()) })} className="flex min-h-11 items-center rounded-md border bg-background px-3 font-medium hover:bg-accent">Cette semaine</Link>
          <BasculeVueSemaine />
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {vue === "commande" && (
            <MenuFicheCommande semaine={semaine} jours={joursDeLaSemaine} jourDefaut={jourDefaut} domaine={domaine} libelleSemaine={libelleSemaine} />
          )}
          {avecExportVue && (
            <div className="flex items-center overflow-hidden rounded-md border bg-background">
              <span className="px-2 text-xs text-muted-foreground">Exporter</span>
              <TelechargerLien href={exportVue("pdf")} className="flex min-h-11 items-center border-l px-3 hover:bg-accent">PDF</TelechargerLien>
              <TelechargerLien href={exportVue("excel")} className="flex min-h-11 items-center border-l px-3 hover:bg-accent">Excel</TelechargerLien>
            </div>
          )}
          {(vue === "conso" || vue === "ventes") && (
            <MenuFichesConso semaine={semaine} domaine={domaine} libelleSemaine={libelleSemaine} jourDefaut={jourDefaut} />
          )}
        </div>
        <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
          <p>Suivi par jour : ce qui est commandé par le restaurant, ce qui lui est livré et ce qu&apos;il consomme (comptages). Les livraisons datées se saisissent dans l&apos;onglet Mouvements.</p>
          {aide && <p>{aide}</p>}
        </div>
        {importer && <div className="border-t pt-2">{importer}</div>}
      </BarreSemaineMobile>
      <SelecteurJour jours={joursSelecteur} aujourdhui={aujourdhui} />
    </div>
  );
}
