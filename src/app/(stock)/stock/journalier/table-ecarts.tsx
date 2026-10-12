import { Fragment } from "react";
import { NOM_ESPACE, texteFenetre, texteInconnu, texteQuantiteEcart, texteTotalDevise, texteValeurEcart } from "@/lib/ecarts-ventes-presentation";
import type { EcartsVentes, LigneEcart } from "@/lib/ecarts-ventes";

// Onglet « Écarts ventes / consommation » de la Conso. journalière : par article du restaurant, la
// consommation RÉELLE (comptages + livraisons) face à la THÉORIQUE (ventes saisies × fiches techniques),
// l'écart en quantité et en valeur (prix de l'article, devise de saisie). SIGNAL SEULEMENT : rien n'est
// écrit, rien n'est corrigé. Composant de présentation, sans état : rendu côté serveur.

const EN_TETE_SECTION: Record<"CUISINE" | "BAR", string> = { CUISINE: "!bg-emerald-100 text-emerald-900", BAR: "!bg-indigo-100 text-indigo-900" };

function Ligne({ l }: { l: LigneEcart }) {
  const p = l.periode;
  const unite = l.unite ? <span className="font-normal text-muted-foreground"> ({l.unite})</span> : null;
  if (p.etat === "INCONNUE") {
    return (
      <tr className="hover:bg-accent/40 even:bg-muted/25" data-ecart="inconnu">
        <td className="sticky left-0 z-10 bg-background font-medium">{l.designation}{unite}</td>
        <td colSpan={5} className="text-muted-foreground" title={p.detail.join(" ; ")}>
          — {texteInconnu(p)}
          {p.detail.slice(0, 2).map((d, k) => <span key={k} className="block text-[11px]">{d}</span>)}
        </td>
      </tr>
    );
  }
  const positif = Number(p.ecart) > 0.0005, negatif = Number(p.ecart) < -0.0005;
  const ton = positif ? "font-semibold text-red-700" : negatif ? "font-medium text-sky-800" : "text-muted-foreground";
  const detail = `compté ${p.compteDebut} (${p.de.slice(8, 10)}/${p.de.slice(5, 7)}) + reçu ${p.recu} − compté ${p.compteFin} (${p.a.slice(8, 10)}/${p.a.slice(5, 7)})`;
  return (
    <tr className="hover:bg-accent/40 even:bg-muted/25" data-ecart={positif ? "plus" : negatif ? "moins" : "nul"}>
      <td className="sticky left-0 z-10 bg-background font-medium">{l.designation}{unite}</td>
      <td className="whitespace-nowrap text-xs text-muted-foreground">{texteFenetre(p)}{p.nbJours !== 7 && <span className="block text-[10px]">{p.nbJours} jours</span>}</td>
      <td className="text-right tabular-nums" title={detail}>{texteQuantiteEcart(p.reelle)}</td>
      <td className="text-right tabular-nums" title={p.parFiche.map((f) => `${f.ficheNom} : ${texteQuantiteEcart(f.quantiteResto)}`).join(" ; ") || "aucune vente saisie dans la fenêtre"}>{texteQuantiteEcart(p.theorique)}</td>
      <td className={`text-right tabular-nums ${ton}`}>{texteQuantiteEcart(p.ecart, true)}</td>
      <td className={`text-right tabular-nums ${ton}`}>{l.valeur ? texteValeurEcart(l.valeur) : <span className="font-normal text-muted-foreground" title="Aucun prix connu sur l'article rattaché">sans prix</span>}</td>
    </tr>
  );
}

export function TableEcarts({ ecarts, espaces, periode }: { ecarts: EcartsVentes; espaces: readonly ("CUISINE" | "BAR")[]; periode: string }) {
  const vide = espaces.every((e) => ecarts[e].length === 0);
  return (
    <div className="tableau-normal-xl rounded-lg border" data-vue="ecarts">
      <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
        <thead className="en-tete-collante-xl bg-muted text-left shadow-sm">
          <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
            <th className="sticky left-0 z-30 bg-muted">Article du restaurant</th>
            <th>Comparé</th>
            <th className="!text-right" title="Compté au début + reçu du dépôt − compté à la fin">Réel</th>
            <th className="!text-right" title="Ventes saisies × quantités des fiches techniques">Théorique</th>
            <th className="!text-right" title="Réel − théorique : positif = consommé en plus de ce que les ventes expliquent">Écart</th>
            <th className="!text-right" title="Écart × prix de l'article, dans la devise de saisie du prix">Valeur de l&apos;écart</th>
          </tr>
        </thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
          {espaces.map((esp) => ecarts[esp].length === 0 ? null : (
            <Fragment key={esp}>
              <tr><td colSpan={6} className={`sticky left-0 !py-1.5 text-xs font-bold tracking-wide ${EN_TETE_SECTION[esp]}`}>{NOM_ESPACE[esp]} — du plus gros écart au plus petit</td></tr>
              {ecarts[esp].map((l) => <Ligne key={l.articleRestoId} l={l} />)}
              {(["USD", "CDF"] as const).map((d) => ecarts.totaux[esp][d] === undefined ? null : (
                <tr key={d} className="bg-muted/40 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted/40" colSpan={5}>Total net {NOM_ESPACE[esp]} ({d === "USD" ? "dollars" : "francs"}) — les écarts de sens contraire s&apos;annulent</td>
                  <td className="text-right tabular-nums">{texteTotalDevise(ecarts.totaux[esp][d]!, d)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {vide && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun article du restaurant rattaché au catalogue à comparer ({periode}).</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
