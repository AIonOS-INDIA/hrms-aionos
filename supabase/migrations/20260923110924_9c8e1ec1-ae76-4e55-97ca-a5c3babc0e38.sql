DROP POLICY IF EXISTS entity_field_values_read ON public.entity_field_values;
CREATE POLICY entity_field_values_read ON public.entity_field_values FOR SELECT TO authenticated
USING (private.can_see_company(company_id));

DROP POLICY IF EXISTS bp_read ON public.benefit_plans;
CREATE POLICY bp_read ON public.benefit_plans FOR SELECT TO authenticated
USING ((company_id IS NULL AND private.my_employee_id() IS NOT NULL) OR private.can_see_company(company_id) OR private.is_master_hr());

DROP POLICY IF EXISTS ct_read ON public.checklist_templates;
CREATE POLICY ct_read ON public.checklist_templates FOR SELECT TO authenticated
USING ((company_id IS NULL AND private.my_employee_id() IS NOT NULL) OR private.can_see_company(company_id) OR private.is_master_hr());

DROP POLICY IF EXISTS cti_read ON public.checklist_template_items;
CREATE POLICY cti_read ON public.checklist_template_items FOR SELECT TO authenticated
USING (
  (private.template_company(template_id) IS NULL AND private.my_employee_id() IS NOT NULL)
  OR private.can_see_company(private.template_company(template_id))
  OR private.is_master_hr()
);

DROP POLICY IF EXISTS tc_read ON public.training_courses;
CREATE POLICY tc_read ON public.training_courses FOR SELECT TO authenticated
USING ((company_id IS NULL AND private.my_employee_id() IS NOT NULL) OR private.can_see_company(company_id) OR private.is_master_hr());

DROP POLICY IF EXISTS jo_read ON public.job_openings;
CREATE POLICY jo_read ON public.job_openings FOR SELECT TO authenticated
USING (private.can_see_company(company_id) OR private.is_master_hr());

DROP POLICY IF EXISTS policies_read ON public.policies;
CREATE POLICY policies_read ON public.policies FOR SELECT TO authenticated
USING (private.my_employee_id() IS NOT NULL OR private.is_master_hr());

DROP POLICY IF EXISTS leave_types_read ON public.leave_types;
CREATE POLICY leave_types_read ON public.leave_types FOR SELECT TO authenticated
USING (private.my_employee_id() IS NOT NULL OR private.is_master_hr());

DROP POLICY IF EXISTS holidays_read ON public.holidays;
CREATE POLICY holidays_read ON public.holidays FOR SELECT TO authenticated
USING (private.my_employee_id() IS NOT NULL OR private.is_master_hr());

CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
  email text PRIMARY KEY,
  last_sent_at timestamp with time zone NOT NULL DEFAULT now(),
  sent_count integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT ALL ON public.password_reset_attempts TO service_role;
ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.password_reset_attempts IS 'Service-only throttle for password reset emails; no client access by design.';