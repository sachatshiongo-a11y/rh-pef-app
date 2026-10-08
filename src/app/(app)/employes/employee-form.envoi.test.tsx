// @vitest-environment happy-dom
//
// Fiche employé (création et modification) : la RÉORGANISATION de l'écran (sections, sommaire,
// simulation collante, enregistrement depuis la barre) ne change RIEN à ce que le serveur reçoit.
// Les listes de référence ci-dessous ont été relevées sur le formulaire d'AVANT la refonte
// (commit 5e1a386, une seule grille de champs) : mêmes noms, mêmes valeurs (l'ordre ne compte pas : le serveur lit chaque champ par son nom). Un champ
// déplacé hors du <form> (dans une section voisine, la barre collante…) sans l'attribut `form`
// disparaîtrait de l'envoi — c'est ce que ce test attrape.
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Employee } from "@prisma/client";
import { EmployeeForm } from "./employee-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYE = {
  id: "e1", matricule: "ST01-PEF", nom: "Sacha Tshiongo", sexe: "M", etatCivil: "Marié(e)", poste: "Cuisinier", secteur: "Cuisine",
  categorie: "BACKOFFICE", categorieProfessionnelle: "EMPLOYE", salaireMensuel: 450.5, transportJourCDF: 3000, transportMoisCDF: 12000,
  transportMoisUSD: 25, cnssMontant: 4, enfants: 2, type: "NATIONAL", dateNaissance: new Date("1990-04-12T00:00:00Z"), telephone: "+243 81 234 5678",
  email: "sacha@example.cd", adresse: "Av. de la Justice 12", photoUrl: null, banque: "Rawbank", compteBancaire: "05100-0123456-78", mobileMoney: "0812345678",
  modePaiement: "VIREMENT", idExterneIVMS: "17", dateEmbauche: new Date("2023-02-01T00:00:00Z"), contrat: "CDI", heuresParJour: 8, heuresHebdomadaires: 45,
  fraisMedicauxMoisCourant: 12.5, actif: true, createdAt: new Date(), updatedAt: new Date(),
} as unknown as Employee;

/** Ce qu'enverrait le navigateur : les champs DU formulaire de la fiche (descendants sans `form`, ou rattachés par `form="…"`). */
function envoi(conteneur: HTMLElement): [string, string][] {
  const form = (conteneur.querySelector('[name="salaireMensuel"]') as HTMLInputElement).closest("form")
    ?? conteneur.querySelector(`form#${(conteneur.querySelector('[name="salaireMensuel"]') as HTMLInputElement).getAttribute("form")}`)!;
  const tous = [...conteneur.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]")];
  const appartient = (el: Element) => {
    const attr = el.getAttribute("form");
    return attr ? attr === form.id : el.closest("form") === form;
  };
  return tous
    .filter(appartient)
    .filter((el) => !(el instanceof HTMLInputElement) || !["file", "submit", "button"].includes(el.type))
    .filter((el) => !(el instanceof HTMLInputElement) || !["checkbox", "radio"].includes(el.type) || el.checked)
    .map((el) => [el.name, el.value]);
}

let conteneur: HTMLDivElement;
let racine: Root;
function monter(employee?: Employee) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(EmployeeForm, { employee, action: () => {}, joursOuvrablesMois: 26, postes: ["Cuisinier", "Serveuse"] })));
}
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

const tri = (l: [string, string][]) => [...l].sort((a, b) => a[0].localeCompare(b[0]));

describe("fiche employé : le serveur reçoit exactement les mêmes champs qu'avant la refonte", () => {
  it("modification : mêmes noms et mêmes valeurs (relevés sur l'ancien formulaire)", () => {
    monter(EMPLOYE);
    expect(tri(envoi(conteneur))).toEqual(tri(AVANT_MODIFICATION));
  });

  it("création : mêmes noms et mêmes valeurs par défaut", () => {
    monter();
    expect(tri(envoi(conteneur))).toEqual(tri(AVANT_CREATION));
  });
});

// Relevés sur le formulaire d'avant la refonte (ne pas régénérer depuis le nouveau : c'est la référence).
const AVANT_MODIFICATION: [string, string][] = [
  ["adresse", "Av. de la Justice 12"],
  ["banque", "Rawbank"],
  ["categorie", "BACKOFFICE"],
  ["categorieProfessionnelle", "EMPLOYE"],
  ["cnssMontant", "4"],
  ["compteBancaire", "05100-0123456-78"],
  ["contrat", "CDI"],
  ["dateEmbauche", "2023-02-01"],
  ["dateNaissance", "1990-04-12"],
  ["email", "sacha@example.cd"],
  ["enfants", "2"],
  ["etatCivil", "Marié(e)"],
  ["fraisMedicauxMoisCourant", "12,5"],
  ["heuresHebdomadaires", "45"],
  ["heuresParJour", "8"],
  ["idExterneIVMS", "17"],
  ["matricule", "ST01-PEF"],
  ["mobileMoney", "0812345678"],
  ["modePaiement", "VIREMENT"],
  ["nom", "Sacha Tshiongo"],
  ["poste", "Cuisinier"],
  ["salaireMensuel", "450,5"],
  ["secteur", "Cuisine"],
  ["sexe", "M"],
  ["telephone", "+243 81 234 5678"],
  ["transportJourCDF", "3000"],
  ["transportMoisCDF", "12000"],
  ["transportMoisUSD", "25"],
  ["type", "NATIONAL"],
];
const AVANT_CREATION: [string, string][] = [
  ["adresse", ""],
  ["banque", ""],
  ["categorie", "BRIGADE"],
  ["categorieProfessionnelle", ""],
  ["cnssMontant", ""],
  ["compteBancaire", ""],
  ["contrat", "CDD"],
  ["dateEmbauche", ""],
  ["dateNaissance", ""],
  ["email", ""],
  ["enfants", "0"],
  ["etatCivil", "Célibataire"],
  ["fraisMedicauxMoisCourant", "0"],
  ["heuresHebdomadaires", "48"],
  ["heuresParJour", "8"],
  ["idExterneIVMS", ""],
  ["matricule", ""],
  ["mobileMoney", ""],
  ["modePaiement", "ESPECES"],
  ["nom", ""],
  ["poste", ""],
  ["salaireMensuel", ""],
  ["secteur", ""],
  ["sexe", "M"],
  ["telephone", ""],
  ["transportJourCDF", ""],
  ["transportMoisCDF", ""],
  ["transportMoisUSD", ""],
  ["type", "NATIONAL"],
];
