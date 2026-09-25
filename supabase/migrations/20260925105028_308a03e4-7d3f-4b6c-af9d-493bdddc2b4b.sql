
create table public.attendance_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  grace_minutes int not null default 10,
  late_limit int not null default 3,
  late_deduct_days numeric not null default 0.5,
  buffer_minutes int not null default 30,
  ot_min_minutes int not null default 30,
  ot_weekday_rate numeric not null default 1.5,
  ot_holiday_rate numeric not null default 2,
  comp_off_expiry_days int not null default 30,
  weekly_hours_cap numeric not null default 48,
  night_start time not null default '22:00',
  night_end time not null default '06:00',
  geofence_required boolean not null default true,
  face_required boolean not null default true,
  regularize_hours int not null default 48,
  proxy_days int not null default 7,
  absconding_days int not null default 3,
  prorata_min_days int not null default 20,
  updated_at timestamptz not null default now()
);
create table public.office_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, city text not null default '',
  lat double precision not null, lng double precision not null,
  radius_m int not null default 200, active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, kind text not null default 'regular',
  start_time time not null default '09:00', end_time time not null default '18:00',
  hours numeric not null default 9, active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create table public.rosters (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  shift_id uuid references public.shifts(id) on delete set null,
  weekly_off boolean not null default false,
  set_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create table public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  shift_id uuid references public.shifts(id) on delete set null,
  in_at timestamptz, out_at timestamptz,
  source text not null default 'app',
  in_lat double precision, in_lng double precision,
  location_id uuid references public.office_locations(id) on delete set null,
  selfie_path text not null default '',
  face_score numeric,
  is_late boolean not null default false, late_minutes int not null default 0,
  worked_minutes int not null default 0, ot_minutes int not null default 0,
  is_night boolean not null default false, is_off_day boolean not null default false,
  status text not null default 'present',
  marked_by uuid references public.employees(id),
  note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create table public.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('regularization','ot_planned','ot_auto')),
  work_date date not null,
  requested_in timestamptz, requested_out timestamptz,
  ot_minutes int not null default 0, ot_rate numeric not null default 1,
  compensation text not null default 'pay' check (compensation in ('pay','comp_off')),
  reason text not null default '',
  status request_status not null default 'pending',
  raised_by uuid references public.employees(id),
  decided_by uuid references public.employees(id),
  decided_at timestamptz, decision_note text not null default '',
  created_at timestamptz not null default now()
);
create table public.comp_offs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  earned_on date not null, expires_on date not null,
  request_id uuid references public.attendance_requests(id) on delete set null,
  status text not null default 'available' check (status in ('available','used','expired')),
  used_on date, created_at timestamptz not null default now()
);
create table public.employee_face_profiles (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  photo_path text not null, enrolled_at timestamptz not null default now()
);
create table public.attendance_flags (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  flag text not null check (flag in ('absconding','hours_cap','late_deduction','missed_punch','prorata')),
  period text not null, detail text not null default '',
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (employee_id, flag, period)
);

grant select, insert, update, delete on public.attendance_settings, public.office_locations, public.shifts, public.rosters, public.attendance_days, public.attendance_requests, public.comp_offs, public.employee_face_profiles, public.attendance_flags to authenticated;
grant all on public.attendance_settings, public.office_locations, public.shifts, public.rosters, public.attendance_days, public.attendance_requests, public.comp_offs, public.employee_face_profiles, public.attendance_flags to service_role;

alter table public.attendance_settings enable row level security;
alter table public.office_locations enable row level security;
alter table public.shifts enable row level security;
alter table public.rosters enable row level security;
alter table public.attendance_days enable row level security;
alter table public.attendance_requests enable row level security;
alter table public.comp_offs enable row level security;
alter table public.employee_face_profiles enable row level security;
alter table public.attendance_flags enable row level security;

