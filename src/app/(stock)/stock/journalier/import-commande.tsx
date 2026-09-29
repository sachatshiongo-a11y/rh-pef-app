"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { estErreur } from "@/lib/action-lisible";
import type { PropositionCommande } from "@/lib/classeur-commande";
import { analyserClasseurCommande, appliquerImportCommande, type ChoixCommande } from "./import-commande-actions";

const TAILLE_MAX = 60 * 1024 * 1024;
const FEUILLES = [
  { feuille: "CUISINE" as const, titre: "Fiche commande cuisine" },
  { feuille: "BAR" as const, titre: "Fiche commande Bar" },
];
const STATUT: Record<PropositionCommande["statut"], { texte: string; classe: string }> = {
  EXACTE: { texte: "même nom au catalogue", classe: "text-emerald-800" },
  DEJA: { texte: "déjà sur la fiche, à ce rang", classe: "text-muted-foreground" },
  PROCHE: { texte: "proche de … : choisissez l'article", classe: "text-amber-800" },
  AMBIGUE: { texte: "plusieurs articles portent ce nom : choisissez", classe: "text-amber-800" },
  LEGUME: { texte: "légume frais : déjà sur la fiche (liste des légumes)", classe: "text-muted-foreground" },
  ABSENTE: { texte: "absente du catalogue (aucun article n'est créé)", classe: "text-red-800" },
};

type Etat = { coche: boolean; articleId: string | null; remplacer: boolean };

/**
 * « Importer les lignes du classeur Commande journalière » (Direction) : pour chaque ligne du
 * classeur, l'article du catalogue proposé. Correspondance EXACTE cochée d'office ; « proche de … »
 * et homonymes décochés, l'article se choisit à la main ; jamais de rattachement deviné. Confirmer
 * met l'article « Sur la fiche commande », au rang et sous la rubrique du classeur, avec le nom du
 * classeur comme nom court s'il n'en a pas (un nom court existant n'est remplacé que sur case).
 */
