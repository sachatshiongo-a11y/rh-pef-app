import Link from "next/link";
import { Avatar } from "@/components/avatar";

/**
 * Affichage unifié d'un salarié (avatar coloré + nom cliquable), identique dans tous les onglets
 * (Employés, À valider, Paie, Documents…). Composant présentational : utilisable côté serveur
 * comme côté client.
 */
export function EmployeeName({
  id,
  nom,
  photoUrl,
  taille = 28,
}: {
  id: string;
  nom: string;
  photoUrl?: string | null;
  taille?: number;
}) {
  return (
    <Link
      href={`/employes/${id}`}
      className="inline-flex items-center gap-2 text-primary hover:underline"
    >
      <Avatar nom={nom} taille={taille} photoUrl={photoUrl ?? null} />
      <span>{nom}</span>
    </Link>
  );
}
