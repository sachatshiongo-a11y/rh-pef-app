import { renderPdfBuffer } from "@/lib/pdf/fonts";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BulletinDocument } from "@/lib/pdf/bulletin";
import { chargerDonneesBulletinsDuMois, bulletinsPourPdf } from "@/lib/paie-bulletins";
import { slugFichier } from "@/lib/texte";
import type { Devise } from "@/lib/pdf/theme";

/** Tous les bulletins du mois courant, un fichier PDF SÉPARÉ par employé, regroupés dans un ZIP. */
export async function GET(request: Request) {
  await verifySession();
  const devise: Devise = new URL(request.url).searchParams.get("devise") === "CDF" ? "CDF" : "USD";

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  const donnees = await chargerDonneesBulletinsDuMois(mois, annee);
  if (!donnees) {
    return new Response("Aucune paie calculée pour ce mois", { status: 404 });
  }
  const periode = `${annee}-${String(mois).padStart(2, "0")}`;

  // Assemblage partagé avec l'export PDF groupé — c'est lui qui pose `signatureSalarie` : un
  // bulletin archivé dans le ZIP dit la même chose que le même bulletin ouvert à l'unité.
  const zip = new JSZip();
  const utilises = new Set<string>();
  for (const b of bulletinsPourPdf(donnees)) {
    const buffer = await renderPdfBuffer(BulletinDocument({ ...b, devise }));
    let nom = `${slugFichier(b.employee.nom) || b.employee.matricule || b.ligne.employeeId}_${periode}_${devise}`;
    // Évite les collisions de noms de fichiers (homonymes).
    let suffixe = 1;
    let candidat = nom;
    while (utilises.has(candidat)) candidat = `${nom}_${++suffixe}`;
    nom = candidat;
    utilises.add(nom);
    zip.file(`${nom}.pdf`, buffer);
  }

  const contenu = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(contenu), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Bulletins_${periode}_${devise}_separes.zip"`,
    },
  });
}
