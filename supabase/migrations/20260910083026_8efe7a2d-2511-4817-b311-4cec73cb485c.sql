-- ============ ENUMS ============
CREATE TYPE public.checklist_kind AS ENUM ('onboarding','offboarding');
CREATE TYPE public.payroll_status AS ENUM ('draft','processed','paid');
CREATE TYPE public.job_status AS ENUM ('open','on_hold','closed');
CREATE TYPE public.candidate_stage AS ENUM ('applied','screening','interview','offer','hired','rejected');
CREATE TYPE public.enrollment_status AS ENUM ('enrolled','in_progress','completed','dropped');
CREATE TYPE public.benefit_status AS ENUM ('pending','active','ended');
CREATE TYPE public.compliance_status AS ENUM ('valid','expiring','expired','missing');

-- ============ CHECKLIST TEMPLATES ============
CREATE TABLE public.checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  kind public.checklist_kind NOT NULL DEFAULT 'onboarding',
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_templates TO authenticated;
GRANT ALL ON public.checklist_templates TO service_role;
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_read ON public.checklist_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY ct_write ON public.checklist_templates FOR ALL TO authenticated
  USING (CASE WHEN company_id IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(company_id) END)
  WITH CHECK (CASE WHEN company_id IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(company_id) END);
CREATE TRIGGER checklist_templates_updated_at BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_role text NOT NULL DEFAULT 'hr',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_template_items TO authenticated;
GRANT ALL ON public.checklist_template_items TO service_role;
ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.template_company(_template_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT company_id FROM public.checklist_templates WHERE id = _template_id $$;

CREATE POLICY cti_read ON public.checklist_template_items FOR SELECT TO authenticated USING (true);
CREATE POLICY cti_write ON public.checklist_template_items FOR ALL TO authenticated
  USING (CASE WHEN public.template_company(template_id) IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(public.template_company(template_id)) END)
  WITH CHECK (CASE WHEN public.template_company(template_id) IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(public.template_company(template_id)) END);

-- ============ EMPLOYEE CHECKLISTS ============
CREATE TABLE public.employee_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kind public.checklist_kind NOT NULL DEFAULT 'onboarding',
  name text NOT NULL DEFAULT 'Onboarding',
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_checklists TO authenticated;
GRANT ALL ON public.employee_checklists TO service_role;
ALTER TABLE public.employee_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY ec_read ON public.employee_checklists FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY ec_write ON public.employee_checklists FOR ALL TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));
CREATE TRIGGER employee_checklists_updated_at BEFORE UPDATE ON public.employee_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.checklist_employee(_checklist_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT employee_id FROM public.employee_checklists WHERE id = _checklist_id $$;

CREATE TABLE public.employee_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES public.employee_checklists(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_role text NOT NULL DEFAULT 'hr',
  sort_order integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_checklist_items TO authenticated;
GRANT ALL ON public.employee_checklist_items TO service_role;
ALTER TABLE public.employee_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY eci_read ON public.employee_checklist_items FOR SELECT TO authenticated
  USING (public.checklist_employee(checklist_id) = public.my_employee_id()
      OR public.can_manage_company(public.employee_company(public.checklist_employee(checklist_id))));
CREATE POLICY eci_update ON public.employee_checklist_items FOR UPDATE TO authenticated
  USING (public.checklist_employee(checklist_id) = public.my_employee_id()
      OR public.can_manage_company(public.employee_company(public.checklist_employee(checklist_id))))
  WITH CHECK (public.checklist_employee(checklist_id) = public.my_employee_id()
      OR public.can_manage_company(public.employee_company(public.checklist_employee(checklist_id))));
CREATE POLICY eci_insert ON public.employee_checklist_items FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(public.employee_company(public.checklist_employee(checklist_id))));
CREATE POLICY eci_delete ON public.employee_checklist_items FOR DELETE TO authenticated
  USING (public.can_manage_company(public.employee_company(public.checklist_employee(checklist_id))));

-- ============ PAYROLL ============
CREATE TABLE public.salary_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  currency text NOT NULL DEFAULT 'INR',
  annual_ctc numeric NOT NULL DEFAULT 0,
  monthly_basic numeric NOT NULL DEFAULT 0,
  monthly_hra numeric NOT NULL DEFAULT 0,
  monthly_allowances numeric NOT NULL DEFAULT 0,
  monthly_deductions numeric NOT NULL DEFAULT 0,
  tax_percent numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_structures TO authenticated;
GRANT ALL ON public.salary_structures TO service_role;
ALTER TABLE public.salary_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY ss_read ON public.salary_structures FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY ss_write ON public.salary_structures FOR ALL TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));
CREATE TRIGGER salary_structures_updated_at BEFORE UPDATE ON public.salary_structures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  status public.payroll_status NOT NULL DEFAULT 'draft',
  note text NOT NULL DEFAULT '',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs TO authenticated;
