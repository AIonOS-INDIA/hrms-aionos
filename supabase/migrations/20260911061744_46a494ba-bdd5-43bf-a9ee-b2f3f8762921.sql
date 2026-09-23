-- 1. Private schema for internal helpers (not exposed to the API)
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION private.is_master_hr()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master_hr');
$$;

CREATE OR REPLACE FUNCTION private.can_manage_company(_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND (role = 'master_hr' OR (role = 'company_hr' AND company_id = _company_id))
  );
$$;

CREATE OR REPLACE FUNCTION private.my_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.employee_company(_employee_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.employees WHERE id = _employee_id;
$$;

CREATE OR REPLACE FUNCTION private.job_company(_job_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.job_openings WHERE id = _job_id;
$$;

CREATE OR REPLACE FUNCTION private.candidate_company(_candidate_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.job_company(job_opening_id) FROM public.candidates WHERE id = _candidate_id;
$$;

CREATE OR REPLACE FUNCTION private.checklist_employee(_checklist_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT employee_id FROM public.employee_checklists WHERE id = _checklist_id;
$$;

CREATE OR REPLACE FUNCTION private.template_company(_template_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.checklist_templates WHERE id = _template_id;
$$;

CREATE OR REPLACE FUNCTION private.timesheet_employee(_timesheet_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT employee_id FROM public.timesheets WHERE id = _timesheet_id;
$$;

CREATE OR REPLACE FUNCTION private.my_reporting_chain()
RETURNS TABLE(id uuid, full_name text, job_title text, department text, email text, depth integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE me AS (
    SELECT e.id, e.manager_id FROM public.employees e WHERE e.id = private.my_employee_id()
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

CREATE OR REPLACE FUNCTION private.claim_my_employee_record()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_emp public.employees%ROWTYPE;
  v_hr_companies uuid[];
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE user_id = v_uid;
  IF NOT FOUND THEN
    UPDATE public.employees SET user_id = v_uid
    WHERE lower(email) = v_email AND user_id IS NULL
    RETURNING * INTO v_emp;
  END IF;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  SELECT array_agg(company_id) INTO v_hr_companies
  FROM public.user_roles
  WHERE user_id = v_uid AND role = 'company_hr' AND company_id IS NOT NULL;

  DELETE FROM public.user_roles WHERE user_id = v_uid;

  IF v_emp.access_level = 'master_hr' THEN
    INSERT INTO public.user_roles (user_id, role, company_id) VALUES (v_uid, 'master_hr', NULL);
  ELSIF v_emp.access_level = 'company_hr' THEN
    IF v_hr_companies IS NULL OR array_length(v_hr_companies, 1) IS NULL THEN
      v_hr_companies := ARRAY[v_emp.company_id];
    END IF;
    INSERT INTO public.user_roles (user_id, role, company_id)
    SELECT v_uid, 'company_hr', c FROM unnest(v_hr_companies) AS c
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role, company_id) VALUES (v_uid, 'employee', v_emp.company_id)
  ON CONFLICT DO NOTHING;

  RETURN v_emp.id;
END; $$;

CREATE OR REPLACE FUNCTION private.update_my_contact(_phone text, _home_address text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.employees
     SET phone = coalesce(_phone, ''),
         home_address = coalesce(_home_address, ''),
         updated_at = now()
   WHERE user_id = auth.uid()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- 2. Point every existing policy at the private helpers
DO $do$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_sql text;
  v_pattern text := '\m(can_manage_company|employee_company|job_company|candidate_company|checklist_employee|template_company|timesheet_employee|my_employee_id|is_master_hr|has_role)\(';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_pattern
  LOOP
    v_qual := regexp_replace(r.qual, v_pattern, 'private.\1(', 'g');
    v_check := regexp_replace(r.with_check, v_pattern, 'private.\1(', 'g');

    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    v_sql := format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
      r.policyname, r.schemaname, r.tablename,
      CASE WHEN r.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      r.cmd,
      array_to_string(r.roles, ', ')
    );
    IF v_qual IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_qual); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;
    EXECUTE v_sql;
  END LOOP;
END
$do$;

-- 3. Replace the public helpers: internal ones go away, the three the app calls
--    stay as thin SECURITY INVOKER wrappers.
DROP FUNCTION IF EXISTS public.can_manage_company(uuid);
DROP FUNCTION IF EXISTS public.employee_company(uuid);
DROP FUNCTION IF EXISTS public.job_company(uuid);
DROP FUNCTION IF EXISTS public.candidate_company(uuid);
DROP FUNCTION IF EXISTS public.checklist_employee(uuid);
DROP FUNCTION IF EXISTS public.template_company(uuid);
DROP FUNCTION IF EXISTS public.timesheet_employee(uuid);
DROP FUNCTION IF EXISTS public.my_employee_id();
DROP FUNCTION IF EXISTS public.is_master_hr();
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);
DROP FUNCTION IF EXISTS public.my_reporting_chain();
DROP FUNCTION IF EXISTS public.claim_my_employee_record();
DROP FUNCTION IF EXISTS public.update_my_contact(text, text);

CREATE OR REPLACE FUNCTION public.claim_my_employee_record()
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.claim_my_employee_record();
$$;

CREATE OR REPLACE FUNCTION public.my_reporting_chain()
RETURNS TABLE(id uuid, full_name text, job_title text, department text, email text, depth integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT * FROM private.my_reporting_chain();
$$;

CREATE OR REPLACE FUNCTION public.update_my_contact(_phone text, _home_address text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.update_my_contact(_phone, _home_address);
$$;

REVOKE ALL ON FUNCTION public.claim_my_employee_record() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_reporting_chain() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_contact(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_employee_record() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_reporting_chain() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_contact(text, text) TO authenticated, service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

-- 4. Column-level guards: employees cannot approve their own records
CREATE OR REPLACE FUNCTION private.guard_leave_request_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pending' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'Only HR can decide a leave request';
  END IF;
  NEW.decision_note := OLD.decision_note;
  NEW.decided_at := OLD.decided_at;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_leave_request_update ON public.leave_requests;
CREATE TRIGGER guard_leave_request_update
BEFORE UPDATE ON public.leave_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_leave_request_update();

CREATE OR REPLACE FUNCTION private.guard_timesheet_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;
  IF NEW.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'Only HR can approve or reject a timesheet';
  END IF;
  IF NEW.finance_status <> 'pending' THEN
    RAISE EXCEPTION 'Only finance can sign off a timesheet';
  END IF;
  NEW.finance_note := '';
  NEW.finance_decided_at := NULL;
  IF NEW.status = 'submitted' AND OLD.status <> 'submitted' THEN
    NEW.decided_at := NULL;
  ELSE
    NEW.decided_at := CASE WHEN NEW.status = 'draft' THEN NULL ELSE OLD.decided_at END;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_timesheet_update ON public.timesheets;
CREATE TRIGGER guard_timesheet_update
BEFORE UPDATE ON public.timesheets
FOR EACH ROW EXECUTE FUNCTION private.guard_timesheet_update();

CREATE OR REPLACE FUNCTION private.guard_separation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;

  NEW.employee_id := OLD.employee_id;
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage <> 'withdrawn' THEN
    RAISE EXCEPTION 'Only HR can move a separation forward';
  END IF;

  NEW.approved_last_day := OLD.approved_last_day;
  NEW.handover_to := OLD.handover_to;
  NEW.exit_interview_done := OLD.exit_interview_done;
  NEW.hr_status := OLD.hr_status;
  NEW.hr_note := OLD.hr_note;
  NEW.hr_decided_at := OLD.hr_decided_at;
  NEW.it_status := OLD.it_status;
  NEW.it_note := OLD.it_note;
  NEW.it_assets := OLD.it_assets;
  NEW.it_decided_at := OLD.it_decided_at;
  NEW.finance_status := OLD.finance_status;
  NEW.finance_note := OLD.finance_note;
  NEW.finance_decided_at := OLD.finance_decided_at;
  NEW.settlement_amount := OLD.settlement_amount;
  NEW.settlement_paid_on := OLD.settlement_paid_on;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS guard_separation_update ON public.separation_requests;
CREATE TRIGGER guard_separation_update
BEFORE UPDATE ON public.separation_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_separation_update();