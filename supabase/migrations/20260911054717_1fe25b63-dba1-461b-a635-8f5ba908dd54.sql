ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS home_address text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.update_my_contact(_phone text, _home_address text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.employees
     SET phone = coalesce(_phone, ''),
         home_address = coalesce(_home_address, ''),
         updated_at = now()
   WHERE user_id = auth.uid()
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.update_my_contact(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_my_contact(text, text) TO authenticated;