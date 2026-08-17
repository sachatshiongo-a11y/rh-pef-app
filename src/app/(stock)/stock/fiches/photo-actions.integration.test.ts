import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Ces tests écrivent sur le Postgres ÉPHÉMÈRE (embedded-postgres, cf. src/lib/test/db.ts) et
// DOUBLENT entièrement le stockage Supabase (aucun appel réseau réel, aucune dépendance à un vrai
// bucket) : voir le `vi.mock("@/lib/fiches/photo-storage", …)` ci-dessous.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
const S = vi.hoisted(() => ({
  envoyerPhoto: vi.fn(async (..._args: [unknown, string, Buffer, string]) => {}),
  supprimerPhoto: vi.fn(async (..._args: [unknown, string]) => {}),
  verifierBucketPhotos: vi.fn(async (..._args: [unknown]) => {}),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/fiches/photo-storage", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/fiches/photo-storage")>();
  return {
    ...reel,
    identifiantsSupabase: () => ({ base: "https://exemple.test", key: "cle-de-test" }),
    verifierBucketPhotos: S.verifierBucketPhotos,
    envoyerPhoto: S.envoyerPhoto,
    supprimerPhoto: S.supprimerPhoto,
  };
});

const { envoyerPhotoFiche, supprimerPhotoFiche } = await import("./photo-actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error("Action acceptée alors qu'elle aurait dû être refusée.");
};
const ok = <T,>(r: T | { erreur: string }): T => {
  if (typeof r === "object" && r !== null && "erreur" in r) throw new Error(String((r as { erreur: string }).erreur));
  return r as T;
};

// PNG 1×1 minimal (signature réelle — c'est elle que `detecterTypeImage` doit reconnaître).
const OCTETS_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000a4944415478da6300010000050001a5f645400000000049454e44ae426082",
  "hex",
);
const fichierPng = (nom = "plat.png") => new File([OCTETS_PNG], nom, { type: "image/png" });
const fd = (photo: File) => {
  const f = new FormData();
  f.set("photo", photo);
  return f;
};

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "fiches-photo@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(() => {
  S.envoyerPhoto.mockClear();
  S.supprimerPhoto.mockClear();
  S.verifierBucketPhotos.mockClear();
});

async function creerFicheEnBase(nom: string) {
  return prisma.ficheTechnique.create({ data: { nom, nbPortions: 1 } });
}

describe("photo-actions fiches techniques", () => {
  it("envoie une photo, vérifie le bucket avant tout envoi, et enregistre l'URL privée", async () => {
    const fiche = await creerFicheEnBase("Bolognaise");
    await ok(await envoyerPhotoFiche(fiche.id, fd(fichierPng())));

    expect(S.verifierBucketPhotos).toHaveBeenCalledTimes(1);
    expect(S.envoyerPhoto).toHaveBeenCalledTimes(1);
    const [, chemin] = S.envoyerPhoto.mock.calls[0]!;
    expect(chemin).toMatch(new RegExp(`^fiches-techniques/${fiche.id}-\\d+\\.png$`));

    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    expect(relue.photoUrl).toBe(`/fichiers/${chemin}`);

    const audit = await prisma.journalAudit.findFirst({ where: { entiteId: fiche.id, champ: "photo" } });
    expect(audit?.nouvelleValeur).toBe(relue.photoUrl);
  }, 60_000);

  it("remplace proprement une photo existante : l'ancienne est retirée du bucket, jamais accumulée", async () => {
    const fiche = await creerFicheEnBase("Carbonara");
    await ok(await envoyerPhotoFiche(fiche.id, fd(fichierPng("v1.png"))));
    const avant = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    const cheminAvant = avant.photoUrl!.replace("/fichiers/", "");

    await ok(await envoyerPhotoFiche(fiche.id, fd(fichierPng("v2.png"))));

    expect(S.supprimerPhoto).toHaveBeenCalledTimes(1);
    expect(S.supprimerPhoto.mock.calls[0]![1]).toBe(cheminAvant);

    const apres = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    expect(apres.photoUrl).not.toBe(avant.photoUrl);
  }, 60_000);

  it("refuse un fichier dont le contenu réel n'est pas une image reconnue, même avec un type MIME menteur", async () => {
    const fiche = await creerFicheEnBase("Faux PNG");
    const faux = new File([Buffer.from("<html>pas une image</html>")], "photo.png", { type: "image/png" });
    expect(erreurDe(await envoyerPhotoFiche(fiche.id, fd(faux)))).toContain("n'est pas une image");
    expect(S.envoyerPhoto).not.toHaveBeenCalled();

    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    expect(relue.photoUrl).toBeNull();
  }, 60_000);

  it("refuse une photo trop lourde (> 5 Mo) sans jamais appeler le stockage", async () => {
    const fiche = await creerFicheEnBase("Trop lourd");
    const gros = Buffer.concat([OCTETS_PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const trop = new File([gros], "gros.png", { type: "image/png" });
    expect(erreurDe(await envoyerPhotoFiche(fiche.id, fd(trop)))).toContain("5 Mo");
    expect(S.verifierBucketPhotos).not.toHaveBeenCalled();
    expect(S.envoyerPhoto).not.toHaveBeenCalled();
  }, 60_000);

  it("refuse une fiche introuvable", async () => {
    expect(erreurDe(await envoyerPhotoFiche("inexistante", fd(fichierPng())))).toContain("introuvable");
  }, 60_000);

  it("un bucket manquant échoue BRUYAMMENT (jamais un envoi silencieux qui laisserait la fiche sans photo)", async () => {
    const fiche = await creerFicheEnBase("Bucket absent");
    S.verifierBucketPhotos.mockRejectedValueOnce(new Error('Bucket Supabase Storage « employes » introuvable.'));
    expect(erreurDe(await envoyerPhotoFiche(fiche.id, fd(fichierPng())))).toContain("introuvable");
    expect(S.envoyerPhoto).not.toHaveBeenCalled();
    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    expect(relue.photoUrl).toBeNull();
  }, 60_000);

  it("supprime une photo existante (colonne + bucket), et ne fait rien si la fiche n'en a pas", async () => {
    const fiche = await creerFicheEnBase("À nettoyer");
    await ok(await envoyerPhotoFiche(fiche.id, fd(fichierPng())));
    const avecPhoto = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    const chemin = avecPhoto.photoUrl!.replace("/fichiers/", "");

    await ok(await supprimerPhotoFiche(fiche.id));
    expect(S.supprimerPhoto).toHaveBeenCalledWith(expect.anything(), chemin);
    const apres = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: fiche.id } });
    expect(apres.photoUrl).toBeNull();

    S.supprimerPhoto.mockClear();
    await ok(await supprimerPhotoFiche(fiche.id)); // déjà sans photo : no-op
    expect(S.supprimerPhoto).not.toHaveBeenCalled();
  }, 60_000);
});
