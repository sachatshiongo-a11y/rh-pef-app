import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd } from "@/lib/stock";
import { AchatLegumesForm, SupprimerAchatBtn } from "./legumes-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { MOIS_FR as MOIS } from "@/lib/dates-fr";

const cdf = (n: number) => n.toLocaleString("fr-FR");

export default async function LegumesPage() {
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const [achats, config] = await Promise.all([
    prisma.achatLegume.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  // Groupement par mois → jour (accordéon par mois).
  type Jour = { cle: string; titre: string; lignes: typeof achats };
  type Mois = { cle: string; titre: string; jours: Jour[] };
  const mois: Mois[] = [];
  const idxM = new Map<string, number>(), idxJ = new Map<string, number>();
  for (const a of achats) {
    const dt = new Date(a.date);
    const cleM = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!idxM.has(cleM)) { idxM.set(cleM, mois.length); mois.push({ cle: cleM, titre: `${MOIS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, jours: [] }); }
    const m = mois[idxM.get(cleM)!];
    const cleJ = dt.toISOString().slice(0, 10);
    if (!idxJ.has(cleJ)) { idxJ.set(cleJ, m.jours.length); m.jours.push({ cle: cleJ, titre: `${dt.getUTCDate()} ${MOIS[dt.getUTCMonth()]}`, lignes: [] }); }
    m.jours[idxJ.get(cleJ)!].lignes.push(a);
  }
  const totCDF = (ls: typeof achats) => ls.reduce((t, l) => t + Number(l.montantCDF ?? 0), 0);
  const totUSD = (ls: typeof achats) => ls.reduce((t, l) => t + Number(l.montantUSD ?? 0), 0);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Achats de légumes frais</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saisissez les achats du jour (montant en CDF converti en USD au taux courant). Journal daté, indépendant du stock du catalogue.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BoutonRapport types={[{ value: "LEGUMES", label: "Légumes" }]} />
        </div>
      </div>

      <AchatLegumesForm taux={taux} estDirection={estDirection} />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Historique des achats</h2>
        {mois.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat enregistré.</p>
        ) : (
          <div className="space-y-2">
            {mois.map((m) => {
              const nb = m.jours.reduce((n, j) => n + j.lignes.length, 0);
              return (
                <details key={m.cle} className="group overflow-hidden rounded-lg border">
                  <summary className="flex cursor-pointer list-none items-center justify-between bg-muted/50 px-3 py-1.5 text-sm font-semibold">
                    <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{m.titre} <span className="font-normal text-muted-foreground">· {nb} achat(s)</span></span>
                    <span className="font-normal text-muted-foreground">{cdf(m.jours.reduce((t, j) => t + totCDF(j.lignes), 0))} CDF · {usd(m.jours.reduce((t, j) => t + totUSD(j.lignes), 0))}</span>
                  </summary>
                  <div className="divide-y">
                    {m.jours.map((j) => (
                      <div key={j.cle}>
                        <div className="flex items-center justify-between bg-muted/20 px-3 py-1 text-xs">
                          <span className="font-medium">{j.titre} <span className="font-normal text-muted-foreground">· {j.lignes.length}</span></span>
                          <span className="text-muted-foreground">{cdf(totCDF(j.lignes))} CDF · {usd(totUSD(j.lignes))}</span>
                        </div>
                        <table className="w-full text-sm">
                          <tbody>
                            {j.lignes.map((l) => (
                              <tr key={l.id} className="border-t even:bg-muted/10">
                                <td className="px-3 py-0.5 font-medium">{l.legume}</td>
                                <td className="px-3 py-0.5 text-right tabular-nums">{Number(l.quantite)} {l.unite ?? ""}</td>
                                <td className="px-3 py-0.5 text-right tabular-nums text-muted-foreground">{l.montantCDF ? `${cdf(Number(l.montantCDF))} CDF` : "—"}</td>
                                <td className="px-3 py-0.5 text-right tabular-nums">{l.montantUSD ? usd(l.montantUSD) : "—"}</td>
                                <td className="px-3 py-0.5 text-right"><SupprimerAchatBtn id={l.id} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
