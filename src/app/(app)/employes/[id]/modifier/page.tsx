import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { EmployeeForm } from "../../employee-form";
import { modifierEmploye } from "../../actions";
import { uploadPhotoEmploye } from "../../photo-actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";
import { Avatar } from "@/components/avatar";

export default async function ModifierEmployePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);

  const { id } = await params;
  const [employee, parametres, postes] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    chargerParametresPaie(),
    chargerPostes(),
  ]);
  if (!employee) notFound();

  const action = modifierEmploye.bind(null, employee.id);

  return (
    <div>
      <Link href={`/employes/${employee.id}`} className="text-sm text-primary underline">
        ← Retour à la fiche
      </Link>
      <h1 className="mb-6 mt-2 text-xl font-semibold sm:text-2xl">Modifier — {employee.nom}</h1>

      {/* Photo — modifiable uniquement ici (page Modifier) */}
      <div className="mb-6 flex items-center gap-4 rounded-xl border bg-card p-4">
        {employee.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={employee.photoUrl} alt={employee.nom} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <Avatar nom={employee.nom} taille={64} />
        )}
        <form action={uploadPhotoEmploye.bind(null, employee.id)} className="flex flex-wrap items-center gap-2">
          <div>
            <p className="text-sm font-medium">Photo de l&apos;employé</p>
            <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" required className="mt-1 text-xs" />
          </div>
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            Mettre à jour la photo
          </button>
        </form>
      </div>

      <EmployeeForm employee={employee} action={action} joursOuvrablesMois={parametres.joursOuvrablesMois} postes={postes} />
    </div>
  );
}
