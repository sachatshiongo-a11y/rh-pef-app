import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { creerBaseTest } from "@/lib/test/db";
import type { Rattachement } from "./import-photos-fiches";

// Écrit sur le Postgres ÉPHÉMÈRE (embedded-postgres) et DOUBLE entièrement Supabase Storage —
// aucun appel réseau réel, cf. le mock de "../src/lib/fiches/photo-storage" ci-dessous.

const S = vi.hoisted(() => ({
  envoyerPhoto: vi.fn(async () => {}),
  supprimerPhoto: vi.fn(async () => {}),
  verifierBucketPhotos: vi.fn(async () => {}),
}));
vi.mock("../src/lib/fiches/photo-storage", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../src/lib/fiches/photo-storage")>();
  return {
    ...reel,
    identifiantsSupabase: () => ({ base: "https://exemple.test", key: "cle-de-test" }),
    verifierBucketPhotos: S.verifierBucketPhotos,
    envoyerPhoto: S.envoyerPhoto,
    supprimerPhoto: S.supprimerPhoto,
  };
});

const {
  compresserImage,
  chargerFichesBaseEnLectureSeule,
  importerPhotos,
} = await import("./import-photos-fiches");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer;
}, 120_000);

afterAll(async () => { await fermer?.(); });

beforeEach(() => {
  S.envoyerPhoto.mockClear();
  S.supprimerPhoto.mockClear();
  S.verifierBucketPhotos.mockClear();
});

// PNG réellement décodable (sharp/libvips va la traiter pour de vrai, contrairement au simple test
// de signature binaire des autres suites) : générée par sharp lui-même, un pixel suffit.
const octetsPng = async () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer();

describe("chargerFichesBaseEnLectureSeule — READ ONLY garanti par ROLLBACK", () => {
  it("lit les fiches en base sans jamais y laisser la moindre trace, même si on tentait d'écrire dans la même transaction", async () => {
    const f = await prisma.ficheTechnique.create({ data: { nom: "Lecture seule", nbPortions: 1 } });

    const lues = await chargerFichesBaseEnLectureSeule(prisma);
    expect(lues.some((x) => x.id === f.id)).toBe(true);

    // Le SET TRANSACTION READ ONLY appliqué par la fonction est vérifié en direct, sur la même
    // base : toute tentative d'écriture SOUS cette même protection doit être refusée par Postgres.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.ficheTechnique.update({ where: { id: f.id }, data: { nom: "Modifiée en lecture seule ?!" } });
      }),
    ).rejects.toThrow();

    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: f.id } });
    expect(relue.nom).toBe("Lecture seule"); // inchangé
  }, 60_000);
});

describe("importerPhotos — écriture réelle (base éphémère) + stockage doublé", () => {
  it("envoie une photo à une fiche sans photo, journalise le chemin, et laisse les autres fiches intactes", async () => {
    const f1 = await prisma.ficheTechnique.create({ data: { nom: "Bolognaise import", nbPortions: 1 } });
    const octets = await octetsPng();
    const compressee = await compresserImage(octets);
    const compressions = new Map([["xl/media/imageX.jpg", compressee]]);
    const rattachements: Extract<Rattachement, { statut: "RATTACHEE" }>[] = [
      { statut: "RATTACHEE", onglet: "Bolognaise", mediaPath: "xl/media/imageX.jpg", extension: "jpg", octetsOriginaux: octets.length, fiche: { id: f1.id, nom: f1.nom, photoUrl: null } },
    ];

    const r = await importerPhotos(prisma, { base: "x", key: "y" }, rattachements, compressions, { remplacer: false });
    expect(r.envoyees).toHaveLength(1);
    expect(r.ignorees).toHaveLength(0);
    expect(S.verifierBucketPhotos).toHaveBeenCalledTimes(1);
    expect(S.envoyerPhoto).toHaveBeenCalledTimes(1);

    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: f1.id } });
    expect(relue.photoUrl).toMatch(/^\/fichiers\/fiches-techniques\//);
  }, 60_000);

  it("idempotent : une 2e passe sans --remplacer ignore une fiche déjà importée par CE script", async () => {
    const f = await prisma.ficheTechnique.create({ data: { nom: "Déjà faite", nbPortions: 1, photoUrl: "/fichiers/fiches-techniques/abc-1.jpg" } });
    const octets = await octetsPng();
    const compressee = await compresserImage(octets);
    const compressions = new Map([["xl/media/imageY.jpg", compressee]]);
    const rattachements: Extract<Rattachement, { statut: "RATTACHEE" }>[] = [
      { statut: "RATTACHEE", onglet: "Déjà faite", mediaPath: "xl/media/imageY.jpg", extension: "jpg", octetsOriginaux: 1, fiche: { id: f.id, nom: f.nom, photoUrl: f.photoUrl } },
    ];

    const r = await importerPhotos(prisma, { base: "x", key: "y" }, rattachements, compressions, { remplacer: false });
    expect(r.envoyees).toHaveLength(0);
    expect(r.ignorees).toHaveLength(1);
    expect(S.envoyerPhoto).not.toHaveBeenCalled();

    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: f.id } });
    expect(relue.photoUrl).toBe("/fichiers/fiches-techniques/abc-1.jpg"); // inchangé
  }, 60_000);

  it("ne remplace jamais en silence une photo ajoutée à la main (préfixe différent), sauf --remplacer explicite", async () => {
    const f = await prisma.ficheTechnique.create({ data: { nom: "Photo manuelle", nbPortions: 1, photoUrl: "/fichiers/autre-prefixe/manuelle.jpg" } });
    const octets = await octetsPng();
    const compressee = await compresserImage(octets);
    const compressions = new Map([["xl/media/imageZ.jpg", compressee]]);
    const rattachements: Extract<Rattachement, { statut: "RATTACHEE" }>[] = [
      { statut: "RATTACHEE", onglet: "Photo manuelle", mediaPath: "xl/media/imageZ.jpg", extension: "jpg", octetsOriginaux: 1, fiche: { id: f.id, nom: f.nom, photoUrl: f.photoUrl } },
    ];

    const sansRemplacer = await importerPhotos(prisma, { base: "x", key: "y" }, rattachements, compressions, { remplacer: false });
    expect(sansRemplacer.envoyees).toHaveLength(0);
    expect(sansRemplacer.ignorees).toHaveLength(1);

    const avecRemplacer = await importerPhotos(prisma, { base: "x", key: "y" }, rattachements, compressions, { remplacer: true });
    expect(avecRemplacer.envoyees).toHaveLength(1);
    expect(S.supprimerPhoto).toHaveBeenCalledWith(expect.anything(), "autre-prefixe/manuelle.jpg");

    const relue = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: f.id } });
    expect(relue.photoUrl).toMatch(/^\/fichiers\/fiches-techniques\//);
  }, 60_000);
});
