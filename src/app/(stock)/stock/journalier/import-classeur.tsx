"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { estErreur } from "@/lib/action-lisible";
import type { PropositionImport } from "@/lib/classeur-ventes";
import { analyserClasseurVentes, appliquerImportClasseur, type ChoixImport } from "./import-classeur-actions";

/** Taille maximale du fichier déposé (le classeur de PEF fait 25 Mo, logo compris). */
const TAILLE_MAX = 60 * 1024 * 1024;

const FEUILLES = [
  { feuille: "CUISINE" as const, titre: "Feuille Cuisine → fiches « Plat vendu »" },
  { feuille: "BAR" as const, titre: "Feuille Bar → fiches Bar" },
];

type Etat = { action: PropositionImport["action"]; ficheId: string | null };

/**
 * « Importer les lignes du classeur » (Direction) : la Direction dépose son classeur « Rapport
 * journalier cuisine et bar » ; les lignes absentes de l'application sont listées par feuille et
 * par rubrique, cochées par défaut — sauf la rubrique « Pâtes » (choix d'une forme, pas une vente)
 * et les lignes « proches » d'une fiche existante, qui ne sont JAMAIS fusionnées d'office : la
 * Direction choisit « créer » ou « c'est cette fiche ». Les lignes déjà présentes reprennent le
 * libellé et le rang du classeur. Le fichier est lu dans le navigateur : seul le résultat part.
 */
