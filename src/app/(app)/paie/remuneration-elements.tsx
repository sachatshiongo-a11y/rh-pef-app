import { Avatar } from "@/components/avatar";

export type LigneRemu = {
  employeeId: string;
  nom: string;
  photoUrl?: string | null;
  base: number;
  hs: number;
  transport: number;
  primes: number;
  fraisMedicaux: number;
  alloc: number;
  acompte: number;
  net: number;
};

const money = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

// Chaque « élément de rémunération » = une clé + un libellé + une couleur (gain vert / retenue ambre).
const ELEMENTS: { cle: keyof LigneRemu; label: string; retenue?: boolean }[] = [
  { cle: "base", label: "Salaire de base" },
  { cle: "hs", label: "Heures supplémentaires" },
  { cle: "transport", label: "Prime de transport" },
  { cle: "primes", label: "Primes" },
  { cle: "fraisMedicaux", label: "Frais médicaux (remboursement)" },
  { cle: "alloc", label: "Allocation familiale" },
  { cle: "acompte", label: "Acompte sur salaire", retenue: true },
];

/**
 * Vue « Éléments de rémunération » façon PayFit : une carte par TYPE de rémunération, listant les
 * employés concernés et leur montant, avec le total du type.
 */
export function RemunerationElements({ lignes }: { lignes: LigneRemu[] }) {
  if (lignes.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Aucune paie calculée pour ce mois.
      </div>
    );
  }

  const masseNette = lignes.reduce((s, l) => s + l.net, 0);

  return (
    <div className="space-y-5">
      {/* Bandeau récap */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Salariés</p>
          <p className="mt-1 text-xl font-semibold">{lignes.length}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Masse nette à payer</p>
          <p className="mt-1 text-xl font-semibold">{money(masseNette)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total primes</p>
          <p className="mt-1 text-xl font-semibold">{money(lignes.reduce((s, l) => s + l.primes, 0))}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total heures supp.</p>
          <p className="mt-1 text-xl font-semibold">{money(lignes.reduce((s, l) => s + l.hs, 0))}</p>
        </div>
      </div>

      {/* Une carte par type de rémunération */}
      <div className="grid gap-4 lg:grid-cols-2">
        {ELEMENTS.map((el) => {
          const concernes = lignes
            .map((l) => ({ nom: l.nom, employeeId: l.employeeId, photoUrl: l.photoUrl, montant: Number(l[el.cle]) }))
            .filter((x) => x.montant > 0)
            .sort((a, b) => b.montant - a.montant);
          const total = concernes.reduce((s, x) => s + x.montant, 0);

          return (
            <div key={el.cle} className="overflow-hidden rounded-xl border bg-card">
              <div className={`flex items-center justify-between border-b px-4 py-2.5 ${el.retenue ? "bg-amber-50" : "bg-emerald-50/60"}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${el.retenue ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
                  <span className="text-sm font-semibold">{el.label}</span>
                  <span className="text-xs text-muted-foreground">· {concernes.length} salarié(s)</span>
                </div>
                <span className={`text-sm font-bold ${el.retenue ? "text-amber-700" : "text-emerald-700"}`}>
                  {el.retenue && total > 0 ? "- " : ""}{money(total)}
                </span>
              </div>
              {concernes.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Aucun salarié concerné ce mois.</p>
              ) : (
                <ul className="max-h-64 divide-y overflow-y-auto">
                  {concernes.map((x) => (
                    <li key={x.employeeId} className="flex items-center gap-3 px-4 py-2">
                      <Avatar nom={x.nom} taille={26} photoUrl={x.photoUrl} />
                      <span className="min-w-0 flex-1 truncate text-sm">{x.nom}</span>
                      <span className="text-sm font-medium">{el.retenue ? "- " : ""}{money(x.montant)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
