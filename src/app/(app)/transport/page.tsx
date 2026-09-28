import { redirect } from "next/navigation";
import { exigerPageRH } from "@/lib/garde-page";

/** L'onglet Transport a été fusionné dans « Employés » (vue Transport). On y redirige les anciens liens. */
export default async function TransportPage() {
  await exigerPageRH();
  redirect("/employes?vue=transport");
}
