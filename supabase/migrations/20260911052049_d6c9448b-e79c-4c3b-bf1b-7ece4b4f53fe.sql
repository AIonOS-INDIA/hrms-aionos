ALTER TYPE gender_type ADD VALUE IF NOT EXISTS 'undisclosed';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS legal_entity text NOT NULL DEFAULT '';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS business_unit text NOT NULL DEFAULT '';