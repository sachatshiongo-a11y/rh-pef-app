"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { marquerPayee, supprimerFacture, marquerPayeesEnLot, supprimerFacturesEnLot } from "./actions";
import { usd, STATUT_FACTURE_LABEL, STATUT_FACTURE_CLASSE } from "@/lib/stock";
import { estErreur } from "@/lib/action-lisible";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { BoutonValider, BoutonNeutre } from "@/components/action-buttons";
import { ApercuDocumentBouton } from "@/components/apercu-document";
import { TelechargerLien } from "@/components/telecharger-lien";
import { BulkBar } from "@/components/bulk-bar";
import { MoisAccordeon } from "@/components/mois-accordeon";
import { MAX_EXPORT_SELECTION, MESSAGE_EXPORT_TROP_GRAND } from "@/lib/export-selection";
import { lireNombreSaisi } from "@/lib/nombre";
import { BasculeDevise, SaisieDollars, SaisieFrancs, TotalLot, TotalLotFrancs, dollarsProposes, francsProposes, type DeviseLot, type DevisePaiement } from "./devise-paiement";
import { aDesFrancs, ajouterAuTotal, formaterMontantFacture, libelleTotal, totalVide, type DeviseFacture, type TotalDevises } from "@/lib/facture-devise";
import { Pagination, usePagination } from "@/components/pagination";
import { tranche, type ParPage } from "@/lib/pagination";

export type FactureRow = {
  id: string;
  nom: string;
  fournisseurId: string | null;
  numero: string | null;
  date: string | null;
  echeance: string | null;
  joursRestants: number | null; // null si réglée ou sans échéance
  datePaiement: string | null;
  /** Devise de la facture (2026-10-09) : `montant` et `reste` sont dans cette devise. Absente = USD. */
  devise?: DeviseFacture;
  montant: string;
  reste: number;
  statut: string;
  documentUrl: string | null;
  /** Un paiement de cette facture attend la Direction (« Demandes à valider ») : pas de second geste. */
  paiementDemande?: boolean;
};

export type Groupe = { titre: string; factures: FactureRow[] };
export type MoisGroupe = { cle: string; label: string; factures: FactureRow[] };
export type AnneeGroupe = { annee: number; mois: MoisGroupe[] };

// Plafond de l'export de la sélection : au-delà, le bouton le dit au lieu d'échouer (la route refuse aussi).
export { MAX_EXPORT_SELECTION };

/** Restes d'un groupe, TENUS PAR DEVISE (jamais 100 $ + 280 000 FC additionnés). */
const sumReste = (fs: FactureRow[]): TotalDevises => fs.reduce((t, f) => ajouterAuTotal(t, f.devise ?? "USD", f.reste), totalVide());
const sumMontant = (fs: FactureRow[]): TotalDevises => fs.reduce((t, f) => ajouterAuTotal(t, f.devise ?? "USD", Number(f.montant)), totalVide());
/** Un montant de la ligne dans sa devise : dollars comme avant (`usd`), francs « 280 000 FC ». */
const fmt = (f: { devise?: DeviseFacture }, n: number | string) => ((f.devise ?? "USD") === "USD" ? usd(n) : formaterMontantFacture(Number(n), "CDF"));
/** « 100,00 $ + 280 000 FC » (dollars formatés comme avant). */
const fmtTotal = (t: TotalDevises) => libelleTotal(t, undefined, usd);
const nonNul = (t: TotalDevises) => aDesFrancs(t) || t.usd > 0;

