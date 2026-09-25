CREATE TABLE public.actionable_card_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_kind text NOT NULL CHECK (approval_kind IN ('leave', 'timesheet', 'expense')),
  approval_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  destination text NOT NULL CHECK (destination IN ('teams', 'outlook')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_kind, approval_id, recipient_user_id, destination)
);

GRANT ALL ON public.actionable_card_deliveries TO service_role;
ALTER TABLE public.actionable_card_deliveries ENABLE ROW LEVEL SECURITY;
CREATE INDEX actionable_card_deliveries_approval ON public.actionable_card_deliveries (approval_kind, approval_id);
CREATE INDEX actionable_card_deliveries_recipient ON public.actionable_card_deliveries (recipient_user_id, created_at DESC);
