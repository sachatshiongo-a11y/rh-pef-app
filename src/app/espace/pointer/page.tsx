import { chargerSalarie } from "../garde";
import { PointerClient } from "@/app/(app)/pointer/pointer-client";
import { chargerPointageDuJour } from "@/app/(app)/pointer/pointage-du-jour";

// Pointage du salarié depuis son espace : l'état du jour et le scanner de l'affiche (même composant
// que l'écran « Pointer » de l'espace RH).
export default async function EspacePointer() {
  const s = await chargerSalarie();
  const jour = await chargerPointageDuJour(s.employeeId);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Pointer</h1>
      <PointerClient
        nom={jour.nom ?? s.nom}
        photoUrl={jour.photoUrl}
        dateLabel={jour.dateLabel}
        pointage={jour.pointage}
        departScanne={jour.departScanne}
      />
    </div>
  );
}
