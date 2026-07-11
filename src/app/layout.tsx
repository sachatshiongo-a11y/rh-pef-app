import type { Metadata, Viewport } from "next";
import { MajBanner } from "@/components/maj-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pâtes en Folie",
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
      <body className="min-h-full flex flex-col">
        {/* Applique le thème (sombre/tamisé) avant le rendu pour éviter tout clignotement. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||t==='tamise')document.documentElement.classList.add(t);}catch(e){}` }} />
        {children}
        {/* Propose un rechargement quand un nouveau déploiement est en ligne (PWA). */}
        <MajBanner version={(process.env.RENDER_GIT_COMMIT ?? "dev").slice(0, 12)} />
      </body>
    </html>
  );
}
