import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SelecteurMois } from "./selecteur-mois";
import { moisDe, moisDuParametre } from "@/lib/dates-fr";

// Sélecteur de mois partagé (Exploitation, Stock) et lecture de `?mois=`.

describe("moisDuParametre — le mois lu dans l'URL", () => {
  const maintenant = new Date("2026-09-30T21:30:00Z"); // 22 h 30 à Kinshasa : septembre des deux côtés
  it("mois courant par défaut", () => {
    expect(moisDe(maintenant)).toBe("2026-09");
    expect(moisDuParametre(undefined, maintenant)).toBe("2026-09");
  });
  it("le 1er du mois à 00 h 30 (Kinshasa) : déjà le mois neuf (l'horloge UTC dit encore la veille)", () => {
    expect(moisDuParametre(undefined, new Date("2026-09-30T23:30:00Z"))).toBe("2026-10");
  });
  it("mois valide : normalisé sur deux chiffres", () => {
    expect(moisDuParametre("2026-08", maintenant)).toBe("2026-08");
    expect(moisDuParametre("2026-8", maintenant)).toBe("2026-08");
  });
  it("mois invalide : mois courant", () => {
    for (const p of ["2026-13", "2026-00", "2026", "août", "", "2026-08-01"]) expect(moisDuParametre(p, maintenant)).toBe("2026-09");
  });
  it("mois futur : accepté (règle de l'Exploitation)", () => {
    expect(moisDuParametre("2027-01", maintenant)).toBe("2027-01");
  });
});

describe("SelecteurMois", () => {
  const rendre = (moisValue: string, moisCourant = "2026-09", chemin = "/stock") =>
    renderToStaticMarkup(<SelecteurMois chemin={chemin} moisValue={moisValue} moisCourant={moisCourant} />);

  it("flèches vers les mois adjacents, passage d'année compris, et mois dans le champ", () => {
    const html = rendre("2026-01", "2026-01");
    expect(html).toContain('aria-label="Mois précédent"');
    expect(html).toContain('href="/stock?mois=2025-12"');
    expect(html).toContain('href="/stock?mois=2026-02"');
    expect(html).toMatch(/<input type="month"[^>]* name="mois" value="2026-01"/);
    expect(html).toContain("<form"); // formulaire GET natif : marche sans JavaScript
  });

  it("au mois courant : pas de lien de retour", () => {
    expect(rendre("2026-09")).not.toContain("data-retour-mois-courant");
  });

  it("hors du mois courant (passé ou futur) : un lien ramène à l'adresse nue", () => {
    for (const m of ["2026-08", "2026-11"]) {
      expect(rendre(m, "2026-09", "/exploitation")).toMatch(/data-retour-mois-courant="true" href="\/exploitation">Revenir à septembre 2026<\/a>/);
    }
  });

  it("rien de collant (ni sous l'en-tête, ni sous la barre du bas) et repli sur téléphone", () => {
    const html = rendre("2026-08");
    expect(html).not.toMatch(/sticky|fixed|colle-sous-entete/);
    expect(html).toMatch(/data-selecteur-mois/);
    expect(html).toMatch(/class="flex flex-wrap items-end gap-2 text-xs" data-selecteur-mois/);
  });
});