export function ImportCommande() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const [propositions, setPropositions] = useState<PropositionCommande[] | null>(null);
  const [etats, setEtats] = useState<Record<string, Etat>>({});
  const [envoi, start] = useTransition();

  const lireFichier = async (f: File | undefined) => {
    setErreur(null); setMessage(null); setPropositions(null); setEtats({});
    if (!f) return;
    if (f.size > TAILLE_MAX) { setErreur("Fichier trop lourd (plus de 60 Mo) : ce n'est pas le classeur attendu."); return; }
    setLecture(true);
    try {
      const { lireClasseurCommande } = await import("@/lib/classeur-commande");
      const lu = await lireClasseurCommande(await f.arrayBuffer());
      if (!lu.ok) { setErreur(lu.erreur); return; }
      const r = await analyserClasseurCommande(lu.lignes);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setPropositions(r.propositions);
      setEtats(Object.fromEntries(r.propositions.map((p) => [p.cle, { coche: p.cochee, articleId: p.articleId, remplacer: false }])));
    } catch {
      setErreur("Fichier illisible : un classeur Excel (.xlsx) est attendu.");
    } finally {
      setLecture(false);
    }
  };

  const choisis = useMemo(() => (propositions ?? []).filter((p) => etats[p.cle]?.coche && etats[p.cle]?.articleId), [propositions, etats]);
  const maj = (cle: string, e: Partial<Etat>) => setEtats((s) => ({ ...s, [cle]: { ...s[cle]!, ...e } }));
  /** « Tout cocher » : seulement les lignes dont l'article est connu (jamais un choix à la place de la Direction). */
  const toutCocher = (oui: boolean) => setEtats((s) => {
    const n = { ...s };
    for (const p of propositions ?? []) if (n[p.cle]!.articleId && p.statut !== "DEJA") n[p.cle] = { ...n[p.cle]!, coche: oui };
    return n;
  });

  const appliquer = () => {
    setErreur(null);
    const choix: ChoixCommande[] = choisis.map((p) => ({ articleId: etats[p.cle]!.articleId!, feuille: p.feuille, rubrique: p.rubrique, rang: p.rang, nom: p.nom, remplacerNomCourt: etats[p.cle]!.remplacer }));
    start(async () => {
      const r = await appliquerImportCommande(choix);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setMessage(`${r.places} article(s) posé(s) sur la fiche commande · ${r.nomsCourts} nom(s) court(s) posé(s)${r.dejaAJour ? ` · ${r.dejaAJour} déjà à jour` : ""}${r.doublons ? ` · ${r.doublons} ligne(s) ignorée(s) : article déjà choisi pour une autre ligne` : ""}.`);
      setPropositions(null); setEtats({});
      router.refresh();
    });
  };

  if (!ouvert) {
    return (
      <div className="space-y-2">
        <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Importer les lignes du classeur Commande journalière</button>
        {message && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Importer les lignes du classeur « Commande journalière »</p>
        <button onClick={() => { setOuvert(false); setPropositions(null); setErreur(null); }} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
      <p className="text-xs text-muted-foreground">
        Déposez le classeur (.xlsx). Chaque ligne cochée met l&apos;article du catalogue « Sur la fiche commande », au rang et sous la rubrique du classeur ; le nom du classeur devient son nom court s&apos;il n&apos;en a pas. Aucun article n&apos;est créé, aucun rattachement n&apos;est deviné.
      </p>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={lecture || envoi}
        onChange={(e) => lireFichier(e.target.files?.[0])} className="block w-full max-w-md text-sm" aria-label="Classeur Commande journalière" />
      {lecture && <p className="text-sm text-muted-foreground">Lecture du classeur…</p>}
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {propositions && (
        <>
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm">
            <span className="font-medium">{choisis.length} ligne(s) cochée(s)</span>
            <button onClick={() => toutCocher(true)} className="rounded border px-2 py-1 hover:bg-accent">Tout cocher</button>
            <button onClick={() => toutCocher(false)} className="rounded border px-2 py-1 hover:bg-accent">Tout décocher</button>
            <button onClick={appliquer} disabled={envoi || choisis.length === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
              {envoi ? "Enregistrement…" : "Poser la sélection sur la fiche"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">« Tout cocher » ne coche que les lignes dont l&apos;article est connu : pour une ligne « proche », choisissez d&apos;abord l&apos;article.</p>
          {FEUILLES.map(({ feuille, titre }) => {
            const ps = propositions.filter((p) => p.feuille === feuille);
            if (ps.length === 0) return null;
            const groupes = [...new Set(ps.map((p) => p.rubrique))];
            return (
              <section key={feuille} className="space-y-1">
                <h3 className="text-sm font-semibold">{titre}</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
                    <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1.5">
                      {groupes.map((g) => (
                        <Fragment key={g}>
                          <tr className="bg-amber-100"><td colSpan={3} className="text-xs font-bold text-amber-900">{g}</td></tr>
                          {ps.filter((p) => p.rubrique === g).map((p) => {
                            const e = etats[p.cle]!;
                            const choisi = p.candidats.find((c) => c.id === e.articleId);
                            const choixPossible = p.candidats.length > 0 && p.statut !== "DEJA";
                            return (
                              <tr key={p.cle} className={e.coche ? "" : "text-muted-foreground"}>
                                <td className="w-8"><input type="checkbox" checked={e.coche} disabled={!e.articleId || p.statut === "DEJA"} onChange={(ev) => maj(p.cle, { coche: ev.target.checked })} aria-label={p.nom} /></td>
                                <td className="font-medium">{p.nom}{p.unite && <span className="ml-1 text-xs font-normal text-muted-foreground">({p.unite})</span>}</td>
                                <td className="text-xs">
                                  <span className={STATUT[p.statut].classe}>{STATUT[p.statut].texte}</span>
                                  {choixPossible && (
                                    <select value={e.articleId ?? ""} onChange={(ev) => maj(p.cle, { articleId: ev.target.value || null, coche: !!ev.target.value, remplacer: false })}
                                      className="mt-1 block max-w-full rounded border border-input bg-background px-1 py-0.5 text-xs" aria-label={`Article du catalogue pour ${p.nom}`}>
                                      <option value="">— choisir l&apos;article —</option>
                                      {p.candidats.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
                                    </select>
                                  )}
                                  {choisi?.nomCourt && choisi.nomCourt !== p.nom && (
                                    <label className="mt-1 flex items-center gap-1">
                                      <input type="checkbox" checked={e.remplacer} onChange={(ev) => maj(p.cle, { remplacer: ev.target.checked })} />
                                      remplacer le nom court « {choisi.nomCourt} » par « {p.nom} »
                                    </label>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
      {message && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p>}
    </div>
  );
}
