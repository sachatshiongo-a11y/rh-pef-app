import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Envoi des courriels (Direction, 2026-10-18) : l'offre gratuite de Render bloque le SMTP sortant, les courriels
// passent par l'API Gmail (HTTPS). Ici : la construction du message RFC 822, le choix du transport et l'envoi avec un
// `fetch` SIMULÉ — aucun appel à Google, aucun courriel réel.
const nodemailerEnvoi = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: nodemailerEnvoi }) } }));

const { construireMessage, corpsBase64, encoderEnTete, envoyerEmail, messageBase64Url, oublierJetonGmail, transportCourriel } = await import("./email");

const GMAIL = { GMAIL_CLIENT_ID: "id-client", GMAIL_CLIENT_SECRET: "secret-client-ultra", GMAIL_REFRESH_TOKEN: "refresh-ultra-secret" };
const SMTP = { SMTP_USER: "rh@patesenfolie.cd", SMTP_PASS: "mot-de-passe-app" };
const TOUTES = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_FROM", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_HOST", "SMTP_PORT"];
const regler = (env: Record<string, string>) => { for (const k of TOUTES) delete process.env[k]; Object.assign(process.env, env); };

/** Décode les mots encodés d'un en-tête (RFC 2047, B). */
const decoderEnTete = (v: string) => v.replace(/\r\n /g, " ").replace(/=\?UTF-8\?B\?([^?]+)\?=(\s+(?==\?UTF-8))?/g, (_m, b) => Buffer.from(b, "base64").toString("utf8"));
const decoderRaw = (raw: string) => {
  const msg = Buffer.from(raw, "base64url").toString("utf8");
  const [tete, ...reste] = msg.split("\r\n\r\n");
  const enTetes: Record<string, string> = {};
  for (const l of tete.replace(/\r\n /g, "\u0000").split("\r\n")) {
    const i = l.indexOf(": ");
    enTetes[l.slice(0, i)] = l.slice(i + 2).replace(/\u0000/g, "\r\n ");
  }
  return { msg, enTetes, corps: reste.join("\r\n\r\n") };
};

