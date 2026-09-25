
alter function public.decide_attendance_request(uuid,text,text,text) set schema private;
alter function public.proxy_mark_attendance(uuid,date,timestamptz,timestamptz,text) set schema private;
alter function public.set_roster(jsonb) set schema private;
alter function public.run_attendance_checks() set schema private;
grant usage on schema private to authenticated;
grant execute on function private.decide_attendance_request(uuid,text,text,text), private.proxy_mark_attendance(uuid,date,timestamptz,timestamptz,text), private.set_roster(jsonb), private.run_attendance_checks() to authenticated;
create function public.decide_attendance_request(_id uuid, _decision text, _note text, _compensation text) returns void language sql set search_path = public as $$ select private.decide_attendance_request(_id,_decision,_note,_compensation); $$;
create function public.proxy_mark_attendance(_employee_id uuid, _date date, _in timestamptz, _out timestamptz, _note text) returns void language sql set search_path = public as $$ select private.proxy_mark_attendance(_employee_id,_date,_in,_out,_note); $$;
create function public.set_roster(_rows jsonb) returns int language sql set search_path = public as $$ select private.set_roster(_rows); $$;
create function public.run_attendance_checks() returns int language sql set search_path = public as $$ select private.run_attendance_checks(); $$;
revoke execute on function public.decide_attendance_request(uuid,text,text,text), public.proxy_mark_attendance(uuid,date,timestamptz,timestamptz,text), public.set_roster(jsonb), public.run_attendance_checks() from anon, public;
grant execute on function public.decide_attendance_request(uuid,text,text,text), public.proxy_mark_attendance(uuid,date,timestamptz,timestamptz,text), public.set_roster(jsonb), public.run_attendance_checks() to authenticated;
