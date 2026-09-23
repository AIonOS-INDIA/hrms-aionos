CREATE POLICY leave_manager_read ON public.leave_requests FOR SELECT TO authenticated USING (private.is_my_report(employee_id));
CREATE POLICY leave_manager_update ON public.leave_requests FOR UPDATE TO authenticated USING (private.is_my_report(employee_id)) WITH CHECK (private.is_my_report(employee_id));

CREATE POLICY ts_manager_read ON public.timesheets FOR SELECT TO authenticated USING (private.is_my_report(employee_id));
CREATE POLICY ts_manager_update ON public.timesheets FOR UPDATE TO authenticated USING (private.is_my_report(employee_id)) WITH CHECK (private.is_my_report(employee_id));

CREATE POLICY ts_entries_manager_read ON public.timesheet_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.timesheets t WHERE t.id = timesheet_entries.timesheet_id AND private.is_my_report(t.employee_id)));

CREATE POLICY expense_manager_read ON public.expense_claims FOR SELECT TO authenticated USING (private.is_my_report(employee_id));
CREATE POLICY expense_manager_update ON public.expense_claims FOR UPDATE TO authenticated USING (private.is_my_report(employee_id)) WITH CHECK (private.is_my_report(employee_id));

CREATE POLICY expense_receipts_manager_read ON public.expense_receipts FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.expense_claims c WHERE c.id = expense_receipts.claim_id AND private.is_my_report(c.employee_id)));

CREATE OR REPLACE FUNCTION private.guard_leave_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  IF private.is_my_report(NEW.employee_id) THEN
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;

  IF private.is_my_report(NEW.employee_id) THEN
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

CREATE OR REPLACE FUNCTION private.guard_expense_claim_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(NEW.company_id)
     OR private.has_finance_role('finance_expense', NEW.company_id) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;
  NEW.company_id := OLD.company_id;

  IF private.is_my_report(NEW.employee_id) THEN
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
  RETURN NEW;
END; $$;