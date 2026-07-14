import { redirect } from "next/navigation";

/** Le calendrier des absences a été fusionné dans « Congés & absences » (/conges?vue=calendrier).
 * On y redirige les anciens liens en transportant les paramètres (vue semaine/mois → cal). */
export default async function AbsencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const p = new URLSearchParams({ vue: "calendrier" });
  if (sp.vue === "semaine" || sp.vue === "mois") p.set("cal", sp.vue);
  for (const k of ["mois", "annee", "type", "emp", "debut"] as const) {
    if (sp[k]) p.set(k, sp[k]!);
  }
  redirect(`/conges?${p}`);
}
