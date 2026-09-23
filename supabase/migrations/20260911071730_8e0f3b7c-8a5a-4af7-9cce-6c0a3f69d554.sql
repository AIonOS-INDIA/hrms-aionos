CREATE TYPE public.expense_status AS ENUM ('draft','submitted','approved','rejected','reimbursed');

CREATE TABLE public.expense_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  title text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  destination text NOT NULL DEFAULT '',
  trip_start date,
  trip_end date,
  currency text NOT NULL DEFAULT 'INR',
  total_amount numeric NOT NULL DEFAULT 0,
  status public.expense_status NOT NULL DEFAULT 'draft',
  submitted_at timestamptz,
  finance_note text NOT NULL DEFAULT '',
  finance_decided_at timestamptz,
  reimbursed_on date,
  reimbursed_amount numeric NOT NULL DEFAULT 0,
  payment_reference text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'web',
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expense_claims_employee_idx ON public.expense_claims(employee_id);
CREATE INDEX expense_claims_company_idx ON public.expense_claims(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_claims TO authenticated;
GRANT ALL ON public.expense_claims TO service_role;
ALTER TABLE public.expense_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expense_claims_select" ON public.expense_claims FOR SELECT TO authenticated
USING (employee_id = private.my_employee_id() OR private.can_manage_company(company_id));

CREATE POLICY "expense_claims_insert_own" ON public.expense_claims FOR INSERT TO authenticated
WITH CHECK (employee_id = private.my_employee_id() AND company_id = private.employee_company(employee_id));

CREATE POLICY "expense_claims_insert_hr" ON public.expense_claims FOR INSERT TO authenticated
WITH CHECK (private.can_manage_company(company_id));

CREATE POLICY "expense_claims_update" ON public.expense_claims FOR UPDATE TO authenticated
USING (employee_id = private.my_employee_id() OR private.can_manage_company(company_id))
WITH CHECK (employee_id = private.my_employee_id() OR private.can_manage_company(company_id));

CREATE POLICY "expense_claims_delete" ON public.expense_claims FOR DELETE TO authenticated
USING ((employee_id = private.my_employee_id() AND status = 'draft') OR private.can_manage_company(company_id));

CREATE TRIGGER expense_claims_updated_at BEFORE UPDATE ON public.expense_claims
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION private.guard_expense_claim_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(NEW.company_id) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;
  NEW.company_id := OLD.company_id;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status IN ('draft','rejected') AND NEW.status IN ('draft','submitted')) THEN
    RAISE EXCEPTION 'Only finance can decide an expense claim';
  END IF;
  NEW.finance_note := OLD.finance_note;
  NEW.finance_decided_at := OLD.finance_decided_at;
  NEW.reimbursed_on := OLD.reimbursed_on;
  NEW.reimbursed_amount := OLD.reimbursed_amount;
  NEW.payment_reference := OLD.payment_reference;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION private.guard_expense_claim_update() FROM PUBLIC, anon;

CREATE TRIGGER guard_expense_claim_update BEFORE UPDATE ON public.expense_claims
FOR EACH ROW EXECUTE FUNCTION private.guard_expense_claim_update();

CREATE TABLE public.expense_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.expense_claims(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'Other',
  merchant text NOT NULL DEFAULT '',
  spent_on date,
  amount numeric NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  file_path text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  file_type text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX expense_receipts_claim_idx ON public.expense_receipts(claim_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_receipts TO authenticated;
GRANT ALL ON public.expense_receipts TO service_role;
ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.expense_claim_employee(_claim_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT employee_id FROM public.expense_claims WHERE id = _claim_id; $$;

CREATE OR REPLACE FUNCTION private.expense_claim_company(_claim_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT company_id FROM public.expense_claims WHERE id = _claim_id; $$;

REVOKE ALL ON FUNCTION private.expense_claim_employee(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.expense_claim_company(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.expense_claim_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.expense_claim_company(uuid) TO authenticated;

CREATE POLICY "expense_receipts_select" ON public.expense_receipts FOR SELECT TO authenticated
USING (private.expense_claim_employee(claim_id) = private.my_employee_id()
       OR private.can_manage_company(private.expense_claim_company(claim_id)));

CREATE POLICY "expense_receipts_write" ON public.expense_receipts FOR INSERT TO authenticated
WITH CHECK (private.expense_claim_employee(claim_id) = private.my_employee_id()
       OR private.can_manage_company(private.expense_claim_company(claim_id)));

CREATE POLICY "expense_receipts_update" ON public.expense_receipts FOR UPDATE TO authenticated
USING (private.expense_claim_employee(claim_id) = private.my_employee_id()
       OR private.can_manage_company(private.expense_claim_company(claim_id)))
WITH CHECK (private.expense_claim_employee(claim_id) = private.my_employee_id()
       OR private.can_manage_company(private.expense_claim_company(claim_id)));

CREATE POLICY "expense_receipts_delete" ON public.expense_receipts FOR DELETE TO authenticated
USING (private.expense_claim_employee(claim_id) = private.my_employee_id()
       OR private.can_manage_company(private.expense_claim_company(claim_id)));