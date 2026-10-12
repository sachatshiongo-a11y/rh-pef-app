import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { BoutonRapport } from "@/app/(stock)/stock/_rapport/bouton-rapport";
import { chargerParametresPaie } from "@/lib/config";
import { GrilleTransport } from "@/app/(app)/transport/_grille";
import { filtrerEmployes, statutEmployes, whereStatutEmployes } from "./_donnees";
import type { Employee } from "@prisma/client";
import { ListeEmployes, type LigneEmploye } from "./employes-liste";
import { exigerPageRH } from "@/lib/garde-page";
import { doublonsProbables } from "@/lib/employe-doublon";
import { chargerFichesIdentite, chargerPairesEcartees } from "@/lib/employe-doublon-serveur";
import { DoublonsProbables } from "./doublons-probables";
import { CreationsEnAttente } from "./creations-en-attente";
import { creationsEnAttente } from "@/lib/creation-fiche";
import { Pagination } from "@/components/pagination";
import { fenetrePage, lirePagination, PAR_DEFAUT, tranche } from "@/lib/pagination";
import { OngletsDefilants } from "@/components/onglets-defilants";

/** Ce que la liste (composant client) reçoit d'un employé : des nombres et des textes, ni Decimal ni Date. */
const versLigne = (e: Employee): LigneEmploye => ({
  id: e.id, matricule: e.matricule, nom: e.nom, photoUrl: e.photoUrl, poste: e.poste, secteur: e.secteur,
  salaireMensuel: Number(e.salaireMensuel), heuresHebdomadaires: Number(e.heuresHebdomadaires), contrat: e.contrat, actif: e.actif,
});

