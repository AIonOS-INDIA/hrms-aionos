ALTER TABLE public.subsidiary_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subsidiary_requests;