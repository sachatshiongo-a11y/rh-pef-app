"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { CLASSES_DANGER, CLASSES_NEUTRE } from "@/components/action-buttons";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmployeeName } from "@/components/employee-name";
import { EtatVide } from "@/components/etat-vide";
import { SECTION_ANCREE } from "@/components/sommaire-sections";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ContratViewerButton } from "@/app/(app)/employes/[id]/contrat-viewer";
import { CATEGORIES_PRO, labelCategoriePro } from "@/lib/categorie-professionnelle";
import {
  filtrerFichesPoste, grouperParDepartement, premiereLigne, type FiltreStatut, type LigneFichePoste,
} from "@/lib/fiches-poste-liste";
import { enregistrerFichePoste, renommerPoste, supprimerFichePoste, supprimerFichesPoste, supprimerPoste } from "./actions";

const champCls = "rounded-md border bg-background px-3 py-1.5 text-sm text-foreground";
const zoneCls = "rounded-md border bg-background px-3 py-2 text-sm text-foreground";

/**
 * Liste des fiches de poste (2026-10-08) : une ligne par poste, rangée sous son département, avec
 * recherche et filtre ; sélection + barre d'actions groupées (PDF en lot, suppression Direction) ;
 * la ligne s'ouvre EN PLEINE LARGEUR sur sa fiche (occupants, puis formulaire — ou lecture seule).
 * Aucun champ, aucune action, aucun droit changés : mêmes formulaires qu'avant, mieux rangés.
 */
