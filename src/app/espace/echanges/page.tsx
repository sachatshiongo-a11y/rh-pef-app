import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { lundiDe } from "@/lib/dates-fr";
import { Icone } from "@/components/icones";
import { demanderEchange, demanderChangementShift } from "../actions";
import { RepondreEchange, AnnulerEchange, AnnulerChangement } from "./boutons";
import { statutDemande } from "@/lib/libelles-espace";

const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);
const jour = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const jourCourt = (d: Date) => new Date(d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const inputCls = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm";

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
        <h1 className="text-xl font-semibold">Échanger un shift</h1>
        <p className="text-sm text-muted-foreground">Donnez un de vos shifts à un collègue contre l&apos;un des siens, ou demandez à la Direction un autre horaire.</p>
      </div>

      {sp.propose && <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Proposition envoyée. L&apos;échange se fera quand votre collègue ET la Direction auront accepté.</p>}
      {sp.echange && <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Demande envoyée à la Direction. Vous serez prévenu(e) de sa réponse.</p>}
      {sp.erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>}

      {/* Demandes reçues (je suis le collègue concerné) */}
      {recus.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Icone nom="echanges" className="shrink-0 text-amber-700" /> À vous de répondre ({recus.length})</h2>
          <ul className="space-y-2">
            {recus.map((e) => (
              <li key={e.id} className="space-y-3 rounded-xl border bg-card p-3">
                <p className="text-sm font-medium">{e.demandeur.nom} vous propose un échange</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Vous donnez</dt>
                  <dd><b>{shiftNom.get(e.collegueShiftId) ?? "shift"}</b> · {jour(e.collegueDate)}</dd>
                  <dt className="text-muted-foreground">Vous recevez</dt>
                  <dd><b>{shiftNom.get(e.demandeurShiftId) ?? "shift"}</b> · {jour(e.demandeurDate)}</dd>
                  {e.motif && (<><dt className="text-muted-foreground">Motif</dt><dd>{e.motif}</dd></>)}
                </dl>
                <RepondreEchange id={e.id} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">L&apos;échange n&apos;a lieu que si vous ET la Direction acceptez.</p>
        </div>
      )}

      {/* Échanger avec un collègue */}
      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Icone nom="echanges" className="shrink-0 text-primary" /> Échanger avec un collègue</h2>
        <p className="mb-3 text-sm text-muted-foreground">Vous donnez un de vos shifts et prenez celui d&apos;un collègue. Votre collègue puis la Direction doivent accepter.</p>
        {mesEligibles.length === 0 || ciblesCollegues.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {mesEligibles.length === 0 ? "Vous n'avez aucun shift à venir dans un planning publié." : "Aucun collègue de votre poste n'a de shift à échanger pour le moment."}
          </p>
        ) : (
          <form action={demanderEchange} className="grid gap-4 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Le shift que je donne
              <select name="date" required className={inputCls}>
                {mesEligibles.map((c) => (
                  <option key={iso(c.date)} value={iso(c.date)}>{jourCourt(c.date)} — {shiftNom.get(c.shiftId) ?? "shift"}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Le shift que je prends
              <select name="cible" required className={inputCls}>
                {ciblesCollegues.map((c) => (
                  <option key={`${c.employeeId}__${iso(c.date)}`} value={`${c.employeeId}__${iso(c.date)}`}>
                    {c.employee.nom}{c.employee.poste !== emp.poste ? ` (${c.employee.poste})` : ""} — {jourCourt(c.date)} — {shiftNom.get(c.shiftId) ?? "shift"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2"><span>Motif <span className="font-normal text-muted-foreground">(facultatif)</span></span>
              <input type="text" name="motif" placeholder="ex. contrainte personnelle" className={inputCls} />
            </label>
            <div className="sm:col-span-2">
              <button className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground sm:w-auto sm:py-2">Proposer l&apos;échange</button>
            </div>
          </form>
        )}
      </div>

      {/* Changer mon shift (sans échange, → Direction seule) */}
      <details className="group rounded-2xl border bg-card">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 text-base font-semibold [&::-webkit-details-marker]:hidden">
          <span className="flex-1">Demander un autre horaire à la Direction <span className="block text-sm font-normal text-muted-foreground">Sans passer par un collègue</span></span>
          <Icone nom="chevronDroit" className="shrink-0 text-muted-foreground transition group-open:rotate-90" />
        </summary>
        <div className="border-t p-5">
          {mesEligibles.length === 0 || shiftsCibles.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Aucun service à venir ou aucun shift alternatif pour votre poste.</p>
          ) : (
            <form action={demanderChangementShift} className="grid gap-4 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Jour concerné
                <select name="date" required className={inputCls}>
                  {mesEligibles.map((c) => (<option key={iso(c.date)} value={iso(c.date)}>{jourCourt(c.date)} — actuellement {shiftNom.get(c.shiftId) ?? "shift"}</option>))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">Horaire souhaité
                <select name="shiftDemandeId" required className={inputCls}>
                  {shiftsCibles.map((sh) => (<option key={sh.id} value={sh.id}>{sh.nom}{sh.heureDebut && sh.heureFin ? ` (${sh.heureDebut}–${sh.heureFin})` : ""}</option>))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:col-span-2"><span>Motif <span className="font-normal text-muted-foreground">(facultatif)</span></span>
                <input type="text" name="motif" placeholder="ex. contrainte personnelle" className={inputCls} />
              </label>
              <div className="sm:col-span-2">
                <button className="w-full rounded-md border px-4 py-3 text-sm font-medium hover:bg-accent sm:w-auto sm:py-2">Envoyer la demande</button>
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
              const b = statutDemande(e.statut);
              const attenteCollegue = e.statut === "EN_ATTENTE" && e.reponseCollegue === "EN_ATTENTE";
              const attenteDir = e.statut === "EN_ATTENTE" && e.reponseDirection === "EN_ATTENTE";
              return (
                <li key={e.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">Échange avec {e.collegue.nom}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted-foreground">Je donne</dt>
                    <dd>{shiftNom.get(e.demandeurShiftId) ?? "—"} · {jourCourt(e.demandeurDate)}</dd>
                    <dt className="text-muted-foreground">Je prends</dt>
                    <dd>{shiftNom.get(e.collegueShiftId) ?? "—"} · {jourCourt(e.collegueDate)}</dd>
                  </dl>
                  {e.statut === "EN_ATTENTE" && (
                    <p className="text-xs text-muted-foreground">
                      {attenteCollegue ? "Votre collègue n'a pas encore répondu" : "Votre collègue a accepté"} ·{" "}
                      {attenteDir ? "la Direction n'a pas encore répondu" : "la Direction a accepté"}
                    </p>
                  )}
                  {e.statut === "EN_ATTENTE" && <AnnulerEchange id={e.id} />}
                </li>
              );
            })}
            {mesChangements.map((d) => {
              const b = statutDemande(d.statut);
              return (
                <li key={d.id} className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">Autre horaire demandé</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${b.classe}`}>{b.label}</span>
                  </div>
                  <p className="text-sm">
                    {jourCourt(d.date)} → <b>{shiftNom.get(d.shiftDemandeId) ?? "—"}</b>
                    {d.motif ? <span className="text-muted-foreground"> · {d.motif}</span> : null}
                  </p>
                  {d.statut === "EN_ATTENTE" && <AnnulerChangement id={d.id} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
