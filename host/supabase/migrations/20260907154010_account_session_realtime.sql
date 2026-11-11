-- RLS continues to limit session notifications to the authenticated owner.
alter publication supabase_realtime add table public.aether_sessions;
