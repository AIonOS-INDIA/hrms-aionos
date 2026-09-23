
create or replace function private.plan_fits_employee(_plan_id uuid, _employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.benefit_plans p
    where p.id = _plan_id
      and (p.company_id is null or p.company_id = private.employee_company(_employee_id))
  )
$$;

grant execute on function private.plan_fits_employee(uuid, uuid) to authenticated, service_role;

drop policy if exists be_insert on public.benefit_enrollments;
create policy be_insert on public.benefit_enrollments
  for insert to authenticated
  with check (
    ((employee_id = private.my_employee_id()) or private.can_manage_company(private.employee_company(employee_id)))
    and private.plan_fits_employee(plan_id, employee_id)
  );

drop policy if exists be_update on public.benefit_enrollments;
create policy be_update on public.benefit_enrollments
  for update to authenticated
  using (private.can_manage_company(private.employee_company(employee_id)))
  with check (
    private.can_manage_company(private.employee_company(employee_id))
    and private.plan_fits_employee(plan_id, employee_id)
  );

create or replace function public.guard_leave_request_validity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.leave_types lt where lt.id = new.leave_type_id) then
    raise exception 'Unknown leave type';
  end if;
  if new.end_date < new.start_date then
    raise exception 'Leave end date cannot be before the start date';
  end if;
  if new.days is null or new.days <= 0 then
    raise exception 'Leave days must be greater than zero';
  end if;
  if new.days > (new.end_date - new.start_date) + 1 then
    raise exception 'Leave days cannot exceed the selected date range';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_leave_request_validity on public.leave_requests;
create trigger guard_leave_request_validity
  before insert or update of leave_type_id, start_date, end_date, days
  on public.leave_requests
  for each row execute function public.guard_leave_request_validity();
