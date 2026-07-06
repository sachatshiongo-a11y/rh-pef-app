import Link from "next/link";
import { transformerContrat, rompreContrat, prolongerContrat } from "./contrat-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

export type ContratRow = {
  id: string;
  employeeId: string;
  nom: string;
  type: string;
  dateDebut: string;
  dateFin: string | null;
  finPeriodeEssai: string | null;
};

export function SuiviContrats({
  contrats,
  peutGerer,
  estAdmin,
}: {
  contrats: ContratRow[];
  peutGerer: boolean;
  estAdmin: boolean;
}) {
  if (contrats.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Aucun contrat à échéance, entrée ou fin de période d&apos;essai ce mois-ci.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {contrats.map((c) => (
        <div key={c.id} className="rounded-xl border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link href={`/employes/${c.employeeId}`} className="font-semibold hover:underline">
                {c.nom}
              </Link>
              <span className="ml-2 text-sm text-muted-foreground">Contrat {c.type}</span>
              <p className="text-xs text-muted-foreground">
                Début {c.dateDebut}
                {c.dateFin ? ` · Échéance ${c.dateFin}` : ""}
                {c.finPeriodeEssai ? ` · Fin période d'essai ${c.finPeriodeEssai}` : ""}
              </p>
            </div>
          </div>

          {peutGerer && (
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
              <form action={transformerContrat.bind(null, c.id)} className="flex flex-wrap items-end gap-1.5">
                <label className="flex flex-col text-[11px] text-muted-foreground">
                  Transformer en
                  <select name="type" defaultValue="CDI" className="rounded border border-input bg-background px-2 py-1 text-sm">
                    <option value="CDI">CDI</option>
                    <option value="CDD">CDD</option>
                    <option value="STAGE">Stage</option>
                    <option value="JOURNALIER">Journalier</option>
                  </select>
                </label>
                <label className="flex flex-col text-[11px] text-muted-foreground">
                  Fin (si CDD)
                  <input name="dateFin" type="date" className="rounded border border-input bg-background px-2 py-1 text-sm" />
                </label>
                <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                  Transformer
                </button>
              </form>

              <form action={prolongerContrat.bind(null, c.id)} className="flex flex-wrap items-end gap-1.5">
                <label className="flex flex-col text-[11px] text-muted-foreground">
                  Nouvelle échéance
                  <input name="dateFin" type="date" required className="rounded border border-input bg-background px-2 py-1 text-sm" />
                </label>
                <button type="submit" className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
                  Prolonger
                </button>
              </form>

              {estAdmin && (
                <form action={rompreContrat.bind(null, c.id)}>
                  <ConfirmSubmitButton
                    message={`Rompre le contrat de ${c.nom} ? Cela le marque comme résilié (sortie).`}
                    className="rounded-md border border-destructive px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    Rompre
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
