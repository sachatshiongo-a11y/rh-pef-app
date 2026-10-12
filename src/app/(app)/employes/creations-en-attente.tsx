import Link from "next/link";
import { Avatar } from "@/components/avatar";

export type CreationEnAttente = { id: string; nom: string; auteurNom: string; le: string; reembauche?: boolean };

/**
 * Encadré à part (jamais mêlé aux salariés) : les fiches saisies par la RH et pas encore validées par la
 * Direction. Elles n'existent pas encore : ni paie, ni présences, ni planning.
 */
export function CreationsEnAttente({ creations, estDirection }: { creations: CreationEnAttente[]; estDirection: boolean }) {
  if (creations.length === 0) return null;
  return (
    <section role="status" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <h2 className="mb-2 flex flex-wrap items-center gap-2 font-semibold">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">À valider</span>
        Nouvelles fiches en attente de validation par la Direction ({creations.length})
      </h2>
      <ul className="space-y-1.5">
        {creations.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <Avatar nom={c.nom} taille={28} />
            <span className="font-medium">{c.nom}</span>{c.reembauche && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">réembauche</span>}
            <span className="text-xs text-amber-800">saisie par {c.auteurNom} le {c.le} — pas encore créée</span>
          </li>
        ))}
      </ul>
      {estDirection && (
        <Link href="/a-valider#modifications-fiches" className="mt-2 inline-block text-xs font-medium text-primary underline">Décider dans « À valider » →</Link>
      )}
    </section>
  );
}
