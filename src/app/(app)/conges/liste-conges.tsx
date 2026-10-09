"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  approuverCongeFormulaire, refuserConge, supprimerConge,
  approuverCongesEnLot, refuserCongesEnLot, supprimerCongesEnLot,
  type FiltresListeConges, type RapportLotConges,
} from "./actions";
import { faireSignerDocument } from "../signature-actions";
import { BoutonApprouver, BoutonDanger, BoutonRefuser, CLASSES_DANGER } from "@/components/action-buttons";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonSigner } from "@/components/bouton-signer";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmployeeName } from "@/components/employee-name";
import { EtatVide } from "@/components/etat-vide";
import { Icone } from "@/components/icones";
import { TelechargerLien } from "@/components/telecharger-lien";
import {
  LIBELLE_STATUT_CONGE, MAX_DEMANDES_PAR_LOT, PLAFOND_SECTION, SECTIONS, libelleJours, libellePeriode,
  type CleSection, type LigneConge, type Regroupement,
} from "@/lib/conges-liste";

// Mêmes pastilles de statut que l'écran d'avant.
const COULEUR_CONGE: Record<string, string> = {
  APPROUVE: "bg-green-100 text-green-800",
  REFUSE: "bg-red-100 text-red-800",
  EN_ATTENTE: "bg-amber-100 text-amber-800",
};
const BORDURE_CONGE: Record<string, string> = { APPROUVE: "border-l-emerald-400", REFUSE: "border-l-red-400", EN_ATTENTE: "border-l-amber-400" };

export type SectionListe = { cle: CleSection; lignes: LigneConge[]; total: number; tronque: boolean };
export type GroupeMois = { cle: string; titre: string; lignes: LigneConge[]; partiel: boolean };

type Contexte = {
  anneeCourante: number;
  peutGerer: boolean;
  peutApprouver: boolean;
  filtresRetour: FiltresListeConges;
  selection: ReturnType<typeof useBulkSelection>;
};

const NB_COLONNES = 8;
const TITRE_SECTION = Object.fromEntries(SECTIONS.map((s) => [s.cle, s])) as Record<CleSection, (typeof SECTIONS)[number]>;

/**
 * La liste des demandes de congé (refonte 2026-10-09) : une ligne par demande (≈ 44 px), rangée par
 * section — À traiter, En cours aujourd'hui, À venir, puis Passés (repliée, paginée) — ou par mois ;
 * cases à cocher + barre d'actions groupées (Approuver, Refuser, PDF en ZIP, Supprimer). Ordinateur :
 * un tableau normal (en-tête collé à la page) ; téléphone et tablette : des cartes compactes.
 * Les droits sont ceux d'avant : décider, supprimer = Direction ; signer = Direction / Responsable ; PDF = toute l'équipe RH.
 * Les actions de chaque ligne sont les actions serveur existantes, inchangées.
 */
