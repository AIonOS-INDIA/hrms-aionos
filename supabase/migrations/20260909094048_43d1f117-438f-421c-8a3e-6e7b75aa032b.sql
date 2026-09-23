CREATE OR REPLACE FUNCTION public.my_reporting_chain()
RETURNS TABLE (id uuid, full_name text, job_title text, department text, email text, depth integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE me AS (
    SELECT e.id, e.manager_id FROM public.employees e WHERE e.id = public.my_employee_id()
  ),
  chain AS (
    SELECT m2.id, m2.manager_id, 1 AS depth
    FROM me JOIN public.employees m2 ON m2.id = me.manager_id
    UNION ALL
    SELECT nxt.id, nxt.manager_id, chain.depth + 1
    FROM chain JOIN public.employees nxt ON nxt.id = chain.manager_id
    WHERE chain.depth < 12
  )
  SELECT e.id, e.full_name, e.job_title, e.department, e.email, chain.depth
  FROM chain JOIN public.employees e ON e.id = chain.id
  ORDER BY chain.depth;
$$;

GRANT EXECUTE ON FUNCTION public.my_reporting_chain() TO authenticated;