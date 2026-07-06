import { dureeShift, libelleShift } from "../../planning/creneaux";

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const ORDRE = [1, 2, 3, 4, 5, 6, 0]; // Lun → Dim

type ShiftInfo = { id: string; nom: string; heureDebut: string | null; heureFin: string | null; dureeHeures: number | null };
type ModeleEntry = { jour: number; semaine: number; shiftId: string };

/**
 * Horaire RÉEL d'un salarié, reconstitué depuis son modèle hebdomadaire (Planning → Modèle hebdo) :
 * shift et durée par jour + total/semaine. Reflète les horaires variables (jours non travaillés,
 * durées différentes) — contrairement au champ unique « heures/jour » (qui n'est qu'un seuil HS).
 */
export function HorairesModele({ entries, shifts }: { entries: ModeleEntry[]; shifts: ShiftInfo[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun horaire type défini. Renseignez le <span className="font-medium">modèle hebdomadaire</span>{" "}
        (Planning → Modèle hebdo) pour refléter les jours et horaires réels de ce salarié.
      </p>
    );
  }
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const semaines = [...new Set(entries.map((e) => e.semaine))].sort();
  const nomSemaine = (s: number) => (s === 1 ? "Semaine A" : s === 2 ? "Semaine B" : "Type (chaque semaine)");

  return (
    <div className="space-y-4">
      {semaines.map((sem) => {
        const jours = ORDRE.map((j) => {
          const e = entries.find((x) => x.semaine === sem && x.jour === j);
          const s = e ? shiftById.get(e.shiftId) : undefined;
          return { jour: j, shift: s, heures: s ? dureeShift(s) : 0 };
        });
        const total = Math.round(jours.reduce((a, b) => a + b.heures, 0) * 100) / 100;
        const joursTravailles = jours.filter((x) => x.shift && x.heures > 0).length;
        return (
          <div key={sem}>
            {semaines.length > 1 && (
              <p className="mb-1 text-xs font-semibold text-muted-foreground">{nomSemaine(sem)}</p>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[26rem] text-sm">
                <tbody>
                  {jours.map((x) => (
                    <tr key={x.jour} className="border-t first:border-t-0">
                      <td className="w-24 px-3 py-1.5 font-medium">{JOURS[x.jour]}</td>
                      <td className="px-3 py-1.5">
                        {x.shift ? (
                          libelleShift(x.shift.nom, x.shift.heureDebut, x.shift.heureFin)
                        ) : (
                          <span className="text-muted-foreground">Repos</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{x.heures > 0 ? `${x.heures} h` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td className="px-3 py-1.5" colSpan={2}>
                      Total ({joursTravailles} jour{joursTravailles > 1 ? "s" : ""} travaillé{joursTravailles > 1 ? "s" : ""}/sem)
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{total} h</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
