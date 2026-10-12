import Link from "next/link";
import { autresEnAttente, type AttenteParEspace, type EspaceAValider } from "@/lib/a-valider-compteur";

/**
 * Rappel croisé de la DIRECTION (plan d'ergonomie, V11), en tête de chaque page « À valider » :
 * « Aussi en attente : Stock 3 · Exploitation 1 », chaque nom menant à la boîte de l'espace. Les
 * espaces vides et l'espace qu'on regarde ne s'affichent pas ; rien du tout si tout est à jour ailleurs.
 * L'appelant ne charge `attente` que pour la Direction (`chargerAttenteDirection`).
 */
export function AussiEnAttente({ courant, attente }: { courant: EspaceAValider; attente: AttenteParEspace | null }) {
  if (!attente) return null;
  const ailleurs = autresEnAttente(courant, attente);
  if (ailleurs.length === 0) return null;
  return (
    <p className="text-sm text-muted-foreground">
      Aussi en attente :{" "}
      {ailleurs.map((a, i) => (
        <span key={a.espace}>
          {i > 0 && " · "}
          <Link href={a.href} className="text-primary hover:underline">{a.nom} <span className="font-semibold tabular-nums">{a.nombre}</span></Link>
        </span>
      ))}
    </p>
  );
}
