// Cartes graphiques de la fiche employé (façon Factorial) : absences colorées + jauge d'heures.

const MOIS_COURT = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛ", "SEP", "OCT", "NOV", "DÉC"];

/** Arrondit une durée en heures à 2 décimales et supprime les artefacts de virgule flottante
 *  (ex. 167.49999999999997 → « 167,5 »). */
function fmtH(n: number): string {
  const r = Math.round(n * 100) / 100;
  return (Object.is(r, -0) ? 0 : r).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function couleurType(type: string): { barre: string; fond: string; texte: string; point: string } {
  const t = type.toLowerCase();
  if (t.includes("annuel") || t.includes("payé"))
    return { barre: "bg-blue-500", fond: "bg-blue-50", texte: "text-blue-800", point: "bg-blue-500" };
  if (t.includes("maladie") || t.includes("accident"))
    return { barre: "bg-amber-500", fond: "bg-amber-50", texte: "text-amber-800", point: "bg-amber-500" };
  if (t.includes("matern") || t.includes("patern") || t.includes("naiss"))
    return { barre: "bg-pink-500", fond: "bg-pink-50", texte: "text-pink-800", point: "bg-pink-500" };
  if (t.includes("mariage") || t.includes("décès") || t.includes("deces"))
    return { barre: "bg-violet-500", fond: "bg-violet-50", texte: "text-violet-800", point: "bg-violet-500" };
  return { barre: "bg-slate-400", fond: "bg-slate-50", texte: "text-slate-700", point: "bg-slate-400" };
}

function ChipDate({ date }: { date: Date }) {
  const d = new Date(date);
  return (
    <div className="flex flex-col items-center rounded-lg border bg-background px-2.5 py-1 leading-none">
      <span className="text-[9px] font-medium uppercase text-muted-foreground">{MOIS_COURT[d.getUTCMonth()]}</span>
      <span className="text-base font-semibold">{d.getUTCDate()}</span>
    </div>
  );
}

export type AbsenceItem = {
  id: string;
  type: string;
  dateDebut: Date;
  dateFin: Date;
  nbJours: number;
  statut: string;
};

const LIBELLE_STATUT: Record<string, { texte: string; classe: string }> = {
  EN_ATTENTE: { texte: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { texte: "Approuvé", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { texte: "Refusé", classe: "bg-red-100 text-red-800" },
};

/** Liste graphique des absences (barre de couleur + type + jours + plage de dates). */
export function AbsencesCard({ absences }: { absences: AbsenceItem[] }) {
  if (absences.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Aucune demande de congé enregistrée.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {absences.map((a) => {
        const c = couleurType(a.type);
        const st = LIBELLE_STATUT[a.statut] ?? { texte: a.statut, classe: "bg-muted text-muted-foreground" };
        return (
          <div key={a.id} className={`flex items-center gap-3 overflow-hidden rounded-xl border ${c.fond}`}>
            <div className={`h-full w-1.5 self-stretch ${c.barre}`} />
            <div className="min-w-0 flex-1 py-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${c.point}`} aria-hidden />
                <span className={`text-sm font-semibold ${c.texte}`}>{a.type}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.classe}`}>{st.texte}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{a.nbJours} jour(s)</p>
            </div>
            <div className="flex items-center gap-2 pr-3">
              <ChipDate date={a.dateDebut} />
              <span className="text-muted-foreground">→</span>
              <ChipDate date={a.dateFin} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Jauge d'heures travaillées : normales + supplémentaires vs contractuelles, avec solde. */
export function HeuresTravailleesCard({
  periode,
  heuresTravaillees,
  heuresContractuelles,
  heuresSupp,
}: {
  periode: string;
  heuresTravaillees: number;
  heuresContractuelles: number;
  heuresSupp: number;
}) {
  const normales = Math.max(0, heuresTravaillees - heuresSupp);
  const base = Math.max(heuresContractuelles, heuresTravaillees, 1);
  const pctNormales = (normales / base) * 100;
  const pctSupp = (heuresSupp / base) * 100;
  const solde = heuresTravaillees - heuresContractuelles;

  return (
    <div className="mb-6 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Heures travaillées</h3>
        <span className="text-xs capitalize text-muted-foreground">{periode}</span>
      </div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold">{fmtH(heuresTravaillees)}h</span>
        <span className="text-lg text-muted-foreground">/ {fmtH(heuresContractuelles)}h</span>
        {heuresSupp > 0 && (
          <span className="ml-auto text-sm font-medium text-orange-600">+{fmtH(heuresSupp)}h supp.</span>
        )}
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-teal-500" style={{ width: `${pctNormales}%` }} />
        <div className="h-full bg-orange-500" style={{ width: `${pctSupp}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden /> Normales
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-orange-500" aria-hidden /> Supplémentaires
        </span>
        <span className="ml-auto">
          Solde{" "}
          <span className={`font-semibold ${solde < 0 ? "text-red-600" : "text-emerald-600"}`}>
            {solde >= 0 ? "+" : ""}
            {fmtH(solde)}h
          </span>
        </span>
      </div>
    </div>
  );
}