GRANT ALL ON public.payroll_runs TO service_role;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_read ON public.payroll_runs FOR SELECT TO authenticated
  USING (public.can_manage_company(company_id));
CREATE POLICY pr_write ON public.payroll_runs FOR ALL TO authenticated
  USING (public.can_manage_company(company_id)) WITH CHECK (public.can_manage_company(company_id));
CREATE TRIGGER payroll_runs_updated_at BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  gross_pay numeric NOT NULL DEFAULT 0,
  deductions numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  paid_days numeric NOT NULL DEFAULT 30,
  loss_of_pay_days numeric NOT NULL DEFAULT 0,
  status public.payroll_status NOT NULL DEFAULT 'processed',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payslips TO authenticated;
GRANT ALL ON public.payslips TO service_role;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY ps_read ON public.payslips FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY ps_write ON public.payslips FOR ALL TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));

-- ============ RECRUITMENT ============
CREATE TABLE public.job_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  department text NOT NULL DEFAULT 'General',
  location text NOT NULL DEFAULT 'Bengaluru',
  employment_type text NOT NULL DEFAULT 'Full-time',
  openings integer NOT NULL DEFAULT 1,
  status public.job_status NOT NULL DEFAULT 'open',
  description text NOT NULL DEFAULT '',
  hiring_manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  posted_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_openings TO authenticated;
GRANT ALL ON public.job_openings TO service_role;
ALTER TABLE public.job_openings ENABLE ROW LEVEL SECURITY;
CREATE POLICY jo_read ON public.job_openings FOR SELECT TO authenticated USING (true);
CREATE POLICY jo_write ON public.job_openings FOR ALL TO authenticated
  USING (public.can_manage_company(company_id)) WITH CHECK (public.can_manage_company(company_id));
CREATE TRIGGER job_openings_updated_at BEFORE UPDATE ON public.job_openings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.job_company(_job_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT company_id FROM public.job_openings WHERE id = _job_id $$;

CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opening_id uuid NOT NULL REFERENCES public.job_openings(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'Referral',
  stage public.candidate_stage NOT NULL DEFAULT 'applied',
  rating numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  resume_url text,
  applied_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates TO authenticated;
GRANT ALL ON public.candidates TO service_role;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY cand_all ON public.candidates FOR ALL TO authenticated
  USING (public.can_manage_company(public.job_company(job_opening_id)))
  WITH CHECK (public.can_manage_company(public.job_company(job_opening_id)));
CREATE TRIGGER candidates_updated_at BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.candidate_company(_candidate_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.job_company(job_opening_id) FROM public.candidates WHERE id = _candidate_id $$;

CREATE TABLE public.interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  round_name text NOT NULL DEFAULT 'Screening',
  interviewer text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'Video',
  outcome text NOT NULL DEFAULT 'pending',
  feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interviews TO authenticated;
GRANT ALL ON public.interviews TO service_role;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY iv_all ON public.interviews FOR ALL TO authenticated
  USING (public.can_manage_company(public.candidate_company(candidate_id)))
  WITH CHECK (public.can_manage_company(public.candidate_company(candidate_id)));

-- ============ TRAINING ============
CREATE TABLE public.training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  provider text NOT NULL DEFAULT 'Internal',
  category text NOT NULL DEFAULT 'General',
  hours numeric NOT NULL DEFAULT 1,
  mandatory boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_courses TO authenticated;
GRANT ALL ON public.training_courses TO service_role;
ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tc_read ON public.training_courses FOR SELECT TO authenticated USING (true);
CREATE POLICY tc_write ON public.training_courses FOR ALL TO authenticated
  USING (CASE WHEN company_id IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(company_id) END)
  WITH CHECK (CASE WHEN company_id IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(company_id) END);
CREATE TRIGGER training_courses_updated_at BEFORE UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.training_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status public.enrollment_status NOT NULL DEFAULT 'enrolled',
  progress integer NOT NULL DEFAULT 0,
  due_date date,
  completed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_enrollments TO authenticated;
GRANT ALL ON public.training_enrollments TO service_role;
ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY te_read ON public.training_enrollments FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY te_update ON public.training_enrollments FOR UPDATE TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY te_insert ON public.training_enrollments FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY te_delete ON public.training_enrollments FOR DELETE TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)));
CREATE TRIGGER training_enrollments_updated_at BEFORE UPDATE ON public.training_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ BENEFITS ============
CREATE TABLE public.benefit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Health',
  provider text NOT NULL DEFAULT '',
  coverage text NOT NULL DEFAULT '',
  employee_cost numeric NOT NULL DEFAULT 0,
  employer_cost numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benefit_plans TO authenticated;
