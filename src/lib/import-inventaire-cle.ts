// Clé d'un article du classeur d'inventaire (domaine + code, comme le rapprochement) — module PUR,
// partagé par l'écran d'import (choix anti-doublon) et le serveur (`appliquerInventaire`).
export const cleArticleImport = (a: { domaine: string; code: string }) => `${a.domaine}|${a.code}`;
