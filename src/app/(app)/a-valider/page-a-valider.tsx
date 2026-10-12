import type { CurrentUser } from "@/lib/auth";
import { BOITES_A_VALIDER, espacesAValider, totalAValiderCompte, type EspaceAValider } from "@/lib/a-valider-compteur";
import { EspacesAValider, type EspaceAfficher } from "@/components/espaces-a-valider";
import { chargerRubriquesRH } from "./rubriques-rh";
import { chargerRubriquesStock } from "@/app/(stock)/stock/a-valider/rubriques-stock";
import { chargerRubriquesExploitation } from "@/app/(exploitation)/exploitation/a-valider/rubriques-exploitation";

/**
 * LA PAGE « À VALIDER » UNIQUE (demande de la Direction, 2026-10-12) : la même page, tous espaces confondus, quel que
 * soit l'espace d'où on l'ouvre. Elle ASSEMBLE les rubriques des trois espaces — RH, Stock, Exploitation — sans rien
 * changer à leurs décisions (mêmes listes, mêmes boutons, mêmes actions serveur, mêmes droits, mêmes messages).
 *
 * Elle est montée à trois adresses, une par coquille d'espace (`/a-valider`, `/stock/a-valider`,
 * `/exploitation/a-valider`) : on garde le menu, la barre du bas et la flèche de retour de l'espace d'où l'on vient, et
 * aucune adresse ne casse (des notifications déjà envoyées y mènent). `courant` n'est que cela : l'adresse où ramener
 * un refus de la paie. La page appelée a déjà exigé l'accès à SON espace ; ici chaque rubrique est de plus chargée
 * seulement si le compte y a droit (`espacesAValider`) : pas de requête inutile, aucun compteur d'un espace étranger.
 * Chaque geste est revérifié côté serveur, comme avant.
 */
export async function PageAValider({ user, erreur, courant }: { user: CurrentUser; erreur?: string; courant: EspaceAValider }) {
  const espaces = espacesAValider(user);
  const retour = BOITES_A_VALIDER.find((b) => b.espace === courant)!.href;
  const estDirection = user.role === "ADMIN";
  const peutPayer = user.role === "ADMIN" || user.role === "MANAGER";

  const [rh, stock, exploitation] = await Promise.all([
    espaces.rh ? chargerRubriquesRH(user, retour) : null,
    espaces.stock ? chargerRubriquesStock(user) : null,
    espaces.exploitation ? chargerRubriquesExploitation(user) : null,
  ]);
  const blocs: EspaceAfficher[] = [
    ...(rh ? [{ espace: "rh" as const, nom: "RH", ...rh }] : []),
    ...(stock ? [{ espace: "stock" as const, nom: "Stock", ...stock }] : []),
    ...(exploitation ? [{ espace: "exploitation" as const, nom: "Exploitation", ...exploitation }] : []),
  ];
  // LE total de la pastille des menus (`lib/a-valider-compteur.ts`) : tous les espaces du compte, chacun compté comme avant.
  const total = totalAValiderCompte({ rh: rh?.total ?? 0, stock: stock?.total ?? 0, exploitation: exploitation?.total ?? 0 });

  return (
    <div className="w-full">
      {erreur && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>
      )}
      {/* En-tête : titre à gauche, compteur à droite (le même chiffre que la pastille du menu) */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">À valider</h1>
          <p className="text-sm text-muted-foreground">{estDirection ? "Demandes et bulletins en attente de votre décision" : "Vos demandes en attente de la Direction"}</p>
        </div>
        <div className="rounded-xl border bg-card px-6 py-4 shadow-sm" title={estDirection ? "Même chiffre que la pastille du menu, tous espaces confondus : demandes en attente, bulletins du mois à valider et bulletins validés à payer." : undefined}>
          <p className="text-xs text-muted-foreground">En attente</p>
          <p className="mt-1 text-3xl font-bold">{total}</p>
        </div>
      </div>

      {!estDirection && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {peutPayer
            ? "Rien n'est modifié tant que la Direction n'a pas approuvé vos demandes. Vous marquez payés les bulletins qu'elle a validés."
            : "Rien n'est modifié tant que la Direction n'a pas approuvé vos demandes."}
        </p>
      )}

      <EspacesAValider espaces={blocs} />
    </div>
  );
}
