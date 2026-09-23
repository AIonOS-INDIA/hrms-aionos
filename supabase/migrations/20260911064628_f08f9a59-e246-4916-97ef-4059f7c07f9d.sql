CREATE OR REPLACE FUNCTION private.is_my_report(_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = _employee_id
      AND e.manager_id = private.my_employee_id()
  );
$$;

REVOKE ALL ON FUNCTION private.is_my_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_my_report(uuid) TO authenticated, service_role;

CREATE POLICY goals_manager_read ON public.employee_goals
  FOR SELECT TO authenticated
  USING (private.is_my_report(employee_id));

CREATE POLICY goals_manager_write ON public.employee_goals
  FOR ALL TO authenticated
  USING (private.is_my_report(employee_id))
  WITH CHECK (private.is_my_report(employee_id));

CREATE POLICY reviews_manager_read ON public.performance_reviews
  FOR SELECT TO authenticated
  USING (private.is_my_report(employee_id));

CREATE POLICY reviews_manager_write ON public.performance_reviews
  FOR ALL TO authenticated
  USING (private.is_my_report(employee_id) AND status = 'draft'::review_status)
  WITH CHECK (private.is_my_report(employee_id) AND status = 'draft'::review_status);