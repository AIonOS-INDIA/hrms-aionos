CREATE TABLE public.protectra_staging (
  employee_code text PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  job_title text NOT NULL,
  band text NOT NULL,
  employment_type employment_type NOT NULL,
  status employment_status NOT NULL,
  gender gender_type NOT NULL,
  date_of_birth date,
  joined_on date NOT NULL,
  exit_on date,
  office_city text NOT NULL,
  legal_entity text NOT NULL,
  hired_from text NOT NULL,
  manager_name text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protectra_staging TO authenticated;
GRANT ALL ON public.protectra_staging TO service_role;
ALTER TABLE public.protectra_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging service only" ON public.protectra_staging FOR ALL TO service_role USING (true) WITH CHECK (true);