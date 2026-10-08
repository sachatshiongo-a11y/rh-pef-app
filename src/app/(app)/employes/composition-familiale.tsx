import type { MembreFamille } from "@prisma/client";
import { ageEnAnnees, compterFamille, ecartCompositionFamiliale } from "@/lib/famille";
import { ajouterMembreFamille, supprimerMembreFamille } from "./actions";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

const inputCls = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground";

/**
 * Composition familiale — justificatif nominatif de la réduction IPR pour charges de famille.
 *
 * Deux usages, un seul composant :
 *   - la FICHE l'affiche en lecture seule (`modifiable` absent) — c'est un aperçu ;
 *   - la page MODIFIER l'édite, comme la photo, qui suit déjà cette règle.
 *
 * Ne pilote AUCUN calcul : `Employee.enfants` reste la source de la paie. Un écart entre le
 * compteur et la fiche nominative est SIGNALÉ, jamais appliqué en silence — corriger un nombre
 * d'enfants à charge déplace un montant payé, et cette décision appartient à la Direction.
 */
export function CompositionFamiliale({
  employeeId,
  membres,
  enfantsCompteur,
  ageLimiteEnfant,
  modifiable,
  peutRetirer = false,
}: {
  employeeId: string;
  membres: MembreFamille[];
  enfantsCompteur: number;
  ageLimiteEnfant: number;
  modifiable?: boolean;
  /** Direction seulement : retirer un membre (ou remplacer le conjoint) est une suppression. */
  peutRetirer?: boolean;
}) {
  const aujourdhui = jourCivilKinshasa(new Date());
  const comptage = compterFamille(membres, aujourdhui, ageLimiteEnfant);
  const ecart = ecartCompositionFamiliale(enfantsCompteur, comptage);

  return (
    <div className="space-y-3">
      {ecart && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{ecart.message}</p>
      )}

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Info label="Conjoint" valeur={comptage.conjoint || "—"} />
        <Info label="Enfants à charge retenus par la paie" valeur={String(enfantsCompteur)} />
        <Info
          label={`Enfants déduits des dates (< ${ageLimiteEnfant} ans)`}
          valeur={`${comptage.enfantsACharge} sur ${comptage.enfantsTotal} saisi(s)`}
        />
      </dl>

      {/* Une ligne par membre : lien, nom, naissance (âge, à charge ou non), retrait — lisible d'un coup d'œil. */}
      {membres.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun membre saisi.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {membres.map((m) => {
            const age = m.dateNaissance ? ageEnAnnees(m.dateNaissance, aujourdhui) : null;
            return (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className={`w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium ${m.lien === "CONJOINT" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-800"}`}>
                  {m.lien === "CONJOINT" ? "Conjoint" : "Enfant"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.nom}</span>
                  <span className="block text-xs text-muted-foreground">
                    {m.dateNaissance ? (
                      <>
                        né(e) le {m.dateNaissance.toLocaleDateString("fr-FR", { timeZone: "UTC" })} · {age} an{age === 1 ? "" : "s"}
                        {m.lien === "ENFANT" && (age! < ageLimiteEnfant ? " · à charge" : " · plus à charge")}
                      </>
                    ) : (
                      <span className="text-amber-700">date de naissance inconnue{m.lien === "ENFANT" ? " — non compté à charge" : ""}</span>
                    )}
                  </span>
                </span>
                {modifiable && peutRetirer && (
                  <form action={supprimerMembreFamille.bind(null, m.id)}>
                    <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive" title={`Retirer ${m.nom}`} aria-label={`Retirer ${m.nom}`}>✕</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {modifiable && (
        <form action={ajouterMembreFamille.bind(null, employeeId)} className="rounded-lg border bg-muted/20 p-3">
          {/* Ajout en une rangée : lien, nom, date, bouton (passe à la ligne sur téléphone). */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Ajouter un membre
              <select name="lien" defaultValue="ENFANT" className={inputCls}>
                <option value="ENFANT">Enfant</option>
                {/* Un conjoint déjà saisi ne se remplace que par la Direction (le remplacer l'efface). */}
                {(peutRetirer || !membres.some((m) => m.lien === "CONJOINT")) && <option value="CONJOINT">Conjoint</option>}
              </select>
            </label>
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Nom et prénom
              <input name="nom" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Date de naissance
              <input name="dateNaissance" type="date" className={inputCls} />
            </label>
            <button type="submit" className="rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent">Ajouter</button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Justificatif de la réduction IPR pour charges de famille. Sans effet sur le calcul : la paie
            retient le champ « Enfants à charge » de la rémunération, modifiable dans le formulaire.
          </p>
        </form>
      )}
    </div>
  );
}

function Info({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{valeur}</dd>
    </div>
  );
}
