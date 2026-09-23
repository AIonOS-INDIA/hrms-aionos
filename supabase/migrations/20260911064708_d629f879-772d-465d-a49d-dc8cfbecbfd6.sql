CREATE POLICY employees_manager_read ON public.employees
  FOR SELECT TO authenticated
  USING (manager_id = private.my_employee_id());