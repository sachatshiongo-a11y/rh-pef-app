import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, estStock, ciblesAutresEspaces } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { chargerNotificationsCompte } from "@/lib/notifications";
import { urgentsParDomaine } from "@/lib/indicateurs/urgents";
import { chargerAValiderDuCompte } from "@/lib/a-valider-chargeurs";
import { exigerMotDePassePersonnel } from "@/app/espace/garde";
import { StockShell } from "./stock-shell";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user)) redirect("/entree");

  const [moi, aValider, notifs, urgents, espaceSalarieActif] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true, employe: { select: { photoUrl: true } } } }),
    // Pastille « À valider » = le total de TOUS les espaces du compte (bons en brouillon, demandes de la Direction,
    // et — pour la Direction — la RH et l'Exploitation) ; les bons en brouillon alimentent aussi le badge des Bons de commande.
    chargerAValiderDuCompte(user),
    chargerNotificationsCompte(user), // LA cloche unique (+ les réponses adressées à ce compte)
    urgentsParDomaine(), // même règle et mêmes articles (actifs) que le tableau de bord
    espaceEmployeActif(),
  ]);

  // Compte relié à une fiche avec un mot de passe temporaire (« Nouvelle fiche ») : il le change
  // d'abord, comme un salarié — sauf espace salarié fermé, où la page de changement le refuserait.
  exigerMotDePassePersonnel({
    role: user.role,
    employeeId: user.employeeId,
    motDePasseTemporaire: moi?.motDePasseTemporaire ?? false,
    espaceOuvert: espaceSalarieActif,
  });

  // Badge persistant par catalogue, à la manière d'« À valider ».
  const urgent = urgents;

  return (
    <StockShell
      userNom={user.nom}
      userRole={user.role}
      maPhoto={moi?.employe?.photoUrl ?? null}
      autresEspaces={ciblesAutresEspaces(user, espaceSalarieActif, "stock")}
      badges={{
        "/stock/a-valider": aValider.total, // le total de tous les espaces du compte : le compteur de la page
        "/stock/commandes": aValider.stock?.bonsEnBrouillon ?? 0,
        "/stock/catalogue": urgent.NOURRITURE + urgent.BOISSON + urgent.AUTRE,
      }}
      notif={{ items: notifs.items, nonLues: notifs.nonLues, nonLuesListees: notifs.nonLuesListees, cloture: null }}
    >
      {children}
    </StockShell>
  );
}
