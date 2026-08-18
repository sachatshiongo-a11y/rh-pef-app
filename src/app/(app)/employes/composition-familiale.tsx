import type { MembreFamille } from "@prisma/client";
import { compterFamille, ecartCompositionFamiliale } from "@/lib/famille";
import { ajouterMembreFamille, supprimerMembreFamille } from "./actions";

const inputCls = "rounded border border-input bg-background px-2 py-1 text-sm";

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
}: {
  employeeId: string;
  membres: MembreFamille[];
  enfantsCompteur: number;
  ageLimiteEnfant: number;
  modifiable?: boolean;
}) {
  const comptage = compterFamille(membres, new Date(), ageLimiteEnfant);
  const ecart = ecartCompositionFamiliale(enfantsCompteur, comptage);

  return (
    <div className="space-y-3">
      {ecart && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{ecart.message}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        <Info label="Conjoint" valeur={comptage.conjoint || "—"} />
        <Info label="Enfants à charge retenus par la paie" valeur={String(enfantsCompteur)} />
        <Info
          label={`Enfants déduits des dates (< ${ageLimiteEnfant} ans)`}
          valeur={`${comptage.enfantsACharge} sur ${comptage.enfantsTotal} saisi(s)`}
        />
      </dl>

      {membres.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun membre saisi.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {membres.map((m) => (
            <span
              key={m.id}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${m.lien === "CONJOINT" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-800"}`}
            >
              {m.lien === "CONJOINT" ? "Conjoint" : "Enfant"} · {m.nom} ·{" "}
              {m.dateNaissance ? m.dateNaissance.toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "date inconnue"}
              {modifiable && (
                <form action={supprimerMembreFamille.bind(null, m.id)} className="inline">
                  <button className="opacity-70 hover:opacity-100" title="Retirer">✕</button>
                </form>
              )}
            </span>
          ))}
        </div>
      )}

      {modifiable && (
        <form action={ajouterMembreFamille.bind(null, employeeId)} className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-medium">Ajouter un membre</p>
          <div className="flex flex-wrap items-end gap-2">
            <select name="lien" defaultValue="ENFANT" className={inputCls}>
              <option value="ENFANT">Enfant</option>
              <option value="CONJOINT">Conjoint</option>
            </select>
            <input name="nom" placeholder="Nom et prénom" required className={inputCls} />
            <label className="flex flex-col text-xs text-muted-foreground">
              Date de naissance
              <input name="dateNaissance" type="date" className={inputCls} />
            </label>
            <button type="submit" className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">Ajouter</button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Justificatif de la réduction IPR pour charges de famille. Sans effet sur le calcul : la paie
            retient le champ « enfants » ci-dessus, modifiable dans le formulaire.
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