-- L1 (direct) or L2 (skip) manager
create or replace function private.is_l1_l2(_employee_id uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (
    select 1 from public.employees e left join public.employees m on m.id = e.manager_id
    where e.id = _employee_id and private.my_employee_id() is not null
      and (e.manager_id = private.my_employee_id() or m.manager_id = private.my_employee_id())
  );
$$;
-- can view an employee's attendance: self, any manager up the chain, dept head, HR
create or replace function private.can_view_attendance(_employee_id uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select _employee_id = private.my_employee_id()
      or private.is_my_report(_employee_id)
      or private.dept_head_of(_employee_id) = private.my_employee_id()
      or private.can_manage_company(private.employee_company(_employee_id))
      or exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'hr_head'
                 and (company_id is null or company_id = private.employee_company(_employee_id)));
$$;
create or replace function private.can_manage_attendance(_employee_id uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.is_l1_l2(_employee_id) or private.can_manage_company(private.employee_company(_employee_id));
$$;

create policy "see settings" on public.attendance_settings for select to authenticated using (private.can_see_company(company_id));
create policy "hr settings" on public.attendance_settings for all to authenticated using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
create policy "see locations" on public.office_locations for select to authenticated using (private.can_see_company(company_id));
create policy "hr locations" on public.office_locations for all to authenticated using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));
create policy "see shifts" on public.shifts for select to authenticated using (private.can_see_company(company_id));
create policy "hr shifts" on public.shifts for all to authenticated using (private.can_manage_company(company_id)) with check (private.can_manage_company(company_id));

create policy "view roster" on public.rosters for select to authenticated using (private.can_view_attendance(employee_id));
create policy "manage roster" on public.rosters for all to authenticated using (private.can_manage_attendance(employee_id)) with check (private.can_manage_attendance(employee_id));

create policy "view attendance" on public.attendance_days for select to authenticated using (private.can_view_attendance(employee_id));
create policy "hr attendance" on public.attendance_days for all to authenticated
  using (private.can_manage_company(private.employee_company(employee_id)))
  with check (private.can_manage_company(private.employee_company(employee_id)));

create policy "view requests" on public.attendance_requests for select to authenticated using (private.can_view_attendance(employee_id));
create policy "raise requests" on public.attendance_requests for insert to authenticated
  with check (status = 'pending' and kind <> 'ot_auto' and (employee_id = private.my_employee_id() or private.can_manage_attendance(employee_id)));
create policy "cancel own" on public.attendance_requests for update to authenticated
  using (employee_id = private.my_employee_id() and status = 'pending') with check (status = 'cancelled');

create policy "view compoff" on public.comp_offs for select to authenticated using (private.can_view_attendance(employee_id));
create policy "hr compoff" on public.comp_offs for all to authenticated
  using (private.can_manage_company(private.employee_company(employee_id)))
  with check (private.can_manage_company(private.employee_company(employee_id)));

create policy "view face" on public.employee_face_profiles for select to authenticated using (employee_id = private.my_employee_id() or private.can_manage_company(private.employee_company(employee_id)));
create policy "hr face" on public.employee_face_profiles for all to authenticated
  using (private.can_manage_company(private.employee_company(employee_id)))
  with check (private.can_manage_company(private.employee_company(employee_id)));

create policy "view flags" on public.attendance_flags for select to authenticated using (private.can_view_attendance(employee_id));
create policy "hr flags" on public.attendance_flags for update to authenticated
  using (private.can_manage_company(private.employee_company(employee_id)))
  with check (private.can_manage_company(private.employee_company(employee_id)));

-- Derive late / OT / night / worked from shift + settings
create or replace function private.compute_attendance() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare s record; sh record; r record; tz text := 'Asia/Kolkata';
  st timestamptz; en timestamptz; comp uuid; hol boolean;
