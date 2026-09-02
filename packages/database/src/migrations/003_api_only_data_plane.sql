DO $$
DECLARE
  table_name TEXT;
  protected_tables TEXT[] := ARRAY[
    'clients',
    'prompt_versions',
    'call_sessions',
    'tool_actions',
    'outbound_jobs',
    'suppressions',
    'call_notes',
    'usage_counters',
    'knowledge_documents',
    'knowledge_chunks',
    'workspace_memberships'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
