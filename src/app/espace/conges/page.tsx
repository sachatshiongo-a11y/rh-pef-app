import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { chargerParametresPaie } from "@/lib/config";
import { calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { typeSansConges } from "@/lib/regles-contrats";
import { demanderMonConge } from "../actions";

const BADGE: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { label: "Approuvé", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { label: "Refusé", classe: "bg-red-100 text-red-800" },
};
const d = (x: Date) => new Date(x).toLocaleDateString("fr-FR", { timeZone: "UTC" });
const auj = () => new Date().toISOString().slice(0, 10);

export default async function EspaceConges({ searchParams }: { searchParams: Promise<{ erreur?: string; envoye?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;
  const params = await chargerParametresPaie();

  const [emp, demandes, typesConges] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: s.employeeId }, select: { contrat: true, dateEmbauche: true } }),
    prisma.leaveRequest.findMany({ where: { employeeId: s.employeeId }, orderBy: { dateDebut: "desc" }, take: 40 }),
    prisma.typeConge.findMany({ where: { actif: true }, orderBy: { ordre: "asc" }, select: { nom: true } }),
  ]);

  const now = new Date();
  const anciennete = Math.max(0, (now.getFullYear() - new Date(emp.dateEmbauche).getFullYear()) * 12 + (now.getMonth() - new Date(emp.dateEmbauche).getMonth()));
  const congesAcquis = typeSansConges(emp.contrat) ? 0 : calculerCongesAcquis(anciennete, params.droitsCongesAnnuel);
  const debutAnnee = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const congesPris = demandes
    .filter((l) => l.statut === "APPROUVE" && new Date(l.dateDebut) >= debutAnnee && congeDeductibleDuSolde(l.type))
    .reduce((a, l) => a + Number(l.nbJours), 0);
  const solde = Math.round((congesAcquis - congesPris) * 10) / 10;

  const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Mes congés</h1>
          <p className="text-sm text-muted-foreground">Demandez un congé et suivez vos demandes.</p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-2 text-center">
          <div className="text-2xl font-semibold">{solde} j</div>
          <div className="text-xs text-muted-foreground">solde disponible</div>
        </div>
      </div>

      {sp.envoye && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Votre demande a été envoyée. La Direction la validera prochainement.</p>}
      {sp.erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Nouvelle demande</h2>
        <form action={demanderMonConge} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Type de congé
            <select name="type" required className={inputCls} defaultValue={typesConges[0]?.nom ?? ""}>
              {typesConges.map((t) => <option key={t.nom} value={t.nom}>{t.nom}</option>)}
            </select>
          </label>
          <div className="hidden sm:block" />
          <label className="flex flex-col gap-1 text-sm">Du
            <input type="date" name="dateDebut" required min={auj()} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">Au
            <input type="date" name="dateFin" required min={auj()} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">Motif (facultatif)
            <input type="text" name="motif" placeholder="ex. raison familiale" className={inputCls} />
          </label>
          <div className="sm:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Envoyer la demande</button>
            <span className="ml-3 text-xs text-muted-foreground">Le décompte exclut les dimanches et jours fériés.</span>
          </div>
        </form>
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Mes demandes</h2>
        {demandes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune demande pour le moment.</p>
        ) : (
          <ul className="divide-y">
            {demandes.map((l) => {
              const b = BADGE[l.statut] ?? { label: l.statut, classe: "bg-muted text-muted-foreground" };
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{l.type} · {Number(l.nbJours)} j</p>
                    <p className="text-xs text-muted-foreground">Du {d(l.dateDebut)} au {d(l.dateFin)}{l.motif ? ` · ${l.motif}` : ""}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