// Pastille d'échéance : verte > 10 j, jaune ≤ 10 j, rouge en retard, verte « payée » une fois réglée.
function badgeEcheance(f: FactureRow): { texte: string; cls: string } | null {
  if (f.statut === "REGLEE") return { texte: `Payée le ${f.datePaiement ?? "—"}`, cls: "bg-emerald-100 text-emerald-800" };
  if (f.joursRestants === null) return null;
  if (f.joursRestants < 0) return { texte: `En retard de ${-f.joursRestants} j`, cls: "bg-red-100 text-red-800" };
  if (f.joursRestants === 0) return { texte: "Échéance aujourd’hui", cls: "bg-amber-100 text-amber-800" };
  return { texte: `${f.joursRestants} j restants`, cls: f.joursRestants > 10 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800" };
}

/** Pastille « paiement demandé » : même forme que les pastilles de statut et d'échéance. */
const BADGE_DEMANDE = "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800";

const sommaireCls = "flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden";

// « 3 factures réglées sur 4 sélectionnées : 1 était déjà réglée. » — le règlement en lot est
// verrouillé ligne par ligne côté serveur (voir marquerPayeesEnLot) : si une facture sélectionnée
// a été réglée entre-temps par ailleurs, elle est simplement exclue, jamais réglée deux fois. On
// le DIT plutôt que de vider la sélection comme si tout était passé.
function messageEcartLot(reglees: number, demandees: number): string {
  const manquantes = demandees - reglees;
  return `${reglees} facture${reglees > 1 ? "s" : ""} réglée${reglees > 1 ? "s" : ""} sur ${demandees} sélectionnée${demandees > 1 ? "s" : ""} : ${manquantes} était${manquantes > 1 ? "ent" : ""} déjà réglée${manquantes > 1 ? "s" : ""}.`;
}

/**
 * Trois présentations d'une même liste (mêmes lignes, même barre d'actions groupées, mêmes droits) :
 *  - `annees`   : Année → Mois (écran Factures) ;
 *  - `groupes`  : par fournisseur (écran Factures) ;
 *  - `moisPlats`: Mois seuls, le plus récent ouvert (fiche d'un fournisseur — `sansFournisseur` : le
 *                 nom du fournisseur est celui de la page, on ne le répète pas à chaque ligne).
 * `paginer` (écran Factures, 2026-10-08) : 50 / 100 / Tout factures par page, page et taille dans l'URL. La liste
 * entière reste chargée : les groupes (année, mois, fournisseur) gardent leurs compteurs et leurs « dû » sur
 * TOUT le filtre et ne montrent que les lignes de la page ; un groupe sans ligne sur la page disparaît.
 */
export function FacturesUI({ groupes, annees, moisPlats, sansFournisseur = false, suffixeRetour = "", estDirection = true, ouvert = false, taux = 0, paginer = false, pageInit = 1, parInit = 50, cleFiltre = "" }: { groupes?: Groupe[]; annees?: AnneeGroupe[]; moisPlats?: MoisGroupe[]; sansFournisseur?: boolean; suffixeRetour?: string; estDirection?: boolean; ouvert?: boolean; /** Taux du jour (Paramètres) : paiement en francs ; 0 = non défini. */ taux?: number; paginer?: boolean; pageInit?: number; parInit?: ParPage; /** Filtres de la page (statut, année, groupement) : la page repart à 1 quand ils changent, pas après « Marquer payée ». */ cleFiltre?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // écart honnête du lot, pas une erreur
  const [sel, setSel] = useState<Set<string>>(new Set());
  // « Marquer payée » demande la date au choix (préremplie à aujourd'hui, heure de Kinshasa),
  // un seul geste de confirmation ensuite — à l'unité (une facture à la fois) et en lot.
  const [datePickerId, setDatePickerId] = useState<string | null>(null);
  const [dateChoisie, setDateChoisie] = useState(() => jourKinshasaISO());
  const [lotDatePicker, setLotDatePicker] = useState(false);
  const [lotDate, setLotDate] = useState(() => jourKinshasaISO());
  // Devise du paiement (2026-10-08) : à l'unité, montant en francs proposé = reste × taux du jour,
  // modifiable ; en lot, chaque facture soldée par reste × taux francs.
  // Facture en francs (2026-10-09) : payée en francs par défaut (son reste, sans conversion) ; en
  // dollars, montant proposé = reste ÷ taux du jour, modifiable.
  const [devise, setDevise] = useState<DevisePaiement>("USD");
  const [francs, setFrancs] = useState("");
  const [dollars, setDollars] = useState("");
  const [lotDevise, setLotDevise] = useState<DeviseLot>("USD");

  const run = (fn: () => Promise<unknown>, onSuccess?: () => void) => {
    setErreur(null); setInfo(null);
    startTransition(async () => {
      const r = await fn();
      if (estErreur(r)) setErreur(r.erreur);
      else {
        if (r && typeof r === "object" && "demande" in r && "message" in r) setInfo(String((r as { message: string }).message));
        onSuccess?.();
        router.refresh(); // l'écran peut ne pas être celui que l'action revalide (fiche d'un fournisseur)
      }
    });
  };

  // Toutes les factures affichées (à plat), pour « tout sélectionner » et les actions groupées.
  const toutes = useMemo(() => {
    const acc: FactureRow[] = [];
    if (annees) for (const a of annees) for (const m of a.mois) acc.push(...m.factures);
    else if (moisPlats) for (const m of moisPlats) acc.push(...m.factures);
    else for (const g of groupes ?? []) acc.push(...g.factures);
    return acc;
  }, [annees, groupes, moisPlats]);
  // Pagination : une tranche de la liste à plat (dans l'ordre d'affichage) ; sans `paginer`, tout s'affiche.
  const pagination = usePagination({ total: toutes.length, pageInit, parInit: paginer ? parInit : "tout", cleFiltre, synchroUrl: paginer });
  const { debut: debutPage, fin: finPage } = pagination;
  const idsPage = useMemo(() => (paginer ? new Set(tranche(toutes, { debut: debutPage, fin: finPage }).map((f) => f.id)) : null), [paginer, toutes, debutPage, finPage]);
  const surPage = (fs: FactureRow[]) => (idsPage ? fs.filter((f) => idsPage.has(f.id)) : fs);
  /** « · 12 affichées » : un groupe dont une partie seulement est sur cette page (compteur et « dû » restent ceux du groupe entier). */
  const noteAffichees = (fs: FactureRow[]) => { const n = surPage(fs).length; return idsPage && n < fs.length ? ` · ${n} affichée(s)` : ""; };
  const pageToutes = surPage(toutes);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const clear = () => { setSel(new Set()); setLotDatePicker(false); };
  // Seulement ce qui est À L'ÉCRAN : après un changement de filtre, une case cochée avant ne doit
  // ni se compter, ni se supprimer, ni s'exporter sans qu'on la voie.
  const selIds = [...sel].filter((id) => toutes.some((f) => f.id === id));
  // À régler = ni réglée, ni déjà en attente d'une décision de la Direction (jamais demandée deux fois).
  const selNonReglees = selIds.filter((id) => toutes.some((f) => f.id === id && f.statut !== "REGLEE" && !f.paiementDemande));
  const selDejaDemandees = selIds.filter((id) => toutes.some((f) => f.id === id && f.paiementDemande)).length;
  // Hors Direction, « Marquer payée » DEMANDE le paiement : les mots le disent.
  const libelleMarquer = estDirection ? "Marquer payée" : "Demander le paiement";
  // « Sa devise » n'a de sens que si la sélection compte des factures en francs : sinon, en dollars (relecture).
  const lotDeviseEffective: DeviseLot = lotDevise === "SA_DEVISE" && !toutes.some((f) => selNonReglees.includes(f.id) && f.devise === "CDF") ? "USD" : lotDevise;
  const libelleConfirmer = estDirection ? "Confirmer" : "Envoyer la demande";

  const confirmerLot = () => {
    setErreur(null); setInfo(null);
    startTransition(async () => {
      const r = await marquerPayeesEnLot(selNonReglees, lotDate, lotDeviseEffective);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (r.demandePaiement !== undefined) setInfo(`Paiement de ${r.demandePaiement} facture${r.demandePaiement > 1 ? "s" : ""} demandé à la Direction (tout ou rien) : rien n'est payé avant sa validation.`);
      else if (r.reglees < r.demandees) setInfo(messageEcartLot(r.reglees, r.demandees));
      clear();
      router.refresh();
    });
  };

  const liste = (factures: FactureRow[]) => (
    <ul className="divide-y border-t">
      {surPage(factures).map((f) => {
        const be = badgeEcheance(f);
        return (
          <li key={f.id} className={`flex gap-3 px-3 py-1.5 hover:bg-accent/30 sm:px-4 ${sel.has(f.id) ? "bg-primary/5" : ""}`}>
            <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="mt-1 shrink-0" aria-label={`Sélectionner ${f.nom}${f.numero ? ` N° ${f.numero}` : ""}`} />
            <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {!sansFournisseur && (f.fournisseurId
                  ? <Link href={`/stock/fournisseurs/${f.fournisseurId}`} className="truncate font-semibold text-primary hover:underline">{f.nom}</Link>
                  : <p className="truncate font-semibold">{f.nom}</p>)}
                <div className={`${sansFournisseur ? "" : "mt-0.5 "}flex flex-wrap items-center gap-x-2 gap-y-1`}>
                  {f.numero ? (
                    <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-sm font-semibold tracking-wide text-foreground">N° {f.numero}</span>
                  ) : (
                    <span className="text-xs italic text-muted-foreground">Sans numéro</span>
                  )}
                  <span className="text-xs text-muted-foreground">{f.date ? `émise le ${f.date}` : ""}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-semibold tabular-nums">{fmt(f, f.montant)}</p>
                <p className="text-[11px] text-muted-foreground">échéance {f.echeance ?? "—"}</p>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUT_FACTURE_CLASSE[f.statut]}`}>{STATUT_FACTURE_LABEL[f.statut]}</span>
              {be && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${be.cls}`}>{be.texte}</span>}
              {f.paiementDemande && <a href="/stock/a-valider" className={BADGE_DEMANDE}>Paiement demandé — en attente de la Direction</a>}
              <div className="ml-auto flex items-center gap-2">
                {f.documentUrl && (
                  <ApercuDocumentBouton href={f.documentUrl} titre={`Facture ${f.nom}${f.numero ? ` · N° ${f.numero}` : ""}`} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">📄 PDF</ApercuDocumentBouton>
                )}
                <a href={`/stock/factures/${f.id}${suffixeRetour}`} title="Détail & réconciliation" className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent">Détail</a>
                {f.statut !== "REGLEE" && !f.paiementDemande && (
                  datePickerId === f.id ? (
                    <span className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={dateChoisie}
                        onChange={(e) => setDateChoisie(e.target.value)}
                        max={jourKinshasaISO()}
                        aria-label="Date de paiement"
                        className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
                      />
                      <BasculeDevise petit devise={devise} deviseFacture={f.devise ?? "USD"} onDevise={(d) => { setDevise(d); if (d === "CDF" && (f.devise ?? "USD") === "USD") setFrancs(francsProposes(f.reste, taux)); if (d === "USD" && f.devise === "CDF") setDollars(dollarsProposes(f.reste, taux)); }} taux={taux} />
                      {devise === "CDF" && (f.devise ?? "USD") === "USD" && <SaisieFrancs petit francs={francs} onFrancs={setFrancs} reste={f.reste} taux={taux} demande={!estDirection} />}
                      {devise === "USD" && f.devise === "CDF" && <SaisieDollars petit dollars={dollars} onDollars={setDollars} reste={f.reste} taux={taux} demande={!estDirection} />}
                      <BoutonValider onClick={() => run(() => (f.devise === "CDF"
                        ? marquerPayee(f.id, dateChoisie, undefined, devise === "USD" ? dollars : undefined)
                        : marquerPayee(f.id, dateChoisie, devise === "CDF" ? francs : undefined)), () => setDatePickerId(null))}
                        disabled={isPending || (devise === "CDF" && (f.devise ?? "USD") === "USD" && !((lireNombreSaisi(francs) ?? 0) > 0)) || (devise === "USD" && f.devise === "CDF" && !((lireNombreSaisi(dollars) ?? 0) > 0))}>{libelleConfirmer}</BoutonValider>
                      <BoutonNeutre onClick={() => setDatePickerId(null)}>Annuler</BoutonNeutre>
                    </span>
                  ) : (
                    <BoutonValider onClick={() => { setDatePickerId(f.id); setDateChoisie(jourKinshasaISO()); setDevise(f.devise ?? "USD"); setFrancs(""); setDollars(""); }}>{libelleMarquer}</BoutonValider>
                  )
                )}
                {estDirection && (
                  <button onClick={() => { if (confirm("Supprimer cette facture ?")) run(() => supprimerFacture(f.id)); }} disabled={isPending} title="Supprimer" className="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10">✕</button>
                )}
              </div>
            </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="space-y-2">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {info && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{info}</p>}

      {/* Barre d'actions groupées — sélection multiple par cases à cocher (BulkBar, commune à l'application). */}
      <BulkBar
        count={selIds.length} total={pageToutes.length} cochesAffichees={pageToutes.filter((f) => sel.has(f.id)).length}
        libelleTout={pageToutes.length < toutes.length ? "Tout sélectionner (cette page)" : "Tout sélectionner"}
        onAll={(on) => setSel((s) => { const n = new Set(s); for (const f of pageToutes) { if (on) n.add(f.id); else n.delete(f.id); } return n; })}
      >
        {pageToutes.length < toutes.length && pageToutes.every((f) => sel.has(f.id)) && selIds.length < toutes.length && (
          <button type="button" data-tout-le-filtre="proposer" onClick={() => setSel(new Set(toutes.map((f) => f.id)))} className="text-xs font-medium text-primary underline">
            Sélectionner les {toutes.length} factures du filtre
          </button>
        )}
        {lotDatePicker ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">Date de paiement
              <input
                type="date"
                value={lotDate}
                onChange={(e) => setLotDate(e.target.value)}
                max={jourKinshasaISO()}
                className="rounded-md border border-input bg-background px-1.5 py-1 text-xs"
              />
            </label>
            {(() => {
              // Lot : en dollars / en francs (comme avant) ; s'il compte des factures en francs, aussi « chacune dans sa devise » (défaut).
              const lot = toutes.filter((f) => selNonReglees.includes(f.id));
              const devises = new Set(lot.map((f) => f.devise ?? "USD"));
              const toutUSD = !devises.has("CDF");
              return (
                <>
                  <BasculeDevise petit devise={lotDeviseEffective} onDevise={setLotDevise} taux={taux} saDevise={!toutUSD} deviseFacture={devises.size === 1 ? [...devises][0] : null} />
                  {toutUSD
                    ? lotDeviseEffective === "CDF" && <TotalLotFrancs restes={lot.map((f) => f.reste)} taux={taux} demande={!estDirection} />
                    : <TotalLot factures={lot.map((f) => ({ devise: f.devise ?? "USD", reste: f.reste }))} verse={lotDeviseEffective} taux={taux} demande={!estDirection} />}
                </>
              );
            })()}
            <BoutonValider onClick={confirmerLot} disabled={isPending || selNonReglees.length === 0}>
              {libelleConfirmer} ({selNonReglees.length})
            </BoutonValider>
            <BoutonNeutre onClick={() => setLotDatePicker(false)}>Annuler</BoutonNeutre>
          </span>
        ) : (
          <BoutonValider
            onClick={() => { setLotDatePicker(true); setLotDate(jourKinshasaISO()); setLotDevise(toutes.some((f) => selNonReglees.includes(f.id) && f.devise === "CDF") ? "SA_DEVISE" : "USD"); }}
            disabled={isPending || selNonReglees.length === 0}
          >
            {estDirection ? "Marquer payées" : "Demander le paiement"} ({selNonReglees.length})
          </BoutonValider>
        )}
        {selDejaDemandees > 0 && <span className="text-xs text-amber-800">{selDejaDemandees} déjà en attente de la Direction</span>}
        {/* Export Excel de la SÉLECTION (lecture seule, ouvert à tout l'espace Stock comme l'export complet). */}
        {selIds.length > MAX_EXPORT_SELECTION ? (
          <button type="button" disabled title={MESSAGE_EXPORT_TROP_GRAND} className="rounded-md border px-3 py-1.5 text-sm font-medium opacity-60">
            Export : {MAX_EXPORT_SELECTION} factures au plus
          </button>
        ) : (
          <TelechargerLien href={`/stock/factures/export?ids=${selIds.join(",")}`} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
            ⭳ Exporter ({selIds.length})
          </TelechargerLien>
        )}
        {estDirection && (
          <button
            onClick={() => { if (confirm(`Supprimer ${selIds.length} facture(s) ? Le stock entré par ces factures sera repris.`)) run(async () => { const r = await supprimerFacturesEnLot(selIds); if (!estErreur(r)) clear(); return r; }); }}
            disabled={isPending}
            className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            ✕ Supprimer ({selIds.length})
          </button>
        )}
        <button onClick={clear} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Désélectionner</button>
      </BulkBar>

      {moisPlats ? (
        <>
          {moisPlats.map((m, i) => {
            const duM = sumReste(m.factures);
            return (
              <MoisAccordeon key={m.cle} titre={m.label} compteur={`${m.factures.length} facture(s)`} defaultOpen={ouvert || i === 0}
                resume={nonNul(duM) ? <span className="text-xs text-red-700">dû {fmtTotal(duM)}</span> : <span className="text-xs text-emerald-700">soldé</span>}>
                {liste(m.factures)}
              </MoisAccordeon>
            );
          })}
          {moisPlats.length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      ) : annees ? (
        <>
          {annees.filter((a) => a.mois.some((m) => surPage(m.factures).length > 0)).map((a) => {
            const nbA = a.mois.reduce((n, m) => n + m.factures.length, 0);
            const duA = sumReste(a.mois.flatMap((m) => m.factures));
            return (
              <details key={a.annee} open={ouvert || undefined} className="group overflow-hidden rounded-xl border">
                <summary className={`${sommaireCls} bg-muted/60 px-4 py-1.5 text-sm font-semibold`}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{a.annee} <span className="font-normal text-muted-foreground">· {nbA} facture(s){noteAffichees(a.mois.flatMap((m) => m.factures))}</span></span>
                  {nonNul(duA) ? <span className="text-red-700">dû {fmtTotal(duA)}</span> : <span className="text-emerald-700">soldé</span>}
                </summary>
                <div className="space-y-1.5 p-2">
                  {a.mois.filter((m) => surPage(m.factures).length > 0).map((m) => {
                    const duM = sumReste(m.factures);
                    return (
                      <details key={m.cle} open={ouvert || undefined} className="group/m overflow-hidden rounded-lg border">
                        <summary className={`${sommaireCls} bg-muted/30 px-3 py-1 text-sm font-medium`}>
                          <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open/m:rotate-90">▸</span>{m.label} <span className="font-normal text-muted-foreground">· {m.factures.length}{noteAffichees(m.factures)}</span></span>
                          {nonNul(duM) ? <span className="text-xs text-red-700">dû {fmtTotal(duM)}</span> : <span className="text-xs text-emerald-700">soldé</span>}
                        </summary>
                        {liste(m.factures)}
                      </details>
                    );
                  })}
                </div>
              </details>
            );
          })}
          {annees.length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      ) : (
        <>
          {(groupes ?? []).filter((g) => surPage(g.factures).length > 0).map((g) => {
            // Par devise : réglé = montant − reste, dans chaque devise.
            const total = sumMontant(g.factures), du = sumReste(g.factures);
            const regle: TotalDevises = { ...total, usd: Math.round((total.usd - du.usd) * 100) / 100, cdf: Math.round((total.cdf - du.cdf) * 100) / 100 };
            return (
              <details key={g.titre} open={ouvert || undefined} className="group overflow-hidden rounded-xl border">
                <summary className={`${sommaireCls} bg-muted/60 px-4 py-1.5 text-sm font-semibold`}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{g.titre} <span className="font-normal text-muted-foreground">· {g.factures.length} facture(s){noteAffichees(g.factures)}</span></span>
                  <span className="text-xs font-normal">Réglé <b className="text-emerald-700">{fmtTotal(regle)}</b> / {fmtTotal(total)}</span>
                </summary>
                {liste(g.factures)}
              </details>
            );
          })}
          {(groupes ?? []).length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      )}
      {paginer && <Pagination className="pt-2" total={toutes.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="factures" />}
    </div>
  );
}
