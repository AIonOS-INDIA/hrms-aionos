CREATE OR REPLACE FUNCTION private.can_see_company(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
  WITH RECURSIVE me AS (SELECT private.my_employee_id() AS id),
  sub AS (
    SELECT e.id, e.company_id
      FROM public.employees e, me
     WHERE me.id IS NOT NULL AND e.manager_id = me.id
    UNION
    SELECT c.id, c.company_id
      FROM public.employees c
      JOIN sub s ON c.manager_id = s.id
  )
  SELECT
    _company_id IS NOT NULL
    AND (
      private.can_manage_company(_company_id)
      OR EXISTS (
        SELECT 1 FROM public.user_roles r
         WHERE r.user_id = auth.uid()
           AND (r.company_id = _company_id OR r.company_id IS NULL)
           AND r.role IN ('finance_expense', 'finance_payroll', 'it_asset')
      )
      OR EXISTS (
        SELECT 1 FROM public.employees e, me
         WHERE e.id = me.id AND e.company_id = _company_id
      )
      OR EXISTS (SELECT 1 FROM sub WHERE sub.company_id = _company_id)
    );
$function$;

GRANT EXECUTE ON FUNCTION private.can_see_company(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS companies_read ON public.companies;
CREATE POLICY companies_read ON public.companies
  FOR SELECT TO authenticated
  USING (private.can_see_company(id));

DROP POLICY IF EXISTS entity_pay_settings_select ON public.entity_pay_settings;
CREATE POLICY entity_pay_settings_select ON public.entity_pay_settings
  FOR SELECT TO authenticated
  USING (private.can_see_company(company_id));