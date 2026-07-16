import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { calculerBulletinLive } from "@/lib/bulletin-live";
import { ApercuBulletinCard } from "@/app/(app)/employes/[id]/apercu-bulletin";
import { demanderMonAcompte } from "../actions";
import { MOIS_FR } from "@/lib/dates-fr";

const BADGE: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { label: "Approuvé", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { label: "Refusé", classe: "bg-red-100 text-red-800" },
};
const fmtH = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const usd = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

export default async function EspacePaie({ searchParams }: { searchParams: Promise<{ acompte?: string; erreur?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;

  const config = await prisma.config.findUnique({ where: { id: "singleton" }, select: { moisCourant: true, anneeCourante: true } });
  const mois = config?.moisCourant ?? new Date().getMonth() + 1;
  const annee = config?.anneeCourante ?? new Date().getFullYear();
  const periode = `${MOIS_FR[mois - 1]} ${annee}`;

  const [apercu, acomptes] = await Promise.all([
    calculerBulletinLive(s.employeeId, mois, annee),
    prisma.acompteSalaire.findMany({ where: { employeeId: s.employeeId }, orderBy: { dateDemande: "desc" }, take: 20 }),
  ]);
  const totalHS = apercu ? apercu.hs30 + apercu.hs60 + apercu.hs100 : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Ma paie</h1>
        <p className="text-sm text-muted-foreground">Aperçu de votre bulletin en cours, vos heures supplémentaires et vos acomptes.</p>
      </div>

      {/* Heures supplémentaires */}
      {apercu && (
        <div className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold">Mes heures supplémentaires — {periode}</h2>
          {totalHS > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total heures supp." valeur={`${fmtH(totalHS)} h`} fort />
              <Stat label="À 30 %" valeur={`${fmtH(apercu.hs30)} h`} />
              <Stat label="À 60 %" valeur={`${fmtH(apercu.hs60)} h`} />
              <Stat label="Dim./fériés (×2)" valeur={`${fmtH(apercu.hs100)} h`} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune heure supplémentaire ce mois-ci.</p>
          )}
        </div>
      )}

      {/* Aperçu du bulletin (réutilise la carte de la fiche RH) */}
      {apercu ? (
        <ApercuBulletinCard apercu={apercu} periode={periode} />
      ) : (
        <div className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Aperçu du bulletin indisponible pour cette période.</div>
      )}
      <p className="-mt-3 text-xs text-muted-foreground">
        Aperçu indicatif calculé en temps réel — le bulletin officiel est celui validé par la Direction (onglet Documents).
      </p>

      {/* Demande d'acompte */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-base font-semibold">Demander un acompte</h2>
        <p className="mb-3 text-sm text-muted-foreground">Un acompte approuvé est déduit de votre prochain salaire net.</p>

        {sp.acompte && <p className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Votre demande d&apos;acompte a été envoyée à la Direction.</p>}
        {sp.erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

        <form action={demanderMonAcompte} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Montant ($)
            <input type="number" name="montantUSD" min="0" step="0.01" required placeholder="ex. 50" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Motif (facultatif)
            <input type="text" name="motif" placeholder="ex. dépense imprévue" className={inputCls} />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Envoyer la demande</button>
          </div>
        </form>

        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Mes demandes d&apos;acompte</h3>
          {acomptes.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Aucune demande pour le moment.</p>
          ) : (
            <ul className="divide-y">
              {acomptes.map((a) => {
                const b = BADGE[a.statut] ?? { label: a.statut, classe: "bg-muted text-muted-foreground" };
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{usd(Number(a.montantUSD))}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.dateDemande).toLocaleDateString("fr-FR")}{a.motif ? ` · ${a.motif}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, valeur, fort }: { label: string; valeur: string; fort?: boolean }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${fort ? "text-xl font-semibold text-amber-700" : "text-base font-medium"}`}>{valeur}</p>
    </div>
  );
}
