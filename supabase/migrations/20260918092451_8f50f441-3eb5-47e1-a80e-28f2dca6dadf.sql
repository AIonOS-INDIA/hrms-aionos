
-- 1. Reporting-line checks must never treat a person as their own manager.
CREATE OR REPLACE FUNCTION private.is_my_direct_report(_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = _employee_id
      AND private.my_employee_id() IS NOT NULL
      AND e.id IS DISTINCT FROM private.my_employee_id()
      AND e.manager_id = private.my_employee_id()
  );
$$;

CREATE OR REPLACE FUNCTION private.is_my_report(_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','private' AS $$
  WITH RECURSIVE me AS (SELECT private.my_employee_id() AS id),
  chain AS (
    SELECT e.id, e.manager_id, 1 AS depth
      FROM public.employees e
     WHERE e.id = _employee_id
    UNION ALL
    SELECT p.id, p.manager_id, c.depth + 1
      FROM public.employees p
      JOIN chain c ON p.id = c.manager_id
     WHERE c.depth < 12
  )
  SELECT EXISTS (
    SELECT 1 FROM chain c, me
    WHERE c.manager_id IS NOT NULL
      AND me.id IS NOT NULL
      AND me.id IS DISTINCT FROM _employee_id
      AND c.manager_id = me.id
  );
$$;

-- 2. Expense claims: freeze the claim content once it leaves the employee's hands.
CREATE OR REPLACE FUNCTION private.guard_expense_claim_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(NEW.company_id)
     OR private.has_finance_role('finance_expense', NEW.company_id) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;
  NEW.company_id := OLD.company_id;

  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id()
     AND private.is_my_report(NEW.employee_id) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'submitted' AND NEW.status IN ('approved','rejected')) THEN
      RAISE EXCEPTION 'A manager can only approve or reject a submitted claim';
    END IF;
    NEW.reimbursed_on := OLD.reimbursed_on;
    NEW.reimbursed_amount := OLD.reimbursed_amount;
    NEW.payment_reference := OLD.payment_reference;
    IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.finance_decided_at := OLD.finance_decided_at; END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status IN ('draft','rejected') AND NEW.status IN ('draft','submitted')) THEN
    RAISE EXCEPTION 'Only your manager or finance can decide an expense claim';
  END IF;
  NEW.finance_note := OLD.finance_note;
  NEW.finance_decided_at := OLD.finance_decided_at;
  NEW.reimbursed_on := OLD.reimbursed_on;
  NEW.reimbursed_amount := OLD.reimbursed_amount;
  NEW.payment_reference := OLD.payment_reference;

  IF OLD.status NOT IN ('draft','rejected') THEN
    NEW.title := OLD.title;
    NEW.purpose := OLD.purpose;
    NEW.destination := OLD.destination;
    NEW.trip_start := OLD.trip_start;
    NEW.trip_end := OLD.trip_end;
    NEW.currency := OLD.currency;
    NEW.total_amount := OLD.total_amount;
  END IF;
  RETURN NEW;
END; $$;

-- 3. Leave, timesheets and separations: manager path can never be the person themselves.
CREATE OR REPLACE FUNCTION private.guard_leave_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id()
     AND private.is_my_report(NEW.employee_id) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'pending' AND NEW.status IN ('approved','rejected')) THEN
      RAISE EXCEPTION 'A manager can only approve or reject a pending leave request';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.decided_at := now(); END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pending' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'Only your manager or HR can decide a leave request';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.decided_at := OLD.decided_at;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION private.guard_timesheet_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id()
     AND private.is_my_report(NEW.employee_id) THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'submitted' AND NEW.status IN ('approved','rejected')) THEN
      RAISE EXCEPTION 'A manager can only approve or send back a submitted timesheet';
    END IF;
    IF NEW.finance_status IS DISTINCT FROM OLD.finance_status THEN
      RAISE EXCEPTION 'Only finance can sign off a timesheet';
    END IF;
    NEW.finance_note := OLD.finance_note;
    NEW.finance_decided_at := OLD.finance_decided_at;
    IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.decided_at := now(); END IF;
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Only your manager or HR can approve a timesheet';
  END IF;
  IF NEW.finance_status <> 'pending' THEN
    RAISE EXCEPTION 'Only finance can sign off a timesheet';
  END IF;
  NEW.finance_note := '';
  NEW.finance_decided_at := NULL;
  IF NEW.status = 'submitted' AND OLD.status <> 'submitted' THEN
    NEW.decided_at := NULL;
  ELSE
    NEW.decided_at := CASE WHEN NEW.status = 'draft' THEN NULL ELSE OLD.decided_at END;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION private.guard_separation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id()
     AND private.has_finance_role('finance_payroll', private.employee_company(NEW.employee_id)) THEN
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

  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id()
     AND private.is_my_report(NEW.employee_id) THEN
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
END; $$;

-- 4. Stop broadcasting subsidiary access requests over realtime.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'subsidiary_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.subsidiary_requests';
  END IF;
END $$;
