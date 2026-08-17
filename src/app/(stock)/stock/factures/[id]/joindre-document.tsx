"use client";

import { useRef, useState, useTransition } from "react";
import { attacherDocumentFacture } from "../actions";
import { estErreur } from "@/lib/action-lisible";

export function JoindreDocument({ id, aDeja }: { id: string; aDeja: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [nom, setNom] = useState<string | null>(null);

  const envoyer = () => {
    const file = ref.current?.files?.[0];
    if (!file) { setErreur("Choisissez un fichier."); return; }
    setErreur(null);
    const fd = new FormData();
    fd.set("document", file);
    start(async () => {
      const r = await attacherDocumentFacture(id, fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setNom(null);
      if (ref.current) ref.current.value = "";
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png"
        onChange={(e) => setNom(e.target.files?.[0]?.name ?? null)}
        className="text-xs"
      />
      <button
        onClick={envoyer}
        disabled={isPending || !nom}
        className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        {isPending ? "Envoi…" : aDeja ? "Remplacer le document" : "📎 Joindre un scan / PDF"}
      </button>
      {erreur && <span className="text-xs text-destructive">{erreur}</span>}
    </div>
  );
}
