CREATE TYPE public.goal_status AS ENUM ('draft','active','achieved','missed');
CREATE TYPE public.review_status AS ENUM ('draft','shared');

CREATE TABLE public.employee_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  details text NOT NULL DEFAULT '',
  target_date date NOT NULL DEFAULT CURRENT_DATE,
  weight numeric NOT NULL DEFAULT 1,
  progress integer NOT NULL DEFAULT 0,
  status public.goal_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_goals TO authenticated;
GRANT ALL ON public.employee_goals TO service_role;
ALTER TABLE public.employee_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY goals_read ON public.employee_goals FOR SELECT TO authenticated
  USING ((employee_id = public.my_employee_id()) OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY goals_write ON public.employee_goals FOR ALL TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));
CREATE TRIGGER employee_goals_updated_at BEFORE UPDATE ON public.employee_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.performance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period text NOT NULL,
  review_date date NOT NULL DEFAULT CURRENT_DATE,
  rating numeric NOT NULL DEFAULT 3,
  strengths text NOT NULL DEFAULT '',
  improvements text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  status public.review_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_reviews TO authenticated;
GRANT ALL ON public.performance_reviews TO service_role;
ALTER TABLE public.performance_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_read ON public.performance_reviews FOR SELECT TO authenticated
  USING ((employee_id = public.my_employee_id() AND status = 'shared') OR public.can_manage_company(public.employee_company(employee_id)));
CREATE POLICY reviews_write ON public.performance_reviews FOR ALL TO authenticated
  USING (public.can_manage_company(public.employee_company(employee_id)))
  WITH CHECK (public.can_manage_company(public.employee_company(employee_id)));
CREATE TRIGGER performance_reviews_updated_at BEFORE UPDATE ON public.performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();