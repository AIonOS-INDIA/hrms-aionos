CREATE TABLE public.onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  joining_type text NOT NULL CHECK (joining_type IN ('intern', 'full_time', 'contract')),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  personal_email text NOT NULL CHECK (position('@' IN personal_email) > 1),
  phone text,
  address text NOT NULL CHECK (char_length(btrim(address)) > 0),
  department text,
  designation text,
  college text,
  start_date date NOT NULL,
  end_date date,
  requested_by uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  requested_by_name text NOT NULL,
  approver_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  approver_name text NOT NULL,
  approver_email text NOT NULL,
  status public.request_status NOT NULL DEFAULT 'pending',
  decision_note text,
  decided_by_email text,
  decided_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_dates_valid CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT onboarding_end_date_required CHECK (
    joining_type = 'full_time' OR end_date IS NOT NULL
  ),
  CONSTRAINT onboarding_no_self_approval CHECK (approver_id <> requested_by),
  CONSTRAINT onboarding_rejection_reason CHECK (status <> 'rejected' OR char_length(btrim(coalesce(decision_note, ''))) > 0),
  CONSTRAINT onboarding_decision_timestamp CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE INDEX onboarding_requests_requested_by_idx ON public.onboarding_requests(requested_by);
CREATE INDEX onboarding_requests_approver_id_idx ON public.onboarding_requests(approver_id);
CREATE INDEX onboarding_requests_company_id_idx ON public.onboarding_requests(company_id);
CREATE INDEX onboarding_requests_approver_email_idx ON public.onboarding_requests(lower(approver_email));

CREATE OR REPLACE FUNCTION public.set_onboarding_request_decision_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status <> 'pending' AND OLD.status = 'pending' THEN
    NEW.decided_at = now();
  ELSIF NEW.status = 'pending' THEN
    NEW.decided_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER onboarding_requests_decision_timestamp
BEFORE INSERT OR UPDATE ON public.onboarding_requests
FOR EACH ROW EXECUTE FUNCTION public.set_onboarding_request_decision_timestamp();

CREATE TRIGGER onboarding_requests_updated_at
BEFORE UPDATE ON public.onboarding_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.onboarding_requests TO authenticated;
GRANT ALL ON public.onboarding_requests TO service_role;
ALTER TABLE public.onboarding_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_requests_select ON public.onboarding_requests
FOR SELECT TO authenticated
USING (
  requested_by = public.my_employee_id()
  OR approver_id = public.my_employee_id()
  OR public.can_manage_company(company_id)
);