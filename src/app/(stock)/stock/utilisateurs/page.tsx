import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { UsersAdmin, type UserRow } from "@/app/(app)/parametres/users-admin";

// Gestion des utilisateurs & accès depuis l'espace Stock — réservée à la Direction (ADMIN).
// Réutilise le même écran que la RH (création compte Supabase + profil, rôle STOCK inclus).
export default async function UtilisateursStockPage() {
  const user = await verifySession();
  if (user.role !== "ADMIN") {
    return (
      <div>
        <h1 className="mb-2 text-xl font-semibold sm:text-2xl">Utilisateurs</h1>
        <p className="text-sm text-muted-foreground">Seule la Direction peut gérer les utilisateurs.</p>
      </div>
    );
  }

  const [users, employes] = await Promise.all([
    prisma.user.findMany({ orderBy: { nom: "asc" }, include: { employe: { select: { nom: true } } } }),
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" }, select: { id: true, nom: true } }),
  ]);
  const userRows: UserRow[] = users.map((u) => ({
    id: u.id, email: u.email, nom: u.nom, role: u.role, actif: u.actif,
    employeeId: u.employeeId, employeNom: u.employe?.nom ?? null,
  }));

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Utilisateurs &amp; accès</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Créez et gérez les comptes. Rôle <span className="font-medium">Stock</span> = accès à cet
          espace uniquement ; <span className="font-medium">Direction</span> = accès total (RH + Stock).
        </p>
      </div>
      <UsersAdmin users={userRows} employes={employes} monId={user.id} />
    </div>
  );
}
