import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";

const cdf = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} CDF`;
const usd = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

export default async function TransportPage() {
  await verifySession();

  const [employes, parametres] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: {
        id: true, matricule: true, nom: true, poste: true, categorie: true,
        transportJourCDF: true, transportMoisCDF: true, transportMoisUSD: true,
      },
    }),
    chargerParametresPaie(),
  ]);

  const jours = parametres.joursOuvrablesMois;
  const taux = parametres.tauxChangeCDF;

  const lignes = employes.map((e) => {
    const jour = Number(e.transportJourCDF);
    const brigade = e.categorie === "BRIGADE";
    // Brigade : transport = tarif journalier × jours de présence → mois complet = tarif × jours ouvrables.
    // Backoffice : forfait mensuel fixe en USD (converti en CDF au taux courant).
    const forfaitUSD = brigade ? 0 : Number(e.transportMoisUSD);
    const moisCompletCDF = brigade ? jour * jours : forfaitUSD * taux;
    return { ...e, jour, brigade, forfaitUSD, moisCompletCDF };
  });

  const totalMoisComplet = lignes.reduce((s, l) => s + l.moisCompletCDF, 0);

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Grille de transport</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prime de transport par employé. « Mois complet » = base {jours} jours ouvrables (brigade) ou forfait mensuel (back-office).
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Taux : 1&nbsp;$ = {taux.toLocaleString("fr-FR")} CDF · {jours} j ouvrables
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Matricule</th>
              <th className="px-3 py-2 font-medium">Nom</th>
              <th className="px-3 py-2 font-medium">Poste</th>
              <th className="px-3 py-2 font-medium">Catégorie</th>
              <th className="px-3 py-2 text-right font-medium">Transport / jour</th>
              <th className="px-3 py-2 text-right font-medium">Forfait mensuel</th>
              <th className="px-3 py-2 text-right font-medium">Mois complet</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{l.matricule}</td>
                <td className="px-3 py-2 font-medium">{l.nom}</td>
                <td className="px-3 py-2 text-muted-foreground">{l.poste}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.brigade ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
                    {l.brigade ? "Brigade" : "Back-office"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.brigade ? cdf(l.jour) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.brigade ? "—" : <span>{usd(l.forfaitUSD)}<span className="block text-xs text-muted-foreground">{cdf(l.forfaitUSD * taux)}</span></span>}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{cdf(l.moisCompletCDF)}</td>
              </tr>
            ))}
            {lignes.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Aucun employé actif.</td></tr>
            )}
          </tbody>
          {lignes.length > 0 && (
            <tfoot>
              <tr className="border-t bg-muted/40 font-semibold">
                <td className="px-3 py-2" colSpan={6}>Total transport (mois complet) — {lignes.length} employé(s)</td>
                <td className="px-3 py-2 text-right tabular-nums">{cdf(totalMoisComplet)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
