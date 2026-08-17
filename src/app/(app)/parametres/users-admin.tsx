"use client";

import { useState, useTransition } from "react";
import {
  creerUtilisateur,
  definirRoleUtilisateur,
  basculerActifUtilisateur,
  reinitialiserMotDePasse,
  lierUtilisateurEmploye,
} from "./user-actions";
import { estErreur } from "@/lib/action-lisible";

export type UserRow = {
  id: string;
  email: string;
  nom: string;
  role: string;
  actif: boolean;
  employeeId: string | null;
  employeNom: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Direction",
  MANAGER: "RH",
  VIEWER: "Consultation",
  STOCK: "Stock",
};
const ROLE_DESC: Record<string, string> = {
  ADMIN: "Accès total : RH, paie, paramètres ET Stock & Achats",
  MANAGER: "Saisit les demandes et vérifie les bulletins, mais ne valide rien",
  VIEWER: "Consultation seule",
  STOCK: "Espace Stock & Achats uniquement (aucun accès RH ni paie)",
};

const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm";

export function UsersAdmin({
  users,
  employes,
  monId,
}: {
  users: UserRow[];
  employes: { id: string; nom: string }[];
  monId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvertMdp, setOuvertMdp] = useState<string | null>(null);

  function action(fn: () => Promise<unknown>) {
    setErreur(null);
    startTransition(async () => {
      const r = await fn();
      if (estErreur(r)) setErreur(r.erreur);
    });
  }

  return (
    <div className="space-y-4">
      {erreur && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {erreur}
        </p>
      )}

      {/* Liste */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-3 py-2">Nom</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Employé lié</th>
              <th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t align-top">
                <td className="px-3 py-2 font-medium">{u.nom}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">
                  <select
                    defaultValue={u.role}
                    disabled={isPending}
                    onChange={(e) => {
                      const fd = new FormData();
                      fd.set("role", e.target.value);
                      action(() => definirRoleUtilisateur(u.id, fd));
                    }}
                    className="rounded border border-input bg-background px-2 py-1 text-xs"
                  >
                    {Object.keys(ROLE_LABEL).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{ROLE_DESC[u.role]}</p>
                </td>
                <td className="px-3 py-2">
                  <select
                    defaultValue={u.employeeId ?? ""}
                    disabled={isPending}
                    onChange={(e) => {
                      const fd = new FormData();
                      fd.set("employeeId", e.target.value);
                      action(() => lierUtilisateurEmploye(u.id, fd));
                    }}
                    className="rounded border border-input bg-background px-2 py-1 text-xs"
                    title="Associer ce compte à une fiche employé (même personne)"
                  >
                    <option value="">— aucun —</option>
                    {employes.map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.nom}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.actif ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
                    {u.actif ? "Actif" : "Désactivé"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {u.id !== monId && (
                      <button
                        onClick={() => action(() => basculerActifUtilisateur(u.id))}
                        disabled={isPending}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        {u.actif ? "Désactiver" : "Réactiver"}
                      </button>
                    )}
                    <button
                      onClick={() => setOuvertMdp(ouvertMdp === u.id ? null : u.id)}
                      className="rounded border px-2 py-1 text-xs hover:bg-accent"
                    >
                      Mot de passe
                    </button>
                  </div>
                  {ouvertMdp === u.id && (
                    <form
                      action={(fd) => action(() => reinitialiserMotDePasse(u.id, fd))}
                      className="mt-2 flex items-center justify-end gap-2"
                    >
                      <input name="password" type="text" placeholder="Nouveau mot de passe" minLength={8} required className="rounded border border-input bg-background px-2 py-1 text-xs" />
                      <button className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">OK</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Création */}
      <form
        action={(fd) => action(() => creerUtilisateur(fd))}
        className="grid grid-cols-2 gap-3 rounded-lg border p-4 md:grid-cols-5"
      >
        <input name="nom" placeholder="Nom complet" required className={inputCls} />
        <input name="email" type="email" placeholder="Email" required className={inputCls} />
        <input name="password" type="text" placeholder="Mot de passe (8+)" minLength={8} required className={inputCls} />
        <select name="role" defaultValue="MANAGER" className={inputCls}>
          {Object.keys(ROLE_LABEL).map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          Créer l&apos;utilisateur
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Direction</span> = accès total (RH + Stock) · <span className="font-medium">RH</span> =
        saisit les demandes et vérifie les bulletins sans rien valider · <span className="font-medium">Consultation</span> =
        lecture seule · <span className="font-medium">Stock</span> = espace Stock &amp; Achats uniquement.
      </p>
    </div>
  );
}