export function ImportClasseur() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const [propositions, setPropositions] = useState<PropositionImport[] | null>(null);
  const [etats, setEtats] = useState<Record<string, Etat>>({});
  const [rubriques, setRubriques] = useState<Record<string, string>>({});
  const [envoi, start] = useTransition();

  const reinitialiser = () => { setPropositions(null); setEtats({}); setRubriques({}); };

  const lireFichier = async (f: File | undefined) => {
    setErreur(null); setMessage(null); reinitialiser();
    if (!f) return;
    if (f.size > TAILLE_MAX) { setErreur("Fichier trop lourd (plus de 60 Mo) : ce n'est pas le classeur attendu."); return; }
    setLecture(true);
    try {
      const { lireClasseurVentes } = await import("@/lib/classeur-ventes");
      const lu = await lireClasseurVentes(await f.arrayBuffer());
      if (!lu.ok) { setErreur(lu.erreur); return; }
      const r = await analyserClasseurVentes(lu.lignes);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setPropositions(r.propositions);
      setEtats(Object.fromEntries(r.propositions.map((p) => [p.cle, { action: p.action, ficheId: p.ficheId }])));
      setRubriques(Object.fromEntries(r.propositions.map((p) => [`${p.feuille}|${p.rubriqueClasseur}`, p.rubrique])));
    } catch {
      setErreur("Fichier illisible : un classeur Excel (.xlsx) est attendu.");
    } finally {
      setLecture(false);
    }
  };

  const coches = useMemo(() => (propositions ?? []).filter((p) => etats[p.cle]?.action !== "ignorer"), [propositions, etats]);
  const nbCreer = coches.filter((p) => etats[p.cle]?.action === "creer").length;

  const cocher = (p: PropositionImport, oui: boolean) =>
    setEtats((e) => ({ ...e, [p.cle]: { ficheId: e[p.cle]?.ficheId ?? p.ficheId, action: !oui ? "ignorer" : p.statut === "PRESENTE" ? "ordre" : "creer" } }));
  /** « Tout cocher » ne touche JAMAIS aux lignes « proches » : chacune se décide à la main. */
  const toutCocher = (oui: boolean, parmi = propositions ?? []) => {
    setEtats((e) => {
      const n = { ...e };
      for (const p of parmi) if (p.proches.length === 0) n[p.cle] = { ficheId: p.ficheId, action: !oui ? "ignorer" : p.statut === "PRESENTE" ? "ordre" : "creer" };
      return n;
    });
  };

  const appliquer = () => {
    if (!propositions) return;
    setErreur(null);
    const choix: ChoixImport[] = coches.map((p) => {
      const e = etats[p.cle]!;
      return {
        feuille: p.feuille, nom: p.nom, rang: p.rang,
        rubrique: (rubriques[`${p.feuille}|${p.rubriqueClasseur}`] ?? p.rubrique).trim() || p.rubrique,
        action: e.action as ChoixImport["action"],
        ficheId: e.action === "creer" ? null : e.ficheId,
      };
    });
    start(async () => {
      const r = await appliquerImportClasseur(choix);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setMessage(`${r.crees} fiche(s) créée(s), sans recette · ${r.reprises} fiche(s) existante(s) reprise(s) au libellé et à l'ordre du classeur${r.dejaPresentes ? ` · ${r.dejaPresentes} déjà à jour` : ""}. Complétez les recettes depuis Fiches techniques.`);
      reinitialiser();
      router.refresh();
    });
  };

  if (!ouvert) {
    return (
      <div className="space-y-2">
        <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Importer les lignes du classeur</button>
        {message && <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Importer les lignes du classeur « Rapport journalier cuisine et bar »</p>
        <button onClick={() => { setOuvert(false); reinitialiser(); setErreur(null); }} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
      <p className="text-xs text-muted-foreground">
        Déposez le classeur (.xlsx). Les lignes absentes deviennent des fiches techniques SANS recette (feuille Cuisine → « Plat vendu », feuille Bar → fiche Bar), au nom exact du classeur ; les lignes déjà présentes reprennent son libellé et son ordre. Une ligne « proche » d&apos;une fiche existante n&apos;est jamais fusionnée : décidez-la vous-même.
      </p>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={lecture || envoi}
        onChange={(e) => lireFichier(e.target.files?.[0])} className="block w-full max-w-md text-sm" aria-label="Classeur Rapport journalier cuisine et bar" />
      {lecture && <p className="text-sm text-muted-foreground">Lecture du classeur…</p>}
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {propositions && (
        <>
          {/* Barre d'actions groupées, collée en haut pendant le défilement. */}
          <div className="sticky colle-sous-entete z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm">
            <span className="font-medium">{coches.length} ligne(s) cochée(s) · {nbCreer} à créer</span>
            <button onClick={() => toutCocher(true)} className="rounded border px-2 py-1 hover:bg-accent">Tout cocher</button>
            <button onClick={() => toutCocher(false)} className="rounded border px-2 py-1 hover:bg-accent">Tout décocher</button>
            <button onClick={appliquer} disabled={envoi || coches.length === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
              {envoi ? "Création…" : "Créer la sélection"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">« Tout cocher » laisse de côté les lignes « proches » : chacune se décide à la main.</p>

          {FEUILLES.map(({ feuille, titre }) => {
            const ps = propositions.filter((p) => p.feuille === feuille);
            if (ps.length === 0) return null;
            const groupes = [...new Set(ps.map((p) => p.rubriqueClasseur))];
            return (
              <section key={feuille} className="space-y-1">
                <h3 className="text-sm font-semibold">{titre}</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
                    <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1.5">
                      {groupes.map((g) => {
                        const lignes = ps.filter((p) => p.rubriqueClasseur === g);
                        const cleG = `${feuille}|${g}`;
                        const tous = lignes.filter((p) => p.proches.length === 0).every((p) => etats[p.cle]?.action !== "ignorer");
                        return (
                          <Fragment key={cleG}>
                            <tr className="bg-amber-100">
                              <td className="w-8"><input type="checkbox" checked={tous} onChange={(e) => toutCocher(e.target.checked, lignes)} aria-label={`Cocher la rubrique ${g}`} /></td>
                              <td colSpan={2}>
                                <label className="flex flex-wrap items-center gap-2 text-xs font-bold text-amber-900">
                                  Rubrique
                                  <input value={rubriques[cleG] ?? g} onChange={(e) => setRubriques((r) => ({ ...r, [cleG]: e.target.value }))}
                                    className="min-w-48 rounded border border-input bg-background px-2 py-0.5 text-xs font-medium text-foreground" aria-label={`Nom de la rubrique ${g}`} />
                                </label>
                              </td>
                            </tr>
                            {lignes.map((p) => {
                              const e = etats[p.cle] ?? { action: p.action, ficheId: p.ficheId };
                              const coche = e.action !== "ignorer";
                              const candidates = p.proches.filter((x) => x.ficheId);
                              return (
                                <tr key={p.cle} className={coche ? "" : "text-muted-foreground"}>
                                  <td><input type="checkbox" checked={coche} onChange={(ev) => cocher(p, ev.target.checked)} aria-label={p.nom} /></td>
                                  <td className="font-medium">{p.nom}</td>
                                  <td className="text-xs">
                                    {p.statut === "PRESENTE" && <span className="text-emerald-800">déjà présente : libellé et ordre du classeur repris</span>}
                                    {p.statut === "ABSENTE" && p.proches.length === 0 && <span>à créer</span>}
                                    {p.proches.map((x, k) => <div key={k} className="text-amber-800">proche de {x.libelle}</div>)}
                                    {p.statut === "ABSENTE" && coche && candidates.length > 0 && (
                                      <select value={e.action === "rattacher" ? `r:${e.ficheId}` : "creer"} className="mt-1 max-w-full rounded border border-input bg-background px-1 py-0.5 text-xs"
                                        onChange={(ev) => { const v = ev.target.value; setEtats((s) => ({ ...s, [p.cle]: v === "creer" ? { action: "creer", ficheId: null } : { action: "rattacher", ficheId: v.slice(2) } })); }}
                                        aria-label={`Que faire de ${p.nom}`}>
                                        <option value="creer">Créer une nouvelle fiche</option>
                                        {candidates.map((x) => <option key={x.ficheId} value={`r:${x.ficheId}`}>C&apos;est {x.libelle.replace(/^même nom : /, "")} (reprendre libellé et ordre)</option>)}
                                      </select>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
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
