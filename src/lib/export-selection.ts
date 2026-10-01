// Plafond de l'export Excel d'une SÉLECTION de factures (`/stock/factures/export?ids=…`).
// Module pur : lu par le bouton (qui se désactive au-delà) ET par la route (qui refuse au-delà) —
// le serveur ne se fie pas au bouton, une adresse écrite à la main passerait sinon.
// Au-delà, la route répond 400 avec ce message plutôt que de tronquer en silence : un export
// incomplet ressemble à un export complet, un refus lisible non.

export const MAX_EXPORT_SELECTION = 200;

export const MESSAGE_EXPORT_TROP_GRAND = `Exportez ${MAX_EXPORT_SELECTION} factures au plus à la fois.`;
