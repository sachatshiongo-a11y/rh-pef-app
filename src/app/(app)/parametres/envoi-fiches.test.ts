import { describe, it, expect } from "vitest";
import { apresEnregistrement, libelleEnvoiFiche } from "./envoi-fiches";

// « ✓ Envoyée » s'affichait dès que l'appareil SAVAIT partager, même quand le partage avait échoué
// et que la fiche était seulement téléchargée : l'administrateur la croyait chez le salarié.
describe("état d'envoi d'une fiche de connexion", () => {
  it("partage abouti → « Envoyée »", () => {
    expect(libelleEnvoiFiche(apresEnregistrement(undefined, "partage"))).toBe("✓ Envoyée");
  });

  it("repli en téléchargement → « Téléchargée »", () => {
    expect(libelleEnvoiFiche(apresEnregistrement(undefined, "telechargement"))).toBe("✓ Téléchargée");
  });

  it("annulation → reste « À envoyer »", () => {
    expect(apresEnregistrement(undefined, "annule")).toBeUndefined();
    expect(libelleEnvoiFiche(apresEnregistrement(undefined, "annule"))).toBe("À envoyer");
  });

  it("une annulation ne défait pas un envoi précédent ; un nouvel envoi remplace l'ancien", () => {
    expect(apresEnregistrement("partage", "annule")).toBe("partage");
    expect(apresEnregistrement("partage", "telechargement")).toBe("telechargement");
    expect(apresEnregistrement("telechargement", "partage")).toBe("partage");
  });
});
