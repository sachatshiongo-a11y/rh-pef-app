import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Les Server Actions plafonnent le corps de requête à 1 Mo par défaut, ce qui fait échouer
    // les téléversements de fiches (surtout l'import en masse). On relève la limite ; le contrôle
    // par fichier (15 Mo) reste appliqué dans televerserFiche.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
