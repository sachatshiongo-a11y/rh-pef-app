import { verifySession, requireRole } from "@/lib/auth";
import { EmployeeForm } from "../employee-form";
import { creerEmploye } from "../actions";
import { chargerParametresPaie } from "@/lib/config";
import { chargerPostes } from "@/lib/postes";

export default async function NouvelEmployePage() {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const [parametres, postes] = await Promise.all([chargerParametresPaie(), chargerPostes()]);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold sm:text-2xl">Nouvel employé</h1>
      <EmployeeForm action={creerEmploye} joursOuvrablesMois={parametres.joursOuvrablesMois} postes={postes} />
    </div>
  );
}
