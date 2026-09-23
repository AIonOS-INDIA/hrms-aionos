ALTER TABLE public.payslips
  ADD COLUMN IF NOT EXISTS hr_status public.request_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS hr_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hr_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS finance_status public.request_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS finance_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS finance_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_on date,
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_reference text NOT NULL DEFAULT '';