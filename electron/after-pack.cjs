// Signature ad-hoc automatique de l'app macOS après packaging (avant création du .dmg).
// Indispensable sur Apple Silicon : sans signature, Gatekeeper tue l'app au lancement
// (« l'app plante »). L'ad-hoc (« - ») est gratuit et ne requiert aucun compte Apple Developer.
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const nom = context.packager.appInfo.productFilename;
  const app = path.join(context.appOutDir, `${nom}.app`);
  console.log(`  • signature ad-hoc de ${nom}.app`);
  execSync(`codesign --deep --force --sign - "${app}"`, { stdio: "inherit" });
};
