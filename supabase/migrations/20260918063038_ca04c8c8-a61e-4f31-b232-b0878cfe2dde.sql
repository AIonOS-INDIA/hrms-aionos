CREATE TYPE public.asset_category AS ENUM ('hardware','accessory','software_license','subscription','other');
CREATE TYPE public.asset_state AS ENUM ('assigned','returned','lost','damaged','retired');

CREATE TABLE public.employee_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  category public.asset_category NOT NULL DEFAULT 'hardware',
  asset_type text NOT NULL DEFAULT '',
  name text NOT NULL,
  make_model text NOT NULL DEFAULT '',
  serial_number text NOT NULL DEFAULT '',
  asset_tag text NOT NULL DEFAULT '',
  vendor text NOT NULL DEFAULT '',
  license_key text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  assigned_on date NOT NULL DEFAULT CURRENT_DATE,
  return_due date,
  returned_on date,
  status public.asset_state NOT NULL DEFAULT 'assigned',
  cost numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  renewal_date date,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX employee_assets_employee_idx ON public.employee_assets(employee_id);
CREATE INDEX employee_assets_company_idx ON public.employee_assets(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_assets TO authenticated;
GRANT ALL ON public.employee_assets TO service_role;

CREATE OR REPLACE FUNCTION private.can_manage_assets(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_manage_company(_company_id)
      OR private.has_finance_role('it_asset', _company_id)
      OR private.has_finance_role('finance_expense', _company_id)
      OR private.has_finance_role('finance_payroll', _company_id);
$$;
REVOKE EXECUTE ON FUNCTION private.can_manage_assets(uuid) FROM anon;

ALTER TABLE public.employee_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_assets_select ON public.employee_assets FOR SELECT TO authenticated
  USING (
    employee_id = private.my_employee_id()
    OR private.is_my_report(employee_id)
    OR private.can_manage_assets(company_id)
  );
CREATE POLICY employee_assets_insert ON public.employee_assets FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_assets(company_id));
CREATE POLICY employee_assets_update ON public.employee_assets FOR UPDATE TO authenticated
  USING (private.can_manage_assets(company_id))
  WITH CHECK (private.can_manage_assets(company_id));
CREATE POLICY employee_assets_delete ON public.employee_assets FOR DELETE TO authenticated
  USING (private.can_manage_assets(company_id));

CREATE TRIGGER employee_assets_updated_at BEFORE UPDATE ON public.employee_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.separation_requests
  ADD COLUMN IF NOT EXISTS manager_status public.request_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS manager_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_decided_at timestamptz;

CREATE POLICY separation_manager_read ON public.separation_requests FOR SELECT TO authenticated
  USING (private.is_my_report(employee_id));
CREATE POLICY separation_manager_update ON public.separation_requests FOR UPDATE TO authenticated
  USING (private.is_my_report(employee_id))
  WITH CHECK (private.is_my_report(employee_id));

CREATE OR REPLACE FUNCTION private.guard_separation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  -- Payroll approvers may only complete the settlement leg.
  IF private.has_finance_role('finance_payroll', private.employee_company(NEW.employee_id)) THEN
    NEW.approved_last_day := OLD.approved_last_day;
    NEW.handover_to := OLD.handover_to;
    NEW.exit_interview_done := OLD.exit_interview_done;
    NEW.manager_status := OLD.manager_status;
    NEW.manager_note := OLD.manager_note;
    NEW.manager_decided_at := OLD.manager_decided_at;
    NEW.hr_status := OLD.hr_status;
    NEW.hr_note := OLD.hr_note;
    NEW.hr_decided_at := OLD.hr_decided_at;
    NEW.it_status := OLD.it_status;
    NEW.it_note := OLD.it_note;
    NEW.it_assets := OLD.it_assets;
    NEW.it_decided_at := OLD.it_decided_at;
    IF NEW.stage IS DISTINCT FROM OLD.stage
       AND NOT (OLD.stage = 'finance_settlement' AND NEW.stage = 'completed') THEN
      RAISE EXCEPTION 'Finance can only close the settlement stage';
    END IF;
    RETURN NEW;
  END IF;

  -- The person's own manager records only the manager decision.
  IF private.is_my_report(NEW.employee_id) THEN
    NEW.approved_last_day := OLD.approved_last_day;
    NEW.exit_interview_done := OLD.exit_interview_done;
    NEW.hr_status := OLD.hr_status;
    NEW.hr_note := OLD.hr_note;
    NEW.hr_decided_at := OLD.hr_decided_at;
    NEW.it_status := OLD.it_status;
    NEW.it_note := OLD.it_note;
    NEW.it_assets := OLD.it_assets;
    NEW.it_decided_at := OLD.it_decided_at;
    NEW.finance_status := OLD.finance_status;
    NEW.finance_note := OLD.finance_note;
    NEW.finance_decided_at := OLD.finance_decided_at;
    NEW.settlement_amount := OLD.settlement_amount;
    NEW.settlement_paid_on := OLD.settlement_paid_on;
    NEW.final_salary_amount := OLD.final_salary_amount;
    NEW.leave_encashment_days := OLD.leave_encashment_days;
    NEW.leave_encashment_amount := OLD.leave_encashment_amount;
    NEW.unpaid_leave_days := OLD.unpaid_leave_days;
    NEW.unpaid_leave_amount := OLD.unpaid_leave_amount;
    NEW.expense_reimbursement_amount := OLD.expense_reimbursement_amount;
    NEW.finance_routed_at := OLD.finance_routed_at;
    IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage NOT IN ('manager_review','hr_review','rejected') THEN
      RAISE EXCEPTION 'A manager can only pass a separation to HR or decline it';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage <> 'withdrawn' THEN
    RAISE EXCEPTION 'Only HR can move a separation forward';
  END IF;

  NEW.approved_last_day := OLD.approved_last_day;
  NEW.handover_to := OLD.handover_to;
  NEW.exit_interview_done := OLD.exit_interview_done;
  NEW.manager_status := OLD.manager_status;
  NEW.manager_note := OLD.manager_note;
  NEW.manager_decided_at := OLD.manager_decided_at;
  NEW.hr_status := OLD.hr_status;
  NEW.hr_note := OLD.hr_note;
  NEW.hr_decided_at := OLD.hr_decided_at;
  NEW.it_status := OLD.it_status;
  NEW.it_note := OLD.it_note;
  NEW.it_assets := OLD.it_assets;
  NEW.it_decided_at := OLD.it_decided_at;
  NEW.finance_status := OLD.finance_status;
  NEW.finance_note := OLD.finance_note;
  NEW.finance_decided_at := OLD.finance_decided_at;
  NEW.settlement_amount := OLD.settlement_amount;
  NEW.settlement_paid_on := OLD.settlement_paid_on;
  NEW.final_salary_amount := OLD.final_salary_amount;
  NEW.leave_encashment_days := OLD.leave_encashment_days;
  NEW.leave_encashment_amount := OLD.leave_encashment_amount;
  NEW.unpaid_leave_days := OLD.unpaid_leave_days;
  NEW.unpaid_leave_amount := OLD.unpaid_leave_amount;
  NEW.expense_reimbursement_amount := OLD.expense_reimbursement_amount;
  NEW.finance_routed_at := OLD.finance_routed_at;
  RETURN NEW;
END;
$$;