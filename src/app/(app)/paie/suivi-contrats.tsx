"use client";

import Link from "next/link";
import { transformerContrat, rompreContrat, prolongerContrat, prolongerEssai } from "./contrat-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { EtatSignatureLecture } from "@/components/etat-signature-lecture";
import type { EtatSignatureUI } from "@/components/bouton-signer";
import { libelleTypeContrat } from "@/lib/contrats-classement";
import { BoutonMarquerExpire } from "./marquer-expire";

export type ContratRow = {
  id: string;
  employeeId: string;
  nom: string;
  type: string;
  dateDebut: string;
  dateFin: string | null;
  finPeriodeEssai: string | null;
  /** Motif du classement (« expiré le … ») quand le contrat est ancien. */
  motif: string | null;
  /** Échu mais encore ACTIF en base : la Direction peut le « Marquer expiré ». */
  expireNonMarque: boolean;
  signature: { etat: EtatSignatureUI; signeLeTexte: string | null };
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
  const sel = useBulkSelection();
  const echus = contrats.filter((c) => c.expireNonMarque);

  if (contrats.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Aucun contrat à échéance, entrée ou fin de période d&apos;essai ce mois-ci.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Actions groupées : les contrats échus (date de fin passée, encore ACTIF en base). */}
      {peutGerer && echus.length > 0 && (
        <BulkBar count={sel.sel.size} total={echus.length} onAll={(on) => sel.setAll(echus.map((c) => c.id), on)}>
          <BoutonMarquerExpire ids={sel.ids} onFini={sel.clear} />
        </BulkBar>
      )}
      {contrats.map((c) => (
        <div key={c.id} className={`rounded-xl border bg-card p-3 ${sel.sel.has(c.id) ? "ring-1 ring-primary" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              {peutGerer && c.expireNonMarque && (
                <input type="checkbox" checked={sel.sel.has(c.id)} onChange={() => sel.toggle(c.id)} aria-label={`Sélectionner ${c.nom}`} className="mt-1" />
              )}
              <div className="min-w-0">
                <Link href={`/employes/${c.employeeId}`} className="font-semibold hover:underline">
                  {c.nom}
                </Link>
                <span className="ml-2 text-sm text-muted-foreground">{libelleTypeContrat(c.type)}</span>
                <p className="text-xs text-muted-foreground">
                  Début {c.dateDebut}
                  {c.dateFin ? ` · Échéance ${c.dateFin}` : ""}
                  {c.finPeriodeEssai ? ` · Fin période d'essai ${c.finPeriodeEssai}` : ""}
                </p>
                {c.motif && <p className="text-xs font-medium text-amber-800">{c.motif[0].toUpperCase() + c.motif.slice(1)}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <EtatSignatureLecture {...c.signature} />
              {peutGerer && c.expireNonMarque && <BoutonMarquerExpire ids={[c.id]} />}
            </div>
          </div>

          {peutGerer && (
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
              <form action={transformerContrat.bind(null, c.id)} className="flex flex-wrap items-end gap-1.5" title="L'ancien contrat reste dans l'historique (statut Transformé)">
                <label className="flex flex-col text-[11px] text-muted-foreground">
                  Transformer en
                  <select name="type" defaultValue="CDI" className="rounded border border-input bg-background px-2 py-1 text-sm">
                    <option value="CDI">CDI</option>
                    <option value="CDD">CDD</option>
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

              {c.finPeriodeEssai && (
                <form action={prolongerEssai.bind(null, c.id)} className="flex flex-wrap items-end gap-1.5">
                  <label className="flex flex-col text-[11px] text-muted-foreground">
                    Nouvelle fin d&apos;essai
                    <input name="finPeriodeEssai" type="date" required className="rounded border border-input bg-background px-2 py-1 text-sm" />
                  </label>
                  <button type="submit" className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
                    Prolonger l&apos;essai
                  </button>
                </form>
              )}

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
