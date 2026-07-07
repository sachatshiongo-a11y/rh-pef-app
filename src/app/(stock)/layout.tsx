import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, estStock } from "@/lib/auth";
import { StockShell } from "./stock-shell";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user.role)) redirect("/entree");

  const moi = await prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } });

  return (
    <StockShell userNom={user.nom} userRole={user.role} maPhoto={moi?.employe?.photoUrl ?? null} doubleAcces={user.role === "ADMIN"}>
      {children}
    </StockShell>
  );
}
