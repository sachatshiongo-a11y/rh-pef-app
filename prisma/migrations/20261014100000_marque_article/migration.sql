-- Marque d'un article du stock (demande de Sacha, 2026-10-14) : « Beurre doux » de la marque « Président »
-- ou « Lurpak ». Migration PUREMENT ADDITIVE : UNE colonne NOUVELLE, facultative, sur "ArticleStock". Aucune
-- donnée existante n'est modifiée : les articles déjà là gardent une marque vide (la marque reste dite dans
-- leur désignation si elle y est écrite). La désignation n'est jamais réécrite.
ALTER TABLE "stock"."ArticleStock" ADD COLUMN IF NOT EXISTS "marque" TEXT;
