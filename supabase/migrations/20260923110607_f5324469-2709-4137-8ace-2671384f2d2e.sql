UPDATE public.employees e
SET manager_id = m.id, updated_at = now()
FROM public.protectra_staging s
JOIN public.employees m
  ON m.company_id = 'fdc8b5c0-558e-4a0c-82c2-b4e744287078'::uuid
 AND lower(m.full_name) LIKE lower(split_part(btrim(s.manager_name), ' ', 1)) || '%'
 AND lower(m.full_name) LIKE '%' || lower(split_part(btrim(s.manager_name), ' ', array_length(string_to_array(btrim(s.manager_name), ' '), 1)))
WHERE e.employee_code = s.employee_code
  AND e.manager_id IS NULL
  AND btrim(s.manager_name) <> ''
  AND m.id <> e.id;