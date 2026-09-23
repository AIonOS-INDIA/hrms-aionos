ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS finance_status public.request_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS finance_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS finance_decided_at timestamp with time zone;