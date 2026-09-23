CREATE TYPE public.separation_stage AS ENUM ('submitted','hr_review','it_clearance','finance_settlement','completed','withdrawn','rejected');

CREATE TABLE public.separation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  resignation_type text NOT NULL DEFAULT 'resignation',
  notice_date date NOT NULL DEFAULT CURRENT_DATE,
  requested_last_day date NOT NULL,
  approved_last_day date,
  notice_days integer NOT NULL DEFAULT 60,
  stage public.separation_stage NOT NULL DEFAULT 'submitted',

  hr_status public.request_status NOT NULL DEFAULT 'pending',
  hr_note text NOT NULL DEFAULT '',
  hr_decided_at timestamptz,
  exit_interview_done boolean NOT NULL DEFAULT false,
  handover_to uuid REFERENCES public.employees(id) ON DELETE SET NULL,

  it_status public.request_status NOT NULL DEFAULT 'pending',
  it_note text NOT NULL DEFAULT '',
  it_assets text NOT NULL DEFAULT '',
  it_decided_at timestamptz,

  finance_status public.request_status NOT NULL DEFAULT 'pending',
  finance_note text NOT NULL DEFAULT '',
  settlement_amount numeric NOT NULL DEFAULT 0,
  settlement_paid_on date,
  finance_decided_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX separation_requests_employee_idx ON public.separation_requests(employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.separation_requests TO authenticated;
GRANT ALL ON public.separation_requests TO service_role;

ALTER TABLE public.separation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own or managed separations"
ON public.separation_requests FOR SELECT TO authenticated
USING (
  employee_id = public.my_employee_id()
  OR public.can_manage_company(public.employee_company(employee_id))
);

CREATE POLICY "employee raises own, hr raises for their company"
ON public.separation_requests FOR INSERT TO authenticated
WITH CHECK (
  employee_id = public.my_employee_id()
  OR public.can_manage_company(public.employee_company(employee_id))
);

CREATE POLICY "hr updates separations"
ON public.separation_requests FOR UPDATE TO authenticated
USING (public.can_manage_company(public.employee_company(employee_id)))
WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));

CREATE POLICY "employee updates own separation"
ON public.separation_requests FOR UPDATE TO authenticated
USING (employee_id = public.my_employee_id())
WITH CHECK (employee_id = public.my_employee_id());

CREATE POLICY "hr deletes separations"
ON public.separation_requests FOR DELETE TO authenticated
USING (public.can_manage_company(public.employee_company(employee_id)));

CREATE TRIGGER separation_requests_updated_at
BEFORE UPDATE ON public.separation_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();