export function ListeConges({
  regroupement, sections, groupes, passesOuvertParDefaut, anneeCourante, peutGerer, peutApprouver, filtresRetour, vide, pagination,
}: {
  regroupement: Regroupement;
  sections: SectionListe[];
  groupes: GroupeMois[];
  /** « Passés » s'ouvre d'office quand un filtre est actif, qu'une autre page est demandée ou qu'il n'y a rien d'autre à voir. */
  passesOuvertParDefaut: boolean;
  anneeCourante: number;
  peutGerer: boolean;
  peutApprouver: boolean;
  filtresRetour: FiltresListeConges;
  /** Message d'état vide (aucune demande) ; null s'il y en a. */
  vide: string | null;
  /** La barre de pagination partagée (rendue par la page serveur) : celle des « Passés », ou du regroupement par mois. */
  pagination: ReactNode;
}) {
  const selection = useBulkSelection();
  const [enCours, demarrer] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; texte: string } | null>(null);
  // Le choix de l'utilisateur (ouvrir / replier « Passés ») ne vaut que tant que la valeur d'office n'a pas changé (nouveau filtre).
  const [choix, setChoix] = useState<{ base: boolean; ouvert: boolean } | null>(null);
  const passesOuvert = choix && choix.base === passesOuvertParDefaut ? choix.ouvert : passesOuvertParDefaut;
  const basculerPasses = () => setChoix({ base: passesOuvertParDefaut, ouvert: !passesOuvert });

  const parMois = regroupement === "mois";
  const affichees = sections.filter((s) => s.total > 0);
  // Ce qui est À L'ÉCRAN : une section « Passés » repliée n'est pas sélectionnable (on n'agit jamais sur ce qu'on ne voit pas).
  const visibles: LigneConge[] = parMois
    ? groupes.flatMap((g) => g.lignes)
    : affichees.flatMap((s) => (s.cle === "PASSES" && !passesOuvert ? [] : s.lignes));
  const idsVisibles = new Set(visibles.map((l) => l.id));
  const choisies = visibles.filter((l) => selection.sel.has(l.id));
  const ids = choisies.map((l) => l.id);
  const enAttenteChoisies = choisies.filter((l) => l.statut === "EN_ATTENTE").map((l) => l.id);

  const ctx: Contexte = { anneeCourante, peutGerer, peutApprouver, filtresRetour, selection };

  function lot(fn: (ids: string[]) => Promise<RapportLotConges>, cibles: string[], verbe: string, message: string) {
    if (cibles.length === 0 || !window.confirm(message)) return;
    setNote(null);
    demarrer(async () => {
      try {
        const r = await fn(cibles);
        selection.clear();
        // Rapport de fin : l'échec d'une demande ne bloque pas les autres, mais il est NOMMÉ.
        setNote(r.echecs.length > 0
          ? { ok: false, texte: `${r.traitees} demande(s) ${verbe}, ${r.echecs.length} échec(s) — ${r.echecs.join(" · ")}` }
          : { ok: true, texte: `${r.traitees} demande(s) ${verbe}.` });
      } catch (e) {
        setNote({ ok: false, texte: e instanceof Error && e.message ? e.message : "L'action groupée a échoué. Réessayez." });
      }
    });
  }

  if (vide) return <EtatVide message={vide} />;

  return (
    <div className="space-y-3">
      {note && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${note.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{note.texte}</p>
      )}

      {visibles.length > 0 && (
        <BulkBar count={choisies.length} total={visibles.length} onAll={(on) => selection.setAll(on ? [...idsVisibles] : [], on)} libelleTout="Tout sélectionner">
          {peutApprouver && enAttenteChoisies.length > 0 && (
            <>
              <BoutonApprouver
                type="button" disabled={enCours}
                onClick={() => lot(approuverCongesEnLot, enAttenteChoisies, "approuvée(s)", `Approuver ${enAttenteChoisies.length} demande(s) de congé ? Les salariés concernés seront prévenus.`)}
              >
                Approuver ({enAttenteChoisies.length})
              </BoutonApprouver>
              <BoutonRefuser
                type="button" disabled={enCours}
                onClick={() => lot(refuserCongesEnLot, enAttenteChoisies, "refusée(s)", `Refuser ${enAttenteChoisies.length} demande(s) de congé ? Les salariés concernés seront prévenus.`)}
              >
                Refuser ({enAttenteChoisies.length})
              </BoutonRefuser>
            </>
          )}
          {ids.length <= MAX_DEMANDES_PAR_LOT ? (
            <TelechargerLien
              href={`/conges/pdf-lot?ids=${ids.join(",")}`}
              nomFichier="Demandes_de_conge.zip"
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              PDF ({ids.length})
            </TelechargerLien>
          ) : (
            <span className="text-xs text-muted-foreground">PDF : {MAX_DEMANDES_PAR_LOT} demandes au plus par lot ({ids.length} cochées)</span>
          )}
          {peutApprouver && (
            <BoutonDanger
              type="button" disabled={enCours}
              onClick={() => lot(supprimerCongesEnLot, ids, "supprimée(s)", `Supprimer ${ids.length} demande(s) de congé ? Les congés approuvés perdent leurs codes sur la feuille de présence. L'opération est tracée au journal d'audit.`)}
            >
              Supprimer ({ids.length})
            </BoutonDanger>
          )}
          {enCours && <span className="text-xs text-muted-foreground">Traitement…</span>}
        </BulkBar>
      )}

      {/* ORDINATEUR (≥ 1280 px) : un tableau normal, l'en-tête de colonnes se colle sous la barre d'actions. */}
      <div data-vue="tableau" className="tableau-normal-xl hidden rounded-lg border bg-card xl:block">
        <table className="w-full text-sm">
          <thead className="en-tete-collante-xl bg-muted text-left text-xs">
            <tr>
              <th className="w-9 px-3 py-2"><span className="sr-only">Sélection</span></th>
              <th className="px-2 py-2 font-medium">Salarié</th>
              <th className="px-2 py-2 font-medium">Type</th>
              <th className="px-2 py-2 font-medium">Période</th>
              <th className="px-2 py-2 text-right font-medium">Jours</th>
              <th className="px-2 py-2 font-medium">Statut</th>
              <th className="w-12 px-1 py-2 text-center font-medium">Signé</th>
              <th className="px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          {parMois
            ? groupes.map((g) => (
                <tbody key={g.cle} data-groupe={g.cle}>
                  <EnteteTableau selection={selection} lignes={g.lignes} titre={g.titre} compte={g.partiel ? `${g.lignes.length} sur cette page` : String(g.lignes.length)} />
                  {g.lignes.map((l) => <LigneTableau key={l.id} l={l} ctx={ctx} />)}
                </tbody>
              ))
            : affichees.map((s) => {
                const replie = s.cle === "PASSES" && !passesOuvert;
                return (
                  <tbody key={s.cle} data-section={s.cle}>
                    <EnteteTableau
                      selection={selection} lignes={s.lignes} titre={TITRE_SECTION[s.cle].titre} aide={TITRE_SECTION[s.cle].aide} compte={String(s.total)}
                      replie={s.cle === "PASSES" ? replie : undefined} onBasculer={s.cle === "PASSES" ? basculerPasses : undefined}
                    />
                    {!replie && s.lignes.map((l) => <LigneTableau key={l.id} l={l} ctx={ctx} />)}
                    {!replie && s.tronque && <AvertissementBorne colSpan={NB_COLONNES} tag="tr" />}
                  </tbody>
                );
              })}
        </table>
      </div>

      {/* TÉLÉPHONE ET TABLETTE (< 1280 px) : des cartes compactes, mêmes sections. */}
      <div data-vue="cartes" className="space-y-3 xl:hidden">
        {parMois
          ? groupes.map((g) => (
              <section key={g.cle} data-groupe={g.cle} aria-label={g.titre}>
                <EnteteCartes selection={selection} lignes={g.lignes} titre={g.titre} compte={g.partiel ? `${g.lignes.length} sur cette page` : String(g.lignes.length)} />
                <ul className="divide-y rounded-lg border bg-card">
                  {g.lignes.map((l) => <CarteConge key={l.id} l={l} ctx={ctx} />)}
                </ul>
              </section>
            ))
          : affichees.map((s) => {
              const replie = s.cle === "PASSES" && !passesOuvert;
              return (
                <section key={s.cle} data-section={s.cle} aria-label={TITRE_SECTION[s.cle].titre}>
                  <EnteteCartes
                    selection={selection} lignes={s.lignes} titre={TITRE_SECTION[s.cle].titre} aide={TITRE_SECTION[s.cle].aide} compte={String(s.total)}
                    replie={s.cle === "PASSES" ? replie : undefined} onBasculer={s.cle === "PASSES" ? basculerPasses : undefined}
                  />
                  {!replie && (
                    <ul className="divide-y rounded-lg border bg-card">
                      {s.lignes.map((l) => <CarteConge key={l.id} l={l} ctx={ctx} />)}
                    </ul>
                  )}
                  {!replie && s.tronque && <AvertissementBorne tag="p" />}
                </section>
              );
            })}
      </div>

      {(parMois || passesOuvert) && pagination}
    </div>
  );
}

