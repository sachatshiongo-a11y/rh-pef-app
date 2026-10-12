import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CompteNonLie } from "@/components/pointage/compte-non-lie";
import { PointerClient } from "./pointer-client";
import { chargerPointageDuJour } from "./pointage-du-jour";
import { EcranSuivi } from "./ecran-suivi";
import { exigerPageRH } from "@/lib/garde-page";
import { espaceEmployeActif } from "@/lib/espace-employe";

// « Pointages » (menu RH). La Direction et la RH y lisent le SUIVI de la brigade ; leur propre pointage est un
// bouton (« Pointer moi-même », /pointer?moi=1). Un compte en consultation n'a pas le suivi : l'écran reste
// son pointage personnel. Même adresse pour tous, l'ancienne /pointer/suivi renvoie ici.
export default async function PointagesPage({ searchParams }: { searchParams: Promise<{ moi?: string; date?: string }> }) {
  const user = await exigerPageRH();
  const sp = await searchParams;
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";

  if (peutGerer && !sp.moi) return <EcranSuivi date={sp.date} />;

  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });

  const entete = (
    <div className="mx-auto mb-3 flex max-w-md flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold sm:text-2xl">Pointages</h1>
      {peutGerer && <Link href="/pointer" className="text-sm text-primary underline">← Suivi de la brigade</Link>}
    </div>
  );

  // Le pointage par l'affiche suit l'interrupteur de l'espace salarié (le serveur refuse aussi le scan).
  if (!(await espaceEmployeActif())) {
    return (
      <>
        {entete}
        <div className="mx-auto max-w-md rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Le pointage par l&apos;affiche est fermé : l&apos;espace salarié est désactivé (Paramètres). Les présences se saisissent dans « Présences &amp; heures ».
        </div>
      </>
    );
  }

  if (!u?.employeeId) {
    return (
      <>
        {entete}
        <div className="mx-auto max-w-md"><CompteNonLie /></div>
      </>
    );
  }

  const jour = await chargerPointageDuJour(u.employeeId);

  return (
    <>
      {entete}
      <PointerClient
        nom={jour.nom ?? "—"}
        photoUrl={jour.photoUrl}
        dateLabel={jour.dateLabel}
        pointage={jour.pointage}
        departScanne={jour.departScanne}
      />
    </>
  );
}
