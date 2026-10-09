"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BoutonNeutre, BoutonRefuser } from "@/components/action-buttons";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";
import { MAX_MOTIF_REFUS, verifierMotifRefus } from "@/lib/conges-liste";

/**
 * Fenêtre « Refuser » : le MOTIF est obligatoire (décision de la Direction, 2026-10-09). Un seul composant
 * pour tous les écrans qui refusent une demande de congé (liste Congés, « À valider »), à l'unité comme en
 * lot — en lot, UN motif pour toute la sélection. Le serveur refuse de toute façon un motif vide ou trop
 * long : ce composant n'est qu'une aide (compteur, bouton inactif tant que le motif est vide).
 * À RENDRE seulement quand il est ouvert (`{ouvert && <DialogueRefus …/>}`) : fermé, il est démonté et la
 * saisie repart vide. Portail dans <body> (même raison que `bouton-signer.tsx`), pas de `backdrop-filter`.
 */
export function DialogueRefus({ titre, consigne, enCours = false, erreur, onConfirmer, onAnnuler }: {
  titre: string;
  /** Ce qui va être refusé, en clair (« 3 demandes de congé », « la demande de Rachel Lunda »). */
  consigne: string;
  enCours?: boolean;
  /** Une erreur rendue par le serveur (le motif refusé, par exemple). */
  erreur?: string | null;
  onConfirmer: (motif: string) => void;
  onAnnuler: () => void;
}) {
  const [motif, setMotif] = useState("");
  const zone = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useLockBodyScroll(true);
  useEffect(() => { zone.current?.focus(); }, []);
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => { if (e.key === "Escape" && !enCours) onAnnuler(); };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [enCours, onAnnuler]);
  if (typeof document === "undefined") return null;

  const verifie = verifierMotifRefus(motif);
  const trop = "erreur" in verifie && motif.trim() !== "";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-black/60 p-3" onClick={() => !enCours && onAnnuler()}>
      <form
        role="dialog" aria-modal="true" aria-labelledby={`${id}-titre`} data-dialogue-refus
        className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if ("motif" in verifie && !enCours) onConfirmer(verifie.motif); }}
      >
        <h2 id={`${id}-titre`} className="mb-1 text-base font-semibold">{titre}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{consigne} Le salarié sera prévenu, avec ce motif.</p>
        {erreur && <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
        <label htmlFor={`${id}-motif`} className="mb-1 block text-sm font-medium">Motif du refus <span className="text-destructive">*</span></label>
        <textarea
          id={`${id}-motif`} ref={zone} required rows={4} value={motif} onChange={(e) => setMotif(e.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <p className={`mt-1 text-xs ${trop ? "text-destructive" : "text-muted-foreground"}`}>
          {motif.trim().length} / {MAX_MOTIF_REFUS} caractères{trop ? " — trop long" : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <BoutonNeutre type="button" onClick={onAnnuler} disabled={enCours}>Annuler</BoutonNeutre>
          <BoutonRefuser type="submit" disabled={enCours || "erreur" in verifie}>{enCours ? "Refus…" : "Refuser"}</BoutonRefuser>
        </div>
      </form>
    </div>,
    document.body,
  );
}
