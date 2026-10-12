import type { ReactNode } from "react";
import { EtatVide } from "@/components/etat-vide";
import { PastillesRubriques, RubriquesAValider, type RubriqueAValider } from "@/components/rubriques-a-valider";
import type { EspaceAValider } from "@/lib/a-valider-compteur";

/** Ce que chaque espace apporte à la page « À valider » : ses rubriques, son total, et ce qui n'attend rien mais reste utile. */
export type BlocAValider = {
  rubriques: RubriqueAValider[];
  total: number;
  /** Annuler un paiement, réponses aux demandes déjà traitées… : affiché sous les espaces, même quand rien n'attend. */
  apres: ReactNode;
};

export type EspaceAfficher = BlocAValider & { espace: EspaceAValider; nom: string };

const nombreDe = (e: EspaceAfficher) => e.rubriques.reduce((n, r) => n + r.nombre, 0);

/**
 * LE CORPS DE LA PAGE « À VALIDER » UNIQUE : un bloc par espace du compte (RH, Stock, Exploitation), repliable, et dans
 * chaque bloc ses rubriques par nature, repliables elles aussi (tout est ouvert au départ).
 *   - un espace SANS rien à valider n'est pas affiché (ni rubrique vide, ni titre) ;
 *   - quand TOUS sont vides : un seul état vide ;
 *   - en tête, un compteur par rubrique non vide, tous espaces confondus (un toucher saute à la rubrique) ;
 *   - sous les blocs, `apres` de chaque espace (réponses aux demandes traitées, annuler un paiement), toujours visible.
 * Composant serveur, sans état : les listes et leurs boutons sont ceux de chaque espace, inchangés.
 */
export function EspacesAValider({ espaces, videMessage = "Rien en attente : tout est à jour." }: { espaces: EspaceAfficher[]; videMessage?: string }) {
  const pleins = espaces.filter((e) => nombreDe(e) > 0);
  return (
    <div className="space-y-8">
      {pleins.length === 0 ? <EtatVide message={videMessage} /> : (
        <div>
          <PastillesRubriques rubriques={pleins.flatMap((e) => e.rubriques)} />
          <div className="space-y-6">
            {pleins.map((e) => (
              <details key={e.espace} id={`espace-${e.espace}`} open className="rounded-xl border bg-card/40 p-4">
                <summary className="mb-4 cursor-pointer">
                  <h2 className="inline text-lg font-semibold">{e.nom} <span className="tabular-nums text-muted-foreground">({nombreDe(e)})</span></h2>
                </summary>
                <RubriquesAValider rubriques={e.rubriques} avecNavigation={false} avecEtatVide={false} niveauTitre={3} repliables />
              </details>
            ))}
          </div>
        </div>
      )}
      {espaces.map((e) => e.apres ? <div key={e.espace} className="space-y-4 empty:hidden">{e.apres}</div> : null)}
    </div>
  );
}
