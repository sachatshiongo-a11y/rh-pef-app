import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, espacesDe } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { FormulaireDeconnexion } from "@/components/formulaire-deconnexion";
import { Icone } from "@/components/icones";
import { chargerAttenteDirection } from "@/lib/a-valider-chargeurs";
import { libelleAValider } from "@/lib/a-valider-compteur";

// Sélecteur d'espace — pour les comptes à accès multiple (Direction RH+Stock, ou salarié + stock).
// Un compte à accès unique n'a rien à choisir : on le renvoie au résolveur d'entrée.
// Le dernier espace visité (cookie posé par le middleware) est mis en avant.
// DIRECTION : chaque carte d'un espace de bureau dit combien d'éléments y attendent une décision (V11) —
// les mêmes chiffres que la pastille « À valider » du menu de l'espace.
export default async function ChoixEspacePage() {
  const user = await verifySession();
  const espaces = espacesDe(user, await espaceEmployeActif());
  if (espaces.length < 2) redirect("/entree");
  const dernier = (await cookies()).get("dernier-espace")?.value ?? null;
  const attente = user.role === "ADMIN" ? await chargerAttenteDirection({ id: user.id, role: user.role }) : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-2">
        <Image src="/logo-pates-en-folie.png" alt="Pâtes en Folie" width={200} height={70} priority className="h-auto w-44" />
        <p className="text-sm text-muted-foreground">Bonjour {user.nom} — choisissez un espace</p>
      </div>

      <div className="grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
        {espaces.includes("salarie") && (
          <EspaceCard href="/espace" icone="employes" titre="Mon espace salarié" sous="Planning, congés, pointage, documents" dernier={dernier === "salarie"} />
        )}
        {espaces.includes("rh") && (
          <EspaceCard href="/accueil" icone="mallette" titre="Ressources humaines" sous="Employés, paie, congés, présences" dernier={dernier === "rh"} aValider={attente?.rh} />
        )}
        {espaces.includes("stock") && (
          <EspaceCard href="/stock" icone="colis" titre="Stock & Achats" sous="Inventaire, fournisseurs, bons de commande" dernier={dernier === "stock"} aValider={attente?.stock} />
        )}
        {espaces.includes("exploitation") && (
          <EspaceCard href="/exploitation" icone="balance" titre="Exploitation" sous="Journal de caisse, comptes, plan comptable" dernier={dernier === "exploitation"} aValider={attente?.exploitation} />
        )}
      </div>

      <FormulaireDeconnexion>
        <button type="submit" className="text-sm text-muted-foreground underline hover:text-foreground">
          Déconnexion
        </button>
      </FormulaireDeconnexion>
    </div>
  );
}

function EspaceCard({ href, icone, titre, sous, dernier, aValider }: { href: string; icone: string; titre: string; sous: string; dernier: boolean; aValider?: number }) {
  return (
    <Link
      href={href}
      className={`relative flex flex-col items-center gap-2 rounded-xl border p-8 text-center outline-none transition-colors hover:border-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${dernier ? "border-primary/60 bg-primary/5" : ""}`}
    >
      {dernier && <span className="absolute right-3 top-3 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Dernier utilisé</span>}
      <span aria-hidden className="rounded-full bg-primary/10 p-3 text-primary"><Icone nom={icone} taille={30} /></span>
      <span className="text-lg font-semibold">{titre}</span>
      <span className="text-xs text-muted-foreground">{sous}</span>
      {aValider !== undefined && (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${aValider > 0 ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground"}`}>{libelleAValider(aValider)}</span>
      )}
    </Link>
  );
}
