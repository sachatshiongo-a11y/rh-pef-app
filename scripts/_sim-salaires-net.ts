/**
 * SIMULATION LECTURE SEULE (2026-07-22) — impact de l'activation du flag `salaires_saisis_en_net`.
 * Pour un mois standard nominal (salaire de base = salaireMensuel, hors transport/HS/primes) :
 * compare le NET perçu et le COÛT EMPLOYEUR avant (flag OFF, salaire traité en brut) et après
 * (flag ON, salaire traité en net → brut reconstitué). N'ÉCRIT RIEN en base.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { calculerPaieBackoffice, type ParametresPaie } from "../src/lib/payroll";
import { chargerParametresPaieDirect } from "./_config-direct";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const usd = (n: number) => n.toFixed(2).padStart(9);

async function main() {
  const base = await chargerParametresPaieDirect(prisma);
  const paramsOFF: ParametresPaie = { ...base, salairesSaisisEnNet: false };
  const paramsON: ParametresPaie = { ...base, salairesSaisisEnNet: true };

  const employes = await prisma.employee.findMany({
    where: { actif: true },
    orderBy: [{ categorie: "asc" }, { nom: "asc" }],
    select: { nom: true, categorie: true, contrat: true, salaireMensuel: true, enfants: true },
  });

  console.log(`\nExercice actif — CNSS salariale ${base.cnssSalarie * 100}%, IPR base ${base.iprBase}, taux ${base.tauxChangeCDF} CDF/$\n`);
  console.log("Salarié                          Cat.  Contrat   Saisi   NetAvant  NetAprès   ΔNet    BrutAprès  CoûtAv.  CoûtAp.   ΔCoût");
  console.log("-".repeat(122));

  let sDeltaNet = 0, sDeltaCout = 0, sHausseBrut = 0;
  for (const e of employes) {
    const salaire = Number(e.salaireMensuel);
    if (e.contrat === "INTERIM") {
      console.log(`${e.nom.padEnd(32).slice(0, 32)} ${e.categorie.slice(0, 4).padEnd(4)}  ${e.contrat.padEnd(8)} ${usd(salaire)}   (intérim — pas de bulletin, payé par l'agence)`);
      continue;
    }
    if (e.contrat === "STAGE") {
      console.log(`${e.nom.padEnd(32).slice(0, 32)} ${e.categorie.slice(0, 4).padEnd(4)}  ${e.contrat.padEnd(8)} ${usd(salaire)}   (stage — sans cotisations, inchangé)`);
      continue;
    }
    const av = calculerPaieBackoffice({ salaireBaseUSD: salaire, transportUSD: 0, enfants: e.enfants }, paramsOFF);
    const ap = calculerPaieBackoffice({ salaireBaseUSD: salaire, transportUSD: 0, enfants: e.enfants }, paramsON);
    const dNet = ap.salNetUSD - av.salNetUSD;
    const dCout = ap.coutEmployeurUSD - av.coutEmployeurUSD;
    sDeltaNet += dNet; sDeltaCout += dCout; sHausseBrut += ap.salBrutUSD - salaire;
    console.log(
      `${e.nom.padEnd(32).slice(0, 32)} ${e.categorie.slice(0, 4).padEnd(4)}  ${e.contrat.padEnd(8)} ${usd(salaire)} ${usd(av.salNetUSD)} ${usd(ap.salNetUSD)} ${usd(dNet)}  ${usd(ap.salBrutUSD)} ${usd(av.coutEmployeurUSD)} ${usd(ap.coutEmployeurUSD)} ${usd(dCout)}`
    );
  }

  console.log("-".repeat(122));
  console.log(`TOTAUX (mois nominal) — Δ net salariés versés : +${sDeltaNet.toFixed(2)} $ ; Δ coût employeur : +${sDeltaCout.toFixed(2)} $ ; hausse brut cumulée : +${sHausseBrut.toFixed(2)} $`);
  console.log(`\n(Simulation nominale hors transport/HS/primes. Le recalcul réel utilise les heures/jours du mois. AUCUNE écriture effectuée.)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