// ── Intitulés de section ──────────────────────────────────────────────────────────────────────────

/** Case d'en-tête d'une section : coche / décoche toutes ses lignes (celles de la page). */
function CaseSection({ selection, lignes, titre }: { selection: ReturnType<typeof useBulkSelection>; lignes: LigneConge[]; titre: string }) {
  const nb = lignes.filter((l) => selection.sel.has(l.id)).length;
  return (
    <input
      type="checkbox"
      aria-label={`Sélectionner toute la section ${titre}`}
      checked={lignes.length > 0 && nb === lignes.length}
      ref={(el) => { if (el) el.indeterminate = nb > 0 && nb < lignes.length; }}
      onChange={(e) => lignes.forEach((l) => { if (e.target.checked !== selection.sel.has(l.id)) selection.toggle(l.id); })}
      className="size-4"
    />
  );
}

function Titre({ titre, aide, compte }: { titre: string; aide?: string; compte: string }) {
  return (
    <>
      <span className="font-semibold">{titre}</span> <span className="tabular-nums text-muted-foreground">({compte})</span>
      {aide && <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">{aide}</span>}
    </>
  );
}

function EnteteTableau({ selection, lignes, titre, aide, compte, replie, onBasculer }: {
  selection: ReturnType<typeof useBulkSelection>; lignes: LigneConge[]; titre: string; aide?: string; compte: string; replie?: boolean; onBasculer?: () => void;
}) {
  return (
    <tr className="border-t bg-muted/40 text-xs">
      <td className="px-3 py-1.5">{!replie && lignes.length > 0 && <CaseSection selection={selection} lignes={lignes} titre={titre} />}</td>
      <th colSpan={NB_COLONNES - 1} scope="colgroup" className="px-2 py-1.5 text-left">
        {onBasculer ? (
          <button type="button" onClick={onBasculer} aria-expanded={!replie} className="inline-flex items-center gap-1.5 hover:underline">
            <span aria-hidden className={`inline-block transition-transform ${replie ? "" : "rotate-90"}`}>▸</span>
            <Titre titre={titre} aide={aide} compte={compte} />
          </button>
        ) : <Titre titre={titre} aide={aide} compte={compte} />}
      </th>
    </tr>
  );
}

function EnteteCartes({ selection, lignes, titre, aide, compte, replie, onBasculer }: {
  selection: ReturnType<typeof useBulkSelection>; lignes: LigneConge[]; titre: string; aide?: string; compte: string; replie?: boolean; onBasculer?: () => void;
}) {
  return (
    <h2 className="mb-1.5 flex items-center gap-2 px-1 text-sm">
      {!replie && lignes.length > 0 && <CaseSection selection={selection} lignes={lignes} titre={titre} />}
      {onBasculer ? (
        <button type="button" onClick={onBasculer} aria-expanded={!replie} className="inline-flex min-h-9 items-center gap-1.5">
          <span aria-hidden className={`inline-block transition-transform ${replie ? "" : "rotate-90"}`}>▸</span>
          <Titre titre={titre} aide={aide} compte={compte} />
        </button>
      ) : <span><Titre titre={titre} aide={aide} compte={compte} /></span>}
    </h2>
  );
}

function AvertissementBorne({ colSpan, tag }: { colSpan?: number; tag: "tr" | "p" }) {
  const texte = `${PLAFOND_SECTION} premières demandes seulement : affinez le filtre pour voir le reste.`;
  return tag === "tr"
    ? <tr><td colSpan={colSpan} role="status" className="border-t bg-amber-50 px-3 py-2 text-sm text-amber-900">{texte}</td></tr>
    : <p role="status" className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{texte}</p>;
}

// ── Éléments d'une ligne ──────────────────────────────────────────────────────────────────────────

function Pastille({ l }: { l: LigneConge }) {
  return (
    <span
      title={l.approuveParNom ? `${LIBELLE_STATUT_CONGE[l.statut]} par ${l.approuveParNom}` : undefined}
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_CONGE[l.statut] ?? ""}`}
    >
      {LIBELLE_STATUT_CONGE[l.statut] ?? l.statut}
    </span>
  );
}

/** « Signé ou non », en un coup d'œil : l'icône vaut le texte (qui reste lisible pour les lecteurs d'écran). */
function MarqueSignature({ l }: { l: LigneConge }) {
  const s = l.signature;
  if (!s) return null;
  if (s.etat === "SIGNE") {
    return <span title={`Signé le ${s.signeLeTexte}`} className="inline-flex text-emerald-600"><Icone nom="valider" taille={16} /><span className="sr-only">Signé le {s.signeLeTexte}</span></span>;
  }
  if (s.etat === "A_RESIGNER") {
    return <span title="Modifiée après la signature : à resigner" className="inline-flex text-amber-600"><Icone nom="valider" taille={16} /><span className="sr-only">À resigner</span></span>;
  }
  return <span title="Pas encore signé" className="text-muted-foreground"><span aria-hidden>–</span><span className="sr-only">À signer</span></span>;
}

const CASE_CLS = "size-4 shrink-0";
const libelleCase = (l: LigneConge) => `Sélectionner la demande de ${l.nom} (${l.type})`;
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);
const periode = (l: LigneConge, annee: number) => libellePeriode(jour(l.debut), jour(l.fin), annee);

/** Les décisions d'une demande EN ATTENTE : les actions serveur d'avant, en formulaire. */
function Decisions({ l, ctx }: { l: LigneConge; ctx: Contexte }) {
  return (
    <>
      <form action={approuverCongeFormulaire.bind(null, l.id, ctx.filtresRetour)} className="inline">
        <BoutonApprouver type="submit" />
      </form>
      <form action={refuserConge.bind(null, l.id)} className="inline">
        <BoutonRefuser type="submit" />
      </form>
    </>
  );
}

function Supprimer({ l }: { l: LigneConge }) {
  return (
    <form action={supprimerConge.bind(null, l.id)} className="inline">
      <ConfirmSubmitButton
        message={l.statut === "APPROUVE" ? "Supprimer ce congé approuvé ? Ses codes seront retirés de la feuille de présence." : "Supprimer cette demande de congé ?"}
        className={`${CLASSES_DANGER} px-2!`}
      >
        <span className="sr-only">Supprimer la demande de {l.nom}</span><span aria-hidden>✕</span>
      </ConfirmSubmitButton>
    </form>
  );
}

function PdfEtSignature({ l, ctx }: { l: LigneConge; ctx: Contexte }) {
  return (
    <>
      <TelechargerLien href={`/conges/demande/${l.id}`} className="text-sm text-primary underline">PDF</TelechargerLien>
      {ctx.peutGerer && l.signature && l.signature.etat !== "SIGNE" && (
        <BoutonSigner
          cible="DEMANDE_CONGE"
          cibleId={l.id}
          nomSalarie={l.nom}
          libelleDocument={`${l.type} — ${l.nom}`}
          cote="DIRECTION"
          action={faireSignerDocument}
          etat={l.signature.etat}
          signeLeTexte={l.signature.signeLeTexte}
        />
      )}
    </>
  );
}

// ── Ligne du tableau (ordinateur) ─────────────────────────────────────────────────────────────────

function LigneTableau({ l, ctx }: { l: LigneConge; ctx: Contexte }) {
  const cochee = ctx.selection.sel.has(l.id);
  return (
    <tr data-conge={l.id} className={`border-t hover:bg-accent/40 ${cochee ? "bg-primary/5" : ""}`}>
      <td className={`w-9 border-l-2 px-3 py-1.5 ${BORDURE_CONGE[l.statut] ?? ""}`}>
        <input type="checkbox" checked={cochee} onChange={() => ctx.selection.toggle(l.id)} aria-label={libelleCase(l)} className={CASE_CLS} />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5"><EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} taille={28} /></td>
      <td className="max-w-[8.5rem] truncate px-2 py-1.5" title={l.type}>{l.type}</td>
      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{periode(l, ctx.anneeCourante)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{libelleJours(l.nbJours)}</td>
      <td className="px-2 py-1.5"><Pastille l={l} /></td>
      <td className="px-1 py-1.5 text-center"><MarqueSignature l={l} /></td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-2">
          {ctx.peutApprouver && l.statut === "EN_ATTENTE" && <Decisions l={l} ctx={ctx} />}
          <PdfEtSignature l={l} ctx={ctx} />
          {ctx.peutApprouver && <Supprimer l={l} />}
        </div>
      </td>
    </tr>
  );
}

// ── Carte (téléphone et tablette) ─────────────────────────────────────────────────────────────────

function CarteConge({ l, ctx }: { l: LigneConge; ctx: Contexte }) {
  const cochee = ctx.selection.sel.has(l.id);
  const decision = ctx.peutApprouver && l.statut === "EN_ATTENTE";
  return (
    <li data-conge={l.id} className={`border-l-4 px-3 py-2 ${BORDURE_CONGE[l.statut] ?? ""} ${cochee ? "bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2.5">
        <input type="checkbox" checked={cochee} onChange={() => ctx.selection.toggle(l.id)} aria-label={libelleCase(l)} className={CASE_CLS} />
        <div className="min-w-0 flex-1 text-sm font-medium"><EmployeeName id={l.employeeId} nom={l.nom} photoUrl={l.photoUrl} taille={28} /></div>
        <Pastille l={l} />
        <MarqueSignature l={l} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 pl-[26px]">
        <p className="min-w-0 text-xs text-muted-foreground">
          {l.type} · <span className="whitespace-nowrap tabular-nums">{periode(l, ctx.anneeCourante)}</span> · <span className="whitespace-nowrap">{libelleJours(l.nbJours)}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <PdfEtSignature l={l} ctx={ctx} />
          {ctx.peutApprouver && !decision && <Supprimer l={l} />}
        </div>
      </div>
      {decision && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[26px]">
          <Decisions l={l} ctx={ctx} />
          <span className="ml-auto"><Supprimer l={l} /></span>
        </div>
      )}
    </li>
  );
}