begin
  comp := private.employee_company(new.employee_id);
  select * into s from public.attendance_settings where company_id = comp;
  if not found then s := row(comp,10,3,0.5,30,30,1.5,2,30,48,'22:00'::time,'06:00'::time,true,true,48,7,3,20,now())::public.attendance_settings; end if;
  select * into r from public.rosters where employee_id = new.employee_id and work_date = new.work_date;
  if new.shift_id is null then new.shift_id := coalesce(r.shift_id, (select id from public.shifts where company_id = comp and active order by created_at limit 1)); end if;
  select * into sh from public.shifts where id = new.shift_id;
  hol := exists (select 1 from public.holidays h join public.employees e on e.id = new.employee_id
                 where h.holiday_date = new.work_date and (h.company_id is null or h.company_id = comp)
                   and (h.location = '' or h.location ilike e.office_city or h.location ilike 'all%'));
  new.is_off_day := coalesce(r.weekly_off,false) or hol or (r.id is null and extract(isodow from new.work_date) in (6,7));
  new.is_late := false; new.late_minutes := 0; new.ot_minutes := 0; new.worked_minutes := 0; new.is_night := false;
  if sh.id is not null then
    st := (new.work_date + sh.start_time) at time zone tz;
    en := (new.work_date + sh.end_time + case when sh.end_time <= sh.start_time then interval '1 day' else interval '0' end) at time zone tz;
    new.is_night := sh.end_time >= s.night_start or sh.start_time <= s.night_end or sh.end_time <= sh.start_time or sh.kind = 'night';
  end if;
  if new.in_at is not null and new.out_at is not null then
    new.worked_minutes := greatest(0, extract(epoch from new.out_at - new.in_at)::int / 60);
  end if;
  if new.in_at is not null and st is not null and not new.is_off_day and new.in_at > st + make_interval(mins => s.grace_minutes) then
    new.is_late := true; new.late_minutes := extract(epoch from new.in_at - st)::int / 60;
  end if;
  if new.out_at is not null then
    if new.is_off_day then new.ot_minutes := new.worked_minutes;
    elsif en is not null and new.out_at > en + make_interval(mins => s.buffer_minutes) then
      new.ot_minutes := greatest(0, extract(epoch from new.out_at - en)::int / 60 - s.grace_minutes);
    end if;
    if new.ot_minutes < s.ot_min_minutes then new.ot_minutes := 0; end if;
  end if;
  new.status := case when new.in_at is null and new.out_at is null then new.status
                     when new.in_at is null or new.out_at is null then case when new.work_date < current_date then 'missed_punch' else 'present' end
                     else 'present' end;
  new.updated_at := now();
  return new;
end $$;
create trigger attendance_compute before insert or update on public.attendance_days for each row execute function private.compute_attendance();

create or replace function private.attendance_auto_ot() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare s record;
begin
  if new.ot_minutes > 0 and not exists (select 1 from public.attendance_requests where employee_id = new.employee_id and work_date = new.work_date and kind in ('ot_auto','ot_planned') and status <> 'cancelled') then
    select * into s from public.attendance_settings where company_id = private.employee_company(new.employee_id);
    insert into public.attendance_requests(employee_id, kind, work_date, ot_minutes, ot_rate, compensation, reason)
    values (new.employee_id, 'ot_auto', new.work_date, new.ot_minutes,
            case when new.is_off_day then coalesce(s.ot_holiday_rate,2) else coalesce(s.ot_weekday_rate,1.5) end,
            case when new.is_off_day then 'comp_off' else 'pay' end, 'Auto-calculated from punches');
  elsif new.ot_minutes > 0 then
    update public.attendance_requests set ot_minutes = new.ot_minutes
     where employee_id = new.employee_id and work_date = new.work_date and kind = 'ot_auto' and status = 'pending';
  end if;
  return new;
end $$;
create trigger attendance_auto_ot after insert or update on public.attendance_days for each row execute function private.attendance_auto_ot();

-- Manager / HR decision
create or replace function public.decide_attendance_request(_id uuid, _decision text, _note text, _compensation text)
returns void language plpgsql security definer set search_path = public, private as $$
declare q record; s record;
begin
  select * into q from public.attendance_requests where id = _id for update;
  if not found or q.status <> 'pending' then raise exception 'Request is no longer pending'; end if;
  if q.employee_id = private.my_employee_id() then raise exception 'You cannot approve your own request'; end if;
  if not (private.is_my_report(q.employee_id) or private.can_manage_company(private.employee_company(q.employee_id))) then raise exception 'Not allowed'; end if;
  if _decision not in ('approved','rejected') then raise exception 'Bad decision'; end if;
  update public.attendance_requests set status = _decision::request_status, decided_by = private.my_employee_id(), decided_at = now(),
    decision_note = coalesce(_note,''), compensation = coalesce(nullif(_compensation,''), compensation) where id = _id;
  if _decision = 'rejected' then return; end if;
  select * into s from public.attendance_settings where company_id = private.employee_company(q.employee_id);
  if q.kind = 'regularization' then
    insert into public.attendance_days(employee_id, work_date, in_at, out_at, source, marked_by, note)
    values (q.employee_id, q.work_date, q.requested_in, q.requested_out, 'regularized', private.my_employee_id(), q.reason)
    on conflict (employee_id, work_date) do update set
      in_at = coalesce(excluded.in_at, attendance_days.in_at), out_at = coalesce(excluded.out_at, attendance_days.out_at),
      source = 'regularized', marked_by = excluded.marked_by;
  elsif coalesce(nullif(_compensation,''), q.compensation) = 'comp_off' then
    insert into public.comp_offs(employee_id, earned_on, expires_on, request_id)
    values (q.employee_id, q.work_date, q.work_date + coalesce(s.comp_off_expiry_days,30), q.id);
  end if;
