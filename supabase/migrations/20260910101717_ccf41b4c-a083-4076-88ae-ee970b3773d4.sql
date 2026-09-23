DELETE FROM public.separation_requests
WHERE employee_id IN (SELECT id FROM public.employees WHERE lower(email) = 'arjun.mehta@aionos.co');

UPDATE public.employees
SET status = 'active', exit_on = NULL
WHERE lower(email) = 'arjun.mehta@aionos.co';