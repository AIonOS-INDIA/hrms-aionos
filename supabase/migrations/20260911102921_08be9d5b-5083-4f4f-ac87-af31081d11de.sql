CREATE TABLE IF NOT EXISTS public.entity_pay_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'INR',
  basic_percent numeric NOT NULL DEFAULT 50,
  hra_percent numeric NOT NULL DEFAULT 20,
  allowance_percent numeric NOT NULL DEFAULT 30,
  pf_percent numeric NOT NULL DEFAULT 12,
  professional_tax numeric NOT NULL DEFAULT 200,
  insurance_monthly numeric NOT NULL DEFAULT 0,
  other_deduction numeric NOT NULL DEFAULT 0,
  tax_percent numeric NOT NULL DEFAULT 10,
  working_days_per_month numeric NOT NULL DEFAULT 22,
  notice_period_days integer NOT NULL DEFAULT 60,
  encash_leave_on_exit boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_pay_settings TO authenticated;
GRANT ALL ON public.entity_pay_settings TO service_role;

ALTER TABLE public.entity_pay_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entity_pay_settings_select" ON public.entity_pay_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "entity_pay_settings_write" ON public.entity_pay_settings
  FOR ALL TO authenticated
  USING (private.is_master_hr())
  WITH CHECK (private.is_master_hr());

CREATE TRIGGER entity_pay_settings_updated_at BEFORE UPDATE ON public.entity_pay_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.entity_pay_settings (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;

ALTER TABLE public.separation_requests
  ADD COLUMN IF NOT EXISTS final_salary_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_encashment_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_encashment_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_reimbursement_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finance_routed_at timestamptz;

CREATE POLICY "separation_finance_read" ON public.separation_requests
  FOR SELECT TO authenticated
  USING (private.has_finance_role('finance_payroll', private.employee_company(employee_id)));

CREATE POLICY "separation_finance_update" ON public.separation_requests
  FOR UPDATE TO authenticated
  USING (private.has_finance_role('finance_payroll', private.employee_company(employee_id)))
  WITH CHECK (private.has_finance_role('finance_payroll', private.employee_company(employee_id)));

CREATE OR REPLACE FUNCTION private.guard_separation_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  -- Payroll approvers may only complete the settlement leg.
  IF private.has_finance_role('finance_payroll', private.employee_company(NEW.employee_id)) THEN
    NEW.approved_last_day := OLD.approved_last_day;
    NEW.handover_to := OLD.handover_to;
    NEW.exit_interview_done := OLD.exit_interview_done;
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

  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage <> 'withdrawn' THEN
    RAISE EXCEPTION 'Only HR can move a separation forward';
  END IF;

  NEW.approved_last_day := OLD.approved_last_day;
  NEW.handover_to := OLD.handover_to;
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
  RETURN NEW;
END; $function$;