end $$;

-- L1/L2 proxy marking within N working days
create or replace function public.proxy_mark_attendance(_employee_id uuid, _date date, _in timestamptz, _out timestamptz, _note text)
returns void language plpgsql security definer set search_path = public, private as $$
declare s record;
begin
  if not (private.is_l1_l2(_employee_id) or private.can_manage_company(private.employee_company(_employee_id))) then raise exception 'Only L1/L2 managers or HR can mark attendance for this person'; end if;
  if _employee_id = private.my_employee_id() then raise exception 'Use your own punch or a regularization request'; end if;
  select * into s from public.attendance_settings where company_id = private.employee_company(_employee_id);
  if _date > current_date then raise exception 'Cannot mark future dates'; end if;
  if not private.can_manage_company(private.employee_company(_employee_id))
     and private.business_days_between(_date::timestamptz, now()) > coalesce(s.proxy_days,7) then
    raise exception 'Locked: proxy updates are allowed only within % working days', coalesce(s.proxy_days,7);
  end if;
  insert into public.attendance_days(employee_id, work_date, in_at, out_at, source, marked_by, note)
  values (_employee_id, _date, _in, _out, 'proxy', private.my_employee_id(), coalesce(_note,''))
  on conflict (employee_id, work_date) do update set in_at = excluded.in_at, out_at = excluded.out_at,
    source = 'proxy', marked_by = excluded.marked_by, note = excluded.note;
end $$;

