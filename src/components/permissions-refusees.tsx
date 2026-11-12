"use client";

// Permissions REFUSÉES à la personne connectée, connues de tout composant client de l'espace (posées par
// la coquille de l'espace). Sert seulement à MASQUER un bouton : le serveur refuse de toute façon.
// Hors coquille (espace RH, espace salarié, tests), la liste est vide : rien n'est masqué.
import { createContext, useContext } from "react";
import { exportStockGouverne, type Permission } from "@/lib/permissions";

const Contexte = createContext<readonly string[]>([]);

export function PermissionsRefuseesProvider({ refusees, children }: { refusees: readonly string[]; children: React.ReactNode }) {
  return <Contexte.Provider value={refusees}>{children}</Contexte.Provider>;
}

export function usePermissionRefusee(cle: Permission): boolean {
  return useContext(Contexte).includes(cle);
}

/** Vrai si ce lien de téléchargement doit être masqué : export du Stock et « Exports » retiré à la personne. */
export function useExportMasque(href: string | undefined): boolean {
  const refuse = usePermissionRefusee("stock.exports");
  return !!href && refuse && exportStockGouverne(href);
}
