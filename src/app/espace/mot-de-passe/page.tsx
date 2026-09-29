import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { formulaireMotDePasseOuvert } from "@/lib/mot-de-passe-temporaire";
import { retourValide } from "@/lib/retour-connexion";
import { redirect } from "next/navigation";
import { changerMonMotDePasse } from "../actions";

export default async function MotDePassePage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; retour?: string | string[] }>;
}) {
  const user = await verifySession();
  const [espaceOuvert, compte] = await Promise.all([
    espaceEmployeActif(),
    prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } }),
  ]);
  const premiereFois = compte?.motDePasseTemporaire ?? false;
  const sp = await searchParams;
  // Où revenir après le changement : le scan de l'affiche qui a amené ici, seul retour permis
  // (lib/retour-connexion — jamais une autre adresse, quoi que dise l'URL).
  const retour = retourValide(sp.retour);
  // Déjà personnel (changé dans un autre onglet, bouton « Précédent »…) : rien à changer, on
  // reprend le scan. Pas de boucle : /scan n'envoie ici que si le mot de passe est temporaire.
  if (retour && !premiereFois) redirect(retour);
  // Même règle que l'action : hors EMPLOYE, le formulaire ne sert qu'au mot de passe temporaire.
  if (!formulaireMotDePasseOuvert({ role: user.role, employeeId: user.employeeId, motDePasseTemporaire: premiereFois, espaceOuvert }))
    redirect("/entree");

  return (
    <div className="mx-auto w-full max-w-md py-2 sm:py-8">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">
          {premiereFois ? "Bienvenue — choisissez votre mot de passe" : "Changer mon mot de passe"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {premiereFois
            ? retour
              ? "Pour votre sécurité, remplacez le mot de passe temporaire par un mot de passe personnel. Vous reviendrez ensuite à votre pointage."
              : "Pour votre sécurité, remplacez le mot de passe temporaire par un mot de passe personnel avant d'accéder à votre espace."
            : "Choisissez un nouveau mot de passe personnel."}
        </p>

        {sp.erreur && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>
        )}

        <form action={changerMonMotDePasse} className="mt-5 flex flex-col gap-4">
          {retour && <input type="hidden" name="retour" value={retour} />}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Nouveau mot de passe
            <input type="password" name="motDePasse" required minLength={6} autoComplete="new-password"
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Confirmer le mot de passe
            <input type="password" name="confirmation" required minLength={6} autoComplete="new-password"
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm" />
          </label>
          <p className="text-sm text-muted-foreground">Au moins 6 caractères. Gardez-le pour vous : ne le donnez à personne, même à un collègue.</p>
          <button className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground">Enregistrer mon mot de passe</button>
        </form>
      </div>
    </div>
  );
}
