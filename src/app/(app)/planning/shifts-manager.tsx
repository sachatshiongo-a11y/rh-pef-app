import type { Shift } from "@prisma/client";
import { creerShift, modifierShift, supprimerShift, reactiverShift } from "./actions";
import { COULEURS_DISPO, paletteDe } from "./creneaux";

function ChampsShift({ shift }: { shift?: Shift }) {
  return (
    <>
      <input
        name="nom"
        defaultValue={shift?.nom ?? ""}
        placeholder="Nom"
        required
        className="w-28 rounded border border-input bg-background px-2 py-1 text-sm"
      />
      <input
        name="heureDebut"
        defaultValue={shift?.heureDebut ?? ""}
        placeholder="08:00"
        className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
      />
      <input
        name="heureFin"
        defaultValue={shift?.heureFin ?? ""}
        placeholder="14:00"
        className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
      />
      <select
        name="couleur"
        defaultValue={shift?.couleur ?? "indigo"}
        className="rounded border border-input bg-background px-2 py-1 text-sm"
      >
        {COULEURS_DISPO.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <input
        name="dureeHeures"
        type="number"
        step="0.25"
        min="0"
        defaultValue={shift?.dureeHeures != null ? String(shift.dureeHeures) : ""}
        placeholder="h (auto)"
        title="Durée en heures (laisser vide = calculée depuis les horaires)"
        className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
      />
      <input
        name="tauxHoraireUSD"
        type="number"
        step="0.0001"
        min="0"
        defaultValue={shift?.tauxHoraireUSD != null ? String(shift.tauxHoraireUSD) : ""}
        placeholder="$/h (défaut)"
        title="Taux horaire de ce rôle (laisser vide = taux par défaut de l'employé)"
        className="w-24 rounded border border-input bg-background px-2 py-1 text-sm"
      />
    </>
  );
}

export function ShiftsManager({ shifts, peutModifier }: { shifts: Shift[]; peutModifier: boolean }) {
  if (!peutModifier) return null;
  return (
    <details className="mb-6 rounded-xl border bg-card">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">
        ⚙️ Gérer les shifts (heures, couleurs, ajout/suppression)
      </summary>
      <div className="space-y-2 border-t p-4">
        {shifts.map((s) => {
          const pal = paletteDe(s.couleur);
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-1 text-xs font-medium ${pal.classe}`}>
                {s.nom}
                {s.heureDebut && s.heureFin ? ` ${s.heureDebut}–${s.heureFin}` : ""}
              </span>
              {!s.actif && <span className="text-xs text-muted-foreground">(désactivé)</span>}
              {s.systeme && <span className="text-xs text-muted-foreground">système</span>}

              <form action={modifierShift} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={s.id} />
                <ChampsShift shift={s} />
                <button type="submit" className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">
                  Enregistrer
                </button>
              </form>

              {!s.systeme &&
                (s.actif ? (
                  <form action={supprimerShift.bind(null, s.id)}>
                    <button type="submit" className="rounded-md border border-destructive px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10">
                      Supprimer
                    </button>
                  </form>
                ) : (
                  <form action={reactiverShift.bind(null, s.id)}>
                    <button type="submit" className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent">
                      Réactiver
                    </button>
                  </form>
                ))}
            </div>
          );
        })}

        <form action={creerShift} className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-sm font-medium">Nouveau shift :</span>
          <ChampsShift />
          <button type="submit" className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
            + Ajouter
          </button>
        </form>
        <p className="text-xs text-muted-foreground">
          Heures au format HH:MM (laisser vide pour Repos/Congé/Férié). <span className="font-medium">Durée</span> et{" "}
          <span className="font-medium">taux horaire</span> facultatifs par shift : servent aux rôles à
          horaires/tarifs différents (ex. serveuse vs assistante admin). Vides = durée déduite des
          horaires et taux par défaut de l&apos;employé. Rappel : le shift « Nuit » n&apos;ouvre aucune
          majoration de nuit en paie.
        </p>
      </div>
    </details>
  );
}
