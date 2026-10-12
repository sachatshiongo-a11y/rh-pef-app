import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, estStock, ciblesAutresEspaces } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { chargerNotifications } from "@/lib/notifications";
import { urgentsParDomaine } from "@/lib/indicateurs/urgents";
import { totalAValiderStock } from "@/lib/a-valider-compteur";
import { exigerMotDePassePersonnel } from "@/app/espace/garde";
import { StockShell } from "./stock-shell";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user)) redirect("/entree");

  const [moi, nbAValider, nbDemandes, notifs, urgents, espaceSalarieActif] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true, employe: { select: { photoUrl: true } } } }),
    prisma.bonDeCommande.count({ where: { statut: "BROUILLON" } }),
    // Paiements, réconciliations et modifications d'articles en attente de la Direction.
    // Toutes pour la Direction ; les siennes pour un autre compte (celles qu'il voit sur la page).
    prisma.demandeValidationStock.count({ where: { statut: "EN_ATTENTE", ...(user.role === "ADMIN" ? {} : { auteurId: user.id }) } }),
    chargerNotifications("STOCK", user.id), // + les réponses de la Direction adressées à ce compte
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

  // Badge persistant par catalogue, à la manière des « Demandes à valider ».
  const urgent = urgents;

  return (
    <StockShell
      userNom={user.nom}
      userRole={user.role}
      maPhoto={moi?.employe?.photoUrl ?? null}
      autresEspaces={ciblesAutresEspaces(user, espaceSalarieActif, "stock")}
      badges={{
        "/stock/a-valider": totalAValiderStock({ bonsEnBrouillon: nbAValider, demandes: nbDemandes }), // même définition que le compteur de la page
        "/stock/commandes": nbAValider,
        "/stock/catalogue": urgent.NOURRITURE + urgent.BOISSON + urgent.AUTRE,
      }}
      notif={{ items: notifs.items, nonLues: notifs.nonLues, cloture: null }}
    >
      {children}
    </StockShell>
  );
}
