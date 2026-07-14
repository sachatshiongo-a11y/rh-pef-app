import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { Avatar } from "@/components/avatar";
import { BoutonRapport } from "@/app/(stock)/stock/_rapport/bouton-rapport";
import { chargerParametresPaie } from "@/lib/config";
import { GrilleTransport } from "@/app/(app)/transport/_grille";
import { filtrerEmployes } from "./_donnees";
import type { Employee } from "@prisma/client";

function formatMoney(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function EmployesPage({
  searchParams,
}: {
  searchParams: Promise<{ poste?: string; secteur?: string; annee?: string; q?: string; vue?: string }>;
}) {
  const user = await verifySession();
  const sp = await searchParams;
  const peutModifier = user.role === "ADMIN" || user.role === "MANAGER";
  const vue = sp.vue === "transport" ? "transport" : "rh";

  const [tous, parametres] = await Promise.all([
    prisma.employee.findMany({ where: { actif: true }, orderBy: { nom: "asc" } }),
    vue === "transport" ? chargerParametresPaie() : Promise.resolve(null),
  ]);

  // Options de filtre dérivées de l'ensemble (stables quel que soit le filtre courant).
  const postes = [...new Set(tous.map((e) => e.poste))].sort();
  const secteurs = [...new Set(tous.map((e) => e.secteur))].sort();
  const annees = [...new Set(tous.map((e) => new Date(e.dateEmbauche).getFullYear()))].sort((a, b) => b - a);

  // Filtres courants sous forme de query string : partagés entre l'affichage (filtrerEmployes,
  // MÊME logique que les exports — plus de duplication), les liens d'export et la bascule de vue.
  const qsExport = new URLSearchParams();
  if (sp.q) qsExport.set("q", sp.q);
  if (sp.poste) qsExport.set("poste", sp.poste);
  if (sp.secteur) qsExport.set("secteur", sp.secteur);
  if (sp.annee) qsExport.set("annee", sp.annee);
  const suffixeExport = qsExport.toString() ? `?${qsExport}` : "";

  const employes = filtrerEmployes(tous, qsExport);
  const brigade = employes.filter((e) => e.categorie === "BRIGADE");
  const backoffice = employes.filter((e) => e.categorie === "BACKOFFICE");
  const filtreActif = qsExport.toString() !== "";
  // L'export « Exporter ▾ » cible la vue active (RH ou Transport), en conservant les filtres.
  const baseExport = vue === "transport" ? "/transport" : "/employes";
  // Bascule de vue en gardant les filtres.
  const lienVue = (v: string) => {
    const p = new URLSearchParams(qsExport);
    if (v !== "rh") p.set("vue", v);
    return `/employes${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Employés</h1>
          <p className="text-sm text-muted-foreground">
            {employes.length} affiché(s){filtreActif ? ` sur ${tous.length}` : " actif(s)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BoutonRapport pdfHref={`${baseExport}/pdf${suffixeExport}`} pdfDownload excelHref={`${baseExport}/export${suffixeExport}`} />
          {peutModifier && (
            <Link href="/employes/nouveau" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              + Nouvel employé
            </Link>
          )}
        </div>
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
        {vue === "transport" && <input type="hidden" name="vue" value="transport" />}
        {filtreActif && (
          <Link href={vue === "transport" ? "/employes?vue=transport" : "/employes"} className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">
            Réinitialiser
          </Link>
        )}
      </form>

      {/* Bascule de vue : Fiche RH / Transport (mêmes filtres et recherche partagés). */}
      <div className="mb-5 flex flex-wrap gap-1.5 text-sm">
        <Link href={lienVue("rh")} className={`rounded-full border px-3 py-1 ${vue === "rh" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Fiche RH</Link>
        <Link href={lienVue("transport")} className={`rounded-full border px-3 py-1 ${vue === "transport" ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>Transport</Link>
      </div>

      {vue === "transport" ? (
        <GrilleTransport employes={employes} jours={parametres!.joursOuvrablesMois} taux={parametres!.tauxChangeCDF} />
      ) : (
        <>
          <div className="mb-8">
            <h2 className="mb-3 text-base font-semibold">
              Brigade <span className="font-normal text-muted-foreground">({brigade.length})</span>
            </h2>
            <EmployeeTable employes={brigade} peutModifier={peutModifier} />
          </div>

          <div>
            <h2 className="mb-3 text-base font-semibold">
              Back-office <span className="font-normal text-muted-foreground">({backoffice.length})</span>
            </h2>
            <EmployeeTable employes={backoffice} peutModifier={peutModifier} />
          </div>
        </>
      )}
    </div>
  );
}

function EmployeeTable({ employes, peutModifier }: { employes: Employee[]; peutModifier: boolean }) {
  return (
    <>
      {/* Mobile : cartes tapables (toute la carte mène à la fiche). */}
      <div className="space-y-2 lg:hidden">
        {employes.map((e) => (
          <Link key={e.id} href={`/employes/${e.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 active:bg-accent">
            <Avatar nom={e.nom} taille={40} photoUrl={e.photoUrl} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{e.nom}</div>
              <div className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{e.matricule}</span> · {e.poste}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums">{formatMoney(Number(e.salaireMensuel))} $</div>
              <div className="text-[11px] text-muted-foreground">{Number(e.heuresHebdomadaires)} h/sem · {e.contrat}</div>
            </div>
          </Link>
        ))}
        {employes.length === 0 && (
          <EtatVide message="Aucun employé ne correspond." />
        )}
      </div>

      {/* Ordinateur : tableau détaillé. */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-lg border lg:block">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-left">
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
    </>
  );
}
