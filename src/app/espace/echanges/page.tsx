import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { lundiDe } from "@/lib/dates-fr";
import { Icone } from "@/components/icones";
import { demanderEchange, demanderChangementShift } from "../actions";
import { RepondreEchange, AnnulerEchange, AnnulerChangement } from "./boutons";

const BADGE: Record<string, { label: string; classe: string }> = {
  EN_ATTENTE: { label: "En attente", classe: "bg-amber-100 text-amber-800" },
  APPROUVE: { label: "Approuvé", classe: "bg-emerald-100 text-emerald-800" },
  REFUSE: { label: "Refusé", classe: "bg-red-100 text-red-800" },
  ANNULE: { label: "Annulé", classe: "bg-muted text-muted-foreground" },
};
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const jour = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const jourCourt = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm";

export default async function EspaceEchanges({ searchParams }: { searchParams: Promise<{ propose?: string; echange?: string; erreur?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;

  const k = new Date(Date.now() + 3_600_000);
  const today = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const lundiCourant = lundiDe(k);
  const fin = new Date(lundiCourant); fin.setUTCDate(fin.getUTCDate() + 27); // 4 semaines

  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: s.employeeId }, select: { poste: true } });
  const [publiees, mesCreneaux, creneauxCollegues, shiftsActifs, besoins, polyvalences, recus, mesEchanges, mesChangements] = await Promise.all([
    prisma.semainePubliee.findMany({ where: { lundi: { gte: lundiCourant, lte: fin } }, select: { lundi: true } }),
    prisma.planningCreneau.findMany({ where: { employeeId: s.employeeId, date: { gte: today, lte: fin } }, select: { date: true, shiftId: true } }),
    prisma.planningCreneau.findMany({
      where: { date: { gte: today, lte: fin }, employeeId: { not: s.employeeId } },
      select: { employeeId: true, date: true, shiftId: true, employee: { select: { nom: true, poste: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.shift.findMany({ where: { actif: true, systeme: false }, orderBy: { ordre: "asc" }, select: { id: true, nom: true, heureDebut: true, heureFin: true } }),
    prisma.besoinShift.findMany({ where: { poste: emp.poste }, select: { shiftId: true } }),
    // Postes qui PEUVENT COUVRIR le mien (polyvalence : posteSource couvre posteCible) → cibles élargies.
    prisma.polyvalencePoste.findMany({ where: { posteCible: emp.poste }, select: { posteSource: true } }),
    prisma.echangeCreneau.findMany({ where: { collegueId: s.employeeId, statut: "EN_ATTENTE" }, orderBy: { createdAt: "desc" }, include: { demandeur: { select: { nom: true } } } }),
    prisma.echangeCreneau.findMany({ where: { demandeurId: s.employeeId }, orderBy: { createdAt: "desc" }, take: 15, include: { collegue: { select: { nom: true } } } }),
    prisma.demandeChangementShift.findMany({ where: { employeeId: s.employeeId }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const publieeSet = new Set(publiees.map((p) => iso(p.lundi)));
  const estPubliee = (d: Date) => publieeSet.has(iso(lundiDe(new Date(d))));
  const shiftNom = new Map(shiftsActifs.map((sh) => [sh.id, sh.nom]));
  const idsBesoin = new Set(besoins.map((b) => b.shiftId));
  const shiftsCibles = shiftsActifs.filter((sh) => idsBesoin.size === 0 || idsBesoin.has(sh.id));

  // Mes créneaux publiés à venir (jours que je peux céder).
  const mesEligibles = mesCreneaux.filter((c) => estPubliee(c.date)).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  // Cibles d'échange = collègues dont le poste PEUT COUVRIR le mien (même poste ou polyvalence),
  // sur un service publié à venir. On montre QUI l'effectue et son poste.
  const postesCouvrants = new Set([emp.poste, ...polyvalences.map((p) => p.posteSource)]);
  const ciblesCollegues = creneauxCollegues
    .filter((c) => postesCouvrants.has(c.employee.poste) && estPubliee(c.date))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Échanges de shift</h1>
        <p className="text-sm text-muted-foreground">Échangez un service avec un collègue, ou demandez à changer votre shift.</p>
      </div>

      {sp.propose && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Proposition envoyée au collègue et à la Direction.</p>}
      {sp.echange && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Demande de changement envoyée à la Direction.</p>}
      {sp.erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      {/* Demandes reçues (je suis le collègue concerné) */}
      {recus.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Icone nom="echanges" className="shrink-0 text-amber-700" /> Propositions à valider ({recus.length})</h2>
          <ul className="space-y-2">
            {recus.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.demandeur.nom} propose un échange</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    Il/elle prend votre <b className="text-foreground">{shiftNom.get(e.collegueShiftId) ?? "shift"}</b> du {jour(e.collegueDate)} ·
                    vous prenez son <b className="text-foreground">{shiftNom.get(e.demandeurShiftId) ?? "shift"}</b> du {jour(e.demandeurDate)}
                    {e.motif ? ` · ${e.motif}` : ""}
                  </p>
                </div>
                <RepondreEchange id={e.id} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">L&apos;échange n&apos;a lieu que si vous ET la Direction acceptez.</p>
        </div>
      )}

      {/* Échanger avec un collègue */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Icone nom="echanges" className="shrink-0 text-primary" /> Échanger un service avec un collègue</h2>
        <p className="mb-3 text-sm text-muted-foreground">Cédez l&apos;un de vos services et prenez celui d&apos;un collègue. Le collègue et la Direction doivent accepter.</p>
        {mesEligibles.length === 0 || ciblesCollegues.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {mesEligibles.length === 0 ? "Vous n'avez aucun service publié à venir à échanger." : "Aucun service de collègue disponible à l'échange pour votre poste."}
          </p>
        ) : (
          <form action={demanderEchange} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">Mon service à céder
              <select name="date" required className={inputCls}>
                {mesEligibles.map((c) => (
                  <option key={iso(c.date)} value={iso(c.date)}>{jourCourt(c.date)} — {shiftNom.get(c.shiftId) ?? "shift"}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">Service du collègue souhaité
              <select name="cible" required className={inputCls}>
                {ciblesCollegues.map((c) => (
                  <option key={`${c.employeeId}__${iso(c.date)}`} value={`${c.employeeId}__${iso(c.date)}`}>
                    {c.employee.nom}{c.employee.poste !== emp.poste ? ` (${c.employee.poste})` : ""} — {jourCourt(c.date)} — {shiftNom.get(c.shiftId) ?? "shift"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">Motif (facultatif)
              <input type="text" name="motif" placeholder="ex. contrainte personnelle" className={inputCls} />
            </label>
            <div className="sm:col-span-2">
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Proposer l&apos;échange</button>
            </div>
          </form>
        )}
      </div>

      {/* Changer mon shift (sans échange, → Direction seule) */}
      <details className="rounded-2xl border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-base font-semibold">Ou simplement changer mon shift (sans collègue)</summary>
        <div className="border-t p-5">
          {mesEligibles.length === 0 || shiftsCibles.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Aucun service à venir ou aucun shift alternatif pour votre poste.</p>
          ) : (
            <form action={demanderChangementShift} className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">Jour concerné
                <select name="date" required className={inputCls}>
                  {mesEligibles.map((c) => (<option key={iso(c.date)} value={iso(c.date)}>{jourCourt(c.date)} — actuellement {shiftNom.get(c.shiftId) ?? "shift"}</option>))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">Shift souhaité
                <select name="shiftDemandeId" required className={inputCls}>
                  {shiftsCibles.map((sh) => (<option key={sh.id} value={sh.id}>{sh.nom}{sh.heureDebut && sh.heureFin ? ` (${sh.heureDebut}–${sh.heureFin})` : ""}</option>))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">Motif (facultatif)
                <input type="text" name="motif" placeholder="ex. contrainte personnelle" className={inputCls} />
              </label>
              <div className="sm:col-span-2">
                <button className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Demander le changement</button>
              </div>
            </form>
          )}
        </div>
      </details>

      {/* Mes demandes */}
      {(mesEchanges.length > 0 || mesChangements.length > 0) && (
        <div className="rounded-2xl border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold">Mes demandes</h2>
          <ul className="divide-y">
            {mesEchanges.map((e) => {
              const b = BADGE[e.statut] ?? BADGE.EN_ATTENTE;
              const attenteCollegue = e.statut === "EN_ATTENTE" && e.reponseCollegue === "EN_ATTENTE";
              const attenteDir = e.statut === "EN_ATTENTE" && e.reponseDirection === "EN_ATTENTE";
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Échange avec {e.collegue.nom}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      Je cède {jourCourt(e.demandeurDate)} ({shiftNom.get(e.demandeurShiftId) ?? "—"}) · je prends {jourCourt(e.collegueDate)} ({shiftNom.get(e.collegueShiftId) ?? "—"})
                    </p>
                    {e.statut === "EN_ATTENTE" && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {attenteCollegue ? "En attente du collègue" : "Collègue : accepté"} · {attenteDir ? "en attente de la Direction" : "Direction : approuvé"}
                      </p>
                    )}
                  </div>
                  <span className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                    {e.statut === "EN_ATTENTE" && <AnnulerEchange id={e.id} />}
                  </span>
                </li>
              );
            })}
            {mesChangements.map((d) => {
              const b = BADGE[d.statut] ?? BADGE.EN_ATTENTE;
              return (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Changement de shift</p>
                    <p className="text-xs text-muted-foreground capitalize">{jourCourt(d.date)} → {shiftNom.get(d.shiftDemandeId) ?? "—"}{d.motif ? ` · ${d.motif}` : ""}</p>
                  </div>
                  <span className="flex items-center gap-2">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                    {d.statut === "EN_ATTENTE" && <AnnulerChangement id={d.id} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
