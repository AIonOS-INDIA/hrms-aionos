
ALTER FUNCTION public.is_master_hr() SECURITY INVOKER;
ALTER FUNCTION public.can_manage_company(uuid) SECURITY INVOKER;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_master_hr() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_employee_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.employee_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.timesheet_employee(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_my_employee_record() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_master_hr() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.timesheet_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_employee_record() TO authenticated;
