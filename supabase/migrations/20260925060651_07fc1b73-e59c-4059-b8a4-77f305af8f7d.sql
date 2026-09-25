
-- ===== Columns on separation requests =====
ALTER TABLE public.separation_requests
  ADD COLUMN IF NOT EXISTS separation_kind text NOT NULL DEFAULT 'voluntary',
  ADD COLUMN IF NOT EXISTS resignation_form jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS letters_issued_at timestamptz;

-- ===== Department heads (Functional Head) =====
CREATE TABLE public.department_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  department text NOT NULL,
  head_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, department)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_heads TO authenticated;
GRANT ALL ON public.department_heads TO service_role;
ALTER TABLE public.department_heads ENABLE ROW LEVEL SECURITY;
CREATE POLICY dh_read ON public.department_heads FOR SELECT TO authenticated USING (private.can_see_company(company_id));
CREATE POLICY dh_insert ON public.department_heads FOR INSERT TO authenticated WITH CHECK (private.can_manage_company(company_id));
CREATE POLICY dh_update ON public.department_heads FOR UPDATE TO authenticated USING (private.can_manage_company(company_id)) WITH CHECK (private.can_manage_company(company_id));
CREATE POLICY dh_delete ON public.department_heads FOR DELETE TO authenticated USING (private.can_manage_company(company_id));
CREATE TRIGGER department_heads_updated_at BEFORE UPDATE ON public.department_heads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== Workflow tasks =====
CREATE TABLE public.separation_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  separation_id uuid NOT NULL REFERENCES public.separation_requests(id) ON DELETE CASCADE,
  step_no integer NOT NULL,
  task_key text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,              -- approval | clearance | closure | submission
  owner_role text NOT NULL,        -- employee | manager | hrbp | functional_head | payroll | it | finance | admin
  assignee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'waiting', -- waiting | pending | done | rejected | skipped
  activated_at timestamptz,
  due_date date,
  form jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL DEFAULT '',
  completed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  completed_at timestamptz,
  escalation_level integer NOT NULL DEFAULT 0,
  escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (separation_id, task_key)
);
CREATE INDEX separation_tasks_sep_idx ON public.separation_tasks(separation_id);
GRANT SELECT ON public.separation_tasks TO authenticated;
GRANT ALL ON public.separation_tasks TO service_role;
ALTER TABLE public.separation_tasks ENABLE ROW LEVEL SECURITY;

