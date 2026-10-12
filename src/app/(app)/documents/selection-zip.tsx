"use client";

import { createContext, useContext, type ReactNode } from "react";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonNeutre } from "@/components/action-buttons";
import { TelechargerLien } from "@/components/telecharger-lien";

/** Un onglet dont les documents se téléchargent par LOT (une archive ZIP existe côté serveur). */
export type LotZip = {
  /** Identifiants des lignes de la PAGE affichée. */
  ids: string[];
  /** Route de l'archive : `${href}?ids=a,b,c`. */
  href: string;
  /** Plafond de la route (au-delà elle refuse en 400) : le lien se désactive avant. */
  max: number;
  /** « les PDF des demandes », « les fiches PDF »… (libellé du lien). */
  libelle: string;
  nomFichier: string;
  /** Total des lignes du filtre, toutes pages : si plus grand que la page, « Tout sélectionner » le dit. */
  totalFiltre: number;
};

type Ctx = { sel: Set<string>; toggle: (id: string) => void } | null;
const SelectionCtx = createContext<Ctx>(null);

/**
 * Cases à cocher + barre d'actions groupées d'un onglet de Documents qui a une archive ZIP (congés, fiches de
 * poste). Les autres onglets (bulletins, contrats, documents RH, attestations) n'ont pas d'archive : `lot`
 * absent, le contenu s'affiche tel quel.
 */
export function SelectionZip({ lot, children }: { lot: LotZip | null; children: ReactNode }) {
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  if (!lot) return <>{children}</>;
  const cocheesPage = lot.ids.filter((id) => sel.has(id)).length;
  const toutPage = (on: boolean) => setAll(on ? [...new Set([...ids, ...lot.ids])] : ids.filter((id) => !lot.ids.includes(id)), true);
  return (
    <SelectionCtx.Provider value={{ sel, toggle }}>
      <div className="space-y-2">
        {lot.ids.length > 0 && (
          <BulkBar count={sel.size} total={lot.ids.length} cochesAffichees={cocheesPage} onAll={toutPage}
            libelleTout={lot.totalFiltre > lot.ids.length ? "Tout sélectionner (cette page)" : "Tout sélectionner"}>
            {ids.length > lot.max ? (
              <button type="button" disabled className="rounded-md border px-3 py-1.5 text-sm font-medium opacity-60">Archive : {lot.max} au plus à la fois</button>
            ) : (
              <TelechargerLien href={`${lot.href}?ids=${ids.join(",")}`} nomFichier={lot.nomFichier} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                ⭳ Télécharger {lot.libelle} ({ids.length})
              </TelechargerLien>
            )}
            <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
          </BulkBar>
        )}
        {children}
      </div>
    </SelectionCtx.Provider>
  );
}

/** Case d'une ligne ; absente (rien) quand l'onglet n'a pas de lot. */
export function CaseZip({ id, libelle }: { id: string; libelle: string }) {
  const ctx = useContext(SelectionCtx);
  if (!ctx) return null;
  return <input type="checkbox" checked={ctx.sel.has(id)} onChange={() => ctx.toggle(id)} aria-label={libelle} className="h-4 w-4 shrink-0 max-lg:h-5 max-lg:w-5" />;
}
