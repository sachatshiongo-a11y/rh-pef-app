import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, estStock } from "@/lib/auth";
import { chargerNotifications } from "@/lib/notifications";
import { niveauAlerte } from "@/lib/stock";
import { StockShell } from "./stock-shell";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user.role)) redirect("/entree");

  const [moi, nbAValider, notifs, stocks] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } }),
    prisma.bonDeCommande.count({ where: { statut: "BROUILLON" } }),
    chargerNotifications("STOCK"),
    prisma.stock.findMany({ select: { quantite: true, seuilUrgent: true, stockMinimum: true, article: { select: { domaine: true, actif: true } } } }),
  ]);

  // Articles urgents (quantité ≤ seuil urgent) par catalogue — badge persistant dans le menu,
  // à la manière des « Demandes à valider ».
  const urgent: Record<"NOURRITURE" | "BOISSON" | "AUTRE", number> = { NOURRITURE: 0, BOISSON: 0, AUTRE: 0 };
  for (const s of stocks) {
    if (!s.article?.actif) continue;
    if (niveauAlerte(s.quantite, s.seuilUrgent, s.stockMinimum) === "URGENT") urgent[s.article.domaine]++;
  }

  return (
    <StockShell
      userNom={user.nom}
      userRole={user.role}
      maPhoto={moi?.employe?.photoUrl ?? null}
      doubleAcces={user.role === "ADMIN"}
      badges={{
        "/stock/a-valider": nbAValider,
        "/stock/commandes": nbAValider,
        "/stock/catalogue/nourriture": urgent.NOURRITURE,
        "/stock/catalogue/boissons": urgent.BOISSON,
        "/stock/catalogue/autre": urgent.AUTRE,
      }}
      notif={{ items: notifs.items, nonLues: notifs.nonLues, cloture: null }}
    >
      {children}
    </StockShell>
  );
}
