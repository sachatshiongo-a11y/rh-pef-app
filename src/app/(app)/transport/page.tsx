import { redirect } from "next/navigation";

/** L'onglet Transport a été fusionné dans « Employés » (vue Transport). On y redirige les anciens liens. */
export default function TransportPage() {
  redirect("/employes?vue=transport");
}
