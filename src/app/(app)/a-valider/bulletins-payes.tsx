import Link from "next/link";
import { changerStatutPaie } from "../paie/actions";
import { Avatar } from "@/components/avatar";
import { TelechargerLien } from "@/components/telecharger-lien";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

export type BulletinPayeRow = {
  id: string;
  employeeId: string;
  matricule: string;
  nom: string;
  photoUrl?: string | null;
  montant: string;
  /** « payé le 05/10/2026 par virement » — déjà mis en forme par la page. */
  paiement: string;
};

/**
 * « Annuler un paiement » (Payé → Validé) : le seul geste de décision de Paie qui n'a pas de rubrique « en attente »
 * dans À valider, puisqu'il défait une décision déjà prise. Il vivait sur la ligne du bulletin dans Paie ; depuis le
 * lot 8 (V5) on décide dans À valider seulement, il est donc ici, à part des files (un bulletin payé n'attend rien :
 * il ne compte pas dans la pastille). Direction seule (paie-etats.ts) ; le serveur revérifie le rôle.
 * Mois en cours seulement, paie non clôturée (le serveur refuse sinon, `appliquerTransitionPaie`) ; la date et le moyen d'un
 * paiement, de n'importe quel mois, se corrigent par « Corriger le paiement » (fiche du salarié → Paie).
 * Ligne par ligne, jamais en lot : « valider » en lot ne vaut pas « annuler un paiement » (transitionAutoriseeEnLot).
 */
export function BulletinsPayes({ rows }: { rows: BulletinPayeRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <Avatar nom={r.nom} photoUrl={r.photoUrl} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <Link href={`/employes/${r.employeeId}`} className="font-semibold hover:underline">{r.nom}</Link>{" "}
              <span className="font-mono text-xs text-muted-foreground">{r.matricule}</span>
            </p>
            <p className="text-xs text-muted-foreground">Salaire net : {r.montant} · {r.paiement}</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <TelechargerLien href={`/paie/bulletin/${r.id}?devise=USD&dl=1`} className="text-primary underline">Bulletin $</TelechargerLien>
            <TelechargerLien href={`/paie/bulletin/${r.id}?devise=CDF&dl=1`} className="text-primary underline">CDF</TelechargerLien>
            <form action={changerStatutPaie.bind(null, r.id)}>
              <input type="hidden" name="versStatut" value="VALIDE" />
              <input type="hidden" name="retour" value="/a-valider" />
              <ConfirmSubmitButton
                variante="neutre"
                message={`Annuler le paiement du bulletin de ${r.nom} ? Il repasse « validé » et la RH est prévenue qu'il est de nouveau à payer.`}
              >
                ↩ Annuler le paiement
              </ConfirmSubmitButton>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
