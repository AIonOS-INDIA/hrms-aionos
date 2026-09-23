CREATE TABLE public.subsidiary_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  company_name text NOT NULL,
  company_code text NOT NULL,
  email_domain text NOT NULL,
  note text NOT NULL DEFAULT '',
  status request_status NOT NULL DEFAULT 'pending',
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.subsidiary_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subsidiary_requests TO authenticated;
GRANT ALL ON public.subsidiary_requests TO service_role;

ALTER TABLE public.subsidiary_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY subreq_insert_anon ON public.subsidiary_requests
  FOR INSERT TO anon WITH CHECK (status = 'pending');
CREATE POLICY subreq_insert_auth ON public.subsidiary_requests
  FOR INSERT TO authenticated WITH CHECK (status = 'pending');
CREATE POLICY subreq_read ON public.subsidiary_requests
  FOR SELECT TO authenticated USING (is_master_hr());
CREATE POLICY subreq_update ON public.subsidiary_requests
  FOR UPDATE TO authenticated USING (is_master_hr()) WITH CHECK (is_master_hr());
CREATE POLICY subreq_delete ON public.subsidiary_requests
  FOR DELETE TO authenticated USING (is_master_hr());

CREATE TRIGGER subsidiary_requests_updated_at
  BEFORE UPDATE ON public.subsidiary_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();