-- Date d'effet de la paie brigade sur heures planifiées : septembre 2026 (AAAAMM = 202609).
-- Décision Direction 2026-09-23. Idempotent : n'écrase jamais une valeur déjà réglée par l'ADMIN.
-- Les mois antérieurs (juin, juillet encore « Pas validé ») restent calculés sur le contrat.
INSERT INTO "public"."ParametreLegal" ("exerciceId", "cle", "valeur", "unite", "libelle", "source", "statutValidation", "commentaire", "updatedAt")
SELECT e."id", 'paie_reference_planning_depuis', 202609, 'AAAAMM',
       'Paie brigade — référence = heures planifiées à partir du mois (AAAAMM)',
       'Décision Direction 2026-09-23', 'A_VALIDER',
       'Vide = ancienne règle (heures/semaine × 52/12) pour tous les mois.', now()
FROM "public"."ExerciceFiscal" e
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."ParametreLegal" x WHERE x."exerciceId" = e."id" AND x."cle" = 'paie_reference_planning_depuis'
);
