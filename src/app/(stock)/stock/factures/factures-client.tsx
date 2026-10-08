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
import { BasculeDevise, SaisieFrancs, TotalLotFrancs, francsProposes, type DevisePaiement } from "./devise-paiement";

export type FactureRow = {
  id: string;
  nom: string;
  fournisseurId: string | null;
  numero: string | null;
  date: string | null;
  echeance: string | null;
  joursRestants: number | null; // null si réglée ou sans échéance
  datePaiement: string | null;
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

const sumReste = (fs: FactureRow[]) => fs.reduce((t, f) => t + f.reste, 0);

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
 */
export function FacturesUI({ groupes, annees, moisPlats, sansFournisseur = false, suffixeRetour = "", estDirection = true, ouvert = false, taux = 0 }: { groupes?: Groupe[]; annees?: AnneeGroupe[]; moisPlats?: MoisGroupe[]; sansFournisseur?: boolean; suffixeRetour?: string; estDirection?: boolean; ouvert?: boolean; /** Taux du jour (Paramètres) : paiement en francs ; 0 = non défini. */ taux?: number }) {
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
  const [devise, setDevise] = useState<DevisePaiement>("USD");
  const [francs, setFrancs] = useState("");
  const [lotDevise, setLotDevise] = useState<DevisePaiement>("USD");

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
  const libelleConfirmer = estDirection ? "Confirmer" : "Envoyer la demande";

  const confirmerLot = () => {
    setErreur(null); setInfo(null);
    startTransition(async () => {
      const r = await marquerPayeesEnLot(selNonReglees, lotDate, lotDevise);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (r.demandePaiement !== undefined) setInfo(`Paiement de ${r.demandePaiement} facture${r.demandePaiement > 1 ? "s" : ""} demandé à la Direction (tout ou rien) : rien n'est payé avant sa validation.`);
      else if (r.reglees < r.demandees) setInfo(messageEcartLot(r.reglees, r.demandees));
      clear();
      router.refresh();
    });
  };

  const liste = (factures: FactureRow[]) => (
    <ul className="divide-y border-t">
      {factures.map((f) => {
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
                <p className="text-base font-semibold tabular-nums">{usd(f.montant)}</p>
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
                      <BasculeDevise petit devise={devise} onDevise={(d) => { setDevise(d); if (d === "CDF") setFrancs(francsProposes(f.reste, taux)); }} taux={taux} />
                      {devise === "CDF" && <SaisieFrancs petit francs={francs} onFrancs={setFrancs} reste={f.reste} taux={taux} demande={!estDirection} />}
                      <BoutonValider onClick={() => run(() => marquerPayee(f.id, dateChoisie, devise === "CDF" ? francs : undefined), () => setDatePickerId(null))} disabled={isPending || (devise === "CDF" && !((lireNombreSaisi(francs) ?? 0) > 0))}>{libelleConfirmer}</BoutonValider>
                      <BoutonNeutre onClick={() => setDatePickerId(null)}>Annuler</BoutonNeutre>
                    </span>
                  ) : (
                    <BoutonValider onClick={() => { setDatePickerId(f.id); setDateChoisie(jourKinshasaISO()); setDevise("USD"); setFrancs(""); }}>{libelleMarquer}</BoutonValider>
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
      <BulkBar count={selIds.length} total={toutes.length} onAll={(on) => setSel(on ? new Set(toutes.map((f) => f.id)) : new Set())}>
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
            <BasculeDevise petit devise={lotDevise} onDevise={setLotDevise} taux={taux} />
            {lotDevise === "CDF" && <TotalLotFrancs restes={toutes.filter((f) => selNonReglees.includes(f.id)).map((f) => f.reste)} taux={taux} demande={!estDirection} />}
            <BoutonValider onClick={confirmerLot} disabled={isPending || selNonReglees.length === 0}>
              {libelleConfirmer} ({selNonReglees.length})
            </BoutonValider>
            <BoutonNeutre onClick={() => setLotDatePicker(false)}>Annuler</BoutonNeutre>
          </span>
        ) : (
          <BoutonValider
            onClick={() => { setLotDatePicker(true); setLotDate(jourKinshasaISO()); setLotDevise("USD"); }}
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
                resume={duM > 0 ? <span className="text-xs text-red-700">dû {usd(duM)}</span> : <span className="text-xs text-emerald-700">soldé</span>}>
                {liste(m.factures)}
              </MoisAccordeon>
            );
          })}
          {moisPlats.length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      ) : annees ? (
        <>
          {annees.map((a) => {
            const nbA = a.mois.reduce((n, m) => n + m.factures.length, 0);
            const duA = a.mois.reduce((n, m) => n + sumReste(m.factures), 0);
            return (
              <details key={a.annee} open={ouvert || undefined} className="group overflow-hidden rounded-xl border">
                <summary className={`${sommaireCls} bg-muted/60 px-4 py-1.5 text-sm font-semibold`}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{a.annee} <span className="font-normal text-muted-foreground">· {nbA} facture(s)</span></span>
                  {duA > 0 ? <span className="text-red-700">dû {usd(duA)}</span> : <span className="text-emerald-700">soldé</span>}
                </summary>
                <div className="space-y-1.5 p-2">
                  {a.mois.map((m) => {
                    const duM = sumReste(m.factures);
                    return (
                      <details key={m.cle} open={ouvert || undefined} className="group/m overflow-hidden rounded-lg border">
                        <summary className={`${sommaireCls} bg-muted/30 px-3 py-1 text-sm font-medium`}>
                          <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open/m:rotate-90">▸</span>{m.label} <span className="font-normal text-muted-foreground">· {m.factures.length}</span></span>
                          {duM > 0 ? <span className="text-xs text-red-700">dû {usd(duM)}</span> : <span className="text-xs text-emerald-700">soldé</span>}
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
          {(groupes ?? []).map((g) => {
            const total = g.factures.reduce((t, f) => t + Number(f.montant), 0);
            const regle = total - sumReste(g.factures);
            return (
              <details key={g.titre} open={ouvert || undefined} className="group overflow-hidden rounded-xl border">
                <summary className={`${sommaireCls} bg-muted/60 px-4 py-1.5 text-sm font-semibold`}>
                  <span className="flex items-center gap-1.5"><span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{g.titre} <span className="font-normal text-muted-foreground">· {g.factures.length} facture(s)</span></span>
                  <span className="text-xs font-normal">Réglé <b className="text-emerald-700">{usd(regle)}</b> / {usd(total)}</span>
                </summary>
                {liste(g.factures)}
              </details>
            );
          })}
          {(groupes ?? []).length === 0 && <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Aucune facture.</p>}
        </>
      )}
    </div>
  );
}
