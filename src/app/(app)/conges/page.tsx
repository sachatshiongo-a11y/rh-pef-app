import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { demanderConge, approuverConge, refuserConge, reinitialiserConges } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { TelechargerLien } from "@/components/telecharger-lien";
import { BTN_VALIDER, BTN_REFUSER } from "@/components/action-buttons";
import { Avatar } from "@/components/avatar";

const COULEUR_CONGE: Record<string, string> = {
  APPROUVE: "bg-green-100 text-green-800",
  REFUSE: "bg-red-100 text-red-800",
  EN_ATTENTE: "bg-amber-100 text-amber-800",
};
const LIBELLE_CONGE: Record<string, string> = { APPROUVE: "Approuvé", REFUSE: "Refusé", EN_ATTENTE: "En attente" };
const BORDURE_CONGE: Record<string, string> = { APPROUVE: "border-l-emerald-400", REFUSE: "border-l-red-400", EN_ATTENTE: "border-l-amber-400" };
const MOIS_COURT = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛ", "SEP", "OCT", "NOV", "DÉC"];
function chipDate(dt: Date) {
  const x = new Date(dt);
  return { j: x.getUTCDate(), m: MOIS_COURT[x.getUTCMonth()] };
}

export default async function CongesPage({
  searchParams,
}: {
  searchParams: Promise<{ statut?: string; type?: string; q?: string }>;
}) {
  const user = await verifySession();
  const sp = await searchParams;
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const peutApprouver = user.role === "ADMIN";

  const [employees, demandesAll, typesConge] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
    prisma.leaveRequest.findMany({
      include: { employee: true, approuvePar: true },
      orderBy: { dateEnreg: "desc" },
      take: 300,
    }),
    prisma.typeConge.findMany({ where: { actif: true }, orderBy: { ordre: "asc" } }),
  ]);
  const TYPES_CONGE = typesConge.map((t) => t.nom);

  const typesPresents = [...new Set(demandesAll.map((d) => d.type))].sort();
  const q = (sp.q ?? "").trim().toLowerCase();
  const demandes = demandesAll.filter(
    (d) =>
      (!sp.statut || d.statut === sp.statut) &&
      (!sp.type || d.type === sp.type) &&
      (!q || d.employee.nom.toLowerCase().includes(q) || d.employee.matricule.toLowerCase().includes(q))
  );
  const filtreActif = !!(sp.statut || sp.type || q);

  const now = new Date();
  const nbAttente = demandesAll.filter((d) => d.statut === "EN_ATTENTE").length;
  const enCours = demandesAll.filter((d) => d.statut === "APPROUVE" && new Date(d.dateDebut) <= now && new Date(d.dateFin) >= now).length;
  const dans30 = new Date(now.getTime() + 30 * 86_400_000);
  const aVenir = demandesAll.filter((d) => d.statut === "APPROUVE" && new Date(d.dateDebut) > now && new Date(d.dateDebut) <= dans30).length;
  const nbApprouve = demandesAll.filter((d) => d.statut === "APPROUVE").length;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold sm:text-2xl">Congés &amp; absences</h1>
          <div className="flex overflow-hidden rounded-md border text-sm">
            <span className="bg-primary px-3 py-1.5 font-medium text-primary-foreground">Liste</span>
            <Link href="/absences" className="px-3 py-1.5 hover:bg-accent">Calendrier</Link>
          </div>
        </div>
        {peutApprouver && demandes.length > 0 && (
          <form action={reinitialiserConges}>
            <ConfirmSubmitButton
              message="Supprimer TOUTES les demandes de congé (journal complet) ? Cette action est irréversible."
              className="rounded-md border border-destructive px-4 py-2 text-sm font-medium text-destructive"
            >
              Réinitialiser les congés
            </ConfirmSubmitButton>
          </form>
        )}
      </div>

      {/* Synthèse façon Factorial */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "En attente", value: nbAttente, classe: "text-amber-600", lien: "?statut=EN_ATTENTE" },
          { label: "En congé aujourd'hui", value: enCours, classe: "text-emerald-600", lien: "?statut=APPROUVE" },
          { label: "À venir (30 j)", value: aVenir, classe: "text-sky-600", lien: "?statut=APPROUVE" },
          { label: "Approuvés (total)", value: nbApprouve, classe: "text-foreground", lien: "?statut=APPROUVE" },
        ].map((c) => (
          <Link key={c.label} href={`/conges${c.lien}`} className="rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`mt-1 text-xl font-bold sm:text-2xl ${c.classe}`}>{c.value}</p>
          </Link>
        ))}
      </div>

      {peutGerer && (
        <details className="mb-6 rounded-xl border">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">+ Nouvelle demande de congé</summary>
          <div className="border-t p-5">
          <form action={demanderConge} className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="employeeId" className="text-sm font-medium">
                Employé
              </label>
              <select
                id="employeeId"
                name="employeeId"
                required
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="type" className="text-sm font-medium">
                Type
              </label>
              <select
                id="type"
                name="type"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TYPES_CONGE.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dateDebut" className="text-sm font-medium">
                Date début
              </label>
              <input
                id="dateDebut"
                name="dateDebut"
                type="date"
                required
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dateFin" className="text-sm font-medium">
                Date fin
              </label>
              <input
                id="dateFin"
                name="dateFin"
                type="date"
                required
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="remplacantId" className="text-sm font-medium">
                Remplaçant(e)
              </label>
              <select
                id="remplacantId"
                name="remplacantId"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">— Aucun —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nom}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5 md:col-span-3">
              <label htmlFor="motif" className="text-sm font-medium">
                Motif (optionnel)
              </label>
              <input
                id="motif"
                name="motif"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="col-span-2 md:col-span-4">
              <button
                type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Enregistrer la demande
              </button>
            </div>
          </form>
          </div>
        </details>
      )}

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
        <label className="flex flex-col gap-1 text-xs">
          Recherche (nom / matricule)
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher…" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Statut
          <select name="statut" defaultValue={sp.statut ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            <option value="EN_ATTENTE">En attente</option>
            <option value="APPROUVE">Approuvé</option>
            <option value="REFUSE">Refusé</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Type
          <select name="type" defaultValue={sp.type ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            {typesPresents.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">Filtrer</button>
        {filtreActif && (
          <Link href="/conges" className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">Réinitialiser</Link>
        )}
      </form>

      {demandes.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucune demande de congé {filtreActif ? "pour ce filtre" : "enregistrée"}.
        </p>
      ) : (
        <div className="space-y-2">
          {demandes.map((d) => {
            const cd = chipDate(d.dateDebut);
            const cf = chipDate(d.dateFin);
            return (
              <div key={d.id} className={`flex flex-wrap items-center gap-3 rounded-xl border border-l-4 bg-card p-3 ${BORDURE_CONGE[d.statut] ?? ""}`}>
                <Avatar nom={d.employee.nom} photoUrl={d.employee.photoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <Link href={`/employes/${d.employee.id}`} className="font-semibold hover:underline">{d.employee.nom}</Link>{" "}
                    <span className="text-muted-foreground">— {d.type.toLowerCase()}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Number(d.nbJours)} jour(s){d.approuvePar ? ` · approuvé par ${d.approuvePar.nom}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-center rounded-lg border bg-background px-2 py-1 leading-none">
                    <span className="text-[9px] font-medium text-muted-foreground">{cd.m}</span>
                    <span className="text-sm font-semibold">{cd.j}</span>
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <div className="flex flex-col items-center rounded-lg border bg-background px-2 py-1 leading-none">
                    <span className="text-[9px] font-medium text-muted-foreground">{cf.m}</span>
                    <span className="text-sm font-semibold">{cf.j}</span>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_CONGE[d.statut] ?? ""}`}>
                  {LIBELLE_CONGE[d.statut] ?? d.statut}
                </span>
                <div className="flex items-center gap-2">
                  {peutApprouver && d.statut === "EN_ATTENTE" && (
                    <>
                      <form action={approuverConge.bind(null, d.id)} className="inline">
                        <button type="submit" className={BTN_VALIDER}>✓ Approuver</button>
                      </form>
                      <form action={refuserConge.bind(null, d.id)} className="inline">
                        <button type="submit" className={BTN_REFUSER}>✕ Refuser</button>
                      </form>
                    </>
                  )}
                  <TelechargerLien href={`/conges/demande/${d.id}`} className="text-sm text-primary underline">PDF</TelechargerLien>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
