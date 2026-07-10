import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, estStock } from "@/lib/auth";
import { chargerNotifications } from "@/lib/notifications";
import { StockShell } from "./stock-shell";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user.role)) redirect("/entree");

  const [moi, nbAValider, notifs, urgents] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } }),
    prisma.bonDeCommande.count({ where: { statut: "BROUILLON" } }),
    chargerNotifications("STOCK"),
    // Comptage des articles urgents (en rupture : quantité ≤ 0) par domaine, agrégé en SQL —
    // un seul aller-retour qui renvoie 3 nombres, au lieu de charger toutes les lignes de stock.
    prisma.$queryRaw<{ domaine: string; n: number }[]>`
      SELECT a."domaine" AS domaine, COUNT(*)::int AS n
      FROM "stock"."Stock" s
      JOIN "stock"."ArticleStock" a ON a."id" = s."articleId"
      WHERE a."actif" = true
        AND s."quantite" <= 0
      GROUP BY a."domaine"`,
  ]);

  // Badge persistant par catalogue, à la manière des « Demandes à valider ».
  const urgent: Record<"NOURRITURE" | "BOISSON" | "AUTRE", number> = { NOURRITURE: 0, BOISSON: 0, AUTRE: 0 };
  for (const r of urgents) if (r.domaine in urgent) urgent[r.domaine as keyof typeof urgent] = Number(r.n);

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
