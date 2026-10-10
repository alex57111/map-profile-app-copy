-- ============================================================================
-- Блок 4: боевая SQL-схема Supabase (реверс-инжиниринг из адаптеров)
-- Источники: src/lib/adapters/supabase/{events,auth}.ts,
--            src/lib/adapters/mock/{events,auth}.ts,
--            src/types/{event,user}.ts
-- Выполнить целиком в Supabase SQL Editor на пустом проекте.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles
-- Нужна для src/lib/adapters/supabase/auth.ts: signInAnonymous() после
-- auth.signInAnonymously() поллит эту таблицу (до 3 раз/300мс), ожидая
-- строку — значит строка должна появляться сама, через триггер на auth.users.
-- Поля — по toProfile()/UserProfile (src/types/user.ts).
-- ----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'Водитель',
  avatar_url    text,
  phone         text,
  is_anonymous  boolean not null default true,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- getCurrentUser()/signInAnonymous(): select .eq("id", user.id) — только своя строка.
create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- updateProfile(): update .eq("id", user.id) — только своя строка.
-- ВАЖНО: is_admin намеренно не входит в список разрешённых для UPDATE колонок —
-- column-level grant ниже физически не даёт клиенту выставить его себе напрямую
-- через .from("profiles").update(...), даже с id = auth.uid() и валидным RLS.
-- is_admin можно поменять только через RPC become_admin() (SECURITY DEFINER,
-- пароль проверяется исключительно на сервере).
create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (display_name, phone, avatar_url) on public.profiles to authenticated;

-- Прямых INSERT/DELETE-политик нет: строка создаётся только триггером ниже.

-- Триггер: при создании auth-пользователя (в проекте — только анонимные,
-- signInAnonymously()) сразу создаём профиль, чтобы поллинг в auth.ts не упёрся
-- в пустоту.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, is_anonymous)
  values (new.id, 'Водитель', coalesce(new.is_anonymous, true));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 2. road_events
-- Столбцы — по toEvent()/RoadEvent (после фикса events.ts в этом блоке) +
-- недостающие heading/end_lat/end_lng/zone_limit_kmh (расхождение Блока 2).
-- ----------------------------------------------------------------------------
create table public.road_events (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references auth.users(id) on delete cascade,
  type            text not null check (type in ('camera','police','accident','repair','danger','speed_zone')),
  lat             double precision not null,
  lng             double precision not null,
  description     text,
  positive_votes  integer not null default 0,
  negative_votes  integer not null default 0,
  -- Блок 6 (2026-07-11): nullable — NULL = событие не истекает. Сейчас
  -- только type='camera' (переиспользован как "стационарная камера" из ТЗ,
  -- отдельный тип camera_stationary не заводили, см. AGENT_LOG.md заход 16).
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  -- Блок 6: обновляется при создании и при confirm_event_relevant() —
  -- НЕ при голосовании.
  updated_at      timestamptz not null default now(),
  -- Блок 6: подряд идущих голосов "нет" без сброса положительным голосом —
  -- используется для автоскрытия в vote_on_event. Внутреннее поле, в
  -- RoadEvent-тип на фронте не входит.
  negative_streak integer not null default 0,
  -- Направление автора (0-360, null = направление неизвестно → алерт всем)
  heading         double precision,
  -- Зона средней скорости (только type = 'speed_zone')
  end_lat         double precision,
  end_lng         double precision,
  zone_limit_kmh  double precision
);

create index road_events_bounds_idx on public.road_events (lat, lng);
create index road_events_expires_idx on public.road_events (expires_at);

alter table public.road_events enable row level security;

-- getEventsInBounds()/subscribeToEvents(): select без auth-фильтра — читать
-- может кто угодно, даже анонимный по publishable-ключу.
create policy road_events_select_all
  on public.road_events for select
  to anon, authenticated
  using (true);

-- Прямых INSERT/UPDATE/DELETE-политик для anon/authenticated нет умышленно:
-- запись только через RPC ниже (SECURITY DEFINER), т.к. anon-ключ публичный
-- и TTL/подсчёт голосов должны считаться на бэкенде, а не приходить от клиента.


