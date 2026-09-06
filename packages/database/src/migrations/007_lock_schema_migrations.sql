-- schema_migrations was created by the migrate runner outside the protected
-- table lists in 003/006, so browser roles inherited default grants. Lock it
-- the same way as tenant tables: RLS on, anon/authenticated revoked.
DO $$
BEGIN
  ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.schema_migrations FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.schema_migrations FROM authenticated;
  END IF;
END
$$;
