import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { chargerPhotosPdf, EN_PARALLELE } from "./photo-fiche-pdf";

// Photos des fiches pour leur PDF : lues côté serveur dans le bucket PRIVÉ (clé de service, jamais
// d'URL), ré-encodées en JPEG (le moteur PDF ne dessine pas le WEBP), et jamais bloquantes.

const appels: string[] = [];
let reponses: Record<string, () => Response> = {};

beforeEach(() => {
  appels.length = 0;
  reponses = {};
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stockage.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle-service");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    appels.push(url);
    expect(init?.signal, "toute lecture de photo a un délai").toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer cle-service");
    const f = Object.entries(reponses).find(([fin]) => url.endsWith(fin));
    return f ? f[1]() : new Response("introuvable", { status: 404 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const webp = () => sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#aa3322" } }).webp().toBuffer();

describe("photos des fiches pour le PDF", () => {
  it("lit la photo dans le bucket privé (URL authentifiée), la convertit en JPEG borné à 600 px", async () => {
    const octets = await webp();
    reponses["/storage/v1/object/authenticated/employes/fiches-techniques/mojito-1.webp"] = () => new Response(new Uint8Array(octets));
    const photos = await chargerPhotosPdf([{ id: "mojito", photoUrl: "/fichiers/fiches-techniques/mojito-1.webp" }]);
    const p = photos.get("mojito");
    expect(p).not.toBe("illisible");
    const { data, format } = p as { data: Buffer; format: string };
    expect(format).toBe("jpg");
    const meta = await sharp(data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(600);
    expect(appels).toEqual(["https://stockage.test/storage/v1/object/authenticated/employes/fiches-techniques/mojito-1.webp"]);
  });

  it("fiche sans photo : aucune entrée, aucun appel", async () => {
    const photos = await chargerPhotosPdf([{ id: "a", photoUrl: null }]);
    expect(photos.size).toBe(0);
    expect(appels).toEqual([]);
  });

  it("photo introuvable ou qui n'est pas une image : « illisible », jamais une erreur", async () => {
    reponses["/fiches-techniques/texte.jpg"] = () => new Response("pas une image");
    const photos = await chargerPhotosPdf([
      { id: "absente", photoUrl: "/fichiers/fiches-techniques/absente.jpg" },
      { id: "texte", photoUrl: "/fichiers/fiches-techniques/texte.jpg" },
    ]);
    expect(photos.get("absente")).toBe("illisible");
    expect(photos.get("texte")).toBe("illisible");
  });

  it("un chemin HORS du dossier des fiches (contrat, bulletin…) n'est jamais lu", async () => {
    const photos = await chargerPhotosPdf([
      { id: "a", photoUrl: "/fichiers/contrats/contrat-1.pdf" },
      { id: "b", photoUrl: "/fichiers/fiches-techniques/../contrats/x.jpg" },
      { id: "c", photoUrl: "https://ailleurs.test/photo.jpg" },
    ]);
    expect([...photos.values()]).toEqual(["illisible", "illisible", "illisible"]);
    expect(appels).toEqual([]);
  });

  it("configuration de stockage absente : « illisible », la fiche s'imprime quand même", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const photos = await chargerPhotosPdf([{ id: "a", photoUrl: "/fichiers/fiches-techniques/a.jpg" }]);
    expect(photos.get("a")).toBe("illisible");
    expect(appels).toEqual([]);
  });

  it("stockage qui ne répond pas : la lecture abandonne après le délai, photo « illisible », PDF non bloqué", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise<Response>((_, rejeter) => {
      init?.signal?.addEventListener("abort", () => rejeter(init.signal!.reason));
    }));
    const debut = Date.now();
    const photos = await chargerPhotosPdf([{ id: "a", photoUrl: "/fichiers/fiches-techniques/a.jpg" }], { delaiMs: 50 });
    expect(photos.get("a")).toBe("illisible");
    expect(Date.now() - debut).toBeLessThan(2000);
  });

  it(`mémoire (instance de 512 Mo) : jamais plus de ${EN_PARALLELE} photos lues et décodées à la fois, toutes lues`, async () => {
    expect(EN_PARALLELE).toBeLessThanOrEqual(3);
    const octets = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    let enCours = 0, maximum = 0;
    vi.stubGlobal("fetch", async () => {
      enCours++;
      maximum = Math.max(maximum, enCours);
      await new Promise((r) => setTimeout(r, 5));
      // La photo n'est rendue qu'une fois décodée : on compte la lecture ET le décodage.
      return new Response(new Uint8Array(octets));
    });
    // Le compteur redescend quand le décodage est fini (sharp est appelé après la lecture).
    const origine = sharp.prototype.toBuffer;
    const espion = vi.spyOn(sharp.prototype, "toBuffer").mockImplementation(async function (this: ReturnType<typeof sharp>, ...args: unknown[]) {
      try { return await (origine as (...a: unknown[]) => Promise<Buffer>).apply(this, args); } finally { enCours--; }
    } as never);
    const fiches = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, photoUrl: `/fichiers/fiches-techniques/f${i}.jpg` }));
    const photos = await chargerPhotosPdf(fiches);
    espion.mockRestore();
    expect(maximum).toBe(EN_PARALLELE);
    expect([...photos.keys()].sort()).toEqual(fiches.map((f) => f.id).sort());
    expect([...photos.values()].every((p) => p !== "illisible")).toBe(true);
  });
});
