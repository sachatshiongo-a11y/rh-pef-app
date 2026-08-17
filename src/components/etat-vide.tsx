import type { ReactNode } from "react";
import { Icone } from "@/components/icones";

/** État vide soigné : icône discrète + message, et une phrase d'action optionnelle. */
export function EtatVide({ icone = "boiteVide", message, action }: { icone?: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
      <span className="rounded-full bg-muted p-2.5 text-muted-foreground" aria-hidden><Icone nom={icone} taille={20} /></span>
      <p className="text-sm text-muted-foreground">{message}</p>
      {action && <div className="text-sm">{action}</div>}
    </div>
  );
}
