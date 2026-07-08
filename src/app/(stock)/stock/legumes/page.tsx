import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd } from "@/lib/stock";
import { AchatLegumesForm, SupprimerAchatBtn } from "./legumes-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const cdf = (n: number) => n.toLocaleString("fr-FR");

export default async function LegumesPage() {
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const [achats, config] = await Promise.all([
    prisma.achatLegume.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  // Groupement par jour.
  const groupes: { cle: string; titre: string; lignes: typeof achats }[] = [];
  const idx = new Map<string, number>();
  for (const a of achats) {
    const dt = new Date(a.date);
    const cle = dt.toISOString().slice(0, 10);
    if (!idx.has(cle)) { idx.set(cle, groupes.length); groupes.push({ cle, titre: `${dt.getUTCDate()} ${MOIS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, lignes: [] }); }
    groupes[idx.get(cle)!].lignes.push(a);
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Achats de légumes frais</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saisissez les achats du jour (montant en CDF converti en USD au taux courant). Journal daté, indépendant du stock du catalogue.</p>
        </div>
        <BoutonRapport types={[{ value: "LEGUMES", label: "Légumes" }]} />
      </div>

      <AchatLegumesForm taux={taux} estDirection={estDirection} />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Historique des achats</h2>
        {groupes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat enregistré.</p>
        ) : (
          <div className="space-y-3">
            {groupes.map((g) => {
              const tc = g.lignes.reduce((t, l) => t + Number(l.montantCDF ?? 0), 0);
              const tu = g.lignes.reduce((t, l) => t + Number(l.montantUSD ?? 0), 0);
              return (
                <div key={g.cle} className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-sm">
                    <span className="font-semibold">{g.titre} <span className="font-normal text-muted-foreground">· {g.lignes.length} ligne(s)</span></span>
                    <span className="text-muted-foreground">{cdf(tc)} CDF · {usd(tu)}</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {g.lignes.map((l) => (
                        <tr key={l.id} className="border-t even:bg-muted/20">
                          <td className="px-3 py-1.5 font-medium">{l.legume}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.quantite)} {l.unite ?? ""}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{l.montantCDF ? `${cdf(Number(l.montantCDF))} CDF` : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.montantUSD ? usd(l.montantUSD) : "—"}</td>
                          <td className="px-3 py-1.5 text-right"><SupprimerAchatBtn id={l.id} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