GRANT ALL ON public.benefit_plans TO service_role;
ALTER TABLE public.benefit_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY bp_read ON public.benefit_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY bp_write ON public.benefit_plans FOR ALL TO authenticated
  USING (CASE WHEN company_id IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(company_id) END)
  WITH CHECK (CASE WHEN company_id IS NULL THEN public.is_master_hr() ELSE public.can_manage_company(company_id) END);
CREATE TRIGGER benefit_plans_updated_at BEFORE UPDATE ON public.benefit_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.benefit_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.benefit_plans(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status public.benefit_status NOT NULL DEFAULT 'pending',
  enrolled_on date NOT NULL DEFAULT CURRENT_DATE,
  ended_on date,
  dependents integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benefit_enrollments TO authenticated;
GRANT ALL ON public.benefit_enrollments TO service_role;
ALTER TABLE public.benefit_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY be_read ON public.benefit_enrollments FOR SELECT TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY be_insert ON public.benefit_enrollments FOR INSERT TO authenticated
  WITH CHECK (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY be_update ON public.benefit_enrollments FOR UPDATE TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY be_delete ON public.benefit_enrollments FOR DELETE TO authenticated
  USING (employee_id = public.my_employee_id() OR public.can_manage_company(public.employee_company(employee_id)));
CREATE TRIGGER benefit_enrollments_updated_at BEFORE UPDATE ON public.benefit_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ COMPLIANCE ============
CREATE TABLE public.compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  name text NOT NULL,
  doc_type text NOT NULL DEFAULT 'Statutory',
  reference text NOT NULL DEFAULT '',
  issued_on date,
  expires_on date,
  status public.compliance_status NOT NULL DEFAULT 'valid',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_documents TO authenticated;
GRANT ALL ON public.compliance_documents TO service_role;
ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY cd_read ON public.compliance_documents FOR SELECT TO authenticated
  USING ((employee_id IS NOT NULL AND employee_id = public.my_employee_id()) OR public.can_manage_company(company_id));
CREATE POLICY cd_write ON public.compliance_documents FOR ALL TO authenticated
  USING (public.can_manage_company(company_id)) WITH CHECK (public.can_manage_company(company_id));
CREATE TRIGGER compliance_documents_updated_at BEFORE UPDATE ON public.compliance_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ INDEXES ============
CREATE INDEX idx_eci_checklist ON public.employee_checklist_items(checklist_id);
CREATE INDEX idx_ec_employee ON public.employee_checklists(employee_id);
CREATE INDEX idx_payslips_employee ON public.payslips(employee_id);
CREATE INDEX idx_candidates_job ON public.candidates(job_opening_id);
CREATE INDEX idx_te_employee ON public.training_enrollments(employee_id);
CREATE INDEX idx_be_employee ON public.benefit_enrollments(employee_id);
CREATE INDEX idx_cd_company ON public.compliance_documents(company_id);