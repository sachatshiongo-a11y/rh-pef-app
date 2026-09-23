import { redirect } from "next/navigation";
import { verifySession, espacesDe, accueilEspace, estSalarie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { exigerMotDePassePersonnel } from "@/app/espace/garde";
import { logout } from "@/app/login/actions";

// Résolveur d'entrée après connexion : oriente chaque compte vers SON espace.
// - un compte salarié (EMPLOYE, ou relié à une fiche) : mot de passe à changer si temporaire, d'abord ;
// - un seul accès  → on entre directement dans cet espace ;
// - plusieurs accès (Direction RH+Stock, salarié+stock, magasinier stock+salarié…) → écran de choix ;
// - aucun accès (salarié dont l'espace a été fermé depuis sa connexion) → un message, sans redirection.
export default async function EntreePage() {
  const user = await verifySession();

  const espaceActif = await espaceEmployeActif();
  // Espace salarié ouvert, tout compte RELIÉ à une fiche employé (EMPLOYE, ou ex. un compte Stock à
  // identifiant matricule) : « Nouvelle fiche » (Paramètres) peut lui donner un mot de passe
  // temporaire, que sa fiche dit « à changer à la première connexion ». Espace fermé, la page de
  // changement le renverrait ici : on ne l'y envoie pas (pas de boucle).
  if (espaceActif && estSalarie(user)) {
    const compte = await prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } });
    exigerMotDePassePersonnel({
      role: user.role,
      employeeId: user.employeeId,
      motDePasseTemporaire: compte?.motDePasseTemporaire ?? false,
      espaceOuvert: espaceActif,
    });
  }

  const espaces = espacesDe(user, espaceActif);
  if (espaces.length === 1) redirect(accueilEspace(espaces[0]));
  if (espaces.length > 1) redirect("/choix-espace");

  // Aucun espace. Pas de redirection vers /login : connecté, le middleware le renverrait ici (boucle).
  const espaceSalarieFerme = user.role === "EMPLOYE" && !espaceActif;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">{espaceSalarieFerme ? "L'espace salarié est fermé" : "Aucun espace ouvert"}</h1>
      <p className="text-sm text-muted-foreground">
        {espaceSalarieFerme
          ? "La Direction a fermé l'espace salarié pour le moment. Vous pourrez y revenir lorsqu'il sera rouvert."
          : "Ce compte n'a accès à aucun espace de l'application. Adressez-vous à la Direction."}
      </p>
      <form action={logout}>
        <button type="submit" className="text-sm text-muted-foreground underline hover:text-foreground">
          Déconnexion
        </button>
      </form>
    </main>
  );
}
