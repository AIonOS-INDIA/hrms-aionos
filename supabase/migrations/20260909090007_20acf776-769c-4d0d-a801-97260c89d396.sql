ALTER TABLE public.employees
  ADD COLUMN manager_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_manager_not_self CHECK (manager_id IS NULL OR manager_id <> id);

CREATE INDEX IF NOT EXISTS employees_manager_id_idx ON public.employees(manager_id);