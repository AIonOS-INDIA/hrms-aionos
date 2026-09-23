DO $$ BEGIN
  CREATE TYPE public.employment_type AS ENUM ('full_time','part_time','consultant','intern');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gender_type AS ENUM ('male','female');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employee_code text,
  ADD COLUMN IF NOT EXISTS gender public.gender_type,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS employment_type public.employment_type NOT NULL DEFAULT 'full_time',
  ADD COLUMN IF NOT EXISTS band text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS office_area text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS office_city text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS employees_employee_code_key
  ON public.employees (employee_code) WHERE employee_code IS NOT NULL;