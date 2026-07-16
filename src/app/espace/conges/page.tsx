import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { chargerParametresPaie } from "@/lib/config";
import { calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { typeSansConges } from "@/lib/regles-contrats";
import { demanderMonConge } from "../actions";
import { Icone } from "@/components/icones";

const BADGE: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { label: "Approuvé", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { label: "Refusé", classe: "bg-red-100 text-red-800" },
};
const MOIS_ABBR = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEP", "OCT", "NOV", "DÉC"];
const auj = () => new Date().toISOString().slice(0, 10);

export default async function EspaceConges({ searchParams }: { searchParams: Promise<{ erreur?: string; envoye?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;
  const params = await chargerParametresPaie();

  const [emp, demandes, typesConges] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: s.employeeId }, select: { contrat: true, dateEmbauche: true } }),
    prisma.leaveRequest.findMany({ where: { employeeId: s.employeeId }, orderBy: { dateDebut: "desc" }, take: 60 }),
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

  const todayIso = auj();
  const aVenir = demandes.filter((l) => l.statut !== "REFUSE" && new Date(l.dateFin).toISOString().slice(0, 10) >= todayIso).reverse();
  const passees = demandes.filter((l) => new Date(l.dateFin).toISOString().slice(0, 10) < todayIso);

  const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Mes congés</h1>
        <p className="text-sm text-muted-foreground">Votre solde, vos absences et vos demandes.</p>
      </div>

      {/* Compteurs façon tableau de bord */}
      <div className="grid grid-cols-3 gap-3">
        <StatConge n={congesAcquis} label="Jours cumulés" />
        <StatConge n={solde} label="Jours disponibles" accent />
        <StatConge n={congesPris} label="Jours pris" />
      </div>

      {sp.envoye && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Votre demande a été envoyée. La Direction la validera prochainement.</p>}
      {sp.erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      {/* Nouvelle demande (repliée pour aérer) */}
      <details className="rounded-2xl border bg-card">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-base font-semibold">
          <Icone nom="parasol" className="shrink-0 text-primary" /> Demander un congé
        </summary>
        <form action={demanderMonConge} className="grid gap-3 border-t p-5 sm:grid-cols-2">
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
      </details>

      <SectionAbsences titre="À venir" items={aVenir} vide="Aucune absence à venir." />
      <SectionAbsences titre="Passées" items={passees} vide="Aucune absence passée." />
    </div>
  );
}

function StatConge({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-4 text-center shadow-sm">
      <div className={`text-2xl font-semibold tabular-nums sm:text-3xl ${accent ? "text-primary" : ""}`}>{n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

type Demande = { id: string; type: string; nbJours: unknown; dateDebut: Date; dateFin: Date; motif: string | null; statut: string };

function SectionAbsences({ titre, items, vide }: { titre: string; items: Demande[]; vide: string }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{titre}</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{vide}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((l) => {
            const b = BADGE[l.statut] ?? { label: l.statut, classe: "bg-muted text-muted-foreground" };
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <ChipDate date={l.dateDebut} />
                <span className="text-muted-foreground">→</span>
                <ChipDate date={l.dateFin} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.type}</p>
                  <p className="text-xs text-muted-foreground">{Number(l.nbJours)} jour{Number(l.nbJours) > 1 ? "s" : ""}{l.motif ? ` · ${l.motif}` : ""}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChipDate({ date }: { date: Date }) {
  const d = new Date(date);
  return (
    <span className="flex w-11 shrink-0 flex-col items-center overflow-hidden rounded-lg border text-center leading-none">
      <span className="w-full bg-primary/10 py-0.5 text-[9px] font-semibold text-primary">{MOIS_ABBR[d.getUTCMonth()]}</span>
      <span className="py-1 text-base font-semibold tabular-nums">{d.getUTCDate()}</span>
    </span>
  );
}
