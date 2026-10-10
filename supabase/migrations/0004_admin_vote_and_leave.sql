-- Заход 43: админ-режим голосования + выход из админ-режима.
-- Включает изменения 0003 (смена голоса пользователем, порог 2 для обычных).
-- Применяется ПОВЕРХ 0001/0002; пароль админа здесь НЕ хранится — его хэш
-- задаётся отдельным INSERT в admin_config (см. AGENT_LOG.md, заход 43).
--
-- Правила vote_on_event:
--   Админ (profiles.is_admin): без rate-limit и без ограничения на повторы
--     в любое время; один голос "нет" скрывает событие сразу; "да" сбрасывает
--     серию "нет".
--   Обычный пользователь: rate-limit 20/10 мин; другой голос перезаписывает
--     прежний, тот же повторно игнорируется; скрытие при 2 подряд "нет"
--     (negative_streak >= 2, любые пользователи), "да" сбрасывает серию.

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
