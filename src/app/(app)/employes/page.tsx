import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { Avatar } from "@/components/avatar";
import type { Employee } from "@prisma/client";

function formatMoney(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function EmployesPage({
  searchParams,
}: {
  searchParams: Promise<{ poste?: string; secteur?: string; annee?: string; q?: string }>;
}) {
  const user = await verifySession();
  const sp = await searchParams;
  const peutModifier = user.role === "ADMIN" || user.role === "MANAGER";

  const tous = await prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } });

  // Options de filtre dérivées de l'ensemble (stables quel que soit le filtre courant).
  const postes = [...new Set(tous.map((e) => e.poste))].sort();
  const secteurs = [...new Set(tous.map((e) => e.secteur))].sort();
  const annees = [...new Set(tous.map((e) => new Date(e.dateEmbauche).getFullYear()))].sort((a, b) => b - a);

  const q = (sp.q ?? "").trim().toLowerCase();
  const employes = tous.filter((e) => {
    if (sp.poste && e.poste !== sp.poste) return false;
    if (sp.secteur && e.secteur !== sp.secteur) return false;
    if (sp.annee && String(new Date(e.dateEmbauche).getFullYear()) !== sp.annee) return false;
    if (q && !e.nom.toLowerCase().includes(q) && !e.matricule.toLowerCase().includes(q)) return false;
    return true;
  });

  const brigade = employes.filter((e) => e.categorie === "BRIGADE");
  const backoffice = employes.filter((e) => e.categorie === "BACKOFFICE");
  const filtreActif = !!(sp.poste || sp.secteur || sp.annee || q);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Employés</h1>
          <p className="text-sm text-muted-foreground">
            {employes.length} affiché(s){filtreActif ? ` sur ${tous.length}` : " actif(s)"}
          </p>
        </div>
        {peutModifier && (
          <Link href="/employes/nouveau" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            + Nouvel employé
          </Link>
        )}
      </div>

      {/* Filtres */}
      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs">
          Recherche (nom / matricule)
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher…" className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Poste
          <select name="poste" defaultValue={sp.poste ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            {postes.map((p) => (<option key={p} value={p}>{p}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Secteur
          <select name="secteur" defaultValue={sp.secteur ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Tous</option>
            {secteurs.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Année d&apos;embauche
          <select name="annee" defaultValue={sp.annee ?? ""} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm">
            <option value="">Toutes</option>
            {annees.map((a) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">
          Filtrer
        </button>
        {filtreActif && (
          <Link href="/employes" className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">
            Réinitialiser
          </Link>
        )}
      </form>

      <div className="mb-8">
        <h2 className="mb-3 text-base font-semibold">
          Brigade <span className="font-normal text-muted-foreground">({brigade.length})</span>
        </h2>
        <EmployeeTable employes={brigade} peutModifier={peutModifier} />
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">
          Backoffice <span className="font-normal text-muted-foreground">({backoffice.length})</span>
        </h2>
        <EmployeeTable employes={backoffice} peutModifier={peutModifier} />
      </div>
    </div>
  );
}

function EmployeeTable({ employes, peutModifier }: { employes: Employee[]; peutModifier: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2">Matricule</th>
            <th className="px-3 py-2">Nom et prénom</th>
            <th className="px-3 py-2">Poste</th>
            <th className="px-3 py-2">Secteur</th>
            <th className="px-3 py-2 text-right">Salaire mensuel $</th>
            <th className="px-3 py-2 text-right">Heures hebdo.</th>
            <th className="px-3 py-2">Contrat</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {employes.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">{e.matricule}</td>
              <td className="px-3 py-2">
                <Link href={`/employes/${e.id}`} className="flex items-center gap-2 hover:underline">
                  <Avatar nom={e.nom} taille={28} photoUrl={e.photoUrl} />
                  <span className="text-primary">{e.nom}</span>
                </Link>
              </td>
              <td className="px-3 py-2">{e.poste}</td>
              <td className="px-3 py-2">{e.secteur}</td>
              <td className="px-3 py-2 text-right">{formatMoney(Number(e.salaireMensuel))}</td>
              <td className="px-3 py-2 text-right">{Number(e.heuresHebdomadaires)}</td>
              <td className="px-3 py-2">{e.contrat}</td>
              <td className="px-3 py-2 text-right">
                {peutModifier && (
                  <Link href={`/employes/${e.id}/modifier`} className="text-primary underline">Modifier</Link>
                )}
              </td>
            </tr>
          ))}
          {employes.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                Aucun employé ne correspond.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
