import { prisma } from "@/lib/prisma";
import { libelleTauxPaie } from "@/lib/paie-taux";
import { calculerDeclarationsMois } from "@/lib/declarations";
import { DeclarationsListe } from "./declarations-liste";
import { exigerPageRH } from "@/lib/garde-page";
import { TelechargerLien } from "@/components/telecharger-lien";
import { numeroMoisCourantKinshasa, anneeCouranteKinshasa } from "@/lib/heure-kinshasa";

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}
function cdf(n: number) {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " CDF";
}

export default async function DeclarationsPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; annee?: string; erreur?: string }>;
}) {
  const user = await exigerPageRH();
  const estAdmin = user.role === "ADMIN";
  const sp = await searchParams;

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const mois = Number(sp.mois) || config?.moisCourant || numeroMoisCourantKinshasa();
  const annee = Number(sp.annee) || config?.anneeCourante || anneeCouranteKinshasa();

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
      {sp.erreur && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Déclarations</h1>
          <p className="text-sm capitalize text-muted-foreground">{periode}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            <TelechargerLien
              href={`/declarations/export?mois=${mois}&annee=${annee}`}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Bordereau (PDF)
            </TelechargerLien>
          )}
          {bordereau && (
            <TelechargerLien
              href={`/declarations/export-excel?mois=${mois}&annee=${annee}`}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Cotisations (Excel)
            </TelechargerLien>
          )}
        </div>
      </div>

      {bordereau?.provisoire && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Provisoire.</span> {bordereau.nbNonValides} bulletin(s) sur {bordereau.nbBulletins} ne sont pas
          encore validés : ces montants peuvent encore changer. Les déclarations ne peuvent être marquées « déclaré » ou « payé »
          qu&apos;une fois toute la paie du mois validée.
        </p>
      )}

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
              <p className="text-xs text-muted-foreground">Total à déclarer{bordereau.provisoire ? " (provisoire)" : ""}</p>
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
          <DeclarationsListe
            lignes={bordereau.lignes.map((l) => ({
              type: l.type,
              libelle: l.libelle,
              detail: l.detail,
              montantUSD: l.montantUSD,
              montantCDF: l.montantCDF,
              recalculUSD: l.recalculUSD,
              figeLe: l.fige ? (l.fige.marqueLe ? new Date(l.fige.marqueLe).toLocaleDateString("fr-FR", { timeZone: "Africa/Kinshasa" }) : "") : null,
              ecartAvecFige: l.ecartAvecFige,
              echeance: new Date(l.echeance).toLocaleDateString("fr-FR"),
              echeanceAValider: l.echeanceAValider,
              statut: l.statut,
            }))}
            mois={mois} annee={annee} periode={periode} provisoire={bordereau.provisoire} estAdmin={estAdmin} totalUSD={totalUSD} totalCDF={totalCDF}
          />
          <p className="mt-4 text-xs text-muted-foreground">
            Taux de change de la paie : {libelleTauxPaie(bordereau.tauxDistincts)}. Les échéances « à valider » et les taux doivent être confirmés par un comptable
            congolais avant tout dépôt officiel.
          </p>
        </>
      )}
    </div>
  );
}
