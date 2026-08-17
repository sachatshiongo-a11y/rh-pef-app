import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { usd } from "@/lib/stock";
import { AchatLegumesForm, SupprimerAchatBtn } from "./legumes-client";
import { BoutonRapport } from "../_rapport/bouton-rapport";
import { lundiDe, JOURS_FR as JOURS, MOIS_FR as MOIS } from "@/lib/dates-fr";

const cdf = (n: number) => n.toLocaleString("fr-FR");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type SP = { periode?: string };

export default async function LegumesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await verifySession();
  const estDirection = user.role === "ADMIN";
  const periode = sp.periode === "jour" || sp.periode === "mois" ? sp.periode : "semaine";

  const [achats, config] = await Promise.all([
    prisma.achatLegume.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);
  const taux = config ? Number(config.tauxChangeCDF) : 0;

  // Groupement par période (jour / semaine / mois), comme la liste d'achat.
  const groupes: { cle: string; titre: string; lignes: typeof achats }[] = [];
  const idx = new Map<string, number>();
  for (const a of achats) {
    const dt = new Date(a.date);
    let cle: string, titre: string;
    if (periode === "jour") {
      cle = dt.toISOString().slice(0, 10);
      titre = `${JOURS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MOIS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
    } else if (periode === "mois") {
      cle = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
      titre = `${cap(MOIS[dt.getUTCMonth()])} ${dt.getUTCFullYear()}`;
    } else {
      const l = lundiDe(dt);
      cle = l.toISOString().slice(0, 10);
      titre = `Semaine du ${l.getUTCDate()} ${MOIS[l.getUTCMonth()]} ${l.getUTCFullYear()}`;
    }
    if (!idx.has(cle)) { idx.set(cle, groupes.length); groupes.push({ cle, titre, lignes: [] }); }
    groupes[idx.get(cle)!].lignes.push(a);
  }
  const totCDF = (ls: typeof achats) => ls.reduce((t, l) => t + Number(l.montantCDF ?? 0), 0);
  const totUSD = (ls: typeof achats) => ls.reduce((t, l) => t + Number(l.montantUSD ?? 0), 0);

  const onglets = [
    { k: "jour", label: "Par jour" },
    { k: "semaine", label: "Par semaine" },
    { k: "mois", label: "Par mois" },
  ];

  return (
    <div className="max-w-3xl space-y-5">
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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Historique des achats</span>
          <span className="text-muted-foreground">·</span>
          {onglets.map((o) => (
            <a key={o.k} href={`/stock/legumes?periode=${o.k}`} className={`rounded-full border px-3 py-1 ${periode === o.k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{o.label}</a>
          ))}
        </div>

        {groupes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun achat enregistré.</p>
        ) : (
          <div className="space-y-2">
            {groupes.map((g) => (
              <details key={g.cle} className="group overflow-hidden rounded-lg border">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/50 px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{g.titre} <span className="font-normal text-muted-foreground">· {g.lignes.length} achat(s)</span></span>
                  <span className="font-normal text-muted-foreground">{cdf(totCDF(g.lignes))} CDF · {usd(totUSD(g.lignes))}</span>
                </summary>
                <table className="w-full border-t text-sm">
                  <tbody className="divide-y">
                    {g.lignes.map((l) => (
                      <tr key={l.id} className="even:bg-muted/10">
                        <td className="px-3 py-1 font-medium">{l.legume}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{Number(l.quantite)} {l.unite ?? ""}</td>
                        <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">{l.montantCDF ? `${cdf(Number(l.montantCDF))} CDF` : "—"}</td>
                        <td className="px-3 py-1 text-right tabular-nums">{l.montantUSD ? usd(l.montantUSD) : "—"}</td>
                        <td className="px-3 py-1 text-right"><SupprimerAchatBtn id={l.id} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
