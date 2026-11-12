"use client";

import { useState, useTransition } from "react";
import { definirPermissionsUtilisateur } from "./permissions-actions";
import { estErreur } from "@/lib/action-lisible";
import {
  PERMISSIONS_RH,
  PERMISSIONS_STOCK,
  aPermission,
  type DefinitionPermission,
  type Permission,
  type SurchargesPermissions,
} from "@/lib/permissions";
import type { Role } from "@prisma/client";

/**
 * Cases à cocher des permissions d'UN compte RH ou Stock (Direction). Partent de l'état réel de la
 * personne (défaut du rôle + écarts enregistrés) ; « Enregistrer » envoie l'état voulu de chaque case,
 * le serveur ne garde que les écarts et journalise chaque permission accordée ou retirée.
 */
export function PermissionsCompte({
  userId,
  nom,
  role,
  accesStock,
  permissions,
}: {
  userId: string;
  nom: string;
  role: Role;
  accesStock: boolean;
  permissions: SurchargesPermissions;
}) {
  const definitions: readonly DefinitionPermission[] = role === "MANAGER" ? PERMISSIONS_RH : PERMISSIONS_STOCK;
  const titulaire = { role, accesStock, permissions };
  const etatInitial = () => Object.fromEntries(definitions.map((d) => [d.cle, aPermission(titulaire, d.cle as Permission)])) as Record<string, boolean>;
  const [cases, setCases] = useState<Record<string, boolean>>(etatInitial);
  const [reference, setReference] = useState<Record<string, boolean>>(etatInitial);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const modifie = definitions.some((d) => cases[d.cle] !== reference[d.cle]);

  function enregistrer() {
    setMessage(null);
    startTransition(async () => {
      const r = await definirPermissionsUtilisateur(userId, cases);
      if (estErreur(r)) setMessage({ ok: false, texte: r.erreur });
      else {
        setReference(cases);
        setMessage({ ok: true, texte: "Permissions enregistrées." });
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-medium">
        Ce que {nom} peut faire ({role === "MANAGER" ? "espace RH" : "espace Stock & Achats"})
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {definitions.map((d) => (
          <label key={d.cle} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={cases[d.cle] ?? false}
              disabled={isPending}
              onChange={(e) => setCases({ ...cases, [d.cle]: e.target.checked })}
            />
            <span>
              {d.libelle}
              <span className="block text-xs text-muted-foreground">{d.description}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Les suppressions, imports, clôtures et approbations restent réservés à la Direction, quoi qu&apos;on coche ici.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={enregistrer}
          disabled={isPending || !modifie}
          className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "…" : "Enregistrer les permissions"}
        </button>
        {message && (
          <span role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-emerald-700" : "text-destructive"}`}>
            {message.texte}
          </span>
        )}
      </div>
    </div>
  );
}
