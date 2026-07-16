import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { redirect } from "next/navigation";
import { changerMonMotDePasse } from "../actions";

export default async function MotDePassePage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || user.role !== "EMPLOYE") redirect("/entree");
  const compte = await prisma.user.findUnique({ where: { id: user.id }, select: { motDePasseTemporaire: true } });
  const sp = await searchParams;
  const premiereFois = compte?.motDePasseTemporaire ?? false;

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 py-10">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">
          {premiereFois ? "Bienvenue — choisissez votre mot de passe" : "Changer mon mot de passe"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {premiereFois
            ? "Pour votre sécurité, remplacez le mot de passe temporaire par un mot de passe personnel avant d'accéder à votre espace."
            : "Choisissez un nouveau mot de passe personnel."}
        </p>

        {sp.erreur && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{sp.erreur}</p>
        )}

        <form action={changerMonMotDePasse} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Nouveau mot de passe
            <input type="password" name="motDePasse" required minLength={6} autoComplete="new-password"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Confirmer le mot de passe
            <input type="password" name="confirmation" required minLength={6} autoComplete="new-password"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <p className="text-xs text-muted-foreground">Au moins 6 caractères. Ne le partagez avec personne.</p>
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Enregistrer</button>
        </form>
      </div>
    </div>
  );
}
