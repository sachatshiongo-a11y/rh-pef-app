import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { JOURS_FR } from "@/lib/dates-fr";
import { libelleShift } from "./creneaux";
import { raisonDe } from "./raisons";
import type { EcartEmployeInfo, EcartShiftInfo } from "./ecart-data";
import type { LigneCouverture, LigneHeures, ResultatEcart } from "@/lib/planning-ecart";

// Deux questions, et seulement deux (voir la conception) : la couverture a-t-elle tenu, et les
// heures prévues ont-elles été faites. Vue en lecture seule, aucune écriture depuis cet écran —
// une correction de présence se fait dans l'onglet Présences, qui est fait pour ça.

function libelleJour(d: Date): string {
  return `${JOURS_FR[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Écart d'heures signé : rouge = manque, vert = surplus — jamais l'inverse (convention src/lib/montant.ts). */
function EcartHeures({ valeur }: { valeur: number }) {
  const signe = valeur > 0 ? "+" : valeur < 0 ? "−" : "";
  const couleur = valeur < 0 ? "text-red-700" : valeur > 0 ? "text-emerald-700" : "text-muted-foreground";
  return <span className={`font-semibold tabular-nums ${couleur}`}>{signe}{Math.abs(valeur).toFixed(1).replace(".", ",")} h</span>;
}

function LigneEmploye({ id, info }: { id: string; info?: EcartEmployeInfo }) {
  const nom = info?.nom ?? "—";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar nom={nom} taille={20} photoUrl={info?.photoUrl} />
      <Link href={`/employes/${id}`} className="truncate font-medium hover:text-primary hover:underline">{nom}</Link>
    </span>
  );
}

export function EcartView({
  resultat,
  employesInfo,
  shiftsInfo,
}: {
  resultat: ResultatEcart;
  employesInfo: Map<string, EcartEmployeInfo>;
  shiftsInfo: Map<string, EcartShiftInfo>;
}) {
  const nonTenues = resultat.couverture
    .filter((g) => g.tenus < g.prevus)
    .sort((a, b) => (b.prevus - b.tenus) - (a.prevus - a.tenus) || a.date.getTime() - b.date.getTime());
  const tenuesCount = resultat.couverture.length - nonTenues.length;

  const heuresTriees = [...resultat.heures].sort((a, b) => a.ecart - b.ecart);

  // Trous de SAISIE, jamais des absences (décision cadrante n°2) : créneaux sans code saisi, et
  // jours codés « P » sans aucune heure. Le bandeau prévient avant toute lecture des deux blocs.
  const joursPresenceSansHeuresTotal = resultat.heures.reduce((s, l) => s + l.joursPresenceSansHeures, 0);
  const alerteSaisie = resultat.total.creneauxNonRenseignes > 0 || joursPresenceSansHeuresTotal > 0;

  return (
    <div className="space-y-6">
      {alerteSaisie && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Des trous de saisie faussent cette lecture</strong> — à combler avant d&apos;en tirer une
          conclusion.{" "}
          {resultat.total.creneauxNonRenseignes > 0 && (
            <>{resultat.total.creneauxNonRenseignes} créneau(x) planifié(s) sans code de présence saisi{joursPresenceSansHeuresTotal > 0 ? " ; " : "."}</>
          )}
          {joursPresenceSansHeuresTotal > 0 && (
            <>{joursPresenceSansHeuresTotal} jour(s) codé(s) « Présence » sans heures saisies.</>
          )}{" "}
          Ce ne sont pas des absences : complétez la saisie dans l&apos;onglet Présences avant de conclure.
        </p>
      )}

      {/* ---------- Couverture ---------- */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Couverture</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {nonTenues.length === 0
            ? "Tous les créneaux planifiés ont été tenus."
            : `${nonTenues.length} créneau(x) jour × shift × poste non entièrement tenu(s), les manques les plus importants d'abord.`}
          {tenuesCount > 0 && <> · {tenuesCount} entièrement tenu(s), non listé(s) ci-dessous.</>}
        </p>
        {nonTenues.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {nonTenues.map((g: LigneCouverture) => {
              const shift = shiftsInfo.get(g.shiftId);
              const label = shift ? libelleShift(shift.nom, shift.heureDebut, shift.heureFin) : "shift";
              return (
                <li key={`${g.date.toISOString()}_${g.shiftId}_${g.poste}`} className="px-3 py-2">
                  <p>
                    <span className="font-medium capitalize">{libelleJour(g.date)}</span>
                    {" · "}
                    <span>{label} × {g.poste || "—"}</span>
                    {" : "}
                    <span className={g.tenus === 0 ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>
                      {g.tenus} tenu(s) sur {g.prevus}
                    </span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    {g.manquants.map((m, i) => (
                      <span key={m.employeeId} className="inline-flex items-center gap-1">
                        {i > 0 && <span>,</span>}
                        <LigneEmploye id={m.employeeId} info={employesInfo.get(m.employeeId)} />
                        <span>({raisonDe(m.code)})</span>
                      </span>
                    ))}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------- Heures par salarié ---------- */}
      <section>
        <h2 className="mb-2 text-base font-semibold">Heures par salarié</h2>
        <p className="mb-3 text-xs text-muted-foreground">Triées par écart croissant : les plus gros manques en tête.</p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Salarié</th>
                <th className="px-3 py-2 text-right">Jours prévus</th>
                <th className="px-3 py-2 text-right">Jours tenus</th>
                <th className="px-3 py-2 text-right">Heures planifiées</th>
                <th className="px-3 py-2 text-right">Heures réalisées</th>
                <th className="px-3 py-2 text-right">Écart</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {heuresTriees.map((l: LigneHeures) => (
                <tr key={l.employeeId}>
                  <td className="px-3 py-1.5">
                    <LigneEmploye id={l.employeeId} info={employesInfo.get(l.employeeId)} />
                    {(l.joursTravaillesHorsPlanning > 0 || l.joursPresenceSansHeures > 0) && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {l.joursTravaillesHorsPlanning > 0 && <>+{l.joursTravaillesHorsPlanning} j. hors planning</>}
                        {l.joursTravaillesHorsPlanning > 0 && l.joursPresenceSansHeures > 0 && " · "}
                        {l.joursPresenceSansHeures > 0 && <span className="text-amber-700">{l.joursPresenceSansHeures} j. présence sans heures</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.joursPlanifies}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.joursTenus}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.heuresPlanifiees.toFixed(1).replace(".", ",")} h</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.heuresRealisees.toFixed(1).replace(".", ",")} h</td>
                  <td className="px-3 py-1.5 text-right"><EcartHeures valeur={l.ecart} /></td>
                </tr>
              ))}
              {heuresTriees.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-muted-foreground">Aucun employé actif.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
