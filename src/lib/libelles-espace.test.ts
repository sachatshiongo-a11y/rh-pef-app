import { describe, it, expect } from "vitest";
import { CibleSignature, LeaveStatus, StatutAcompte, TypeDocument } from "@prisma/client";
import { messageSignatureRecueillie, LIBELLE_TYPE_DOCUMENT, NOM_CIBLE_SIGNATURE, PAGE_CIBLE_SIGNATURE, STATUT_DEMANDE, libelleTypeDocument, statutDemande } from "./libelles-espace";

// Chaque valeur des énumérations montrées au salarié a son libellé : une valeur ajoutée au schéma
// sans libellé ferait réapparaître le code brut à l'écran.
describe("libellés de l'espace salarié", () => {
  it("chaque type de document a un libellé en clair", () => {
    for (const t of Object.values(TypeDocument)) {
      expect(LIBELLE_TYPE_DOCUMENT[t], t).toBeTruthy();
      expect(LIBELLE_TYPE_DOCUMENT[t]).not.toMatch(/_|^[A-Z]{3,}$/);
    }
  });

  it("chaque statut de demande (congé, acompte, échange) a un libellé", () => {
    // Échanges et changements de shift : statut en texte libre (EN_ATTENTE | APPROUVE | REFUSE | ANNULE).
    for (const s of [...Object.values(LeaveStatus), ...Object.values(StatutAcompte), "ANNULE"]) expect(STATUT_DEMANDE[s], s).toBeTruthy();
  });

  it("chaque cible de signature a un nom et un écran", () => {
    for (const c of Object.values(CibleSignature)) {
      expect(NOM_CIBLE_SIGNATURE[c], c).toBeTruthy();
      expect(PAGE_CIBLE_SIGNATURE[c], c).toMatch(/^\/espace\//);
    }
  });

  it("la notification de signature parle en clair et accorde", () => {
    expect(messageSignatureRecueillie("DEMANDE_CONGE")).toBe("Votre demande de congé a été signée en présence de la Direction.");
    expect(messageSignatureRecueillie("BULLETIN")).toBe("Votre bulletin de paie a été signé en présence de la Direction.");
    for (const c of Object.values(CibleSignature)) expect(messageSignatureRecueillie(c)).not.toContain(c);
  });

  it("une valeur inconnue ne s'affiche jamais brute", () => {
    expect(statutDemande("NOUVEAU_STATUT").label).toBe("Statut inconnu");
    expect(libelleTypeDocument("NOUVEAU_TYPE")).toBe("Document");
  });
});
