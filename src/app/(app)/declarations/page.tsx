import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { calculerDeclarationsMois } from "@/lib/declarations";
import { marquerDeclarationForm } from "./actions";
import type { StatutDeclaration } from "@prisma/client";

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}
function cdf(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " CDF";
}

const LIBELLE_STATUT: Record<StatutDeclaration, string> = {
  A_DECLARER: "À déclarer",
  DECLARE: "Déclaré",
  PAYE: "Payé",
};
const COULEUR_STATUT: Record<StatutDeclaration, string> = {
  A_DECLARER: "bg-amber-100 text-amber-800",
  DECLARE: "bg-blue-100 text-blue-800",
  PAYE: "bg-green-100 text-green-800",
};

export default async function DeclarationsPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; annee?: string }>;
}) {
  const user = await verifySession();
  const estAdmin = user.role === "ADMIN";
  const sp = await searchParams;

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = Number(sp.mois) || config?.moisCourant || new Date().getMonth() + 1;
  const annee = Number(sp.annee) || config?.anneeCourante || new Date().getFullYear();

  // Mois pour lesquels une paie existe (pour le sélecteur).
  const runs = await prisma.payrollRun.findMany({
    select: { mois: true, annee: true },
    orderBy: [{ annee: "desc" }, { mois: "desc" }],
  });

  const bordereau = await calculerDeclarationsMois(mois, annee);
  const periode = new Date(annee, mois - 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const totalUSD = bordereau?.lignes.reduce((s, l) => s + l.montantUSD, 0) ?? 0;
  const totalCDF = bordereau?.lignes.reduce((s, l) => s + l.montantCDF, 0) ?? 0;
  const nbADeclarer = bordereau?.lignes.filter((l) => l.statut === "A_DECLARER").length ?? 0;
  const ligneCnss = bordereau?.lignes.find((l) => l.type === "CNSS");
  const cnssEcheance = ligneCnss ? new Date(ligneCnss.echeance).toLocaleDateString("fr-FR") : "—";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Déclarations</h1>
          <p className="text-sm capitalize text-muted-foreground">{periode}</p>
        </div>
        <div className="flex items-center gap-2">
          {runs.length > 0 && (
            <form method="GET" className="flex items-center gap-2">
              <select
                name="mois"
                defaultValue={mois}
                className="rounded-md border px-2 py-1.5 text-sm"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {new Date(2000, m - 1).toLocaleDateString("fr-FR", { month: "long" })}
                  </option>
                ))}
              </select>
              <select
                name="annee"
                defaultValue={annee}
                className="rounded-md border px-2 py-1.5 text-sm"
              >
                {Array.from(new Set([annee, ...runs.map((r) => r.annee)]))
                  .sort((a, b) => b - a)
                  .map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
              </select>
              <button
                type="submit"
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                Afficher
              </button>
            </form>
          )}
          {bordereau && (
            <a
              href={`/declarations/export?mois=${mois}&annee=${annee}`}
              target="_blank"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Bordereau (PDF)
            </a>
          )}
          {bordereau && (
            <a
              href="/declarations/export-excel"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cotisations (Excel)
            </a>
          )}
        </div>
      </div>

      {!bordereau ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Aucune paie calculée pour {periode}. Calculez d&apos;abord la paie de ce mois dans la
          page Paie pour générer le bordereau de déclarations.
        </div>
      ) : (
        <>
          {/* Synthèse */}
          <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Synthèse</div>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Total à déclarer</p>
              <p className="mt-1 text-xl font-semibold">{money(totalUSD)}</p>
              <p className="text-xs text-muted-foreground">{cdf(totalCDF)}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Échéance CNSS</p>
              <p className="mt-1 text-xl font-semibold">{cnssEcheance}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">Lignes à déclarer</p>
              <p className="mt-1 text-xl font-semibold">{nbADeclarer} / {bordereau.lignes.length}</p>
            </div>
          </div>

          <div className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Déclarations par organisme</div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">Organisme</th>
                  <th className="px-3 py-2">Nature</th>
                  <th className="px-3 py-2 text-right">Montant USD</th>
                  <th className="px-3 py-2 text-right">Montant CDF</th>
                  <th className="px-3 py-2">Échéance</th>
                  <th className="px-3 py-2">Statut</th>
                  {estAdmin && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {bordereau.lignes.map((l) => (
                  <tr key={l.type} className="border-t align-top">
                    <td className="px-3 py-2 font-medium">{l.libelle}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.detail}</td>
                    <td className="px-3 py-2 text-right">{money(l.montantUSD)}</td>
                    <td className="px-3 py-2 text-right">{cdf(l.montantCDF)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {new Date(l.echeance).toLocaleDateString("fr-FR")}
                      {l.echeanceAValider && (
                        <span className="ml-1 text-xs italic text-amber-700">(à valider)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_STATUT[l.statut]}`}
                      >
                        {LIBELLE_STATUT[l.statut]}
                      </span>
                    </td>
                    {estAdmin && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {l.statut !== "DECLARE" && l.statut !== "PAYE" && (
                          <form action={marquerDeclarationForm} className="inline">
                            <input type="hidden" name="type" value={l.type} />
                            <input type="hidden" name="mois" value={mois} />
                            <input type="hidden" name="annee" value={annee} />
                            <input type="hidden" name="statut" value="DECLARE" />
                            <button className="text-primary underline">Marquer déclaré</button>
                          </form>
                        )}
                        {l.statut !== "PAYE" && (
                          <form action={marquerDeclarationForm} className="ml-3 inline">
                            <input type="hidden" name="type" value={l.type} />
                            <input type="hidden" name="mois" value={mois} />
                            <input type="hidden" name="annee" value={annee} />
                            <input type="hidden" name="statut" value="PAYE" />
                            <button className="text-primary underline">Marquer payé</button>
                          </form>
                        )}
                        {l.statut === "PAYE" && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="border-t-2 border-primary/40 bg-muted/30 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right">{money(totalUSD)}</td>
                  <td className="px-3 py-2 text-right">{cdf(totalCDF)}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2"></td>
                  {estAdmin && <td className="px-3 py-2"></td>}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Taux de change utilisé pour la paie : 1 $ = {bordereau.tauxChange.toLocaleString("fr-FR")}{" "}
            CDF. Les échéances « à valider » et les taux doivent être confirmés par un comptable
            congolais avant tout dépôt officiel.
          </p>
        </>
      )}
    </div>
  );
}
