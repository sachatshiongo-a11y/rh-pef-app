"use client";

import Link from "next/link";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonNeutre } from "@/components/action-buttons";
import { Avatar } from "@/components/avatar";
import { EtatVide } from "@/components/etat-vide";
import { TelechargerLien } from "@/components/telecharger-lien";
import { formaterNombre } from "@/lib/montant";
import { MAX_EXPORT_EMPLOYES, MESSAGE_EXPORT_EMPLOYES_TROP_GRAND } from "./_donnees";

/** Ce que la liste affiche d'un employé (déjà sérialisé : le serveur ne passe ni Decimal ni Date au client). */
export type LigneEmploye = {
  id: string; matricule: string; nom: string; photoUrl: string | null; poste: string; secteur: string;
  salaireMensuel: number; heuresHebdomadaires: number; contrat: string; actif: boolean;
};

const money = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Liste des employés (fiche RH) : Brigade puis Back-office, avec CASES À COCHER par ligne et barre d'actions
 * groupées — exporter la sélection en Excel ou en PDF (mêmes colonnes que l'export de la liste, restreintes aux
 * cochés ; le statut Actifs / Inactifs / Tous suit). Cases partagées entre les deux sections de la page.
 */
export function ListeEmployes({ brigade, backoffice, totalBrigade, totalBackoffice, statut, peutModifier }: {
  brigade: LigneEmploye[]; backoffice: LigneEmploye[]; totalBrigade: number; totalBackoffice: number;
  statut: "actifs" | "inactifs" | "tous"; peutModifier: boolean;
}) {
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const page = [...brigade, ...backoffice];
  const idsPage = page.map((e) => e.id);
  const cocheesPage = idsPage.filter((id) => sel.has(id)).length;
  // Cocher la page ajoute ses lignes à la sélection ; décocher n'enlève que les siennes (les autres pages restent cochées).
  const toutPage = (on: boolean) => setAll(on ? [...new Set([...ids, ...idsPage])] : ids.filter((id) => !idsPage.includes(id)), true);
  const qs = (e: string) => `ids=${ids.join(",")}${statut !== "actifs" ? `&statut=${statut}` : ""}${e}`;
  const tropGrand = ids.length > MAX_EXPORT_EMPLOYES;

  return (
    <div className="space-y-6">
      {page.length > 0 && (
        <BulkBar count={sel.size} total={page.length} cochesAffichees={cocheesPage} onAll={toutPage}
          libelleTout={totalBrigade + totalBackoffice > page.length ? "Tout sélectionner (cette page)" : "Tout sélectionner"}>
          {tropGrand ? (
            <button type="button" disabled title={MESSAGE_EXPORT_EMPLOYES_TROP_GRAND} className="rounded-md border px-3 py-1.5 text-sm font-medium opacity-60">
              Export : {MAX_EXPORT_EMPLOYES} employés au plus
            </button>
          ) : (
            <>
              <TelechargerLien href={`/employes/export?${qs("")}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                ⭳ Excel ({ids.length})
              </TelechargerLien>
              <TelechargerLien href={`/employes/pdf?${qs("")}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                ⭳ PDF ({ids.length})
              </TelechargerLien>
            </>
          )}
          <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}

      {(brigade.length > 0 || backoffice.length === 0) && (
        <div>
          <h2 className="mb-3 text-base font-semibold">
            Brigade <span className="font-normal text-muted-foreground">({totalBrigade})</span>
          </h2>
          <TableEmployes employes={brigade} peutModifier={peutModifier} sel={sel} toggle={toggle} />
        </div>
      )}

      {(backoffice.length > 0 || brigade.length === 0) && (
        <div>
          <h2 className="mb-3 text-base font-semibold">
            Back-office <span className="font-normal text-muted-foreground">({totalBackoffice})</span>
          </h2>
          <TableEmployes employes={backoffice} peutModifier={peutModifier} sel={sel} toggle={toggle} />
        </div>
      )}
    </div>
  );
}

function TableEmployes({ employes, peutModifier, sel, toggle }: { employes: LigneEmploye[]; peutModifier: boolean; sel: Set<string>; toggle: (id: string) => void }) {
  return (
    <>
      {/* Mobile : cartes tapables (toute la carte mène à la fiche) ; la case est à côté, hors du lien. */}
      <div className="space-y-2 lg:hidden">
        {employes.map((e) => (
          <div key={e.id} className={`flex items-center gap-2 rounded-xl border bg-card pl-3 ${sel.has(e.id) ? "bg-primary/10" : ""}`}>
            <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} className="h-5 w-5 shrink-0" aria-label={`Sélectionner ${e.nom}`} />
            <Link href={`/employes/${e.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3 active:bg-accent">
              <Avatar nom={e.nom} taille={40} photoUrl={e.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{e.nom}</span>
                  {!e.actif && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Inactif</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  <span className="font-mono">{e.matricule}</span> · {e.poste}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold tabular-nums">{money(e.salaireMensuel)} $</div>
                <div className="text-[11px] text-muted-foreground">{e.heuresHebdomadaires} h/sem · {e.contrat}</div>
              </div>
            </Link>
          </div>
        ))}
        {employes.length === 0 && <EtatVide message="Aucun employé ne correspond." />}
      </div>

      {/* Ordinateur : tableau détaillé. */}
      <div className="tableau-normal hidden rounded-lg border lg:block">
        <table className="w-full text-sm">
          <thead className="en-tete-collante bg-muted text-left">
            <tr>
              <th className="w-8 px-3 py-2"><span className="sr-only">Sélection</span></th>
              <th className="px-3 py-2">Matricule</th>
              <th className="px-3 py-2">Nom et prénom</th>
              <th className="px-3 py-2">Poste</th>
              <th className="px-3 py-2 max-xl:hidden">Secteur</th>
              <th className="px-3 py-2 text-right">Salaire mensuel $</th>
              <th className="px-3 py-2 text-right">Heures hebdo.</th>
              <th className="px-3 py-2">Contrat</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {employes.map((e) => (
              <tr key={e.id} className={`border-t ${sel.has(e.id) ? "bg-primary/10" : ""}`}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Sélectionner ${e.nom}`} />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{e.matricule}</td>
                <td className="px-3 py-2">
                  <Link href={`/employes/${e.id}`} className="flex items-center gap-2 hover:underline">
                    <Avatar nom={e.nom} taille={28} photoUrl={e.photoUrl} />
                    <span className="text-primary">{e.nom}</span>
                    {!e.actif && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Inactif</span>}
                  </Link>
                </td>
                <td className="px-3 py-2">{e.poste}</td>
                <td className="px-3 py-2 max-xl:hidden">{e.secteur}</td>
                <td className="px-3 py-2 text-right">{money(e.salaireMensuel)}</td>
                <td className="px-3 py-2 text-right">{e.heuresHebdomadaires}</td>
                <td className="px-3 py-2">{e.contrat}</td>
                <td className="px-3 py-2 text-right">
                  {peutModifier && <Link href={`/employes/${e.id}/modifier`} className="inline-flex min-h-8 items-center text-primary underline">Modifier</Link>}
                </td>
              </tr>
            ))}
            {employes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Aucun employé ne correspond.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