describe("construction du message", () => {
  it("sujet et nom encodés RFC 2047 : accents et émoji passent, chaque mot ≤ 75 caractères, aucun caractère coupé", () => {
    const sujet = "📊 Rapport mensuel — Septembre 2026 : synthèse paie, achats et factures fournisseurs en attente de règlement 🍝";
    const enc = encoderEnTete(sujet);
    for (const mot of enc.split("\r\n ")) {
      expect(mot).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(mot.length).toBeLessThanOrEqual(75);
      // chaque mot se décode seul en UTF-8 valide (pas de moitié d'émoji)
      expect(Buffer.from(mot.slice(10, -2), "base64").toString("utf8")).not.toContain("�");
    }
    expect(decoderEnTete(enc)).toBe(sujet);
    expect(encoderEnTete("Gestion Pâtes en Folie")).toBe("=?UTF-8?B?" + Buffer.from("Gestion Pâtes en Folie").toString("base64") + "?=");
  });

  it("un sujet ASCII court reste lisible ; un saut de ligne glissé dans un sujet ne crée pas d'en-tête", () => {
    expect(encoderEnTete("Rappels du jour")).toBe("Rappels du jour");
    const piege = encoderEnTete("Bonjour\r\nBcc: pirate@exemple.com");
    expect(piege).not.toMatch(/[\r\n]/);
  });

  it("le corps est en base64, lignes de 76 caractères au plus, fins de ligne CRLF, et se relit à l'identique", () => {
    const texte = "Bonjour,\n\n" + "• Congé de Awa débute dans 5 jour(s) — très urgent.\n".repeat(12) + "🔴 URGENT";
    const b64 = corpsBase64(texte);
    const lignes = b64.split("\r\n");
    expect(lignes.length).toBeGreaterThan(3);
    for (const l of lignes.slice(0, -1)) expect(l).toHaveLength(76);
    expect(lignes.at(-1)!.length).toBeLessThanOrEqual(76);
    expect(Buffer.from(lignes.join(""), "base64").toString("utf8")).toBe(texte.replace(/\n/g, "\r\n"));
  });

  it("en-têtes complets : From nommé, To multiples, Subject, Date, Message-ID, MIME ; `raw` est du base64url sans remplissage", () => {
    const msg = construireMessage({
      expediteur: "rh@patesenfolie.cd", destinataires: ["a@pef.cd", "b@pef.cd"], sujet: "📊 Rapport", texte: "Salut ?>~ é",
      date: new Date("2026-10-19T07:00:00Z"), idMessage: "abc-123",
    });
    const raw = messageBase64Url(msg);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // ni +, ni /, ni =
    const { enTetes, corps } = decoderRaw(raw);
    expect(decoderEnTete(enTetes.From)).toBe("Gestion Pâtes en Folie <rh@patesenfolie.cd>");
    expect(enTetes.To).toBe("a@pef.cd, b@pef.cd");
    expect(decoderEnTete(enTetes.Subject)).toBe("📊 Rapport");
    expect(enTetes.Date).toBe("Mon, 19 Oct 2026 07:00:00 GMT");
    expect(enTetes["Message-ID"]).toBe("<abc-123@patesenfolie.cd>");
    expect(enTetes["MIME-Version"]).toBe("1.0");
    expect(enTetes["Content-Type"]).toBe("text/plain; charset=UTF-8");
    expect(enTetes["Content-Transfer-Encoding"]).toBe("base64");
    expect(Buffer.from(corps.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Salut ?>~ é");
  });

  it("falsification du décodeur : un en-tête non encodé ne se confond pas avec un en-tête encodé", () => {
    expect(decoderEnTete("📊 Rapport")).toBe("📊 Rapport"); // le décodeur de test ne « répare » rien : un sujet brut reste brut
    expect(encoderEnTete("📊 Rapport")).not.toContain("📊");
  });
});

describe("choix du transport", () => {
  it.each([
    ["les 3 variables Gmail", GMAIL, "gmail"],
    ["Gmail ET SMTP : Gmail l'emporte", { ...GMAIL, ...SMTP }, "gmail"],
    ["Gmail incomplet (sans refresh token) + SMTP : SMTP", { GMAIL_CLIENT_ID: "x", GMAIL_CLIENT_SECRET: "y", ...SMTP }, "smtp"],
    ["SMTP seul", SMTP, "smtp"],
    ["SMTP sans mot de passe", { SMTP_USER: "a@b.cd" }, "aucun"],
    ["rien", {}, "aucun"],
  ] as const)("%s → %s", (_n, env, attendu) => {
    expect(transportCourriel(env as NodeJS.ProcessEnv)).toBe(attendu);
  });
});

type Reponse = { status: number; corps: unknown };
const rep = (r: Reponse) => new Response(JSON.stringify(r.corps), { status: r.status, headers: { "Content-Type": "application/json" } });

describe("envoi par l'API Gmail (fetch simulé)", () => {
  let appels: { url: string; init: RequestInit }[];
  let reponses: ((url: string) => Reponse | Promise<Response>)[];
  let erreurs: string[];
  const fetchSimule = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    appels.push({ url: String(url), init: init! });
    const r = await reponses.shift()!(String(url));
    return r instanceof Response ? r : rep(r);
  });

  beforeEach(() => {
    appels = []; reponses = []; erreurs = [];
    fetchSimule.mockClear(); nodemailerEnvoi.mockClear();
    vi.stubGlobal("fetch", fetchSimule);
    vi.spyOn(console, "error").mockImplementation((...a) => { erreurs.push(a.join(" ")); });
    vi.spyOn(console, "info").mockImplementation(() => {});
    regler({ ...GMAIL, GMAIL_FROM: "rh@patesenfolie.cd" });
    oublierJetonGmail();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); regler({}); });

  const JETON: Reponse = { status: 200, corps: { access_token: "jeton-acces-secret", expires_in: 3600, token_type: "Bearer" } };
  const OK: Reponse = { status: 200, corps: { id: "m1", threadId: "t1" } };

  it("jeton puis envoi : bons points d'entrée, grant refresh_token, Bearer, message décodable — et n'appelle pas nodemailer", async () => {
    reponses = [() => JETON, () => OK];
    expect(await envoyerEmail(["direction@pef.cd", "stock@pef.cd"], "📊 Rapport mensuel", "Bonjour\nÀ bientôt")).toBe(true);
    expect(appels.map((a) => a.url)).toEqual(["https://oauth2.googleapis.com/token", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"]);
    const form = new URLSearchParams(String(appels[0].init.body));
    expect(Object.fromEntries(form)).toEqual({ client_id: "id-client", client_secret: "secret-client-ultra", refresh_token: "refresh-ultra-secret", grant_type: "refresh_token" });
    expect((appels[1].init.headers as Record<string, string>).Authorization).toBe("Bearer jeton-acces-secret");
    const { enTetes, corps } = decoderRaw(JSON.parse(String(appels[1].init.body)).raw);
    expect(enTetes.To).toBe("direction@pef.cd, stock@pef.cd");
    expect(decoderEnTete(enTetes.Subject)).toBe("📊 Rapport mensuel");
    expect(Buffer.from(corps.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Bonjour\r\nÀ bientôt");
    expect(nodemailerEnvoi).not.toHaveBeenCalled();
  });

  it("le jeton d'accès est mis en cache : deux envois, une seule demande de jeton ; il est redemandé une fois périmé (marge comprise)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T07:00:00Z"));
    reponses = [() => JETON, () => OK, () => OK, () => ({ status: 200, corps: { access_token: "jeton-2", expires_in: 3600 } }), () => OK];
    await envoyerEmail(["a@pef.cd"], "s", "t");
    await envoyerEmail(["a@pef.cd"], "s", "t");
    expect(appels.filter((a) => a.url.includes("oauth2")).length).toBe(1);
    vi.setSystemTime(new Date("2026-10-19T07:59:30Z")); // 3570 s plus tard : dans la marge de 60 s avant l'expiration
    await envoyerEmail(["a@pef.cd"], "s", "t");
    expect(appels.filter((a) => a.url.includes("oauth2")).length).toBe(2);
    expect((appels[4].init.headers as Record<string, string>).Authorization).toBe("Bearer jeton-2");
  });

  it("deux envois SIMULTANÉS ne demandent qu'un seul jeton", async () => {
    reponses = [() => JETON, () => OK, () => OK];
    const [a, b] = await Promise.all([envoyerEmail(["a@pef.cd"], "s", "t"), envoyerEmail(["a@pef.cd"], "s", "t")]);
    expect([a, b]).toEqual([true, true]);
    expect(appels.filter((x) => x.url.includes("oauth2")).length).toBe(1);
  });

  it("invalid_grant : false, ne lève pas, le journal dit de régénérer GMAIL_REFRESH_TOKEN", async () => {
    reponses = [() => ({ status: 400, corps: { error: "invalid_grant", error_description: "Token has been expired or revoked." } })];
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(false);
    expect(erreurs.join("\n")).toMatch(/invalid_grant/);
    expect(erreurs.join("\n")).toMatch(/GMAIL_REFRESH_TOKEN/);
    expect(erreurs.join("\n")).toMatch(/API Gmail/);
  });

  it("invalid_client : le journal désigne l'ID ou le secret client", async () => {
    reponses = [() => ({ status: 401, corps: { error: "invalid_client" } })];
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(false);
    expect(erreurs.join("\n")).toMatch(/GMAIL_CLIENT_ID ou GMAIL_CLIENT_SECRET/);
  });

  it("403 : false, le journal dit « API non activée ou mauvaise portée » et nomme la portée gmail.send", async () => {
    reponses = [() => JETON, () => ({ status: 403, corps: { error: { code: 403, message: "Gmail API has not been used in project 123 before or it is disabled.", status: "PERMISSION_DENIED", errors: [{ reason: "accessNotConfigured" }] } } })];
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(false);
    const j = erreurs.join("\n");
    expect(j).toMatch(/HTTP 403 accessNotConfigured/);
    expect(j).toMatch(/API Gmail non activée/);
    expect(j).toMatch(/gmail\.send/);
  });

  it("401 à l'envoi (jeton périmé trop tôt) : un jeton neuf est demandé et l'envoi réessayé UNE fois", async () => {
    reponses = [() => JETON, () => ({ status: 401, corps: { error: { code: 401 } } }), () => ({ status: 200, corps: { access_token: "jeton-neuf", expires_in: 3600 } }), () => OK];
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(true);
    expect((appels[3].init.headers as Record<string, string>).Authorization).toBe("Bearer jeton-neuf");
  });

  it("délai dépassé (15 s) sur la demande de jeton comme sur l'envoi : false, jamais d'attente infinie", async () => {
    vi.useFakeTimers();
    fetchSimule.mockImplementation(async (url, init) => {
      appels.push({ url: String(url), init: init! });
      return new Promise<Response>((_ok, ko) => init!.signal!.addEventListener("abort", () => ko(new DOMException("aborted", "AbortError"))));
    });
    const p1 = envoyerEmail(["a@pef.cd"], "s", "t");
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await p1).toBe(false);
    expect(erreurs.join("\n")).toMatch(/délai dépassé \(15 s\) : oauth2\.googleapis\.com/);

    // envoi : jeton obtenu, puis Gmail ne répond pas
    erreurs.length = 0; oublierJetonGmail();
    fetchSimule.mockReset();
    fetchSimule.mockImplementationOnce(async (url, init) => { appels.push({ url: String(url), init: init! }); return rep(JETON); });
    fetchSimule.mockImplementationOnce(async (_url, init) => new Promise<Response>((_ok, ko) => init!.signal!.addEventListener("abort", () => ko(new DOMException("aborted", "AbortError")))));
    const p2 = envoyerEmail(["a@pef.cd"], "s", "t");
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await p2).toBe(false);
    expect(erreurs.join("\n")).toMatch(/délai dépassé \(15 s\) : gmail\.googleapis\.com/);
  });

  it("panne réseau : false et message clair", async () => {
    fetchSimule.mockImplementationOnce(async () => { throw new TypeError("fetch failed"); });
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(false);
    expect(erreurs.join("\n")).toMatch(/réseau : fetch failed/);
  });

  it("aucun jeton ni secret dans les journaux, même en cas d'échec", async () => {
    reponses = [() => JETON, () => ({ status: 403, corps: { error: { message: "refusé", errors: [{ reason: "forbidden" }] } } })];
    await envoyerEmail(["a@pef.cd"], "s", "t");
    reponses = [() => ({ status: 400, corps: { error: "invalid_grant" } })];
    oublierJetonGmail();
    await envoyerEmail(["a@pef.cd"], "s", "t");
    const tout = erreurs.join("\n");
    for (const secret of ["jeton-acces-secret", "secret-client-ultra", "refresh-ultra-secret", "id-client"]) expect(tout).not.toContain(secret);
    expect(tout).not.toContain("a@pef.cd"); // ni l'adresse d'un destinataire
  });

  it("expéditeur introuvable (ni GMAIL_FROM, ni SMTP_FROM, ni SMTP_USER) : false avec le nom de la variable à renseigner", async () => {
    regler(GMAIL);
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(false);
    expect(erreurs.join("\n")).toMatch(/GMAIL_FROM/);
    expect(fetchSimule).not.toHaveBeenCalled();
  });

  it("l'expéditeur peut venir de SMTP_FROM au format « Nom <adresse> » (compatibilité)", async () => {
    regler({ ...GMAIL, SMTP_FROM: "Gestion <rh@patesenfolie.cd>" });
    reponses = [() => JETON, () => OK];
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(true);
    expect(decoderEnTete(decoderRaw(JSON.parse(String(appels[1].init.body)).raw).enTetes.From)).toBe("Gestion Pâtes en Folie <rh@patesenfolie.cd>");
  });

  it("une adresse piégée (saut de ligne) est écartée ; si aucune adresse n'est valide : false, sans appel", async () => {
    reponses = [() => JETON, () => OK];
    expect(await envoyerEmail(["a@pef.cd\r\nBcc: pirate@x.com", "b@pef.cd"], "s", "t")).toBe(true);
    const { msg, enTetes } = decoderRaw(JSON.parse(String(appels[1].init.body)).raw);
    expect(enTetes.To).toBe("b@pef.cd");
    expect(msg).not.toContain("pirate");
    appels.length = 0;
    expect(await envoyerEmail(["pas une adresse"], "s", "t")).toBe(false);
    expect(appels).toEqual([]);
  });
});

