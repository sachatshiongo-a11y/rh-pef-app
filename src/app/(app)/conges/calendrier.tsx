import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { chargerParametresPaie } from "@/lib/config";
import { calculerCongesAcquis, calculerJoursOuvrables, congeDeductibleDuSolde } from "@/lib/payroll";
import { Avatar } from "@/components/avatar";

// Vue Calendrier de l'onglet « Congés & absences » (fusion de l'ancien /absences).
// Le paramètre interne semaine/mois s'appelle `cal` (vue=calendrier est pris par la bascule).

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MOIS_LONG = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// Chaque type d'absence = couleur + libellé (jamais d'icône décorative). Les types sont
// configurables (table TypeConge) : la couleur est dérivée du NOM de façon stable (comme les
// avatars), les types connus gardent leur couleur historique. Aucun type n'est renommé « Autre ».
const TYPE_STYLE: Record<string, { chip: string; point: string }> = {
  "Congé annuel": { chip: "bg-blue-100 text-blue-800", point: "bg-blue-500" },
  "Congé maladie": { chip: "bg-amber-100 text-amber-800", point: "bg-amber-500" },
  "Congé maternité": { chip: "bg-pink-100 text-pink-800", point: "bg-pink-500" },
};
const TYPE_PALETTE: { chip: string; point: string }[] = [
  { chip: "bg-emerald-100 text-emerald-800", point: "bg-emerald-500" },
  { chip: "bg-violet-100 text-violet-800", point: "bg-violet-500" },
  { chip: "bg-cyan-100 text-cyan-800", point: "bg-cyan-500" },
  { chip: "bg-rose-100 text-rose-800", point: "bg-rose-500" },
  { chip: "bg-lime-100 text-lime-800", point: "bg-lime-600" },
  { chip: "bg-orange-100 text-orange-800", point: "bg-orange-500" },
  { chip: "bg-teal-100 text-teal-800", point: "bg-teal-500" },
  { chip: "bg-slate-200 text-slate-700", point: "bg-slate-500" },
];
function styleType(t: string) {
  if (TYPE_STYLE[t]) return TYPE_STYLE[t];
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return TYPE_PALETTE[h % TYPE_PALETTE.length];
}
function isoJour(d: Date) {
  return d.toISOString().slice(0, 10);
}
function moisEntre(debut: Date, fin: Date): number {
  return Math.max(0, (fin.getFullYear() - debut.getFullYear()) * 12 + (fin.getMonth() - debut.getMonth()));
}

export type SPCalendrier = { mois?: string; annee?: string; type?: string; emp?: string; cal?: string; debut?: string };

