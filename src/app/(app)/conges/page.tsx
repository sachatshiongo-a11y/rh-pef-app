import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { demanderConge, approuverConge, refuserConge, reinitialiserConges } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { BTN_VALIDER, BTN_REFUSER } from "@/components/action-buttons";


const COULEUR_CONGE: Record<string, string> = {
  APPROUVE: "bg-green-100 text-green-800",
  REFUSE: "bg-red-100 text-red-800",
  EN_ATTENTE: "bg-amber-100 text-amber-800",
};

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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Congés</h1>
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

      {peutGerer && (
        <div className="mb-8 rounded-lg border p-5">
          <h2 className="mb-4 text-base font-semibold">Nouvelle demande de congé</h2>
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Employé</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Début</th>
              <th className="px-3 py-2">Fin</th>
              <th className="px-3 py-2 text-right">Jours</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2">Approuvé par</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {demandes.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-3 py-2">
                  <Link href={`/employes/${d.employee.id}`} className="text-primary underline">
                    {d.employee.nom}
                  </Link>
                </td>
                <td className="px-3 py-2">{d.type}</td>
                <td className="px-3 py-2">{new Date(d.dateDebut).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-2">{new Date(d.dateFin).toLocaleDateString("fr-FR")}</td>
                <td className="px-3 py-2 text-right">{Number(d.nbJours)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_CONGE[d.statut] ?? ""}`}>
                    {d.statut.replace("_", " ")}
                  </span>
                </td>
                <td className="px-3 py-2">{d.approuvePar?.nom ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {peutApprouver && d.statut === "EN_ATTENTE" && (
                      <>
                        <form action={approuverConge.bind(null, d.id)} className="inline">
                          <button type="submit" className={BTN_VALIDER}>
                            ✓ Approuver
                          </button>
                        </form>
                        <form action={refuserConge.bind(null, d.id)} className="inline">
                          <button type="submit" className={BTN_REFUSER}>
                            ✕ Refuser
                          </button>
                        </form>
                      </>
                    )}
                    <a
                      href={`/conges/demande/${d.id}`}
                      target="_blank"
                      className="text-primary underline"
                    >
                      PDF
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {demandes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Aucune demande de congé enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
