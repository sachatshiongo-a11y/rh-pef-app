// Coque application de bureau (Electron) pour RH Pâtes en Folie.
//
// Elle affiche l'application web dans une fenêtre native (icône, plein écran, pas de barre
// d'adresse) — « pas un simple lien ». L'URL de l'application est configurable :
//   - APP_URL (variable d'environnement) OU le fichier electron/app-url.txt
//   - par défaut : http://localhost:3000
//
// ⚠️ SÉCURITÉ : ne JAMAIS embarquer la clé SUPABASE_SERVICE_ROLE_KEY dans cette coque distribuée.
// Le serveur Next (qui détient la clé) doit tourner ailleurs (hébergé en Europe près de la base,
// ou sur un serveur local du restaurant). La coque ne fait qu'afficher son URL.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const fs = require("fs");

function lireAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.trim();
  const fichier = path.join(__dirname, "app-url.txt");
  try {
    const contenu = fs.readFileSync(fichier, "utf8").trim();
    if (contenu) return contenu;
  } catch {
    /* fichier absent : on garde le défaut */
  }
  return "http://localhost:3000";
}

function creerFenetre() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "RH Pâtes en Folie",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(lireAppUrl());

  // Les liens externes (ex. ouverture d'un bulletin dans un nouvel onglet) s'ouvrent dans le
  // navigateur système plutôt que dans une fenêtre Electron sans barre d'outils.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  creerFenetre();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
