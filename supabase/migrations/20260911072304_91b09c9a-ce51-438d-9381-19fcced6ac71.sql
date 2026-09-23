CREATE OR REPLACE FUNCTION private.has_finance_role(_role public.app_role, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = _role
      AND (company_id IS NULL OR company_id = _company_id)
  );
$$;
REVOKE ALL ON FUNCTION private.has_finance_role(public.app_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_finance_role(public.app_role, uuid) TO authenticated;

CREATE POLICY "Expense approvers manage claims in scope" ON public.expense_claims
  FOR ALL TO authenticated
  USING (private.has_finance_role('finance_expense', company_id))
  WITH CHECK (private.has_finance_role('finance_expense', company_id));

CREATE POLICY "Expense approvers read receipts in scope" ON public.expense_receipts
  FOR SELECT TO authenticated
  USING (private.has_finance_role('finance_expense', private.expense_claim_company(claim_id)));

CREATE POLICY "Payroll approvers manage payslips in scope" ON public.payslips
  FOR ALL TO authenticated
  USING (private.has_finance_role('finance_payroll', private.employee_company(employee_id)))
  WITH CHECK (private.has_finance_role('finance_payroll', private.employee_company(employee_id)));

CREATE POLICY "Expense approvers read receipt files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id::text = (storage.foldername(name))[1]
        AND private.has_finance_role('finance_expense', e.company_id)
    )
  );

CREATE OR REPLACE FUNCTION private.guard_expense_claim_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(NEW.company_id)
     OR private.has_finance_role('finance_expense', NEW.company_id) THEN RETURN NEW; END IF;

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
END;
$$;