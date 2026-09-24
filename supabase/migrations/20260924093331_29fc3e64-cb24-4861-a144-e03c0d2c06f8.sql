ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS policies_read ON public.policies;
DROP POLICY IF EXISTS policies_write ON public.policies;
CREATE POLICY policies_read ON public.policies FOR SELECT TO authenticated
  USING ((company_id IS NULL AND private.my_employee_id() IS NOT NULL) OR private.is_master_hr() OR (company_id IS NOT NULL AND private.can_see_company(company_id)));
CREATE POLICY policies_write ON public.policies FOR ALL TO authenticated
  USING (CASE WHEN company_id IS NULL THEN private.is_master_hr() ELSE private.can_manage_company(company_id) END)
  WITH CHECK (CASE WHEN company_id IS NULL THEN private.is_master_hr() ELSE private.can_manage_company(company_id) END);

DROP POLICY IF EXISTS holidays_read ON public.holidays;
DROP POLICY IF EXISTS holidays_write ON public.holidays;
CREATE POLICY holidays_read ON public.holidays FOR SELECT TO authenticated
  USING ((company_id IS NULL AND private.my_employee_id() IS NOT NULL) OR private.is_master_hr() OR (company_id IS NOT NULL AND private.can_see_company(company_id)));
CREATE POLICY holidays_write ON public.holidays FOR ALL TO authenticated
  USING (CASE WHEN company_id IS NULL THEN private.is_master_hr() ELSE private.can_manage_company(company_id) END)
  WITH CHECK (CASE WHEN company_id IS NULL THEN private.is_master_hr() ELSE private.can_manage_company(company_id) END);