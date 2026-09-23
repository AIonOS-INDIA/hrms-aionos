CREATE TABLE public.employee_channel_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','microsoft_teams')),
  handle text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','revoked')),
  verification_code text,
  code_expires_at timestamptz,
  connected_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, channel)
);

GRANT ALL ON public.employee_channel_links TO service_role;
ALTER TABLE public.employee_channel_links ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX employee_channel_links_active_handle
  ON public.employee_channel_links (channel, handle)
  WHERE status = 'connected' AND handle <> '';

CREATE INDEX employee_channel_links_employee ON public.employee_channel_links (employee_id);

CREATE TRIGGER employee_channel_links_updated_at
  BEFORE UPDATE ON public.employee_channel_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.channel_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.employee_channel_links(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL DEFAULT '',
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.channel_messages TO service_role;
ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX channel_messages_link ON public.channel_messages (link_id, created_at DESC);
CREATE UNIQUE INDEX channel_messages_external ON public.channel_messages (link_id, external_id) WHERE external_id IS NOT NULL;