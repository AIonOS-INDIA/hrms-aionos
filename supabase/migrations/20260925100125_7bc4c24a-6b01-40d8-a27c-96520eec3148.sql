ALTER TABLE public.separation_requests ADD COLUMN IF NOT EXISTS initiated_by uuid REFERENCES public.employees(id);

-- Is the separated employee allowed to see their own case yet?
CREATE OR REPLACE FUNCTION private.sep_subject_can_see(_sep_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.separation_requests s WHERE s.id = _sep_id AND (
    s.separation_kind = 'voluntary'
    OR EXISTS (SELECT 1 FROM public.separation_tasks t WHERE t.separation_id = s.id AND t.task_key = 'hr_head' AND t.status = 'done')));
$$;

CREATE OR REPLACE FUNCTION private.can_see_separation(_sep_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.separation_requests s JOIN public.employees e ON e.id = s.employee_id
    WHERE s.id = _sep_id AND (
      (e.id = private.my_employee_id() AND private.sep_subject_can_see(s.id))
      OR (e.id <> coalesce(private.my_employee_id(), '00000000-0000-0000-0000-000000000000'::uuid) AND (
        s.initiated_by = private.my_employee_id()
        OR private.can_manage_company(e.company_id)
        OR private.is_my_report(e.id)
        OR private.has_finance_role('finance_payroll', e.company_id)
        OR private.has_finance_role('finance_expense', e.company_id)
        OR private.has_finance_role('it_asset', e.company_id)
        OR private.has_finance_role('admin_facilities', e.company_id)
        OR private.has_finance_role('hr_head', e.company_id)
        OR private.has_finance_role('legal', e.company_id)
        OR private.dept_head_of(e.id) = private.my_employee_id()
        OR EXISTS (SELECT 1 FROM public.separation_tasks t WHERE t.separation_id = s.id AND t.assignee_id = private.my_employee_id())
      ))
    )
  );
$$;

DROP POLICY IF EXISTS "read own or managed separations" ON public.separation_requests;
CREATE POLICY "read own or managed separations" ON public.separation_requests FOR SELECT TO authenticated
  USING ((employee_id = private.my_employee_id() AND private.sep_subject_can_see(id))
    OR (employee_id <> private.my_employee_id() AND private.can_manage_company(private.employee_company(employee_id))));

-- Employees can only raise their own voluntary resignations directly
DROP POLICY IF EXISTS "employee raises own, hr raises for their company" ON public.separation_requests;
CREATE POLICY "employee raises own resignation" ON public.separation_requests FOR INSERT TO authenticated
  WITH CHECK (employee_id = private.my_employee_id() AND separation_kind = 'voluntary');

CREATE OR REPLACE FUNCTION private.sep_role_recipients(_sep_id uuid, _role text, _assignee uuid)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _emp public.employees; _app app_role;
BEGIN
  SELECT e.* INTO _emp FROM public.separation_requests s JOIN public.employees e ON e.id = s.employee_id WHERE s.id = _sep_id;
  IF _role = 'employee' THEN RETURN NEXT _emp.id; RETURN; END IF;
  IF _role IN ('manager','functional_head','initiator') THEN
    IF _assignee IS NOT NULL THEN RETURN NEXT _assignee; END IF; RETURN;
  END IF;
  IF _role = 'hrbp' THEN
    RETURN QUERY SELECT DISTINCT x.id FROM public.user_roles r JOIN public.employees x ON x.user_id = r.user_id
      WHERE r.role = 'company_hr' AND r.company_id = _emp.company_id AND x.id <> _emp.id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT DISTINCT x.id FROM public.user_roles r JOIN public.employees x ON x.user_id = r.user_id
        WHERE r.role = 'master_hr' AND x.id <> _emp.id;
    END IF;
    RETURN;
  END IF;
  _app := CASE _role WHEN 'payroll' THEN 'finance_payroll' WHEN 'finance' THEN 'finance_expense'
    WHEN 'it' THEN 'it_asset' WHEN 'admin' THEN 'admin_facilities' WHEN 'hr_head' THEN 'hr_head' WHEN 'legal' THEN 'legal' END::app_role;
  IF _app IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT DISTINCT x.id FROM public.user_roles r JOIN public.employees x ON x.user_id = r.user_id
    WHERE r.role = _app AND (r.company_id IS NULL OR r.company_id = _emp.company_id) AND x.id <> _emp.id;
