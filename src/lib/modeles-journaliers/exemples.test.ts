import { it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { excelModele, feuillesCommande, feuillesRapport, pdfModele } from "./index";
import { fichesCommandeEssai, fichesRapportEssai } from "./donnees-essai";

// EXEMPLES montrés à la Direction : `SORTIE_EXEMPLES=<dossier> npx vitest run src/lib/modeles-journaliers/exemples.test.ts`
// écrit exemple-rapport.(xlsx|pdf) et exemple-commande.(xlsx|pdf). Sans la variable : rien.
const dossier = process.env.SORTIE_EXEMPLES;

it.skipIf(!dossier)("écrit les exemples", async () => {
  const rapport = await feuillesRapport(await fichesRapportEssai(), "2026-09-28");
  fs.writeFileSync(path.join(dossier!, "exemple-rapport.xlsx"), await excelModele(rapport));
  fs.writeFileSync(path.join(dossier!, "exemple-rapport.pdf"), await pdfModele(rapport, "Rapport journalier cuisine et bar — semaine 40"));
  const dimanche = await feuillesRapport(await fichesRapportEssai({ dimanche: true }), "2026-09-28");
  fs.writeFileSync(path.join(dossier!, "exemple-rapport-dimanche.xlsx"), await excelModele(dimanche));
  fs.writeFileSync(path.join(dossier!, "exemple-rapport-dimanche.pdf"), await pdfModele(dimanche, "Rapport journalier — dimanche"));
  const commande = await feuillesCommande([{ date: "2026-09-29", fiches: await fichesCommandeEssai() }]);
  fs.writeFileSync(path.join(dossier!, "exemple-commande.xlsx"), await excelModele(commande));
  fs.writeFileSync(path.join(dossier!, "exemple-commande.pdf"), await pdfModele(commande, "Commande journalière — mardi 29 septembre 2026", "1 sortie(s) sans motif ce jour-là ne sont pas comptées comme livrées (onglet Consommation)."));
  const jours = await Promise.all(["2026-09-28", "2026-09-29"].map(async (date, i) => ({
    date, fiches: (await fichesCommandeEssai({ date })).map((f) => ({ ...f, feuille: `${["Lun 28", "Mar 29"][i]} ${f.espace === "CUISINE" ? "Cuisine" : "Bar"}` })),
  })));
  fs.writeFileSync(path.join(dossier!, "exemple-commande-semaine.xlsx"), await excelModele(await feuillesCommande(jours)));
}, 120_000);
