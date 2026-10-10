-- Заход 53: присутствие пользователей на карте — видит ТОЛЬКО админ.
-- Таблица закрыта от прямого доступа (RLS включён, прав у anon/authenticated нет).
-- Запись — только своей строки через report_presence(); чтение — только через
-- get_online_users(), которая на сервере проверяет profiles.is_admin
-- (не-админ получает пустой результат).

create table if not exists public.user_presence (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  heading    double precision not null default 0,
  speed      double precision not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists user_presence_updated_at_idx on public.user_presence (updated_at);

alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;

-- Запись своей позиции (раз в несколько секунд, пока приложение открыто).
create or replace function public.report_presence(
  p_lat double precision,
  p_lng double precision,
  p_heading double precision default 0,
  p_speed double precision default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'Invalid request';
  end if;

  insert into public.user_presence (user_id, lat, lng, heading, speed, updated_at)
  values (auth.uid(), p_lat, p_lng, coalesce(p_heading, 0), coalesce(p_speed, 0), now())
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        heading = excluded.heading, speed = excluded.speed,
        updated_at = now();

  -- Чистка: последняя позиция давно ушедших не хранится (≈ раз в 20 вызовов).
  if random() < 0.05 then
    delete from public.user_presence where updated_at < now() - interval '1 hour';
  end if;
end;
$$;

-- Удаление своей позиции (приложение свернули / закрыли карту).
create or replace function public.remove_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.user_presence where user_id = auth.uid();
end;
$$;

-- Список онлайн (позиция обновлялась ≤ 30 с назад). Только для админа.
create or replace function public.get_online_users()
returns table (
  user_id      uuid,
  display_name text,
  lat          double precision,
  lng          double precision,
  heading      double precision,
  speed        double precision,
  updated_at   timestamptz,
  is_self      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null
     or not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    return;
  end if;

  return query
    select p.user_id, pf.display_name, p.lat, p.lng, p.heading, p.speed, p.updated_at,
           (p.user_id = auth.uid())
    from public.user_presence p
    left join public.profiles pf on pf.id = p.user_id
    where p.updated_at > now() - interval '30 seconds';
end;
$$;

revoke execute on function public.report_presence(double precision, double precision, double precision, double precision) from public, anon;
revoke execute on function public.remove_presence() from public, anon;
revoke execute on function public.get_online_users() from public, anon;
grant execute on function public.report_presence(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.remove_presence() to authenticated;
grant execute on function public.get_online_users() to authenticated;
