import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Decimal from "decimal.js";
import { actionLisible, messageDe } from "./action-lisible";
import { formulaireLisible } from "./erreur-formulaire";
import { ErreurMetier, MESSAGE_ERREUR_INATTENDUE, estErreurMetier } from "./erreur-metier";
import { StockInsuffisant } from "./validations-stock/stock-positif";
import { BulletinFigeError } from "./paie-element-fige";
import { PdfTropLongError } from "./pdf/plafond";

// Audit du 10/10/2026, sécurité 6 : actionLisible / formulaireLisible renvoyaient À L'ÉCRAN le
// message de N'IMPORTE QUELLE erreur (requête Prisma, nom de table, TypeError…) sans la journaliser.

/** Erreur technique au même profil qu'une erreur Prisma (sous-classe d'Error, message interne). */
class PrismaClientKnownRequestError extends Error {
  code = "P2002";
}

const GENERIQUE = new RegExp(`^${MESSAGE_ERREUR_INATTENDUE.replace(/[.,]/g, "\\$&")} \\(réf\\. [A-Z0-9]{6}\\)$`);

afterEach(() => { vi.restoreAllMocks(); });

describe("actionLisible : seules les erreurs métier sont montrées", () => {
  it("Error simple (convention du dépôt) et classes de refus : message tel quel, rien au journal", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await actionLisible(async () => { throw new Error("Le montant dépasse le reste à payer."); })()).toEqual({ erreur: "Le montant dépasse le reste à payer." });
    expect(await actionLisible(async () => { throw new ErreurMetier("Refus lisible."); })()).toEqual({ erreur: "Refus lisible." });
    expect(estErreurMetier(new PdfTropLongError(2000))).toBe(true);
    expect(journal).not.toHaveBeenCalled();
  });

  it("erreur technique (Prisma, TypeError, decimal.js) : message générique + référence, erreur COMPLÈTE au journal", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    const techniques: (() => never)[] = [
      () => { throw new PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`) in table "public"."User"'); },
      () => { throw new TypeError("Cannot read properties of undefined (reading 'id')"); },
      () => { new Decimal("abc"); throw new Error("inatteignable"); },
    ];
    for (const t of techniques) {
      const r = (await actionLisible(async () => t())()) as { erreur: string };
      expect(r.erreur).toMatch(GENERIQUE);
      expect(r.erreur).not.toMatch(/User|undefined|Decimal/);
      const ref = r.erreur.match(/réf\. (\w+)/)![1];
      const appel = journal.mock.calls.at(-1)!;
      expect(String(appel[0])).toContain(`réf. ${ref}`);
      expect(appel[1]).toBeInstanceOf(Error); // l'erreur entière (pile comprise) part au journal Render
    }
  });

  it("les redirections de Next passent inchangées", async () => {
    const redir = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    await expect(actionLisible(async () => { throw redir; })()).rejects.toBe(redir);
  });

  it("messageDe (actions en lot) suit la même règle", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(messageDe(new Error("Article introuvable."))).toBe("Article introuvable.");
    expect(messageDe(new RangeError("Invalid time value"))).toMatch(GENERIQUE);
  });
});

describe("formulaireLisible : même règle, message générique dans l'adresse", () => {
  async function adresse(corps: () => Promise<void>): Promise<string> {
    try { await formulaireLisible("/stock/achats", corps); return ""; } catch (e) {
      return decodeURIComponent(String((e as { digest?: string }).digest).split(";")[2]);
    }
  }
  it("métier : son message ; technique : générique + journal avec la page en contexte", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await adresse(async () => { throw new Error("Quantité requise."); })).toBe("/stock/achats?erreur=Quantité requise.");
    const a = await adresse(async () => { throw new PrismaClientKnownRequestError("relation \"stock\".\"Achat\" does not exist"); });
    expect(a.replace("/stock/achats?erreur=", "")).toMatch(GENERIQUE);
    expect(String(journal.mock.calls.at(-1)![0])).toContain("formulaire /stock/achats");
  });
});

describe("garde-fou : les classes d'erreur du dépôt sont des erreurs MÉTIER", () => {
  it("les classes de refus héritent d'ErreurMetier", () => {
    for (const C of [StockInsuffisant, BulletinFigeError, PdfTropLongError]) expect(C.prototype).toBeInstanceOf(ErreurMetier);
  });

  it("aucune nouvelle `class … extends Error` : elle serait masquée à l'écran en « Erreur inattendue »", () => {
    const SRC = path.resolve(__dirname, "..");
    const fautifs: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /class \w+ extends Error\b/.test(fs.readFileSync(p, "utf8"))) fautifs.push(path.relative(SRC, p));
      }
    };
    parcourir(SRC);
    expect(fautifs, "faire hériter d'ErreurMetier (src/lib/erreur-metier.ts) une erreur faite pour être lue").toEqual(["lib/erreur-metier.ts"]);
  });
});