END; $function$;

CREATE OR REPLACE FUNCTION private.can_act_sep_task(_task_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.separation_tasks; e public.employees; me uuid := private.my_employee_id();
BEGIN
  SELECT * INTO t FROM public.separation_tasks WHERE id = _task_id;
  IF NOT FOUND OR me IS NULL THEN RETURN false; END IF;
  SELECT emp.* INTO e FROM public.separation_requests s JOIN public.employees emp ON emp.id = s.employee_id WHERE s.id = t.separation_id;
  IF t.owner_role = 'employee' THEN RETURN e.id = me; END IF;
  IF e.id = me THEN RETURN false; END IF;
  IF private.is_master_hr() THEN RETURN true; END IF;
  IF t.escalation_level >= 1 AND private.dept_head_of(e.id) = me THEN RETURN true; END IF;
  IF t.escalation_level >= 2 AND private.has_finance_role('hr_head', e.company_id) THEN RETURN true; END IF;
  RETURN CASE t.owner_role
    WHEN 'manager' THEN t.assignee_id = me OR private.is_my_direct_report(e.id)
    WHEN 'functional_head' THEN t.assignee_id = me
    WHEN 'hrbp' THEN private.can_manage_company(e.company_id)
    WHEN 'hr_head' THEN private.has_finance_role('hr_head', e.company_id)
    WHEN 'legal' THEN private.has_finance_role('legal', e.company_id)
    WHEN 'payroll' THEN private.has_finance_role('finance_payroll', e.company_id)
    WHEN 'it' THEN private.has_finance_role('it_asset', e.company_id) OR private.can_manage_company(e.company_id)
    WHEN 'finance' THEN private.has_finance_role('finance_expense', e.company_id)
    WHEN 'admin' THEN private.has_finance_role('admin_facilities', e.company_id)
    ELSE false END;
END; $function$;

-- Start a termination (HRBP or someone in the reporting line)
CREATE OR REPLACE FUNCTION private.initiate_termination(_employee_id uuid, _form jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE me uuid := private.my_employee_id(); e public.employees; lwd date; new_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'No employee record linked to your account'; END IF;
  SELECT * INTO e FROM public.employees WHERE id = _employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF e.id = me THEN RAISE EXCEPTION 'Use the resignation form for your own exit'; END IF;
  IF NOT (private.can_manage_company(e.company_id) OR private.is_my_report(e.id)) THEN
    RAISE EXCEPTION 'Only the HRBP or the reporting manager can start a termination';
  END IF;
  IF coalesce(_form->>'reason','') NOT IN ('Performance','Misconduct','Redundancy','Policy Violation','Absconding') THEN
    RAISE EXCEPTION 'Pick a reason for termination';
  END IF;
  lwd := nullif(_form->>'effective_date','')::date;
  IF lwd IS NULL THEN RAISE EXCEPTION 'Termination effective date is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.separation_requests WHERE employee_id = e.id AND stage NOT IN ('completed','withdrawn','rejected')) THEN
    RAISE EXCEPTION 'This person already has a separation in progress';
  END IF;
  INSERT INTO public.separation_requests (employee_id, reason, resignation_type, separation_kind, resignation_form,
      notice_date, notice_days, requested_last_day, initiated_by)
    VALUES (e.id, _form->>'reason', 'termination', 'involuntary', _form, current_date, 0, lwd, me)
    RETURNING id INTO new_id;
  RETURN new_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.initiate_termination(_employee_id uuid, _form jsonb)
RETURNS uuid LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.initiate_termination(_employee_id, _form); $$;
REVOKE ALL ON FUNCTION public.initiate_termination(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.initiate_termination(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.initiate_termination(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION private.sep_subject_can_see(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.sep_create_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE e public.employees; fh uuid; lwd date := NEW.requested_last_day; ini public.employees;
  ini_is_hr boolean; skip_mgr boolean; reason text;
BEGIN
  SELECT * INTO e FROM public.employees WHERE id = NEW.employee_id;

  IF NEW.separation_kind = 'involuntary' THEN
    IF NEW.initiated_by IS NULL THEN RAISE EXCEPTION 'A termination must be started from the termination form'; END IF;
    SELECT * INTO ini FROM public.employees WHERE id = NEW.initiated_by;
    skip_mgr := e.manager_id IS NULL OR e.manager_id = ini.id;
    ini_is_hr := NOT skip_mgr AND EXISTS (
      SELECT 1 FROM public.user_roles r WHERE r.user_id = ini.user_id
        AND (r.role = 'master_hr' OR (r.role = 'company_hr' AND r.company_id = e.company_id)));
    reason := coalesce(NEW.resignation_form->>'reason', NEW.reason);
    INSERT INTO public.separation_tasks (separation_id, step_no, task_key, title, kind, owner_role, assignee_id, status, activated_at, completed_at, completed_by, form, due_date) VALUES
      (NEW.id, 1, 'initiation', 'Termination request', 'submission', 'initiator', ini.id, 'done', now(), now(), ini.id, NEW.resignation_form, NEW.notice_date),
      (NEW.id, 2, 'manager', 'Reporting manager approval', 'approval', 'manager', e.manager_id, CASE WHEN skip_mgr THEN 'skipped' ELSE 'waiting' END, NULL, NULL, NULL, '{}', NULL),
      (NEW.id, 3, 'hrbp', 'HRBP review', 'approval', 'hrbp', NULL, CASE WHEN ini_is_hr THEN 'skipped' ELSE 'waiting' END, NULL, NULL, NULL, '{}', NULL),
      (NEW.id, 4, 'hr_head', 'HR Head review', 'approval', 'hr_head', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL),
      (NEW.id, 5, 'legal', 'Legal review', 'approval', 'legal', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL),
      (NEW.id, 6, 'payroll', 'Payroll / Finance approval', 'approval', 'payroll', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL),
      (NEW.id, 7, 'it', 'IT clearance', 'clearance', 'it', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd - 1),
      (NEW.id, 8, 'admin', 'Admin clearance', 'clearance', 'admin', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd - 1),
      (NEW.id, 9, 'fnf', 'Payroll full & final settlement', 'closure', 'payroll', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd + 2),
      (NEW.id, 10, 'letters', 'Exit documentation', 'closure', 'hrbp', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL);
    -- CC on initiation: Legal team + HR Head (employee is not told yet)
    PERFORM private.sep_notify(NEW.id,
      ARRAY(SELECT private.sep_role_recipients(NEW.id, 'legal', NULL)) || ARRAY(SELECT private.sep_role_recipients(NEW.id, 'hr_head', NULL)),
      'Termination initiated · ' || e.full_name,
      coalesce(ini.full_name,'A manager') || ' has started a termination for ' || e.full_name || ', ' || coalesce(e.job_title,'') || ' - ' ||
      coalesce(e.department,'') || '. Reason: ' || coalesce(reason,'—') || '. Effective date: ' || to_char(lwd, 'DD Mon YYYY') || '.');
    PERFORM private.sep_advance(NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.separation_kind <> 'voluntary' THEN RETURN NEW; END IF;
  fh := private.dept_head_of(e.id);
  IF fh = e.id OR fh = e.manager_id THEN fh := NULL; END IF;
  INSERT INTO public.separation_tasks (separation_id, step_no, task_key, title, kind, owner_role, assignee_id, status, activated_at, completed_at, completed_by, form, due_date) VALUES
    (NEW.id, 1, 'resignation', 'Resignation submission', 'submission', 'employee', e.id, 'done', now(), now(), e.id, NEW.resignation_form, NEW.notice_date),
    (NEW.id, 2, 'manager', 'Manager review & approval', 'approval', 'manager', e.manager_id, CASE WHEN e.manager_id IS NULL THEN 'skipped' ELSE 'waiting' END, NULL, NULL, NULL, '{}', NULL),
    (NEW.id, 3, 'hrbp', 'HRBP review & validation', 'approval', 'hrbp', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL),
    (NEW.id, 4, 'functional_head', 'Functional head approval', 'approval', 'functional_head', fh, CASE WHEN fh IS NULL THEN 'skipped' ELSE 'waiting' END, NULL, NULL, NULL, '{}', NULL),
    (NEW.id, 5, 'payroll', 'Payroll approval', 'approval', 'payroll', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL),
    (NEW.id, 6, 'it', 'IT clearance', 'clearance', 'it', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd - 2),
    (NEW.id, 7, 'finance', 'Finance clearance', 'clearance', 'finance', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd - 2),
    (NEW.id, 8, 'admin', 'Admin clearance', 'clearance', 'admin', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd - 2),
    (NEW.id, 9, 'exit_interview', 'Exit interview', 'clearance', 'hrbp', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd - 1),
    (NEW.id, 10, 'fnf', 'Payroll full & final settlement', 'closure', 'payroll', NULL, 'waiting', NULL, NULL, NULL, '{}', lwd),
    (NEW.id, 11, 'letters', 'Letter generation & closure', 'closure', 'hrbp', NULL, 'waiting', NULL, NULL, NULL, '{}', NULL);
  PERFORM private.sep_notify(NEW.id,
    array_append(ARRAY(SELECT private.sep_role_recipients(NEW.id, 'hrbp', NULL)), e.manager_id),
    'Resignation received · ' || e.full_name,
    'Your reportee / colleague ' || e.full_name || ', ' || coalesce(e.job_title,'') || ' - ' || coalesce(e.department,'') ||
    ' has resigned. Proposed last day: ' || to_char(lwd, 'DD Mon YYYY') || '.');
  PERFORM private.sep_advance(NEW.id);
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION private.sep_advance(_sep_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s public.separation_requests; t public.separation_tasks; e public.employees; lwd date; invol boolean; what text;
BEGIN
  PERFORM set_config('app.sep_engine', 'on', true);
  SELECT * INTO s FROM public.separation_requests WHERE id = _sep_id;
  SELECT * INTO e FROM public.employees WHERE id = s.employee_id;
  IF s.stage IN ('rejected','withdrawn','completed') THEN RETURN; END IF;
  lwd := coalesce(s.approved_last_day, s.requested_last_day);
  invol := s.separation_kind = 'involuntary';
  what := CASE WHEN invol THEN ' is being separated by the company (' || coalesce(s.reason,'termination') || '). '
    ELSE ' has resigned. ' END;

  SELECT * INTO t FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'approval'
    AND status NOT IN ('done','skipped') ORDER BY step_no LIMIT 1;
  IF FOUND THEN
    IF t.status = 'waiting' THEN
      UPDATE public.separation_tasks SET status = 'pending', activated_at = now(),
        due_date = current_date + CASE WHEN t.owner_role = 'manager' THEN 2 WHEN invol OR t.owner_role = 'hrbp' THEN 1 ELSE 2 END
        WHERE id = t.id RETURNING * INTO t;
      PERFORM private.sep_notify(_sep_id, private.sep_task_holders(t), t.title || ' · ' || e.full_name,
        e.full_name || ' (' || coalesce(e.job_title,'') || ' - ' || coalesce(e.department,'') || ')' || what ||
        t.title || ' is pending with you. ' || CASE WHEN invol THEN 'Effective date: ' ELSE 'Proposed last day: ' END || to_char(lwd, 'DD Mon YYYY') || '.');
    END IF;
    UPDATE public.separation_requests SET stage = CASE WHEN t.owner_role = 'manager' THEN 'manager_review' ELSE 'hr_review' END::separation_stage
      WHERE id = _sep_id;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'clearance' AND status = 'waiting') THEN
    FOR t IN UPDATE public.separation_tasks SET status = 'pending', activated_at = now(),
        due_date = lwd - CASE WHEN invol OR task_key = 'exit_interview' THEN 1 ELSE 2 END
        WHERE separation_id = _sep_id AND kind = 'clearance' AND status = 'waiting' RETURNING * LOOP
      PERFORM private.sep_notify(_sep_id, private.sep_task_holders(t), t.title || ' · ' || e.full_name,
        t.title || ' is pending with you to complete separation formalities for ' || e.full_name ||
        ' whose last working day is ' || to_char(lwd, 'DD Mon YYYY') || '.');
    END LOOP;
    UPDATE public.separation_requests SET stage = 'it_clearance' WHERE id = _sep_id;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'clearance' AND status = 'pending') THEN
    RETURN;
  END IF;

  SELECT * INTO t FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'closure'
    AND status NOT IN ('done','skipped') ORDER BY step_no LIMIT 1;
  IF FOUND THEN
    IF t.status = 'waiting' THEN
      UPDATE public.separation_tasks SET status = 'pending', activated_at = now(),
        due_date = CASE WHEN t.task_key = 'fnf' THEN greatest(lwd + CASE WHEN invol THEN 2 ELSE 0 END, current_date)
          WHEN invol THEN current_date + 1 ELSE current_date END
        WHERE id = t.id RETURNING * INTO t;
      PERFORM private.sep_notify(_sep_id, private.sep_task_holders(t), t.title || ' · ' || e.full_name,
        t.title || ' is pending with you for ' || e.full_name || ' (last working day ' || to_char(lwd, 'DD Mon YYYY') || ').');
    END IF;
    IF t.task_key = 'fnf' THEN
      UPDATE public.separation_requests SET stage = 'finance_settlement', finance_routed_at = coalesce(finance_routed_at, now()) WHERE id = _sep_id;
    END IF;
    RETURN;
  END IF;

  UPDATE public.separation_requests SET stage = 'completed', letters_issued_at = coalesce(letters_issued_at, now()) WHERE id = _sep_id;
  UPDATE public.employees SET status = 'offboarded', exit_on = lwd WHERE id = s.employee_id;
  PERFORM private.sep_notify(_sep_id, ARRAY[e.id], 'Your exit is complete',
    CASE WHEN invol THEN 'Your full & final settlement is done and your relieving letter is ready on the Separation page.'
      ELSE 'Your full & final settlement is done and your relieving and experience letters are ready on the Separation page.' END);
END; $function$;

CREATE OR REPLACE FUNCTION private.complete_separation_task(_task_id uuid, _decision text, _form jsonb, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.separation_tasks; s public.separation_requests; e public.employees; me uuid := private.my_employee_id();
  me_name text; lwd date; invol boolean; told boolean;
BEGIN
  IF NOT private.can_act_sep_task(_task_id) THEN RAISE EXCEPTION 'You cannot act on this step'; END IF;
  SELECT * INTO t FROM public.separation_tasks WHERE id = _task_id FOR UPDATE;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'This step is not open'; END IF;
  IF _decision NOT IN ('done','rejected') THEN RAISE EXCEPTION 'Unknown decision'; END IF;
  IF _decision = 'rejected' AND t.kind <> 'approval' THEN RAISE EXCEPTION 'Only approval steps can be rejected'; END IF;
  SELECT * INTO s FROM public.separation_requests WHERE id = t.separation_id;
  SELECT * INTO e FROM public.employees WHERE id = s.employee_id;
  SELECT full_name INTO me_name FROM public.employees WHERE id = me;
  invol := s.separation_kind = 'involuntary';
  told := private.sep_subject_can_see(s.id);
  PERFORM set_config('app.sep_engine', 'on', true);
  _form := coalesce(_form, '{}'::jsonb);

  IF t.task_key = 'it' AND EXISTS (SELECT 1 FROM public.employee_assets WHERE employee_id = e.id AND status = 'assigned') THEN
    RAISE EXCEPTION 'Mark every assigned asset as returned before closing IT clearance';
  END IF;

  UPDATE public.separation_tasks SET status = _decision, form = _form, note = coalesce(_note,''),
    completed_by = me, completed_at = now() WHERE id = _task_id;

  IF _decision = 'rejected' THEN
    UPDATE public.separation_requests SET stage = 'rejected',
      manager_status = CASE WHEN t.owner_role = 'manager' THEN 'rejected' ELSE manager_status END,
      hr_status = CASE WHEN t.owner_role IN ('hrbp','hr_head') THEN 'rejected' ELSE hr_status END,
      manager_note = CASE WHEN t.owner_role = 'manager' THEN coalesce(_note,'') ELSE manager_note END,
      hr_note = CASE WHEN t.owner_role IN ('hrbp','hr_head') THEN coalesce(_note,'') ELSE hr_note END
      WHERE id = s.id;
    UPDATE public.separation_tasks SET status = 'skipped' WHERE separation_id = s.id AND status IN ('waiting','pending');
    IF invol THEN
      PERFORM private.sep_notify(s.id,
        ARRAY[s.initiated_by, e.manager_id] || ARRAY(SELECT private.sep_role_recipients(s.id, 'hrbp', NULL))
          || CASE WHEN told THEN ARRAY[e.id] ELSE '{}'::uuid[] END,
        'Termination not approved · ' || e.full_name,
        coalesce(me_name,'The reviewer') || ' (' || t.title || ') has rejected the termination of ' || e.full_name || '.' ||
        CASE WHEN coalesce(_note,'') <> '' THEN ' Note: ' || _note ELSE '' END);
    ELSE
      PERFORM private.sep_notify(s.id, ARRAY[e.id, e.manager_id], 'Resignation not accepted · ' || e.full_name,
        coalesce(me_name,'The reviewer') || ' has rejected ' || e.full_name || '''s resignation.' ||
        CASE WHEN coalesce(_note,'') <> '' THEN ' Note: ' || _note ELSE '' END);
    END IF;
    RETURN;
  END IF;

  IF t.task_key = 'manager' THEN
    UPDATE public.separation_requests SET manager_status = 'approved', manager_note = coalesce(_form->>'feedback', _note, ''), manager_decided_at = now() WHERE id = s.id;
    IF NOT invol THEN
      PERFORM private.sep_notify(s.id, ARRAY[e.id], 'Your manager accepted your resignation',
        'Your resignation has been accepted by your manager and is awaiting confirmation from HR.');
    END IF;
  ELSIF t.task_key = 'hrbp' THEN
    lwd := coalesce(nullif(_form->>'last_day','')::date, s.requested_last_day);
    UPDATE public.separation_requests SET hr_status = 'approved', hr_note = coalesce(_form->>'comments', _note, ''), hr_decided_at = now(),
      approved_last_day = lwd, notice_days = coalesce(nullif(_form->>'notice_days','')::int, notice_days) WHERE id = s.id;
    UPDATE public.separation_tasks SET due_date = lwd - CASE WHEN invol OR task_key = 'exit_interview' THEN 1 ELSE 2 END
      WHERE separation_id = s.id AND kind = 'clearance';
    UPDATE public.separation_tasks SET due_date = lwd + CASE WHEN invol THEN 2 ELSE 0 END WHERE separation_id = s.id AND task_key = 'fnf';
    IF NOT invol THEN
      PERFORM private.sep_notify(s.id, ARRAY[e.id, e.manager_id], 'Resignation confirmed by HR · ' || e.full_name,
        e.full_name || '''s resignation has been confirmed by ' || coalesce(me_name,'HR') || '. Last working day: ' || to_char(lwd, 'DD Mon YYYY') || '.');
    END IF;
  ELSIF t.task_key = 'hr_head' THEN
    lwd := coalesce(nullif(_form->>'last_day','')::date, s.approved_last_day, s.requested_last_day);
    UPDATE public.separation_requests SET approved_last_day = lwd,
      hr_status = 'approved', hr_decided_at = coalesce(hr_decided_at, now()) WHERE id = s.id;
    UPDATE public.separation_tasks SET due_date = lwd - 1 WHERE separation_id = s.id AND kind = 'clearance';
    UPDATE public.separation_tasks SET due_date = lwd + 2 WHERE separation_id = s.id AND task_key = 'fnf';
    -- The employee is told now
    PERFORM private.sep_notify(s.id, ARRAY[e.id], 'Your separation has been confirmed',
      'Hi ' || e.full_name || ', your separation from the company has been confirmed by HR. Your last working day is ' ||
      to_char(lwd, 'DD Mon YYYY') || '. Open the Separation page to see the next steps.');
    PERFORM private.sep_notify(s.id, ARRAY[e.manager_id, s.initiated_by], 'Termination confirmed by HR Head · ' || e.full_name,
      e.full_name || '''s termination has been confirmed by ' || coalesce(me_name,'the HR Head') || '. Last working day: ' || to_char(lwd, 'DD Mon YYYY') || '.');
  ELSIF t.task_key = 'it' THEN
    UPDATE public.separation_requests SET it_status = 'approved', it_note = coalesce(_note,''), it_decided_at = now() WHERE id = s.id;
  ELSIF t.task_key = 'exit_interview' THEN
    UPDATE public.separation_requests SET exit_interview_done = true WHERE id = s.id;
  ELSIF t.task_key = 'fnf' THEN
    UPDATE public.separation_requests SET finance_status = 'approved', finance_decided_at = now(), finance_note = coalesce(_note,''),
      settlement_amount = coalesce(nullif(_form->>'net_payable','')::numeric, settlement_amount),
      settlement_paid_on = coalesce(nullif(_form->>'paid_on','')::date, current_date),
      final_salary_amount = coalesce(nullif(_form->>'final_salary','')::numeric, final_salary_amount),
      leave_encashment_days = coalesce(nullif(_form->>'encash_days','')::numeric, leave_encashment_days),
      leave_encashment_amount = coalesce(nullif(_form->>'encash_amount','')::numeric, leave_encashment_amount),
      unpaid_leave_days = coalesce(nullif(_form->>'unpaid_days','')::numeric, unpaid_leave_days),
      unpaid_leave_amount = coalesce(nullif(_form->>'unpaid_amount','')::numeric, unpaid_leave_amount),
      expense_reimbursement_amount = coalesce(nullif(_form->>'expenses','')::numeric, expense_reimbursement_amount)
      WHERE id = s.id;
  END IF;

  IF t.kind = 'approval' AND NOT invol THEN
    PERFORM private.sep_notify(s.id,
      ARRAY(SELECT private.sep_role_recipients(s.id, 'hr_head', NULL)) || ARRAY(SELECT private.sep_role_recipients(s.id, 'payroll', NULL)),
      t.title || ' done · ' || e.full_name, coalesce(me_name,'An approver') || ' approved ' || e.full_name || '''s resignation (' || t.title || ').');
  ELSIF t.kind = 'approval' AND invol AND NOT EXISTS (
      SELECT 1 FROM public.separation_tasks WHERE separation_id = s.id AND kind = 'approval' AND status IN ('waiting','pending')) THEN
    -- CC when fully approved: Payroll team + Admin
    PERFORM private.sep_notify(s.id,
      ARRAY(SELECT private.sep_role_recipients(s.id, 'payroll', NULL)) || ARRAY(SELECT private.sep_role_recipients(s.id, 'admin', NULL)),
      'Termination approved · ' || e.full_name,
      e.full_name || ', ' || coalesce(e.job_title,'') || ' - ' || coalesce(e.department,'') ||
      ' has been approved for separation. Last working day: ' || to_char(coalesce(s.approved_last_day, s.requested_last_day), 'DD Mon YYYY') ||
      '. Clearance and full & final will follow.');
  END IF;

  PERFORM private.sep_advance(s.id);
END; $function$;

CREATE OR REPLACE FUNCTION private.escalate_separation_tasks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.separation_tasks; e public.employees; n int := 0; fh uuid; lim int;
BEGIN
  FOR t IN SELECT * FROM public.separation_tasks WHERE status = 'pending' AND activated_at IS NOT NULL
    AND owner_role <> 'employee' AND escalation_level < 2 LOOP
    SELECT emp.* INTO e FROM public.separation_requests s JOIN public.employees emp ON emp.id = s.employee_id WHERE s.id = t.separation_id;
    SELECT CASE WHEN s.separation_kind = 'involuntary' THEN 2 ELSE 3 END INTO lim FROM public.separation_requests s WHERE s.id = t.separation_id;
    fh := private.dept_head_of(e.id);
    IF t.escalation_level = 0 AND private.business_days_between(t.activated_at, now()) >= lim THEN
      IF fh IS NOT NULL AND fh <> e.id AND t.owner_role NOT IN ('functional_head','hr_head') THEN
        UPDATE public.separation_tasks SET escalation_level = 1, escalated_at = now() WHERE id = t.id;
        PERFORM private.sep_notify(t.separation_id, ARRAY[fh], 'Escalated: ' || t.title || ' · ' || e.full_name,
          t.title || ' for ' || e.full_name || ' has had no action for ' || lim || ' business days and is now escalated to you.');
      ELSE
        UPDATE public.separation_tasks SET escalation_level = 2, escalated_at = now() WHERE id = t.id;
        PERFORM private.sep_notify(t.separation_id, ARRAY(SELECT private.sep_role_recipients(t.separation_id, 'hr_head', NULL)),
          'Escalated: ' || t.title || ' · ' || e.full_name,
          t.title || ' for ' || e.full_name || ' has had no action for ' || lim || ' business days and is now escalated to HR Head.');
      END IF;
      n := n + 1;
    ELSIF t.escalation_level = 1 AND private.business_days_between(t.escalated_at, now()) >= lim THEN
      UPDATE public.separation_tasks SET escalation_level = 2, escalated_at = now() WHERE id = t.id;
      PERFORM private.sep_notify(t.separation_id, ARRAY(SELECT private.sep_role_recipients(t.separation_id, 'hr_head', NULL)),
        'Escalated: ' || t.title || ' · ' || e.full_name,
        t.title || ' for ' || e.full_name || ' is still pending after escalation and now needs HR Head.');
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION private.revoke_my_resignation(_sep_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s public.separation_requests; e public.employees;
BEGIN
  SELECT * INTO s FROM public.separation_requests WHERE id = _sep_id;
  IF NOT FOUND OR s.employee_id <> private.my_employee_id() THEN RAISE EXCEPTION 'Not your resignation'; END IF;
  IF s.separation_kind <> 'voluntary' THEN RAISE EXCEPTION 'Only a resignation you raised can be revoked'; END IF;
  IF s.stage IN ('finance_settlement','completed','rejected','withdrawn') THEN RAISE EXCEPTION 'This resignation can no longer be revoked'; END IF;
  SELECT * INTO e FROM public.employees WHERE id = s.employee_id;
  PERFORM set_config('app.sep_engine', 'on', true);
  UPDATE public.separation_requests SET stage = 'withdrawn', revoked_at = now() WHERE id = _sep_id;
  UPDATE public.separation_tasks SET status = 'skipped' WHERE separation_id = _sep_id AND status IN ('waiting','pending');
  PERFORM private.sep_notify(_sep_id,
    array_append(ARRAY(SELECT private.sep_role_recipients(_sep_id, 'hrbp', NULL)), e.manager_id),
    'Resignation revoked · ' || e.full_name,
    e.full_name || ', ' || coalesce(e.job_title,'') || ' - ' || coalesce(e.department,'') ||
    ' has revoked their resignation. No further separation steps are needed.');
END; $function$;