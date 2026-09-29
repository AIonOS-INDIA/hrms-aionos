-- Leave approval through Outlook, without the Supabase service role key.
-- Two database functions do the privileged reads/writes instead:
--   1. leave_notify_context   : called with the employee's own login, returns their leave
--                               request plus their manager's name and email.
--   2. leave_decide_from_outlook : called by the server after it has verified Microsoft's
--                               signed token; protected by a shared secret.
-- The secret itself is NOT in this file. After applying, store it once with:
--   INSERT INTO private.app_settings (name, value)
--   VALUES ('outlook_decision_secret', '<long random value>')
--   ON CONFLICT (name) DO UPDATE SET value = excluded.value;
-- and put the same value in the portal's OUTLOOK_DECISION_SECRET environment variable.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_settings (
  name  text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON private.app_settings FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON private.app_settings FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON private.app_settings FROM authenticated';
  END IF;
END $$;

-- 1. Details for the approval email: only for the caller's own leave request.
CREATE OR REPLACE FUNCTION public.leave_notify_context(p_request_id uuid)
RETURNS TABLE (
  request_id      uuid,
  leave_status    text,
  start_on        date,
  end_on          date,
  day_count       numeric,
  leave_reason    text,
  leave_type_name text,
  employee_name   text,
  manager_name    text,
  manager_email   text,
  manager_status  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.status::text, r.start_date, r.end_date, r.days, r.reason,
         t.name, e.full_name, m.full_name, lower(m.email), m.status::text
  FROM public.leave_requests r
  JOIN public.employees e ON e.id = r.employee_id
  LEFT JOIN public.leave_types t ON t.id = r.leave_type_id
  LEFT JOIN public.employees m ON m.id = e.manager_id
  WHERE r.id = p_request_id
    AND e.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.leave_notify_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_notify_context(uuid) TO authenticated;

-- 2. Record the manager's Outlook decision. The server calls this only after verifying
--    Microsoft's token; the secret stops anyone else from calling it directly.
CREATE OR REPLACE FUNCTION public.leave_decide_from_outlook(
  p_secret      text,
  p_request_id  uuid,
  p_actor_email text,
  p_decision    text,
  p_reason      text DEFAULT NULL
)
RETURNS TABLE (
  outcome         text,
  leave_status    text,
  start_on        date,
  end_on          date,
  day_count       numeric,
  leave_reason    text,
  leave_type_name text,
  employee_name   text,
  employee_email  text,
  manager_email   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_expected text;
  v_row      record;
  v_updated  int;
BEGIN
  SELECT s.value INTO v_expected FROM private.app_settings s WHERE s.name = 'outlook_decision_secret';
  IF v_expected IS NULL OR p_secret IS NULL OR p_secret <> v_expected THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision';
  END IF;
  IF p_decision = 'rejected' AND coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'a denial reason is required';
  END IF;

  SELECT r.status::text AS status, r.start_date, r.end_date, r.days, r.reason,
         t.name AS type_name, e.full_name, e.email AS emp_email, lower(m.email) AS mgr_email
    INTO v_row
  FROM public.leave_requests r
  JOIN public.employees e ON e.id = r.employee_id
  LEFT JOIN public.leave_types t ON t.id = r.leave_type_id
  LEFT JOIN public.employees m ON m.id = e.manager_id
  WHERE r.id = p_request_id;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  leave_status    := v_row.status;
  start_on        := v_row.start_date;
  end_on          := v_row.end_date;
  day_count       := v_row.days;
  leave_reason    := v_row.reason;
  leave_type_name := v_row.type_name;
  employee_name   := v_row.full_name;
  employee_email  := v_row.emp_email;
  manager_email   := v_row.mgr_email;

  IF v_row.mgr_email IS NULL OR v_row.mgr_email <> lower(btrim(p_actor_email)) THEN
    outcome := 'not_manager';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_row.status <> 'pending' THEN
    outcome := 'already_decided';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Same update as the portal's Approve / Reject; only one click can win.
  UPDATE public.leave_requests
     SET status = p_decision::public.request_status,
         decided_at = now(),
         decision_note = CASE WHEN p_decision = 'rejected' THEN btrim(p_reason) ELSE decision_note END
   WHERE id = p_request_id AND status = 'pending';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    SELECT r.status::text INTO leave_status FROM public.leave_requests r WHERE r.id = p_request_id;
    outcome := 'already_decided';
  ELSE
    leave_status := p_decision;
    outcome := 'decided';
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.leave_decide_from_outlook(text, uuid, text, text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.leave_decide_from_outlook(text, uuid, text, text, text) TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.leave_decide_from_outlook(text, uuid, text, text, text) TO authenticated';
  END IF;
END $$;