-- Roster (single or bulk) by L1/L2/HR
create or replace function public.set_roster(_rows jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare x jsonb; n int := 0;
begin
  for x in select * from jsonb_array_elements(_rows) loop
    if not private.can_manage_attendance((x->>'employee_id')::uuid) then raise exception 'Not allowed to roster %', x->>'employee_id'; end if;
    insert into public.rosters(employee_id, work_date, shift_id, weekly_off, set_by)
    values ((x->>'employee_id')::uuid, (x->>'work_date')::date, nullif(x->>'shift_id','')::uuid, coalesce((x->>'weekly_off')::boolean,false), private.my_employee_id())
    on conflict (employee_id, work_date) do update set shift_id = excluded.shift_id, weekly_off = excluded.weekly_off, set_by = excluded.set_by;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Periodic checks: lates, absconding, hours cap, missed punches, comp-off expiry, pro-rata
create or replace function private.run_attendance_checks_all() returns int
language plpgsql security definer set search_path = public, private as $$
declare n int := 0; rec record; per text := to_char(current_date,'YYYY-MM'); prev text := to_char(current_date - interval '1 month','YYYY-MM');
  lt uuid; bal record; left_days numeric;
begin
  update public.comp_offs set status = 'expired' where status = 'available' and expires_on < current_date;
  update public.attendance_days set status = 'missed_punch' where status = 'present' and work_date < current_date and (in_at is null or out_at is null);
  insert into public.attendance_flags(employee_id, flag, period, detail)
  select employee_id, 'missed_punch', work_date::text, 'Missing punch — regularize within the allowed window or it becomes unpaid leave'
    from public.attendance_days where status = 'missed_punch' on conflict do nothing;
  -- late deductions
  for rec in select a.employee_id, count(*) c, coalesce(s.late_limit,3) lim, coalesce(s.late_deduct_days,0.5) d
      from public.attendance_days a left join public.attendance_settings s on s.company_id = private.employee_company(a.employee_id)
     where a.is_late and to_char(a.work_date,'YYYY-MM') = per group by 1,3,4 having count(*) > coalesce(s.late_limit,3) loop
    if not exists (select 1 from public.attendance_flags where employee_id = rec.employee_id and flag = 'late_deduction' and period = per) then
      left_days := rec.d;
      for lt in select id from public.leave_types where code in ('CASUAL','SICK') order by case code when 'CASUAL' then 1 else 2 end loop
        select * into bal from public.leave_balances where employee_id = rec.employee_id and leave_type_id = lt and year = extract(year from current_date)::int;
        if found and bal.entitled_days - bal.used_days >= left_days then
          update public.leave_balances set used_days = used_days + left_days where id = bal.id; left_days := 0; exit;
        end if;
      end loop;
      insert into public.attendance_flags(employee_id, flag, period, detail) values (rec.employee_id, 'late_deduction', per,
        rec.c || ' late arrivals — ' || rec.d || ' day ' || case when left_days = 0 then 'deducted from CL/SL' else 'marked as unpaid leave (no balance)' end);
      n := n + 1;
    end if;
  end loop;
  -- weekly hours cap (current ISO week)
  insert into public.attendance_flags(employee_id, flag, period, detail)
  select a.employee_id, 'hours_cap', to_char(current_date,'IYYY-"W"IW'), round(sum(a.worked_minutes)/60.0,1) || 'h worked this week (cap ' || coalesce(max(s.weekly_hours_cap),48) || 'h)'
    from public.attendance_days a left join public.attendance_settings s on s.company_id = private.employee_company(a.employee_id)
   where a.work_date >= date_trunc('week', current_date) group by a.employee_id
  having sum(a.worked_minutes)/60.0 > coalesce(max(s.weekly_hours_cap),48) on conflict do nothing;
  -- absconding: last N working days (Mon-Fri, not weekly off) with no attendance & no approved/pending leave
  insert into public.attendance_flags(employee_id, flag, period, detail)
  select e.id, 'absconding', current_date::text, 'Absent without leave for ' || coalesce(s.absconding_days,3) || '+ working days'
    from public.employees e left join public.attendance_settings s on s.company_id = e.company_id
   where e.status = 'active' and exists (select 1 from public.attendance_days x where x.employee_id = e.id)
     and not exists (
       select 1 from generate_series(current_date - (coalesce(s.absconding_days,3) + 4), current_date - 1, interval '1 day') g(d)
       where extract(isodow from g.d) < 6
         and (exists (select 1 from public.attendance_days a where a.employee_id = e.id and a.work_date = g.d::date and a.in_at is not null)
           or exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status in ('approved','pending') and g.d::date between l.start_date and l.end_date)
           or exists (select 1 from public.rosters r where r.employee_id = e.id and r.work_date = g.d::date and r.weekly_off))
       and g.d::date >= current_date - coalesce(s.absconding_days,3) - 2)
     and (select max(work_date) from public.attendance_days a where a.employee_id = e.id and a.in_at is not null) < current_date - coalesce(s.absconding_days,3)
  on conflict do nothing;
  -- pro-rata: previous month worked days below threshold
  insert into public.attendance_flags(employee_id, flag, period, detail)
  select a.employee_id, 'prorata', prev, count(*) || ' days worked last month (threshold ' || coalesce(max(s.prorata_min_days),20) || ') — leave accrual to be pro-rated'
    from public.attendance_days a left join public.attendance_settings s on s.company_id = private.employee_company(a.employee_id)
   where to_char(a.work_date,'YYYY-MM') = prev and a.in_at is not null group by a.employee_id
  having count(*) < coalesce(max(s.prorata_min_days),20) on conflict do nothing;
  return n;
end $$;
create or replace function public.run_attendance_checks() returns int
language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('master_hr','company_hr','hr_head')) then raise exception 'HR only'; end if;
  return private.run_attendance_checks_all();
end $$;
revoke execute on function public.run_attendance_checks(), public.decide_attendance_request(uuid,text,text,text), public.proxy_mark_attendance(uuid,date,timestamptz,timestamptz,text), public.set_roster(jsonb) from anon, public;
grant execute on function public.run_attendance_checks(), public.decide_attendance_request(uuid,text,text,text), public.proxy_mark_attendance(uuid,date,timestamptz,timestamptz,text), public.set_roster(jsonb) to authenticated;

insert into public.attendance_settings(company_id) select id from public.companies on conflict do nothing;
insert into public.shifts(company_id, name, kind, start_time, end_time, hours)
select c.id, v.n, v.k, v.s::time, v.e::time, 9 from public.companies c,
 (values ('General (9–6)','regular','09:00','18:00'),('Rotational A (6–3)','rotational','06:00','15:00'),('Rotational B (2–11)','rotational','14:00','23:00'),('Night (10–7)','night','22:00','07:00'),('WFH (9–6)','wfh','09:00','18:00')) v(n,k,s,e)
on conflict do nothing;

create policy "attendance photos own" on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and (storage.foldername(name))[1] = private.my_employee_id()::text);
