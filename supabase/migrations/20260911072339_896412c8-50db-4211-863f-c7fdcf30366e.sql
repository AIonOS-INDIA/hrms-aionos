CREATE OR REPLACE FUNCTION private.claim_my_employee_record()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_emp public.employees%ROWTYPE;
  v_hr_companies uuid[];
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT lower(email), COALESCE(email_confirmed_at, confirmed_at)
    INTO v_email, v_confirmed
    FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_emp FROM public.employees WHERE user_id = v_uid;
  IF NOT FOUND THEN
    IF v_confirmed IS NULL THEN RETURN NULL; END IF;
    UPDATE public.employees SET user_id = v_uid
    WHERE lower(email) = v_email AND user_id IS NULL
    RETURNING * INTO v_emp;
  END IF;
  IF v_emp.id IS NULL THEN RETURN NULL; END IF;

  SELECT array_agg(company_id) INTO v_hr_companies
  FROM public.user_roles
  WHERE user_id = v_uid AND role = 'company_hr' AND company_id IS NOT NULL;

  DELETE FROM public.user_roles
  WHERE user_id = v_uid AND role NOT IN ('finance_expense', 'finance_payroll');

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
END;
$$;