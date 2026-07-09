import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerParametresPaie } from "@/lib/config";
import { Avatar } from "@/components/avatar";

const cdf = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} CDF`;
const usd = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

export default async function TransportPage() {
  await verifySession();

  const [employes, parametres] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: {
        id: true, matricule: true, nom: true, poste: true, categorie: true, photoUrl: true,
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

  // Totaux par catégorie. Par jour : brigade = tarif journalier ; back-office = forfait ÷ jours ouvrables.
  const totauxGroupe = (brig: boolean) => {
    const g = lignes.filter((l) => l.brigade === brig);
    const jourCDF = g.reduce((s, l) => s + (brig ? l.jour : l.moisCompletCDF / jours), 0);
    const moisCDF = g.reduce((s, l) => s + l.moisCompletCDF, 0);
    return { n: g.length, jourCDF, moisCDF };
  };
  const totBrigade = totauxGroupe(true);
  const totBackoffice = totauxGroupe(false);
  const totalJour = totBrigade.jourCDF + totBackoffice.jourCDF;

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

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <CarteTotal titre="Brigade" n={totBrigade.n} jour={totBrigade.jourCDF} mois={totBrigade.moisCDF} taux={taux} accent="bg-amber-100 text-amber-800" />
        <CarteTotal titre="Back-office" n={totBackoffice.n} jour={totBackoffice.jourCDF} mois={totBackoffice.moisCDF} taux={taux} accent="bg-sky-100 text-sky-800" />
        <CarteTotal titre="Ensemble" n={lignes.length} jour={totalJour} mois={totalMoisComplet} taux={taux} accent="bg-primary/10 text-primary" />
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
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
                <td className="px-3 py-2 font-medium">
                  <span className="flex items-center gap-2">
                    <Avatar nom={l.nom} taille={26} photoUrl={l.photoUrl} />
                    <span className="truncate">{l.nom}</span>
                  </span>
                </td>
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

/** Carte de synthèse : total transport par jour et par mois pour une catégorie (CDF + USD). */
function CarteTotal({ titre, n, jour, mois, taux, accent }: { titre: string; n: number; jour: number; mois: number; taux: number; accent: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${accent}`}>{titre}</span>
        <span className="text-xs text-muted-foreground">{n} employé(s)</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total / jour</p>
          <p className="text-sm font-semibold tabular-nums">{cdf(jour)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{usd(jour / taux)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total / mois</p>
          <p className="text-base font-semibold tabular-nums">{cdf(mois)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{usd(mois / taux)}</p>
        </div>
      </div>
    </div>
  );
}