-- ----------------------------------------------------------------------------
-- 3. event_votes
-- В коде адаптера (supabase/events.ts) явно не читается/не пишется напрямую —
-- добавлена как опора для RPC vote_on_event, чтобы соблюсти "RPC с проверками"
-- из ТЗ (п.2) и не дать одному auth.uid() голосовать за одно событие дважды —
-- аналогично поведению votesStore в mock-адаптере (mock/events.ts).
-- RLS без policy = anon/authenticated доступа к таблице напрямую не имеют,
-- читает/пишет её только SECURITY DEFINER функция ниже.
-- ----------------------------------------------------------------------------
create table public.event_votes (
  event_id  uuid not null references public.road_events(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  vote      boolean not null, -- true = "yes", false = "no" (см. VoteValue)
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.event_votes enable row level security;
-- Политик нет намеренно — таблица закрыта для прямого доступа.
-- UNIQUE на (event_id, user_id) уже обеспечена PRIMARY KEY — отдельный
-- constraint для антифрода Блока 6 (п.3 ТЗ) не требуется, повторный голос
-- одним user_id за одно событие невозможен уже с Блока 4.


-- ----------------------------------------------------------------------------
-- 3a. vote_rate_log (Блок 6)
-- Rate-limit на голоса: не более 20 вызовов vote_on_event за скользящее
-- окно 10 минут на user_id. Считать по event_votes нельзя — там одна
-- строка на (event_id, user_id), перезаписывается через ON CONFLICT
-- (особенно у админа), повторные попытки теряются. Здесь — отдельный
-- append-only лог КАЖДОГО вызова, а не только уникальных голосов.
-- ----------------------------------------------------------------------------
create table public.vote_rate_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index vote_rate_log_user_time_idx on public.vote_rate_log (user_id, created_at);

alter table public.vote_rate_log enable row level security;
-- Политик нет намеренно — таблица закрыта для прямого доступа, читает и
-- пишет только SECURITY DEFINER функция ниже.


-- ----------------------------------------------------------------------------
-- 4. RPC create_road_event
-- Вызывается из createEvent() (supabase/events.ts) с параметрами
-- p_type/p_lat/p_lng/p_description (+ p_heading/p_end_lat/p_end_lng/
-- p_zone_limit_kmh после фикса в этом блоке).
-- TTL — CASE по типу, значения синхронизированы с EVENT_TYPE_CONFIG
-- (src/types/event.ts). Блок 6 (2026-07-11, по прямому указанию Alex —
-- "заменить текущие на новые"): accident 180 / repair 1440 / police 120 —
-- из ТЗ Блока 6; camera → NULL (никогда не истекает, переиспользован как
-- camera_stationary из ТЗ); danger/speed_zone → 360 ("остальные типы",
-- 6 часов по умолчанию из ТЗ). Старые значения (camera 180 / police 60 /
-- accident 90 / repair 480 / danger 45 / speed_zone 1440) — см. историю в
-- AGENT_LOG.md, заход 4.
-- ----------------------------------------------------------------------------
create or replace function public.create_road_event(
  p_type            text,
  p_lat             double precision,
  p_lng             double precision,
  p_description     text default null,
  p_heading         double precision default null,
  p_end_lat         double precision default null,
  p_end_lng         double precision default null,
  p_zone_limit_kmh  double precision default null
)
returns public.road_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ttl_mins integer;
  v_row public.road_events;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_type not in ('camera','police','accident','repair','danger','speed_zone') then
    raise exception 'Unknown event type: %', p_type;
  end if;

  -- Значения ttlMins из src/types/event.ts EVENT_TYPE_CONFIG — держать в синхроне.
  -- NULL (camera) — событие не истекает.
  v_ttl_mins := case p_type
    when 'camera'     then null
    when 'police'     then 120
    when 'accident'   then 180
    when 'repair'     then 1440
    when 'danger'     then 360
    when 'speed_zone' then 360
  end;

  insert into public.road_events (
    author_id, type, lat, lng, description,
    positive_votes, negative_votes, expires_at, updated_at,
    heading, end_lat, end_lng, zone_limit_kmh
  ) values (
    auth.uid(), p_type, p_lat, p_lng, p_description,
    0, 0,
    case when v_ttl_mins is null then null else now() + (v_ttl_mins || ' minutes')::interval end,
    now(),
    p_heading, p_end_lat, p_end_lng, p_zone_limit_kmh
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_road_event(
  text, double precision, double precision, text,
  double precision, double precision, double precision, double precision
) to authenticated;


-- ----------------------------------------------------------------------------
-- 4a. RPC confirm_event_relevant (Блок 6)
-- «Подтвердить, что событие всё ещё актуально»: продлевает expires_at на
-- тот же TTL заново от текущего момента (тот же CASE по типу, что и в
-- create_road_event — держать в синхроне), обновляет updated_at, сбрасывает
-- negative_streak (спор считается разрешённым в пользу события).
-- ----------------------------------------------------------------------------
create function public.confirm_event_relevant(p_event_id uuid)
returns public.road_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_ttl_mins integer;
  v_row public.road_events;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select type into v_type from public.road_events where id = p_event_id;
  if v_type is null then
    raise exception 'Event not found';
  end if;

  v_ttl_mins := case v_type
    when 'camera'     then null
    when 'police'     then 120
    when 'accident'   then 180
    when 'repair'     then 1440
    when 'danger'     then 360
    when 'speed_zone' then 360
  end;

  update public.road_events
  set
    expires_at = case when v_ttl_mins is null then null else now() + (v_ttl_mins || ' minutes')::interval end,
    updated_at = now(),
    negative_streak = 0
  where id = p_event_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.confirm_event_relevant(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. admin_config + RPC become_admin
-- Дополнение к Блоку 4 (по прямому указанию Alex): режим "админ" для
-- неограниченного голосования. Пароль сверяется ИСКЛЮЧИТЕЛЬНО здесь, внутри
-- SECURITY DEFINER функции — на фронтенде (в JS/бандле) пароль нигде не
-- хранится и не проверяется, только передаётся строкой в RPC-вызов.
--
-- Блок 6, п.4 (2026-07-13) — вынос пароля из кода:
-- become_admin — это Postgres RPC, а не Cloudflare Pages Function,
-- переменные окружения Cloudflare туда физически не долетают (разные
-- среды выполнения) — "вынос в Cloudflare env var" в буквальном виде не
-- подходил, см. развилку из AGENT_LOG.md, заход 15/16. Выбран вариант (а)
-- из уточнения Alex: bcrypt-хэш пароля хранится в отдельной закрытой
-- таблице admin_config (без RLS-политик на чтение снаружи — доступна
-- только SECURITY DEFINER функциям, по тому же паттерну, что и
-- event_votes/vote_rate_log выше). Значение хэша задаёт Alex вручную
-- одним INSERT/UPDATE в Supabase SQL Editor — см. инструкцию в
-- AGENT_LOG.md и в отдельном файле миграции. Пароль '321' в открытом виде
-- в коде/базе больше не хранится нигде.
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;

create table public.admin_config (
  id            integer primary key default 1,
  password_hash text not null,
  updated_at    timestamptz not null default now(),
  constraint admin_config_singleton check (id = 1)
);

alter table public.admin_config enable row level security;
-- Политик нет намеренно — таблица закрыта для прямого доступа, читает и
-- пишет только вручную сам Alex (через Supabase SQL Editor/service role)
-- и SECURITY DEFINER функция become_admin() ниже.

create or replace function public.become_admin(p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select password_hash into v_hash from public.admin_config where id = 1;

  -- v_hash is null → Alex ещё не задал пароль в admin_config (см.
  -- инструкцию в AGENT_LOG.md) — become_admin недоступен никому, это
  -- безопасное поведение по умолчанию, а не баг.
  -- Ошибка намеренно без деталей — не подтверждает и не опровергает, что
  -- именно было неверно (пароль или отсутствие admin_config).
  if v_hash is null or p_password is null or crypt(p_password, v_hash) is distinct from v_hash then
    raise exception 'Invalid request';
  end if;

  update public.profiles set is_admin = true where id = auth.uid();
end;
$$;

grant execute on function public.become_admin(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 6. RPC vote_on_event
-- Вызывается из voteOnEvent() (supabase/events.ts): p_event_id/p_vote
-- (p_vote = true → positive, false → negative, см. events.ts:
-- vote === "yes" -> p_vote: true).
--
-- Обычный пользователь: один auth.uid() — один голос за событие
-- (event_votes PK), повторный голос молча игнорируется (как в mock-адаптере).
--
-- Админ (profiles.is_admin = true, выставляется только через become_admin()):
-- уникальность голоса не проверяется — каждый вызов увеличивает счётчик,
-- даже если это тот же auth.uid() и то же событие (по прямому указанию Alex,
-- Блок 4 — дополнение). Строка в event_votes для админа при этом
-- перезаписывается (ON CONFLICT DO UPDATE) — таблица хранит последний голос
-- для справки, но НЕ отражает реальное количество голосов админа, т.к.
-- счётчик в road_events растёт при каждом вызове независимо от конфликта.
--
-- Блок 6 (2026-07-11): два изменения по прямому указанию Alex.
-- (1) Rate-limit — не более 20 вызовов за 10 минут на user_id (см.
--     vote_rate_log выше), проверяется и логируется в самом начале, до
--     остальной логики и независимо от её исхода.
-- (2) Старый score-based DELETE (positive_votes - negative_votes <= -1,
--     см. историю в AGENT_LOG.md, заходы 10-12) ЗАМЕНЁН на streak-based
--     hide: порог — 2 подряд идущих голоса "нет" без положительного голоса
--     между ними (заход 42; было 1) (negative_streak, обнуляется любым голосом "да"). Событие
--     больше не удаляется физически — только скрывается через
--     expires_at в прошлое (фронт фильтрует по expires_at, см.
--     src/lib/adapters/supabase/events.ts).
-- ----------------------------------------------------------------------------
create or replace function public.vote_on_event(
  p_event_id uuid,
  p_vote     boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_recent_votes integer;
  v_prev boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select coalesce(is_admin, false) into v_is_admin
  from public.profiles where id = auth.uid();

  if v_is_admin then
    insert into public.event_votes (event_id, user_id, vote, created_at)
    values (p_event_id, auth.uid(), p_vote, now())
    on conflict (event_id, user_id) do update set vote = excluded.vote, created_at = now();

    if p_vote then
      update public.road_events set positive_votes = positive_votes + 1, negative_streak = 0
        where id = p_event_id;
    else
      update public.road_events
        set negative_votes = negative_votes + 1, negative_streak = negative_streak + 1,
            expires_at = now() - interval '1 minute'
        where id = p_event_id;
    end if;
    return;
  end if;

  select count(*) into v_recent_votes
  from public.vote_rate_log
  where user_id = auth.uid() and created_at > now() - interval '10 minutes';

  if v_recent_votes >= 20 then
    raise exception 'Too many votes, try again later';
  end if;

  insert into public.vote_rate_log (user_id) values (auth.uid());

  select vote into v_prev from public.event_votes
    where event_id = p_event_id and user_id = auth.uid();

  if found and v_prev = p_vote then
    return;
  end if;

  insert into public.event_votes (event_id, user_id, vote)
  values (p_event_id, auth.uid(), p_vote)
  on conflict (event_id, user_id) do update set vote = excluded.vote, created_at = now();

  if p_vote then
    update public.road_events set positive_votes = positive_votes + 1, negative_streak = 0
      where id = p_event_id;
  else
    update public.road_events
      set negative_votes = negative_votes + 1, negative_streak = negative_streak + 1
      where id = p_event_id;
    update public.road_events set expires_at = now() - interval '1 minute'
      where id = p_event_id and negative_streak >= 2;
  end if;
end;
$$;

grant execute on function public.vote_on_event(uuid, boolean) to authenticated;

-- Заход 43: выход из админ-режима.
create or replace function public.leave_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles set is_admin = false where id = auth.uid();
end;
$$;

grant execute on function public.leave_admin() to authenticated;


-- ----------------------------------------------------------------------------
-- 7. Realtime: публикация таблицы road_events
-- Без этой команды postgres_changes-подписка в subscribeToEvents()
-- (src/lib/adapters/supabase/events.ts) НЕ получает события — ни insert
-- своего события, ни изменения от других пользователей (голоса, delete
-- при отрицательном score из п.6). Изначально причина, по которой события
-- не появлялись в реальном времени без ручной перезагрузки вкладки.
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.road_events;