export async function CalendrierAbsences({ sp }: { sp: SPCalendrier }) {
  const maintenant = new Date();
  const cal = sp.cal === "semaine" ? "semaine" : "mois";
  const filtreType = sp.type ?? "";
  const filtreEmp = sp.emp ?? "";

  // Cases affichées + libellé + navigation selon la vue (mois = semaines lun→dim ; semaine = 7 jours).
  let cases: Date[];
  let annee: number;
  let mois: number;
  let titre: string;
  let navPrec: string;
  let navSuiv: string;
  let navAuj: string;

  if (cal === "semaine") {
    const base = sp.debut ? new Date(sp.debut + "T00:00:00Z") : maintenant;
    const ref = isNaN(base.getTime()) ? maintenant : base;
    const dow = ref.getUTCDay();
    const lundi = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
    lundi.setUTCDate(lundi.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    cases = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(lundi);
      d.setUTCDate(d.getUTCDate() + i);
      return d;
    });
    annee = lundi.getUTCFullYear();
    mois = lundi.getUTCMonth() + 1;
    titre = `Semaine du ${lundi.getUTCDate()} au ${cases[6].toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;
    navPrec = `cal=semaine&debut=${isoJour(new Date(lundi.getTime() - 7 * 86_400_000))}`;
    navSuiv = `cal=semaine&debut=${isoJour(new Date(lundi.getTime() + 7 * 86_400_000))}`;
    navAuj = `cal=semaine`;
  } else {
    annee = Number(sp.annee) || maintenant.getFullYear();
    mois = sp.mois ? Math.min(12, Math.max(1, Number(sp.mois))) : maintenant.getMonth() + 1;
    const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
    const finMois = new Date(Date.UTC(annee, mois, 0));
    const offset = (debutMois.getUTCDay() + 6) % 7;
    const nbCases = Math.ceil((offset + finMois.getUTCDate()) / 7) * 7;
    cases = Array.from({ length: nbCases }, (_, i) => {
      const d = new Date(debutMois);
      d.setUTCDate(1 - offset + i);
      return d;
    });
    titre = `${MOIS_LONG[mois - 1]} ${annee}`;
    const mp = mois === 1 ? { m: 12, a: annee - 1 } : { m: mois - 1, a: annee };
    const ms = mois === 12 ? { m: 1, a: annee + 1 } : { m: mois + 1, a: annee };
    navPrec = `cal=mois&mois=${mp.m}&annee=${mp.a}`;
    navSuiv = `cal=mois&mois=${ms.m}&annee=${ms.a}`;
    navAuj = `cal=mois`;
  }

  const base = "/conges?vue=calendrier";

  const debutRange = cases[0];
  const finRange = cases[cases.length - 1];
  const debutAnnee = new Date(Date.UTC(annee, 0, 1));
  const finAnnee = new Date(Date.UTC(annee, 11, 31));

  const [employees, demandesRange, demandesAnnee, feries, feriesAnnee, params] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
    }),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: finRange }, dateFin: { gte: debutRange } },
      include: { employee: { select: { id: true, nom: true } } },
      orderBy: { dateDebut: "asc" },
    }),
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: finAnnee }, dateFin: { gte: debutAnnee } },
    }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutRange, lte: finRange } } }),
    prisma.jourFerie.findMany({ where: { date: { gte: debutAnnee, lte: finAnnee } }, select: { date: true } }),
    chargerParametresPaie(),
  ]);

  const feriesIso = new Set(feries.map((f) => isoJour(new Date(f.date))));

  // Options de filtres + application (type d'absence, employé).
  const typeOptions = Array.from(new Set(demandesAnnee.map((d) => d.type))).sort();
  const demandesAff = demandesRange.filter(
    (d) => (!filtreType || d.type === filtreType) && (!filtreEmp || d.employeeId === filtreEmp)
  );
  const employeesAff = filtreEmp ? employees.filter((e) => e.id === filtreEmp) : employees;

  // absents par jour ISO (borné à la période affichée)
  const absentsParJour = new Map<string, { nom: string; type: string }[]>();
  for (const d of demandesAff) {
    let cur = new Date(Math.max(new Date(d.dateDebut).getTime(), debutRange.getTime()));
    const fin = new Date(Math.min(new Date(d.dateFin).getTime(), finRange.getTime()));
    while (cur <= fin) {
      const iso = isoJour(cur);
      (absentsParJour.get(iso) ?? absentsParJour.set(iso, []).get(iso)!).push({
        nom: d.employee.nom,
        type: d.type,
      });
      cur = new Date(cur.getTime() + 86_400_000);
    }
  }

  // --- Soldes annuels (conservés sous le calendrier) ---
  const congesAnnuelsParEmp = new Map<string, number>();
  for (const d of demandesAnnee) {
    if (!congeDeductibleDuSolde(d.type)) continue;
    const debut = new Date(Math.max(new Date(d.dateDebut).getTime(), debutAnnee.getTime()));
    const fin = new Date(Math.min(new Date(d.dateFin).getTime(), finAnnee.getTime()));
    if (debut > fin) continue;
    congesAnnuelsParEmp.set(
      d.employeeId,
      (congesAnnuelsParEmp.get(d.employeeId) ?? 0) + calculerJoursOuvrables(debut, fin, feriesAnnee.map((f) => f.date))
    );
  }

  const typesPresents = Array.from(new Set(demandesAff.map((d) => d.type))).sort();
  const isoAuj = isoJour(new Date(Date.UTC(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate())));
  const filtresQS = `${filtreType ? `&type=${encodeURIComponent(filtreType)}` : ""}${filtreEmp ? `&emp=${filtreEmp}` : ""}`;
  const enMois = cal === "mois";
  const dansPeriode = (d: Date) => (enMois ? d.getUTCMonth() === mois - 1 : true);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Congés &amp; absences — Calendrier</h1>
          <p className="text-sm capitalize text-muted-foreground">{titre}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="flex overflow-hidden rounded-md border">
            <Link href="/conges" className="px-3 py-1.5 hover:bg-accent">Liste</Link>
            <span className="bg-primary px-3 py-1.5 font-medium text-primary-foreground">Calendrier</span>
          </div>
          <div className="flex overflow-hidden rounded-md border">
            <Link href={`${base}&cal=semaine${filtresQS}`} className={`px-3 py-1.5 ${cal === "semaine" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Semaine</Link>
            <Link href={`${base}&cal=mois${filtresQS}`} className={`px-3 py-1.5 ${cal === "mois" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Mois</Link>
          </div>
          <Link href={`${base}&${navPrec}${filtresQS}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">← Préc.</Link>
          <Link href={`${base}&${navAuj}${filtresQS}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">Aujourd&apos;hui</Link>
          <Link href={`${base}&${navSuiv}${filtresQS}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">Suiv. →</Link>
        </div>
      </div>

      {/* Filtres (type d'absence + employé) */}
      <form method="get" action="/conges" className="mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="vue" value="calendrier" />
        <input type="hidden" name="cal" value={cal} />
        {cal === "mois" ? (
          <>
            <input type="hidden" name="mois" value={mois} />
            <input type="hidden" name="annee" value={annee} />
          </>
        ) : (
          <input type="hidden" name="debut" value={isoJour(cases[0])} />
        )}
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Type d&apos;absence</span>
          <select name="type" defaultValue={filtreType} className="rounded-md border px-2.5 py-1.5 text-sm">
            <option value="">Tous les types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">Employé</span>
          <select name="emp" defaultValue={filtreEmp} className="rounded-md border px-2.5 py-1.5 text-sm">
            <option value="">Tous les employés</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          Filtrer
        </button>
        {(filtreType || filtreEmp) && (
          <Link href={`${base}&${navAuj}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Réinitialiser
          </Link>
        )}
      </form>

      {/* Légende (couleur + libellé) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(typesPresents.length > 0 ? typesPresents : typeOptions).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${styleType(t).point}`} aria-hidden />
            {t}
          </span>
        ))}
      </div>

      {/* Calendrier mensuel */}
      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-7 bg-muted/50 text-xs font-medium">
          {JOURS.map((j) => (
            <div key={j} className="px-2 py-2 text-center">
              {j}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cases.map((d, i) => {
            const iso = isoJour(d);
            const dansLeMois = dansPeriode(d);
            const dimanche = d.getUTCDay() === 0;
            const ferie = feriesIso.has(iso);
            const absents = absentsParJour.get(iso) ?? [];
            const estAuj = iso === isoAuj;
            return (
              <div
                key={i}
                className={`min-h-24 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0 ${
                  !dansLeMois ? "bg-muted/30 text-muted-foreground/50" : dimanche || ferie ? "bg-orange-50" : "bg-background"
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${
                      estAuj ? "bg-primary font-semibold text-primary-foreground" : "font-medium"
                    }`}
                  >
                    {d.getUTCDate()}
                  </span>
                  {ferie && dansLeMois && <span className="text-[9px] uppercase text-orange-600">Férié</span>}
                </div>
                <div className="space-y-0.5">
                  {absents.slice(0, 4).map((a, k) => (
                    <div
                      key={k}
                      className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${styleType(a.type).chip}`}
                      title={`${a.nom} — ${a.type}`}
                    >
                      {a.nom}
                    </div>
                  ))}
                  {absents.length > 4 && (
                    <div className="px-1 text-[10px] text-muted-foreground">+{absents.length - 4} autre(s)</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Soldes de congés annuels */}
      <h2 className="mb-2 mt-8 text-base font-semibold">Soldes de congés — {annee}</h2>
      <div className="max-h-[70vh] overflow-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Employé</th>
              <th className="px-3 py-2 text-center">Droits acquis</th>
              <th className="px-3 py-2 text-center">Congés pris (décomptés)</th>
              <th className="px-3 py-2 text-center">Solde</th>
            </tr>
          </thead>
          <tbody>
            {employeesAff.map((e) => {
              const anciennete = moisEntre(new Date(e.dateEmbauche), maintenant);
              const droits = calculerCongesAcquis(anciennete, params.droitsCongesAnnuel);
              const pris = congesAnnuelsParEmp.get(e.id) ?? 0;
              const solde = droits - pris;
              return (
                <tr key={e.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <Link href={`/employes/${e.id}`} className="flex items-center gap-2 hover:text-primary hover:underline">
                      <Avatar nom={e.nom} taille={26} photoUrl={e.photoUrl} />
                      {e.nom}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-center">{droits} j</td>
                  <td className="px-3 py-1.5 text-center">{pris} j</td>
                  <td className={`px-3 py-1.5 text-center font-semibold ${solde < 0 ? "text-red-700" : "text-foreground"}`}>
                    {solde} j
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Source : demandes de congé <span className="font-medium">approuvées</span>. Solde = droits acquis
        selon l&apos;ancienneté − congés décomptés sur l&apos;année (maternité, maladie, accident du
        travail et arrivée d&apos;un enfant ne sont pas déduits). Les droits légaux restent à valider
        par un comptable. Colonne orange = dimanche ou jour férié.
      </p>
    </div>
  );
}
