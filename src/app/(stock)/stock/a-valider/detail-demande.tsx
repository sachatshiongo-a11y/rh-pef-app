// Contenu d'une demande à valider, tel que la Direction doit le voir pour décider : factures et
// restes, écarts de comptage et leur valeur, avant/après champ par champ — et ce qui a changé
// depuis (alerte). Composant de PRÉSENTATION pur (ni état ni action) : rendu sur la page
// « Demandes à valider » (composant client) comme sur la fiche facture / article (serveur).
import Link from "next/link";
import type { ApercuDemande } from "@/lib/validations-stock/apercu";
import { formaterFC, formaterNombre, formaterUSD, montantSigne } from "@/lib/montant";

const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const nb = (s: string) => formaterNombre(Number(s), { maximumFractionDigits: 3 });

/** Montant signé : négatif entre parenthèses et en rouge, jamais « − » (convention des montants). */
function Signe({ n }: { n: number }) {
  const m = montantSigne(n, "USD");
  return <span className={m.negatif ? "text-red-700" : undefined}>{m.texte}</span>;
}

export function AlertesDemande({ a }: { a: ApercuDemande }) {
  if (a.alertes.length === 0) return null;
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
      <p className="font-semibold">⚠ Elle ne peut plus être validée telle quelle — refusez-la :</p>
      <ul className="mt-0.5 list-disc pl-4">{a.alertes.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
}

export function DetailDemande({ a }: { a: ApercuDemande }) {
  if (a.paiement) {
    const p = a.paiement;
    return (
      <div className="space-y-1.5 text-sm">
        <ul className="divide-y rounded-md border">
          {p.factures.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <Link href={`/stock/factures/${f.id}`} className="font-medium text-primary hover:underline">{f.numero ? `N° ${f.numero}` : "Sans numéro"} · {f.nom}</Link>
              <span className="tabular-nums">
                {p.reglement ? <span className="text-muted-foreground">reste {formaterUSD(f.resteDemande)}</span> : <b>{formaterUSD(f.resteDemande)}</b>}
                {f.resteActuel !== null && Math.abs(f.resteActuel - f.resteDemande) > 0.001 && <span className="ml-2 text-red-700">aujourd&apos;hui {formaterUSD(f.resteActuel)}</span>}
              </span>
            </li>
          ))}
        </ul>
        {p.reglement && (
          <p>
            {p.reglement.type === "AVOIR" ? "Avoir" : "Paiement"} de{" "}
            {p.reglement.montantCDF !== null ? (
              // En francs : le montant saisi, et son équivalent au taux qui SERA appliqué (celui des
              // Paramètres au moment de la validation — aujourd'hui, s'il est validé maintenant).
              <>
                <b className="tabular-nums">{formaterFC(p.reglement.montantCDF)}</b>{" "}
                {p.reglement.montantUSD !== null && p.reglement.tauxActuel !== null
                  ? <>≈ <b className="tabular-nums">{formaterUSD(p.reglement.montantUSD)}</b> au taux du jour ({formaterNombre(p.reglement.tauxActuel)} FC/$), appliqué à la validation</>
                  : <>— équivalent en dollars : — (taux de change non configuré)</>}
              </>
            ) : <b className="tabular-nums">{p.reglement.montantUSD === null ? "—" : formaterUSD(p.reglement.montantUSD)}</b>}
            {p.reglement.mode && <> · {p.reglement.mode}</>}
            {p.reglement.note && <> · « {p.reglement.note} »</>}
          </p>
        )}
        {!p.reglement && p.factures.length > 1 && <p>Total : <b className="tabular-nums">{p.total === null ? "—" : formaterUSD(p.total)}</b> — tout ou rien.</p>}
        <p className="text-xs text-muted-foreground">Date de paiement proposée : {dateFr(p.date)}</p>
      </div>
    );
  }

  if (a.comptage) {
    const c = a.comptage;
    const bouge = c.lignes.some((l) => l.etat === "mouvemente");
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-xs text-muted-foreground">
          {c.origine} · {c.lignes.length} écart(s) sur {c.nbLignes} article(s) compté(s)
          {c.valeurTotale !== null ? <> · valeur des écarts <b><Signe n={c.valeurTotale} /></b></> : " · valeur des écarts : — (prix manquant)"}
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[36rem] text-xs">
            <thead className="bg-muted text-left">
              <tr className="[&>th]:px-2 [&>th]:py-1.5">
                <th>Article</th><th className="text-right">Théorique</th><th className="text-right">Compté</th><th className="text-right">Écart</th><th className="text-right">Valeur</th>
                {bouge && <th className="text-right">Stock actuel → après</th>}
              </tr>
            </thead>
            <tbody>
              {c.lignes.map((l) => (
                <tr key={l.articleId} className={`border-t align-top ${l.etat === "conflit" ? "bg-red-50" : ""}`}>
                  <td className="px-2 py-1">
                    <Link href={`/stock/catalogue/${l.articleId}`} className="font-medium text-primary hover:underline">{l.designation}</Link>
                    {l.explication && <span className="block text-[11px] text-muted-foreground">« {l.explication} »</span>}
                    {l.raison && <span className="block text-[11px] text-red-700">{l.raison}</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{nb(l.theorique)}{l.unite ? ` ${l.unite}` : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{nb(l.physique)}</td>
                  <td className={`px-2 py-1 text-right font-medium tabular-nums ${Number(l.ecart) < 0 ? "text-red-700" : "text-emerald-700"}`}>{Number(l.ecart) > 0 ? "+" : ""}{nb(l.ecart)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.valeur === null ? "—" : <Signe n={l.valeur} />}</td>
                  {bouge && <td className="px-2 py-1 text-right tabular-nums">{l.etat === "mouvemente" ? `${nb(l.actuel)} → ${nb(l.final!)}` : l.etat === "conflit" ? "—" : "inchangé"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {bouge && <p className="text-[11px] text-muted-foreground">Le stock a bougé depuis le comptage (entrées/sorties enregistrées) : l&apos;écart constaté est appliqué au stock actuel, sans effacer ces mouvements.</p>}
      </div>
    );
  }

  if (a.mouvement) {
    const m = a.mouvement;
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-xs text-muted-foreground">{m.type === "ENTREE" ? "Entrée" : "Sortie"} manuelle « {m.origine} » · datée du {new Date(m.date).toLocaleDateString("fr-FR", { timeZone: "UTC" })}</p>
        {m.saisisDepuis.length > 0 && (
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {m.type === "ENTREE" ? "Une entrée" : "Une sortie"} manuelle a été saisie en direct depuis cette demande sur {m.saisisDepuis.map((d) => `« ${d} »`).join(", ")} : s&apos;il s&apos;agit du même mouvement, refusez la demande (sinon il serait compté deux fois).
          </p>
        )}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[30rem] text-xs">
            <thead className="bg-muted text-left">
              <tr className="[&>th]:px-2 [&>th]:py-1.5"><th>Article</th><th className="text-right">Quantité</th><th className="text-right">Stock actuel → après</th><th className="text-right">Valeur</th></tr>
            </thead>
            <tbody>
              {m.lignes.map((l) => (
                <tr key={l.articleId} className="border-t">
                  <td className="px-2 py-1"><Link href={`/stock/catalogue/${l.articleId}`} className="font-medium text-primary hover:underline">{l.designation}</Link></td>
                  <td className={`px-2 py-1 text-right font-medium tabular-nums ${m.type === "SORTIE" ? "text-red-700" : "text-emerald-700"}`}>{m.type === "SORTIE" ? "-" : "+"}{nb(l.quantite)}{l.unite ? ` ${l.unite}` : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{nb(l.actuel)} → {nb(l.apres)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.valeur === null ? "—" : <Signe n={l.valeur} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (a.article) {
    return (
      <div className="space-y-2 text-sm">
        {a.article.articles.map((art) => (
          <div key={art.id} className="rounded-md border">
            <Link href={`/stock/catalogue/${art.id}`} className="block border-b bg-muted/40 px-3 py-1 font-medium text-primary hover:underline">{art.designation}</Link>
            <ul className="divide-y text-xs">
              {art.changements.map((c) => (
                <li key={c.libelle} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-2 px-3 py-1">
                  <span className="text-muted-foreground">{c.libelle}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-muted-foreground line-through">{c.avant}</span> → <b>{c.apres}</b>
                    {c.actuel !== null && <span className="ml-2 text-red-700">(aujourd&apos;hui : {c.actuel})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }
  return null;
}
