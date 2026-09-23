CREATE OR REPLACE FUNCTION private.is_my_report(_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
      AND c.manager_id = me.id
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_my_direct_report(_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = _employee_id
      AND e.manager_id = private.my_employee_id()
  );
$function$;

REVOKE EXECUTE ON FUNCTION private.is_my_direct_report(uuid) FROM anon;

DROP POLICY IF EXISTS employees_manager_read ON public.employees;
CREATE POLICY employees_manager_read ON public.employees
  FOR SELECT TO authenticated
  USING (private.is_my_report(id));