export default async function EmployesPage({
  searchParams,
}: {
  searchParams: Promise<{ creation?: string; poste?: string; secteur?: string; annee?: string; q?: string; vue?: string; statut?: string; page?: string; par?: string }>;
}) {
  const user = await exigerPageRH();
  const sp = await searchParams;
  const peutModifier = user.role === "ADMIN" || user.role === "MANAGER";
  // Doublons probables déjà en base : encadré réservé à la Direction (toutes les fiches, actives et inactives).
  const estDirection = user.role === "ADMIN";
  const vue = sp.vue === "transport" ? "transport" : "rh";
  // Actifs par défaut ; « inactifs » = ex-employés (fin de contrat) ; « tous » = registre complet.
  const statut = statutEmployes(sp.statut);
  const whereActif = whereStatutEmployes(statut);

  const [tous, parametres, identites, ecartees, creations] = await Promise.all([
    prisma.employee.findMany({ where: whereActif, orderBy: [{ nom: "asc" }, { id: "asc" }] }),
    vue === "transport" ? chargerParametresPaie() : Promise.resolve(null),
    estDirection ? chargerFichesIdentite() : Promise.resolve([]),
    estDirection ? chargerPairesEcartees() : Promise.resolve(new Set<string>()),
    creationsEnAttente(),
  ]);
  const paires = estDirection ? doublonsProbables(identites, ecartees) : [];

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
  if (statut !== "actifs") qsExport.set("statut", statut);
  const suffixeExport = qsExport.toString() ? `?${qsExport}` : "";

  const employes = filtrerEmployes(tous, qsExport);
  const brigade = employes.filter((e) => e.categorie === "BRIGADE");
  const backoffice = employes.filter((e) => e.categorie === "BACKOFFICE");
  // Pagination (50 / 100 / Tout) de la fiche RH : une seule suite « Brigade puis Back-office » découpée en pages ;
  // les titres gardent le total de chaque section sur tout le filtre. (La vue Transport, elle, a des totaux : pas de pages.)
  const { page, par } = lirePagination(sp);
  const suiteRH = [...brigade, ...backoffice];
  const fen = fenetrePage(suiteRH.length, page, par);
  const surLaPage = new Set(tranche(suiteRH, fen).map((e) => e.id));
  const brigadeP = brigade.filter((e) => surLaPage.has(e.id));
  const backofficeP = backoffice.filter((e) => surLaPage.has(e.id));
  const suffixeTaille = par !== PAR_DEFAUT ? `par=${par}` : ""; // la taille de page suit les liens de statut et de vue
  const filtreActif = Boolean(sp.q || sp.poste || sp.secteur || sp.annee);
  const labelStatut = statut === "inactifs" ? "inactif(s)" : statut === "tous" ? "au total" : "actif(s)";
  // Lien conservant les filtres courants mais changeant le statut (Actifs / Inactifs / Tous).
  const lienStatut = (st: string) => {
    const p = new URLSearchParams(qsExport);
    if (st === "actifs") p.delete("statut"); else p.set("statut", st);
    if (vue === "transport") p.set("vue", "transport");
    else if (suffixeTaille) p.set("par", String(par));
    return `/employes${p.toString() ? `?${p}` : ""}`;
  };
  // L'export « Exporter ▾ » cible la vue active (RH ou Transport), en conservant les filtres.
  const baseExport = vue === "transport" ? "/transport" : "/employes";
  // Bascule de vue en gardant les filtres.
  const lienVue = (v: string) => {
    const p = new URLSearchParams(qsExport);
    if (v !== "rh") p.set("vue", v);
    else if (suffixeTaille) p.set("par", String(par));
    return `/employes${p.toString() ? `?${p}` : ""}`;
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Employés</h1>
          <p className="text-sm text-muted-foreground">
            {employes.length} {labelStatut}{filtreActif ? ` (filtré sur ${tous.length})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BoutonRapport pdfHref={`${baseExport}/pdf${suffixeExport}`} excelHref={`${baseExport}/export${suffixeExport}`} />
          {peutModifier && (
            <Link href="/employes/nouveau" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              + Nouvel employé
            </Link>
          )}
        </div>
      </div>

      {/* Vues : Fiche RH / Transport (mêmes filtres et recherche partagés) — le segment commun, sous le titre. */}
      <div className="mb-4">
        <OngletsDefilants
          libelle="Vues des employés"
          onglets={[
            { href: lienVue("rh"), label: "Fiche RH", actif: vue === "rh" },
            { href: lienVue("transport"), label: "Transport", actif: vue === "transport" },
          ]}
        />
      </div>

      {sp.creation === "envoyee" && (
        <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          La nouvelle fiche a été envoyée à la Direction pour validation : elle sera créée dès qu&apos;elle l&apos;aura approuvée.
        </p>
      )}
      <CreationsEnAttente creations={creations} estDirection={estDirection} />
      {estDirection && <DoublonsProbables paires={paires} />}

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
        {vue !== "transport" && suffixeTaille && <input type="hidden" name="par" value={par} />}
        {statut !== "actifs" && <input type="hidden" name="statut" value={statut} />}
        {filtreActif && (
          <Link href={lienStatut(statut)} className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent">
            Réinitialiser
          </Link>
        )}
      </form>

      {/* Statut : Actifs / Inactifs (ex-employés, fin de contrat) / Tous — registre complet. */}
      <div className="mb-3 flex flex-wrap gap-1.5 text-sm">
        {([["actifs", "Actifs"], ["inactifs", "Inactifs"], ["tous", "Tous"]] as const).map(([st, label]) => (
          <Link key={st} href={lienStatut(st)} className={`rounded-full border px-3 py-1 ${statut === st ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</Link>
        ))}
      </div>

      {vue === "transport" ? (
        <GrilleTransport employes={employes} jours={parametres!.joursOuvrablesMois} taux={parametres!.tauxChangeCDF} />
      ) : (
        <>
          <ListeEmployes
            brigade={brigadeP.map(versLigne)} backoffice={backofficeP.map(versLigne)}
            totalBrigade={brigade.length} totalBackoffice={backoffice.length}
            statut={statut} peutModifier={peutModifier}
          />

          <Pagination className="mt-6" total={suiteRH.length} page={fen.page} par={par} chemin="/employes" params={sp} libelle="employés" />
        </>
      )}
    </div>
  );
}
