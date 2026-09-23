REVOKE EXECUTE ON FUNCTION public.template_company(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.checklist_employee(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.job_company(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.candidate_company(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.template_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.checklist_employee(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.job_company(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.candidate_company(uuid) TO authenticated, service_role;