describe("autres transports et contrat", () => {
  beforeEach(() => {
    nodemailerEnvoi.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch ne doit pas être appelé"); }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    oublierJetonGmail();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); regler({}); });

  it("SMTP configuré, Gmail non : nodemailer comme avant, sans fetch", async () => {
    regler({ ...SMTP, SMTP_FROM: "Rh <rh@patesenfolie.cd>" });
    expect(await envoyerEmail(["a@pef.cd"], "Sujet", "Texte")).toBe(true);
    expect(nodemailerEnvoi).toHaveBeenCalledWith({ from: { name: "Gestion Pâtes en Folie", address: "rh@patesenfolie.cd" }, to: ["a@pef.cd"], subject: "Sujet", text: "Texte" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("SMTP en panne : false, ne lève pas", async () => {
    regler(SMTP);
    nodemailerEnvoi.mockRejectedValueOnce(new Error("Connection timeout"));
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(false);
  });

  it("rien de configuré : no-op, true, aucun appel ; aucun destinataire : true aussi", async () => {
    regler({});
    expect(await envoyerEmail(["a@pef.cd"], "s", "t")).toBe(true);
    regler({ ...GMAIL, GMAIL_FROM: "rh@patesenfolie.cd" });
    expect(await envoyerEmail([], "s", "t")).toBe(true);
    expect(await envoyerEmail([""], "s", "t")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(nodemailerEnvoi).not.toHaveBeenCalled();
  });
});