-- ===== In-app notifications =====
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  separation_id uuid REFERENCES public.separation_requests(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON public.notifications(recipient_employee_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notif_read ON public.notifications FOR SELECT TO authenticated USING (recipient_employee_id = private.my_employee_id());
CREATE POLICY notif_update ON public.notifications FOR UPDATE TO authenticated USING (recipient_employee_id = private.my_employee_id()) WITH CHECK (recipient_employee_id = private.my_employee_id());

-- ===== Helpers =====
CREATE OR REPLACE FUNCTION private.dept_head_of(_employee_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dh.head_employee_id FROM public.employees e
  JOIN public.department_heads dh ON dh.company_id = e.company_id AND lower(dh.department) = lower(e.department)
  WHERE e.id = _employee_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.can_see_separation(_sep_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.separation_requests s JOIN public.employees e ON e.id = s.employee_id
    WHERE s.id = _sep_id AND (
      e.id = private.my_employee_id()
      OR private.can_manage_company(e.company_id)
      OR private.is_my_report(e.id)
      OR private.has_finance_role('finance_payroll', e.company_id)
      OR private.has_finance_role('finance_expense', e.company_id)
      OR private.has_finance_role('it_asset', e.company_id)
      OR private.has_finance_role('admin_facilities', e.company_id)
      OR private.has_finance_role('hr_head', e.company_id)
      OR private.dept_head_of(e.id) = private.my_employee_id()
      OR EXISTS (SELECT 1 FROM public.separation_tasks t WHERE t.separation_id = s.id AND t.assignee_id = private.my_employee_id())
    )
  );
$$;

CREATE POLICY sep_tasks_read ON public.separation_tasks FOR SELECT TO authenticated USING (private.can_see_separation(separation_id));
CREATE POLICY separation_duty_read ON public.separation_requests FOR SELECT TO authenticated USING (private.can_see_separation(id));

CREATE OR REPLACE FUNCTION private.business_days_between(_from timestamptz, _to timestamptz)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*)::int FROM generate_series((_from::date) + 1, _to::date, interval '1 day') g
  WHERE extract(isodow FROM g) < 6;
$$;

-- Employees who hold a role for this separation
CREATE OR REPLACE FUNCTION private.sep_role_recipients(_sep_id uuid, _role text, _assignee uuid)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _emp public.employees; _app app_role;
BEGIN
  SELECT e.* INTO _emp FROM public.separation_requests s JOIN public.employees e ON e.id = s.employee_id WHERE s.id = _sep_id;
  IF _role = 'employee' THEN RETURN NEXT _emp.id; RETURN; END IF;
  IF _role IN ('manager','functional_head') THEN
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
    WHEN 'it' THEN 'it_asset' WHEN 'admin' THEN 'admin_facilities' WHEN 'hr_head' THEN 'hr_head' END::app_role;
  IF _app IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT DISTINCT x.id FROM public.user_roles r JOIN public.employees x ON x.user_id = r.user_id
    WHERE r.role = _app AND (r.company_id IS NULL OR r.company_id = _emp.company_id) AND x.id <> _emp.id;
END; $$;

CREATE OR REPLACE FUNCTION private.sep_notify(_sep_id uuid, _recipients uuid[], _title text, _body text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (recipient_employee_id, title, body, link, separation_id)
  SELECT DISTINCT r, _title, _body, '/separation', _sep_id FROM unnest(_recipients) r WHERE r IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION private.sep_task_holders(_task public.separation_tasks)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(x), '{}') FROM private.sep_role_recipients(_task.separation_id, _task.owner_role, _task.assignee_id) x;
$$;

-- Can the caller act on this task?
CREATE OR REPLACE FUNCTION private.can_act_sep_task(_task_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    WHEN 'payroll' THEN private.has_finance_role('finance_payroll', e.company_id)
    WHEN 'it' THEN private.has_finance_role('it_asset', e.company_id) OR private.can_manage_company(e.company_id)
    WHEN 'finance' THEN private.has_finance_role('finance_expense', e.company_id)
    WHEN 'admin' THEN private.has_finance_role('admin_facilities', e.company_id)
    ELSE false END;
END; $$;

-- Let the workflow engine bypass the manual-edit guard
CREATE OR REPLACE FUNCTION private.guard_separation_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF current_setting('app.sep_engine', true) = 'on' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF private.can_manage_company(private.employee_company(NEW.employee_id)) THEN RETURN NEW; END IF;
  NEW.employee_id := OLD.employee_id;
  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id()
     AND private.has_finance_role('finance_payroll', private.employee_company(NEW.employee_id)) THEN
    NEW.approved_last_day := OLD.approved_last_day; NEW.handover_to := OLD.handover_to;
    NEW.exit_interview_done := OLD.exit_interview_done; NEW.manager_status := OLD.manager_status;
    NEW.manager_note := OLD.manager_note; NEW.manager_decided_at := OLD.manager_decided_at;
    NEW.hr_status := OLD.hr_status; NEW.hr_note := OLD.hr_note; NEW.hr_decided_at := OLD.hr_decided_at;
    NEW.it_status := OLD.it_status; NEW.it_note := OLD.it_note; NEW.it_assets := OLD.it_assets; NEW.it_decided_at := OLD.it_decided_at;
    IF NEW.stage IS DISTINCT FROM OLD.stage AND NOT (OLD.stage = 'finance_settlement' AND NEW.stage = 'completed') THEN
      RAISE EXCEPTION 'Finance can only close the settlement stage';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.employee_id IS DISTINCT FROM private.my_employee_id() AND private.is_my_report(NEW.employee_id) THEN
    NEW.approved_last_day := OLD.approved_last_day; NEW.exit_interview_done := OLD.exit_interview_done;
    NEW.hr_status := OLD.hr_status; NEW.hr_note := OLD.hr_note; NEW.hr_decided_at := OLD.hr_decided_at;
    NEW.it_status := OLD.it_status; NEW.it_note := OLD.it_note; NEW.it_assets := OLD.it_assets; NEW.it_decided_at := OLD.it_decided_at;
    NEW.finance_status := OLD.finance_status; NEW.finance_note := OLD.finance_note; NEW.finance_decided_at := OLD.finance_decided_at;
    NEW.settlement_amount := OLD.settlement_amount; NEW.settlement_paid_on := OLD.settlement_paid_on;
    NEW.final_salary_amount := OLD.final_salary_amount; NEW.leave_encashment_days := OLD.leave_encashment_days;
    NEW.leave_encashment_amount := OLD.leave_encashment_amount; NEW.unpaid_leave_days := OLD.unpaid_leave_days;
    NEW.unpaid_leave_amount := OLD.unpaid_leave_amount; NEW.expense_reimbursement_amount := OLD.expense_reimbursement_amount;
    NEW.finance_routed_at := OLD.finance_routed_at;
    IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage NOT IN ('manager_review','hr_review','rejected') THEN
      RAISE EXCEPTION 'A manager can only pass a separation to HR or decline it';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage <> 'withdrawn' THEN
    RAISE EXCEPTION 'Only HR can move a separation forward';
  END IF;
  NEW.approved_last_day := OLD.approved_last_day; NEW.handover_to := OLD.handover_to;
  NEW.exit_interview_done := OLD.exit_interview_done; NEW.manager_status := OLD.manager_status;
  NEW.manager_note := OLD.manager_note; NEW.manager_decided_at := OLD.manager_decided_at;
  NEW.hr_status := OLD.hr_status; NEW.hr_note := OLD.hr_note; NEW.hr_decided_at := OLD.hr_decided_at;
  NEW.it_status := OLD.it_status; NEW.it_note := OLD.it_note; NEW.it_assets := OLD.it_assets; NEW.it_decided_at := OLD.it_decided_at;
  NEW.finance_status := OLD.finance_status; NEW.finance_note := OLD.finance_note; NEW.finance_decided_at := OLD.finance_decided_at;
  NEW.settlement_amount := OLD.settlement_amount; NEW.settlement_paid_on := OLD.settlement_paid_on;
  NEW.final_salary_amount := OLD.final_salary_amount; NEW.leave_encashment_days := OLD.leave_encashment_days;
  NEW.leave_encashment_amount := OLD.leave_encashment_amount; NEW.unpaid_leave_days := OLD.unpaid_leave_days;
  NEW.unpaid_leave_amount := OLD.unpaid_leave_amount; NEW.expense_reimbursement_amount := OLD.expense_reimbursement_amount;
  NEW.finance_routed_at := OLD.finance_routed_at;
  RETURN NEW;
END; $function$;

-- Move the workflow forward to the next open step(s)
CREATE OR REPLACE FUNCTION private.sep_advance(_sep_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.separation_requests; t public.separation_tasks; e public.employees; lwd date;
BEGIN
  PERFORM set_config('app.sep_engine', 'on', true);
  SELECT * INTO s FROM public.separation_requests WHERE id = _sep_id;
  SELECT * INTO e FROM public.employees WHERE id = s.employee_id;
  IF s.stage IN ('rejected','withdrawn','completed') THEN RETURN; END IF;
  lwd := coalesce(s.approved_last_day, s.requested_last_day);

  -- Approvals, one at a time
  SELECT * INTO t FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'approval'
    AND status NOT IN ('done','skipped') ORDER BY step_no LIMIT 1;
  IF FOUND THEN
    IF t.status = 'waiting' THEN
      UPDATE public.separation_tasks SET status = 'pending', activated_at = now(),
        due_date = current_date + CASE WHEN t.owner_role = 'hrbp' THEN 1 ELSE 2 END
        WHERE id = t.id RETURNING * INTO t;
      PERFORM private.sep_notify(_sep_id, private.sep_task_holders(t), t.title || ' · ' || e.full_name,
        e.full_name || ' (' || coalesce(e.job_title,'') || ' - ' || coalesce(e.department,'') || ') has resigned. ' ||
        t.title || ' is pending with you. Proposed last day: ' || to_char(lwd, 'DD Mon YYYY') || '.');
    END IF;
    UPDATE public.separation_requests SET stage = CASE WHEN t.owner_role = 'manager' THEN 'manager_review' ELSE 'hr_review' END::separation_stage
      WHERE id = _sep_id;
    RETURN;
  END IF;

  -- Clearances (IT, Finance, Admin, Exit interview) run side by side
  IF EXISTS (SELECT 1 FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'clearance' AND status = 'waiting') THEN
    FOR t IN UPDATE public.separation_tasks SET status = 'pending', activated_at = now(),
        due_date = lwd - CASE WHEN task_key = 'exit_interview' THEN 1 ELSE 2 END
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

  -- Full & final, then letters
  SELECT * INTO t FROM public.separation_tasks WHERE separation_id = _sep_id AND kind = 'closure'
    AND status NOT IN ('done','skipped') ORDER BY step_no LIMIT 1;
  IF FOUND THEN
    IF t.status = 'waiting' THEN
      UPDATE public.separation_tasks SET status = 'pending', activated_at = now(),
        due_date = CASE WHEN t.task_key = 'fnf' THEN greatest(lwd, current_date) ELSE current_date END
        WHERE id = t.id RETURNING * INTO t;
      PERFORM private.sep_notify(_sep_id, private.sep_task_holders(t), t.title || ' · ' || e.full_name,
        t.title || ' is pending with you for ' || e.full_name || ' (last working day ' || to_char(lwd, 'DD Mon YYYY') || ').');
    END IF;
    IF t.task_key = 'fnf' THEN
      UPDATE public.separation_requests SET stage = 'finance_settlement', finance_routed_at = coalesce(finance_routed_at, now()) WHERE id = _sep_id;
    END IF;
    RETURN;
  END IF;

  -- Everything done: close the exit
  UPDATE public.separation_requests SET stage = 'completed', letters_issued_at = coalesce(letters_issued_at, now()) WHERE id = _sep_id;
  UPDATE public.employees SET status = 'offboarded', exit_on = lwd WHERE id = s.employee_id;
  PERFORM private.sep_notify(_sep_id, ARRAY[e.id], 'Your exit is complete',
    'Your full & final settlement is done and your relieving and experience letters are ready on the Separation page.');
END; $$;

-- Build the voluntary workflow when a resignation is submitted
CREATE OR REPLACE FUNCTION private.sep_create_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.employees; fh uuid; lwd date := NEW.requested_last_day; mgr_name text;
BEGIN
  IF NEW.separation_kind <> 'voluntary' THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.employees WHERE id = NEW.employee_id;
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

  -- CC on submission: HRBP + immediate manager
  PERFORM private.sep_notify(NEW.id,
    array_append(ARRAY(SELECT private.sep_role_recipients(NEW.id, 'hrbp', NULL)), e.manager_id),
    'Resignation received · ' || e.full_name,
    'Your reportee / colleague ' || e.full_name || ', ' || coalesce(e.job_title,'') || ' - ' || coalesce(e.department,'') ||
    ' has resigned. Proposed last day: ' || to_char(lwd, 'DD Mon YYYY') || '.');
  PERFORM private.sep_advance(NEW.id);
  RETURN NEW;
END; $$;

CREATE TRIGGER separation_create_workflow AFTER INSERT ON public.separation_requests
  FOR EACH ROW EXECUTE FUNCTION private.sep_create_workflow();

-- Complete / decide a task
CREATE OR REPLACE FUNCTION private.complete_separation_task(_task_id uuid, _decision text, _form jsonb, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.separation_tasks; s public.separation_requests; e public.employees; me uuid := private.my_employee_id();
  me_name text; lwd date;
BEGIN
  IF NOT private.can_act_sep_task(_task_id) THEN RAISE EXCEPTION 'You cannot act on this step'; END IF;
  SELECT * INTO t FROM public.separation_tasks WHERE id = _task_id FOR UPDATE;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'This step is not open'; END IF;
  IF _decision NOT IN ('done','rejected') THEN RAISE EXCEPTION 'Unknown decision'; END IF;
  IF _decision = 'rejected' AND t.kind <> 'approval' THEN RAISE EXCEPTION 'Only approval steps can be rejected'; END IF;
  SELECT * INTO s FROM public.separation_requests WHERE id = t.separation_id;
  SELECT * INTO e FROM public.employees WHERE id = s.employee_id;
  SELECT full_name INTO me_name FROM public.employees WHERE id = me;
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
      hr_status = CASE WHEN t.owner_role = 'hrbp' THEN 'rejected' ELSE hr_status END,
      manager_note = CASE WHEN t.owner_role = 'manager' THEN coalesce(_note,'') ELSE manager_note END,
      hr_note = CASE WHEN t.owner_role = 'hrbp' THEN coalesce(_note,'') ELSE hr_note END
      WHERE id = s.id;
    UPDATE public.separation_tasks SET status = 'skipped' WHERE separation_id = s.id AND status IN ('waiting','pending');
    PERFORM private.sep_notify(s.id, ARRAY[e.id, e.manager_id], 'Resignation not accepted · ' || e.full_name,
      coalesce(me_name,'The reviewer') || ' has rejected ' || e.full_name || '''s resignation.' ||
      CASE WHEN coalesce(_note,'') <> '' THEN ' Note: ' || _note ELSE '' END);
    RETURN;
  END IF;

  -- Keep the summary fields in step
  IF t.task_key = 'manager' THEN
    UPDATE public.separation_requests SET manager_status = 'approved', manager_note = coalesce(_form->>'feedback',''), manager_decided_at = now() WHERE id = s.id;
    PERFORM private.sep_notify(s.id, ARRAY[e.id], 'Your manager accepted your resignation',
      'Your resignation has been accepted by your manager and is awaiting confirmation from HR.');
  ELSIF t.task_key = 'hrbp' THEN
    lwd := coalesce(nullif(_form->>'last_day','')::date, s.requested_last_day);
    UPDATE public.separation_requests SET hr_status = 'approved', hr_note = coalesce(_form->>'comments',''), hr_decided_at = now(),
      approved_last_day = lwd, notice_days = coalesce(nullif(_form->>'notice_days','')::int, notice_days) WHERE id = s.id;
    UPDATE public.separation_tasks SET due_date = lwd - CASE WHEN task_key = 'exit_interview' THEN 1 ELSE 2 END
      WHERE separation_id = s.id AND kind = 'clearance';
    UPDATE public.separation_tasks SET due_date = lwd WHERE separation_id = s.id AND task_key = 'fnf';
    PERFORM private.sep_notify(s.id, ARRAY[e.id, e.manager_id], 'Resignation confirmed by HR · ' || e.full_name,
      e.full_name || '''s resignation has been confirmed by ' || coalesce(me_name,'HR') || '. Last working day: ' || to_char(lwd, 'DD Mon YYYY') || '.');
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

  -- CC on approvals: HR Head + payroll team
  IF t.kind = 'approval' THEN
    PERFORM private.sep_notify(s.id,
      ARRAY(SELECT private.sep_role_recipients(s.id, 'hr_head', NULL)) || ARRAY(SELECT private.sep_role_recipients(s.id, 'payroll', NULL)),
      t.title || ' done · ' || e.full_name, coalesce(me_name,'An approver') || ' approved ' || e.full_name || '''s resignation (' || t.title || ').');
  END IF;

  PERFORM private.sep_advance(s.id);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_separation_task(_task_id uuid, _decision text, _form jsonb, _note text)
RETURNS void LANGUAGE sql SET search_path = public AS $$ SELECT private.complete_separation_task(_task_id, _decision, _form, _note); $$;

-- Employee revokes their resignation
CREATE OR REPLACE FUNCTION private.revoke_my_resignation(_sep_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.separation_requests; e public.employees;
BEGIN
  SELECT * INTO s FROM public.separation_requests WHERE id = _sep_id;
  IF NOT FOUND OR s.employee_id <> private.my_employee_id() THEN RAISE EXCEPTION 'Not your resignation'; END IF;
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
END; $$;
CREATE OR REPLACE FUNCTION public.revoke_my_resignation(_sep_id uuid)
RETURNS void LANGUAGE sql SET search_path = public AS $$ SELECT private.revoke_my_resignation(_sep_id); $$;

-- Escalation: 3 business days without action -> functional head -> HR head
CREATE OR REPLACE FUNCTION private.escalate_separation_tasks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.separation_tasks; e public.employees; n int := 0; fh uuid;
BEGIN
  FOR t IN SELECT * FROM public.separation_tasks WHERE status = 'pending' AND activated_at IS NOT NULL
    AND owner_role <> 'employee' AND escalation_level < 2 LOOP
    SELECT emp.* INTO e FROM public.separation_requests s JOIN public.employees emp ON emp.id = s.employee_id WHERE s.id = t.separation_id;
    fh := private.dept_head_of(e.id);
    IF t.escalation_level = 0 AND private.business_days_between(t.activated_at, now()) >= 3 THEN
      IF fh IS NOT NULL AND fh <> e.id AND t.owner_role <> 'functional_head' THEN
        UPDATE public.separation_tasks SET escalation_level = 1, escalated_at = now() WHERE id = t.id;
        PERFORM private.sep_notify(t.separation_id, ARRAY[fh], 'Escalated: ' || t.title || ' · ' || e.full_name,
          t.title || ' for ' || e.full_name || ' has had no action for 3 business days and is now escalated to you.');
      ELSE
        UPDATE public.separation_tasks SET escalation_level = 2, escalated_at = now() WHERE id = t.id;
        PERFORM private.sep_notify(t.separation_id, ARRAY(SELECT private.sep_role_recipients(t.separation_id, 'hr_head', NULL)),
          'Escalated: ' || t.title || ' · ' || e.full_name,
          t.title || ' for ' || e.full_name || ' has had no action for 3 business days and is now escalated to HR Head.');
      END IF;
      n := n + 1;
    ELSIF t.escalation_level = 1 AND private.business_days_between(t.escalated_at, now()) >= 3 THEN
      UPDATE public.separation_tasks SET escalation_level = 2, escalated_at = now() WHERE id = t.id;
      PERFORM private.sep_notify(t.separation_id, ARRAY(SELECT private.sep_role_recipients(t.separation_id, 'hr_head', NULL)),
        'Escalated: ' || t.title || ' · ' || e.full_name,
        t.title || ' for ' || e.full_name || ' is still pending after escalation and now needs HR Head.');
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END; $$;
CREATE OR REPLACE FUNCTION public.run_separation_escalations()
RETURNS integer LANGUAGE sql SET search_path = public AS $$ SELECT private.escalate_separation_tasks(); $$;

REVOKE ALL ON FUNCTION public.complete_separation_task(uuid, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_my_resignation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.run_separation_escalations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_separation_task(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_resignation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_separation_escalations() TO authenticated;
