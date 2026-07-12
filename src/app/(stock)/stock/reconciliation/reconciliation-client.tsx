"use client";

import Link from "next/link";
import { Fragment, memo, useMemo, useState, useTransition, type ReactNode } from "react";
import { appliquerComptage } from "./actions";
import { qte, SEUIL_TOLERANCE_PCT } from "@/lib/stock";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";

type Art = { id: string; code: string | null; designation: string; categorie: string; theorique: number };
type TriCol = "code" | "designation" | "categorie" | "theorique";
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const valeurTri = (a: Art, col: TriCol): string | number =>
  col === "code" ? (a.code && Number.isFinite(Number(a.code)) ? Number(a.code) : a.code ? Number.MAX_SAFE_INTEGER : Number.POSITIVE_INFINITY) :
  col === "designation" ? a.designation.toLowerCase() :
  col === "categorie" ? a.categorie.toLowerCase() :
  col === "theorique" ? a.theorique : 0;

function ThTri({ col, tri, onTri, align, className, children }: {
  col: TriCol; tri: { col: TriCol; dir: 1 | -1 } | null; onTri: (c: TriCol) => void;
  align?: "right"; className?: string; children: ReactNode;
}) {
  const actif = tri?.col === col;
  return (
    <th className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={() => onTri(col)} className={`inline-flex items-center gap-0.5 font-semibold hover:text-primary ${align === "right" ? "flex-row-reverse" : ""} ${actif ? "text-primary" : ""}`}>
        {children}<span className="w-2 text-[10px]">{actif ? (tri!.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

// Ligne mémoïsée à état propre : taper ne re-rend QUE cette ligne (perf sur des centaines d'articles).
const LigneComptage = memo(function LigneComptage({ a, montrerCat }: { a: Art; montrerCat: boolean }) {
  const [v, setV] = useState("");
  const [expl, setExpl] = useState("");
  const num = Number(v.replace(",", "."));
  const valide = v !== "" && Number.isFinite(num);
  const ecart = valide ? num - a.theorique : null;
  const pct = ecart === null ? null : a.theorique !== 0 ? (ecart / Math.abs(a.theorique)) * 100 : ecart !== 0 ? 100 : 0;
  const horsTol = ecart !== null && Math.abs(ecart) > 0.0001 && (a.theorique === 0 ? num !== 0 : Math.abs(pct!) > SEUIL_TOLERANCE_PCT);
  const couleurEcart = ecart === null ? "text-muted-foreground" : ecart === 0 ? "text-emerald-700" : horsTol ? "text-red-700" : ecart > 0 ? "text-blue-700" : "text-amber-700";
  return (
    <>
      <tr className={`even:bg-muted/25 hover:bg-accent/40 ${horsTol ? "bg-red-50/50" : ""}`}>
        <td className="text-center tabular-nums text-muted-foreground">{a.code ?? ""}</td>
        <td className="font-medium"><Link href={`/stock/catalogue/${a.id}`} className="text-primary hover:underline">{a.designation}</Link></td>
        <td className="text-muted-foreground">{montrerCat ? a.categorie : ""}</td>
        <td className="text-right tabular-nums text-muted-foreground">{qte(a.theorique)}</td>
        <td className="text-right">
          <input type="hidden" name="recon_articleId" value={a.id} />
          <input name="recon_physique" type="number" step="0.001" value={v} onChange={(e) => setV(e.target.value)} placeholder="0" className={`${inp} w-24 text-right`} />
        </td>
        <td className={`text-right font-medium tabular-nums ${couleurEcart}`}>
          {ecart === null ? "—" : <>{ecart > 0 ? "+" : ""}{qte(ecart)}{pct !== null && a.theorique !== 0 ? <span className="ml-1 text-xs">({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)</span> : null}</>}
          {!horsTol && <input type="hidden" name="recon_explication" value="" />}
        </td>
      </tr>
      {horsTol && (
        <tr><td colSpan={6} className="!pt-0">
          <input name="recon_explication" value={expl} onChange={(e) => setExpl(e.target.value)} required placeholder={`Écart > ${SEUIL_TOLERANCE_PCT} % — expliquez la raison (obligatoire)`} className={`${inp} w-full border-red-300`} />
        </td></tr>
      )}
    </>
  );
});

export function ReconciliationForm({ articles, domaine, estDirection = false }: { articles: Art[]; domaine?: string; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [cle, setCle] = useState(0);
  const [q, setQ] = useState("");
  const [tri, setTri] = useState<{ col: TriCol; dir: 1 | -1 } | null>(null);
  const reinitialiser = () => { setMsg(null); setCle((c) => c + 1); };
  const trierPar = (col: TriCol) => setTri((t) => (t?.col !== col ? { col, dir: 1 } : t.dir === 1 ? { col, dir: -1 } : null));

  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    return nq ? articles.filter((a) => norm(a.designation).includes(nq) || norm(a.categorie).includes(nq) || (a.code ?? "").toLowerCase().includes(nq)) : articles;
  }, [articles, q]);
  const affichees = useMemo(() => {
    if (!tri) return visibles;
    return [...visibles].sort((a, b) => { const x = valeurTri(a, tri.col), y = valeurTri(b, tri.col); return (x < y ? -1 : x > y ? 1 : 0) * tri.dir; });
  }, [visibles, tri]);

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await appliquerComptage(fd); setMsg({ ok: true, texte: "Comptage appliqué : le stock a été ajusté au réel." }); setCle((c) => c + 1); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  return (
    <form key={cle} action={submit} className="space-y-3">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}
      {domaine && <input type="hidden" name="domaine" value={domaine} />}

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <input name="origine" placeholder="Libellé du comptage (ex. Inventaire fin de mois)" className={`${inp} w-full sm:w-auto sm:min-w-64 sm:flex-1`} />
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Application…" : "Appliquer le comptage"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article (code, nom, catégorie)…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        <span className="text-xs text-muted-foreground">{visibles.length} / {articles.length} article(s) · écart &gt; {SEUIL_TOLERANCE_PCT}% ⇒ explication requise</span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border [scrollbar-gutter:stable]">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <ThTri col="code" tri={tri} onTri={trierPar} className="w-16">Code</ThTri>
              <ThTri col="designation" tri={tri} onTri={trierPar}>Désignation</ThTri>
              <ThTri col="categorie" tri={tri} onTri={trierPar}>Catégorie</ThTri>
              <ThTri col="theorique" tri={tri} onTri={trierPar} align="right" className="w-24">Théorique</ThTri>
              <th className="w-28 text-right">Physique</th>
              <th className="w-24 text-right">Écart</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
            {affichees.map((a, i) => (
              <Fragment key={a.id}>
                {!tri && (i === 0 || affichees[i - 1].categorie !== a.categorie) && (
                  <tr><td colSpan={6} className="!bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{a.categorie} ({visibles.filter((x) => x.categorie === a.categorie).length})</td></tr>
                )}
                <LigneComptage a={a} montrerCat={!!tri} />
              </Fragment>
            ))}
            {affichees.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
        </table>
      </div>
    </form>
  );
}
