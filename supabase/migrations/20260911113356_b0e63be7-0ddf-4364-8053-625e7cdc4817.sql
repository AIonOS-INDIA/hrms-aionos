DROP POLICY IF EXISTS ss_write ON public.salary_structures;

CREATE POLICY ss_write ON public.salary_structures
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_hr')
    OR private.has_finance_role('finance_payroll'::app_role, private.employee_company(employee_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_hr')
    OR private.has_finance_role('finance_payroll'::app_role, private.employee_company(employee_id))
  );

CREATE POLICY ss_read_payroll ON public.salary_structures
  FOR SELECT TO authenticated
  USING (private.has_finance_role('finance_payroll'::app_role, private.employee_company(employee_id)));

CREATE POLICY pr_payroll_role ON public.payroll_runs
  FOR ALL TO authenticated
  USING (private.has_finance_role('finance_payroll'::app_role, company_id))
  WITH CHECK (private.has_finance_role('finance_payroll'::app_role, company_id));