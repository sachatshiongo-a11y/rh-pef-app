import type { Metadata, Viewport } from "next";
import { MajBanner } from "@/components/maj-banner";
import { EnregistrerSW } from "@/components/enregistrer-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pâtes en Folie",
  robots: { index: false, follow: false }, // outil interne : jamais indexé par les moteurs
  description: "Gestion de Pâtes en Folie",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/icons/apple-touch-icon-167.png", sizes: "167x167", type: "image/png" },
      { url: "/icons/apple-touch-icon-152.png", sizes: "152x152", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "Pâtes en Folie",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#8b5e3c",
  viewportFit: "cover", // permet d'utiliser les safe-area (encoche / barre d'accueil iPhone)
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-dvh flex flex-col">
        {children}
        {/* Enregistre le service worker pour TOUT LE MONDE : il porte le cache de la coquille et la
            page hors ligne, pas seulement les notifications — voir src/components/enregistrer-sw.tsx. */}
        <EnregistrerSW />
        {/* Propose un rechargement quand un nouveau déploiement est en ligne (PWA). */}
        <MajBanner version={(process.env.RENDER_GIT_COMMIT ?? "dev").slice(0, 12)} />
      </body>
    </html>
  );
}
