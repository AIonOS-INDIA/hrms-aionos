CREATE OR REPLACE FUNCTION public.is_master_hr()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_hr'); $$;

CREATE OR REPLACE FUNCTION public.can_manage_company(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND (role = 'master_hr' OR (role = 'company_hr' AND company_id = _company_id))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_master_hr() FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_company(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_master_hr() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_company(uuid) TO authenticated;