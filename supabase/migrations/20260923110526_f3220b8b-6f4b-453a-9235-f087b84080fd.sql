DO $$
DECLARE pid uuid := 'fdc8b5c0-558e-4a0c-82c2-b4e744287078';
BEGIN
  UPDATE public.employees e SET
    full_name = s.full_name,
    email = lower(s.email),
    job_title = s.job_title,
    band = s.band,
    employment_type = s.employment_type,
    status = s.status,
    gender = s.gender,
    date_of_birth = s.date_of_birth,
    joined_on = s.joined_on,
    exit_on = s.exit_on,
    office_city = s.office_city,
    office_area = CASE WHEN coalesce(e.office_area,'') = '' THEN s.office_city ELSE e.office_area END,
    location = CASE WHEN coalesce(e.location,'') = '' THEN s.office_city ELSE e.location END,
    legal_entity = s.legal_entity,
    hired_from = s.hired_from,
    company_id = pid,
    updated_at = now()
  FROM public.protectra_staging s
  WHERE e.employee_code = s.employee_code;

  DELETE FROM public.employees e
  WHERE e.company_id = pid
    AND e.user_id IS NULL
    AND (e.employee_code IS NULL OR e.employee_code NOT IN (SELECT employee_code FROM public.protectra_staging));

  UPDATE public.employees e SET manager_id = m.id, updated_at = now()
  FROM public.protectra_staging s
  JOIN public.employees m ON lower(btrim(m.full_name)) = lower(btrim(s.manager_name)) AND m.company_id = pid
  WHERE e.employee_code = s.employee_code
    AND btrim(s.manager_name) <> ''
    AND m.id <> e.id;

  UPDATE public.employees e SET manager_id = m.id, updated_at = now()
  FROM public.protectra_staging s
  JOIN public.employees m ON lower(btrim(m.full_name)) = lower(btrim(s.manager_name))
  WHERE e.employee_code = s.employee_code
    AND btrim(s.manager_name) <> ''
    AND e.manager_id IS NULL
    AND m.id <> e.id;
END $$;

INSERT INTO public.entity_field_values (company_id, field, value)
SELECT DISTINCT 'fdc8b5c0-558e-4a0c-82c2-b4e744287078'::uuid, f.field, f.value
FROM (
  SELECT 'job_title' AS field, job_title AS value FROM public.protectra_staging
  UNION SELECT 'band', band FROM public.protectra_staging
  UNION SELECT 'office_city', office_city FROM public.protectra_staging
  UNION SELECT 'legal_entity', legal_entity FROM public.protectra_staging
  UNION SELECT 'hired_from', hired_from FROM public.protectra_staging
) f
WHERE btrim(coalesce(f.value,'')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.entity_field_values v
    WHERE v.company_id = 'fdc8b5c0-558e-4a0c-82c2-b4e744287078'::uuid
      AND v.field = f.field AND lower(v.value) = lower(f.value)
  );