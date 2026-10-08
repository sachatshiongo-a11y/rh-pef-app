import { EmployeeName } from "@/components/employee-name";
import { BoutonNeutre } from "@/components/action-buttons";
import { libelleMotif, type MotifDoublon } from "@/lib/employe-doublon";
import { ecarterDoublon } from "./actions";

type FicheResumee = { id: string; nom: string; photoUrl: string | null; poste: string; actif: boolean; matricule: string };
export type PaireDoublon = { a: FicheResumee; b: FicheResumee; motifs: MotifDoublon[]; memeNom: boolean };

function Fiche({ f }: { f: FicheResumee }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <EmployeeName id={f.id} nom={f.nom} photoUrl={f.photoUrl} taille={24} />
      <span className="text-xs text-muted-foreground">
        <span className="font-mono">{f.matricule}</span> · {f.poste}
      </span>
      {!f.actif && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Inactif</span>}
    </span>
  );
}

/**
 * Doublons PROBABLES déjà en base — réservé à la Direction (la page ne le monte que pour elle).
 * Montre, ne corrige rien : la fusion de deux dossiers n'existe pas (présences, paies, contrats…
 * restent attachés à chaque fiche ; les réunir serait un chantier à part). « Deux personnes
 * différentes » journalise la paire, qui ne se représente plus.
 */
export function DoublonsProbables({ paires }: { paires: PaireDoublon[] }) {
  if (paires.length === 0) return null;
  return (
    <details open={paires.length <= 3} className="group mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
        {paires.length === 1 ? "2 fiches semblent en double" : `${paires.length} paires de fiches semblent en double`}
      </summary>
      <ul className="mt-3 space-y-2">
        {paires.map(({ a, b, motifs, memeNom }) => (
          <li key={`${a.id}|${b.id}`} className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-card p-3 text-foreground lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
              <span className="text-sm text-muted-foreground">2 fiches semblent en double :</span>
              <Fiche f={a} />
              <span aria-hidden className="hidden text-muted-foreground sm:inline">/</span>
              <Fiche f={b} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {motifs.map((m) => (
                <span key={m} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{libelleMotif(m, memeNom)}</span>
              ))}
              <form action={ecarterDoublon.bind(null, a.id, b.id)}>
                <BoutonNeutre type="submit" title="Ne plus signaler cette paire (décision tracée au journal)">Deux personnes différentes</BoutonNeutre>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-amber-800">
        Rien n&apos;est fusionné ni modifié : la fusion de deux dossiers n&apos;existe pas. Ouvrez les deux fiches pour trancher.
      </p>
    </details>
  );
}
