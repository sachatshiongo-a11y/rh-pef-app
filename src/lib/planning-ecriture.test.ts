import { describe, it, expect, vi } from "vitest";

// Reconnaissance des refus ATTENDUS d'une écriture du planning, que les actions renvoient comme
// un message (Next masque le message des erreurs levées en production). Aucun accès à la base.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { estInterblocage, messageErreurPlanning, messageMoisFiges, MESSAGE_INTERBLOCAGE, MESSAGE_PLANNING_CHANGE, PlanningVerrouilleError } = await import("./planning-ecriture");

// Forme RÉELLE relevée le 2026-09-23 (Prisma 7 + @prisma/adapter-pg), par le test « interblocage
// RÉEL » de planning-ecriture.integration.test.ts : P2010 et le code Postgres au fond de `meta`.
const interblocageReel = Object.assign(new Error("Raw query failed. Code: `40P01`."), {
  code: "P2010",
  meta: {
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: { originalCode: "40P01", originalMessage: "deadlock detected", kind: "postgres", code: "40P01" },
    },
  },
});

describe("estInterblocage", () => {
  it("reconnaît la forme réelle rendue par Prisma (P2010, meta.driverAdapterError.cause)", () => {
    expect(estInterblocage(interblocageReel)).toBe(true);
  });

  it("reconnaît les autres chemins : erreur pg brute, code Prisma P2034, meta.code, cause", () => {
    expect(estInterblocage({ code: "40P01" })).toBe(true);
    expect(estInterblocage({ code: "P2034", meta: {} })).toBe(true);
    expect(estInterblocage({ code: "P2010", meta: { code: "40P01" } })).toBe(true);
    expect(estInterblocage({ cause: { originalCode: "40P01" } })).toBe(true);
  });

  it("ne reconnaît PAS les autres erreurs, ni le texte d'un message", () => {
    expect(estInterblocage({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "55P03" } } } })).toBe(false); // délai de verrou
    expect(estInterblocage({ code: "P2002", meta: { target: ["employeeId", "date"] } })).toBe(false); // doublon
    expect(estInterblocage(new Error("40P01 deadlock detected"))).toBe(false);
    expect(estInterblocage("40P01")).toBe(false);
    expect(estInterblocage(null)).toBe(false);
    expect(estInterblocage(undefined)).toBe(false);
  });

  it("une erreur qui se référence elle-même ne boucle pas", () => {
    const e: Record<string, unknown> = { code: "XX000" };
    e.cause = e;
    expect(estInterblocage(e)).toBe(false);
  });
});

describe("messageErreurPlanning", () => {
  it("planning verrouillé → le message du verrou", () => {
    const e = new PlanningVerrouilleError([{ employeeId: "x", nom: "Martine Mutombo", mois: 9, annee: 2026 }]);
    expect(messageErreurPlanning(e)).toBe(
      "Planning verrouillé : paie validée ou payée pour Martine Mutombo (septembre 2026). Rouvrir la ligne de paie avant de modifier ce planning.",
    );
  });

  it("interblocage → « La paie est en cours de validation : réessayez dans un instant. »", () => {
    expect(MESSAGE_INTERBLOCAGE).toBe("La paie est en cours de validation : réessayez dans un instant.");
    expect(messageErreurPlanning(interblocageReel)).toBe(MESSAGE_INTERBLOCAGE);
  });

  it("course sur un même (salarié, jour) : P2002 → « Le planning a changé pendant l'enregistrement : réessayez. »", () => {
    expect(MESSAGE_PLANNING_CHANGE).toBe("Le planning a changé pendant l'enregistrement : réessayez.");
    // Forme du client Prisma (createMany sur la clé unique employeeId_date) et forme Postgres brute.
    expect(messageErreurPlanning(Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["employeeId", "date"] } }))).toBe(MESSAGE_PLANNING_CHANGE);
    expect(messageErreurPlanning({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "23505" } } } })).toBe(MESSAGE_PLANNING_CHANGE);
    // Jamais par le texte seul.
    expect(messageErreurPlanning(new Error("P2002 Unique constraint failed"))).toBeNull();
  });

  it("toute autre erreur → null (l'appelant la relance)", () => {
    expect(messageErreurPlanning(new Error("ecrireCreneaux : opération en double pour x|2026-09-18"))).toBeNull();
    expect(messageErreurPlanning({ code: "P2003" })).toBeNull();
  });
});

describe("messageMoisFiges", () => {
  const martine = { employeeId: "m", nom: "Martine Mutombo" };
  const esther = { employeeId: "e", nom: "Esther Ngalula" };
  it("aucun mois figé → rien à dire", () => {
    expect(messageMoisFiges([])).toBeUndefined();
  });
  it("un salarié, un mois : le mois est nommé", () => {
    expect(messageMoisFiges([{ ...martine, mois: 9, annee: 2026 }])).toBe(
      "Paie validée ou payée : Martine Mutombo (septembre 2026) — ses créneaux de ce mois n'ont pas été touchés",
    );
  });
  it("plusieurs salariés et plusieurs mois : chacun avec SES mois, triés par nom puis date", () => {
    expect(messageMoisFiges([
      { ...martine, mois: 10, annee: 2026 },
      { ...esther, mois: 9, annee: 2026 },
      { ...martine, mois: 9, annee: 2026 },
    ])).toBe(
      "Paie validée ou payée : Esther Ngalula (septembre 2026), Martine Mutombo (septembre 2026, octobre 2026) — leurs créneaux de ces mois n'ont pas été touchés",
    );
    expect(messageMoisFiges([{ ...esther, mois: 9, annee: 2026 }, { ...martine, mois: 9, annee: 2026 }])).toBe(
      "Paie validée ou payée : Esther Ngalula (septembre 2026), Martine Mutombo (septembre 2026) — leurs créneaux de ce mois n'ont pas été touchés",
    );
  });
});
