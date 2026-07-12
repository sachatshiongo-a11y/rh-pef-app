-- Sécurité : active la Row-Level Security sur les 7 tables qui ne l'avaient pas (dont jetons de
-- réinitialisation et paiements). Le rôle applicatif (postgres, BYPASSRLS) n'est PAS affecté ; cela
-- bloque tout accès via l'API Data Supabase (rôle anon/authenticated) faute de policy permissive.
ALTER TABLE "JetonReinitialisation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolyvalencePoste" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TentativeConnexion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock"."ClotureStock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock"."CommandeLegumeResto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock"."CommandeResto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock"."Paiement" ENABLE ROW LEVEL SECURITY;
