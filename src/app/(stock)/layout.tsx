import { redirect } from "next/navigation";
import { verifySession, estStock } from "@/lib/auth";
import { StockShell } from "./stock-shell";

// Espace STOCK — coquille indépendante de l'espace RH. Garde de LECTURE : un compte sans
// accès Stock est renvoyé vers le résolveur d'entrée (→ son propre espace).
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!estStock(user.role)) redirect("/entree");

  return (
    <StockShell userNom={user.nom} doubleAcces={user.role === "ADMIN"}>
      {children}
    </StockShell>
  );
}
