import { verifySession, requireRole } from "@/lib/auth";
import { EmployeeForm } from "../employee-form";
import { creerEmploye } from "../actions";
import { chargerParametresPaie } from "@/lib/config";

export default async function NouvelEmployePage() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const parametres = await chargerParametresPaie();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Nouvel employé</h1>
      <EmployeeForm action={creerEmploye} joursOuvrablesMois={parametres.joursOuvrablesMois} />
    </div>
  );
}
