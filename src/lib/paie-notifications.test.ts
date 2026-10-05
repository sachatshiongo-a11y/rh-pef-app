import { describe, it, expect } from "vitest";
import { messageBulletinsAPayer, messageBulletinsPayes, messageClotureParRH, messagePaiementAnnule, libelleMoisPaie } from "./paie-notifications";

// Textes des notifications de paie (2026-10-01) : le mois est celui de la PAIE, la date celle du jour
// civil de Kinshasa, le total celui réellement versé, écrit à la française.
describe("notifications de paie : les textes", () => {
  it("le mois de la paie, jamais celui de l'horloge", () => {
    expect(libelleMoisPaie(9, 2026)).toBe("septembre 2026");
    expect(libelleMoisPaie(12, 2025)).toBe("décembre 2025");
  });

  it("à payer : singulier, pluriel, et ce qui attend déjà", () => {
    expect(messageBulletinsAPayer(1, 9, 2026, 1)).toBe("1 bulletin de septembre 2026 validé — à payer");
    expect(messageBulletinsAPayer(3, 9, 2026, 3)).toBe("3 bulletins de septembre 2026 validés — à payer");
    expect(messageBulletinsAPayer(2, 9, 2026, 7)).toBe("2 bulletins de septembre 2026 validés — à payer (7 en attente de paiement)");
  });

  it("payés : la date de versement choisie (date pure, lue en UTC — jamais décalée), total à la française", () => {
    expect(messageBulletinsPayes(2, 9, 2026, new Date("2026-10-01T00:00:00Z"), 1234.5)).toBe("2 bulletins de septembre 2026 payés le 01/10/2026 — 1 234,50 $");
    expect(messageBulletinsPayes(1, 9, 2026, new Date("2026-09-30T00:00:00Z"), 270)).toBe("1 bulletin de septembre 2026 payé le 30/09/2026 — 270,00 $");
  });

  it("clôture par la RH : qui, et les lignes hors calcul laissées de côté", () => {
    expect(messageClotureParRH(9, 2026, "Esther (RH)", 0)).toBe("Paie de septembre 2026 clôturée par Esther (RH)");
    expect(messageClotureParRH(9, 2026, "Esther (RH)", 2)).toBe("Paie de septembre 2026 clôturée par Esther (RH) — 2 ligne(s) hors calcul laissée(s) de côté");
  });

  it("paiement annulé par la Direction", () => {
    expect(messagePaiementAnnule(2, 9, 2026)).toBe("Paiement annulé par la Direction : 2 bulletins de septembre 2026 à payer de nouveau");
  });
});
