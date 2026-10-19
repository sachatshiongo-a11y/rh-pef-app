import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "./sha256";

const reference = (...m: (string | Uint8Array)[]) => { const h = createHash("sha256"); for (const x of m) h.update(x); return h.digest("hex"); };

describe("sha256Hex (JavaScript pur) = node:crypto", () => {
  it("vecteurs connus", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("textes accentués, octets, morceaux, toutes les longueurs autour d'un bloc", () => {
    expect(sha256Hex("Pâtes en Folie — é\u0000", new Uint8Array([0, 255, 128]))).toBe(reference("Pâtes en Folie — é\u0000", new Uint8Array([0, 255, 128])));
    let graine = 7;
    const hasard = () => (graine = (graine * 1103515245 + 12345) % 2147483648) % 256;
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 100_000]) {
      const o = Uint8Array.from({ length: n }, hasard);
      expect(sha256Hex(o), String(n)).toBe(reference(o));
    }
  });
});