export function ListeFichesPoste({
  lignes, peutGerer, estAdmin, posteOuvert,
}: {
  lignes: LigneFichePoste[]; peutGerer: boolean; estAdmin: boolean;
  /** `?poste=` (lien « La renseigner » de la fiche employé) : cette fiche s'ouvre et vient à l'écran. */
  posteOuvert?: string;
}) {
  const [saisie, setSaisie] = useState("");
  const [statut, setStatut] = useState<FiltreStatut>("tous");
  const [ouverts, setOuverts] = useState<Set<string>>(() => new Set(posteOuvert && lignes.some((l) => l.poste === posteOuvert) ? [posteOuvert] : []));
  useEffect(() => {
    if (!posteOuvert) return;
    document.querySelector(`[data-poste="${CSS.escape(posteOuvert)}"]`)?.scrollIntoView({ block: "start" });
  }, [posteOuvert]);
  const selection = useBulkSelection();

  const visibles = useMemo(() => filtrerFichesPoste(lignes, saisie, statut), [lignes, saisie, statut]);
  const groupes = useMemo(() => grouperParDepartement(visibles), [visibles]);
  // Seules les lignes qui ONT une fiche se sélectionnent (PDF, suppression) ; la sélection suit le filtre.
  const selectionnables = visibles.flatMap((l) => (l.fiche ? [l.fiche.id] : []));
  const choisies = selection.ids.filter((id) => selectionnables.includes(id));
  const nbDocumentees = lignes.filter((l) => l.documentee).length;

  const basculer = (poste: string) =>
    setOuverts((s) => {
      const n = new Set(s);
      if (n.has(poste)) n.delete(poste); else n.add(poste);
      return n;
    });

  const filtres: [FiltreStatut, string, number][] = [
    ["tous", "Tous", lignes.length],
    ["documentees", "Documentés", nbDocumentees],
    ["a-faire", "À documenter", lignes.length - nbDocumentees],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="Rechercher un poste, un salarié…"
          aria-label="Rechercher un poste"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:max-w-sm"
        />
        <div className="flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Filtrer par état">
          {filtres.map(([v, label, n]) => (
            <button
              key={v}
              type="button"
              aria-pressed={statut === v}
              onClick={() => setStatut(v)}
              className={`rounded-full border px-3 py-1 ${statut === v ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}
            >
              {label} <span className="text-muted-foreground">({n})</span>
            </button>
          ))}
        </div>
      </div>

      {peutGerer && selectionnables.length > 0 && (
        <BulkBar count={choisies.length} total={selectionnables.length} onAll={(on) => selection.setAll(selectionnables, on)}>
          <TelechargerLien
            href={`/fiches-poste/pdf-lot?ids=${choisies.join(",")}`}
            nomFichier="Fiches_de_poste.zip"
            className={CLASSES_NEUTRE}
          >
            Télécharger les fiches PDF ({choisies.length})
          </TelechargerLien>
          {estAdmin && (
            <form action={supprimerFichesPoste}>
              {choisies.map((id) => <input key={id} type="hidden" name="ficheId" value={id} />)}
              <ConfirmSubmitButton
                message={`Supprimer ${choisies.length} fiche(s) de poste ? (Les postes et leurs employés sont conservés.)`}
                className={CLASSES_DANGER}
              >
                Supprimer les fiches ({choisies.length})
              </ConfirmSubmitButton>
            </form>
          )}
        </BulkBar>
      )}

      {visibles.length === 0 && (
        <EtatVide message={lignes.length === 0 ? "Aucun poste enregistré (ajoutez d'abord des employés avec un intitulé de poste)." : "Aucun poste ne correspond."} />
      )}

      {groupes.map((g) => (
        <section key={g.departement} aria-labelledby={`dep-${g.departement}`}>
          <h2 id={`dep-${g.departement}`} className="mb-2 text-base font-semibold">
            {g.departement} <span className="font-normal text-muted-foreground">({g.lignes.length})</span>
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {g.lignes.map((l) => (
              <LignePoste
                key={l.poste}
                ligne={l}
                ouvert={ouverts.has(l.poste)}
                onBasculer={() => basculer(l.poste)}
                selectionne={Boolean(l.fiche && selection.sel.has(l.fiche.id))}
                onSelection={() => l.fiche && selection.toggle(l.fiche.id)}
                peutGerer={peutGerer}
                estAdmin={estAdmin}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LignePoste({
  ligne: l, ouvert, onBasculer, selectionne, onSelection, peutGerer, estAdmin,
}: {
  ligne: LigneFichePoste; ouvert: boolean; onBasculer: () => void; selectionne: boolean; onSelection: () => void; peutGerer: boolean; estAdmin: boolean;
}) {
  const f = l.fiche;
  const effectif = l.occupants.length;
  const apercu = premiereLigne(f?.descriptionPoste) || premiereLigne(f?.description);
  const classe = labelCategoriePro(f?.categorieProfessionnelle);
  const libelleBascule = peutGerer ? (f ? "Modifier" : "Renseigner") : "Lire";
  return (
    <li data-poste={l.poste} className={`${SECTION_ANCREE} ${l.documentee ? "" : "bg-amber-50/40"}`}>
      <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* Case à cocher : seulement s'il y a une fiche (PDF, suppression) ; sinon une place vide garde l'alignement. */}
          {peutGerer && (f ? (
            <input
              type="checkbox"
              checked={selectionne}
              onChange={onSelection}
              aria-label={`Sélectionner la fiche ${l.poste}`}
              className="mt-1 size-4 shrink-0"
            />
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          ))}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button type="button" onClick={onBasculer} aria-expanded={ouvert} className="text-left font-semibold hover:underline">
                {l.poste}
              </button>
              {l.documentee ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Documentée</span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">À documenter</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {effectif > 0 ? (
                <Link href={`/employes?poste=${encodeURIComponent(l.poste)}`} className="text-primary hover:underline">{effectif} salarié{effectif > 1 ? "s" : ""}</Link>
              ) : (
                "aucun salarié actif"
              )}
              {classe ? ` · ${classe}` : ""}
              {f?.fichierNom ? ` · 📎 ${f.fichierNom}` : ""}
            </p>
            {apercu && <p className="mt-0.5 truncate text-xs text-foreground/80">{apercu}</p>}
          </div>
        </div>
        <div className={`flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end ${peutGerer ? "pl-7 sm:pl-0" : ""}`}>
          {f && peutGerer && (
            <ContratViewerButton href={`/fiches-poste/${f.id}/pdf`} titre={`Fiche de poste — ${l.poste}`} libelle="Fiche PDF" className={CLASSES_NEUTRE} />
          )}
          {f?.fichierUrl && (
            <TelechargerLien href={f.fichierUrl} nomFichier={f.fichierNom ?? undefined} className={CLASSES_NEUTRE}>
              Document joint
            </TelechargerLien>
          )}
          <button type="button" onClick={onBasculer} aria-expanded={ouvert} className={`${CLASSES_NEUTRE} ${ouvert ? "bg-accent" : ""}`}>
            {libelleBascule} <span aria-hidden className={`transition-transform ${ouvert ? "rotate-90" : ""}`}>▸</span>
          </button>
        </div>
      </div>
      {ouvert && <PanneauFiche ligne={l} peutGerer={peutGerer} estAdmin={estAdmin} />}
    </li>
  );
}

/** Fiche ouverte, en pleine largeur sous sa ligne : qui occupe le poste, puis l'édition (ou la lecture). */
function PanneauFiche({ ligne: l, peutGerer, estAdmin }: { ligne: LigneFichePoste; peutGerer: boolean; estAdmin: boolean }) {
  const f = l.fiche;
  const effectif = l.occupants.length;
  return (
    <div className="space-y-4 border-t bg-muted/20 px-3 py-4 sm:px-4">
      {effectif > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Occupé par</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {l.occupants.map((o) => <EmployeeName key={o.id} id={o.id} nom={o.nom} photoUrl={o.photoUrl} taille={24} />)}
          </div>
        </div>
      )}

      {!peutGerer ? (
        <div className="space-y-2 text-sm">
          {!f?.descriptionPoste && !f?.description && <p className="text-muted-foreground">Fiche pas encore rédigée.</p>}
          {f?.descriptionPoste && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Missions principales du poste</p>
              <p className="whitespace-pre-line">{f.descriptionPoste}</p>
            </div>
          )}
          {f?.description && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Activités et tâches principales</p>
              <p className="whitespace-pre-line">{f.description}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <form action={enregistrerFichePoste} className="space-y-4">
            <input type="hidden" name="poste" value={l.poste} />
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Contenu de la fiche (missions, activités) — ce qu'on rédige le plus. */}
              <div className="space-y-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  <span>Missions principales du poste <span className="font-normal">(une par ligne)</span></span>
                  <textarea name="descriptionPoste" defaultValue={f?.descriptionPoste ?? ""} rows={5} placeholder="Les missions principales / responsabilités du poste…" className={zoneCls} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  <span>Activités et tâches principales <span className="font-normal">(une par ligne)</span></span>
                  <textarea name="description" defaultValue={f?.description ?? ""} rows={6} placeholder="Les activités et tâches concrètes (avant / pendant / après le service…)…" className={zoneCls} />
                </label>
              </div>
              {/* Champs du générateur de fiche de poste (PDF). */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">Informations pour la fiche de poste (PDF)</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">Type de contrat
                    <input type="text" name="typeContrat" defaultValue={f?.typeContrat ?? ""} placeholder="ex. CDD à temps partiel" className={champCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">Échelle salariale
                    <input type="text" name="echelleSalariale" defaultValue={f?.echelleSalariale ?? ""} placeholder="ex. 100 USD" className={champCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">Supérieur hiérarchique direct
                    <input type="text" name="superieurHierarchique" defaultValue={f?.superieurHierarchique ?? ""} placeholder="ex. Contrôleur de gestion" className={champCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">Temps de travail
                    <input type="text" name="tempsTravail" defaultValue={f?.tempsTravail ?? ""} placeholder="ex. 10 heures/semaine" className={champCls} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">Classe / Catégorie professionnelle
                    <select name="categorieProfessionnelle" defaultValue={f?.categorieProfessionnelle ?? ""} className={champCls}>
                      <option value="">— (déduite des salariés du poste)</option>
                      {CATEGORIES_PRO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">Le lieu de travail se remplit automatiquement (restaurant Pâtes en Folie). Si la catégorie n&apos;est pas choisie ici, elle est déduite des salariés du poste.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Compétences techniques <span className="font-normal">(une par ligne)</span></span>
                <textarea name="competencesTechniques" defaultValue={f?.competencesTechniques ?? ""} rows={3} className={zoneCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground"><span>Savoir-être, soft skills <span className="font-normal">(une par ligne)</span></span>
                <textarea name="savoirEtre" defaultValue={f?.savoirEtre ?? ""} rows={3} className={zoneCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">Formations requises
                <textarea name="formationsRequises" defaultValue={f?.formationsRequises ?? ""} rows={3} className={zoneCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">Diplômes requis
                <textarea name="diplomesRequis" defaultValue={f?.diplomesRequis ?? ""} rows={2} className={zoneCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-1 lg:col-span-2">Expériences exigées
                <textarea name="experiencesExigees" defaultValue={f?.experiencesExigees ?? ""} rows={2} className={zoneCls} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Document joint (PDF ou Word, max 15 Mo){f?.fichierNom ? ` — remplace « ${f.fichierNom} »` : ""}
                <input type="file" name="fichier" accept=".pdf,.doc,.docx" className="text-xs text-foreground" />
              </label>
              <button type="submit" className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Enregistrer la fiche
              </button>
            </div>
          </form>

          {/* Le poste lui-même : renommer (répercuté sur employés, contrats, besoins, polyvalences), supprimer (Direction). */}
          <div className="flex flex-col gap-3 border-t pt-3 lg:flex-row lg:items-center">
            <form action={renommerPoste} className="flex flex-1 flex-wrap items-center gap-2">
              <input type="hidden" name="poste" value={l.poste} />
              <input type="text" name="nouveau" required defaultValue={l.poste} aria-label={`Nouveau nom pour le poste ${l.poste}`} className={`${champCls} min-w-0 flex-1`} />
              <ConfirmSubmitButton
                message={`Renommer le poste « ${l.poste} » ? Le changement s'applique à tous les employés, contrats et plannings concernés.`}
                className={CLASSES_NEUTRE}
              >
                Renommer le poste
              </ConfirmSubmitButton>
            </form>
            {estAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                {f && (
                  <form action={supprimerFichePoste.bind(null, l.poste)}>
                    <ConfirmSubmitButton message={`Supprimer la fiche du poste « ${l.poste} » ? (Le poste et ses employés sont conservés.)`} className={CLASSES_DANGER}>
                      Supprimer la fiche
                    </ConfirmSubmitButton>
                  </form>
                )}
                {effectif === 0 ? (
                  <form action={supprimerPoste.bind(null, l.poste)}>
                    <ConfirmSubmitButton
                      message={`Supprimer définitivement le poste « ${l.poste} » ? La fiche, les besoins de planning et les polyvalences liés seront supprimés.`}
                      className={CLASSES_DANGER}
                    >
                      Supprimer le poste
                    </ConfirmSubmitButton>
                  </form>
                ) : (
                  <span className="text-xs text-muted-foreground">Pour supprimer ce poste, réaffectez d&apos;abord ses {effectif} salarié(s).</span>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
