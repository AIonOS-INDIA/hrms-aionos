CREATE TABLE public.entity_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  field text NOT NULL,
  value text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX entity_field_values_uniq
  ON public.entity_field_values (company_id, field, lower(value));
CREATE INDEX entity_field_values_lookup
  ON public.entity_field_values (company_id, field);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.entity_field_values TO authenticated;
GRANT ALL ON public.entity_field_values TO service_role;

ALTER TABLE public.entity_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_field_values_read ON public.entity_field_values
  FOR SELECT TO authenticated USING (true);
CREATE POLICY entity_field_values_write ON public.entity_field_values
  FOR INSERT TO authenticated WITH CHECK (private.can_manage_company(company_id));
CREATE POLICY entity_field_values_update ON public.entity_field_values
  FOR UPDATE TO authenticated
  USING (private.can_manage_company(company_id))
  WITH CHECK (private.can_manage_company(company_id));
CREATE POLICY entity_field_values_delete ON public.entity_field_values
  FOR DELETE TO authenticated USING (private.can_manage_company(company_id));

CREATE TRIGGER entity_field_values_updated_at
  BEFORE UPDATE ON public.entity_field_values
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Preload from the text fields already captured on employee records
INSERT INTO public.entity_field_values (company_id, field, value)
SELECT DISTINCT ON (e.company_id, f.field, lower(btrim(f.val)))
       e.company_id, f.field, btrim(f.val)
FROM public.employees e
CROSS JOIN LATERAL (VALUES
  ('job_title', e.job_title),
  ('band', e.band),
  ('department', e.department),
  ('business_unit', e.business_unit),
  ('legal_entity', e.legal_entity),
  ('location', e.location),
  ('office_city', e.office_city),
  ('office_area', e.office_area)
) AS f(field, val)
WHERE btrim(coalesce(f.val, '')) <> ''
ON CONFLICT DO NOTHING;

-- Company name list
INSERT INTO public.entity_field_values (company_id, field, value)
SELECT c.id, 'company', c.name FROM public.companies c
ON CONFLICT DO NOTHING;

-- Standard option sets
INSERT INTO public.entity_field_values (company_id, field, value)
SELECT c.id, 'employment_type', v
FROM public.companies c
CROSS JOIN unnest(enum_range(NULL::public.employment_type)) AS v
ON CONFLICT DO NOTHING;

INSERT INTO public.entity_field_values (company_id, field, value)
SELECT c.id, 'employment_status', v
FROM public.companies c
CROSS JOIN unnest(enum_range(NULL::public.employment_status)) AS v
ON CONFLICT DO NOTHING;

INSERT INTO public.entity_field_values (company_id, field, value)
SELECT c.id, 'gender', v
FROM public.companies c
CROSS JOIN unnest(enum_range(NULL::public.gender_type)) AS v
ON CONFLICT DO NOTHING;