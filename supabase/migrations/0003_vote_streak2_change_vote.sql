-- Заход 42: (1) порог скрытия — 2 подряд голоса "нет" (было 1);
-- (2) смена голоса пользователем засчитывается (👍→👎), тот же голос повторно игнорируется.
-- Применять вручную в Supabase SQL Editor. Ничего, кроме функции, не меняется.

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

  -- Rate-limit: считаем КАЖДУЮ попытку вызова (не только уникальные
  -- голоса) — иначе повторные/дублирующие вызовы (особенно у админа,
  -- у которого event_votes перезаписывается ON CONFLICT) не ловятся.
  select count(*) into v_recent_votes
  from public.vote_rate_log
  where user_id = auth.uid() and created_at > now() - interval '10 minutes';

  if v_recent_votes >= 20 then
    raise exception 'Too many votes, try again later';
  end if;

  insert into public.vote_rate_log (user_id) values (auth.uid());

  select coalesce(is_admin, false) into v_is_admin
  from public.profiles where id = auth.uid();

  if v_is_admin then
    -- Админ: неограниченное голосование, уникальность не проверяется.
    insert into public.event_votes (event_id, user_id, vote, created_at)
    values (p_event_id, auth.uid(), p_vote, now())
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
    return;
  end if;

  -- Обычный пользователь: тот же голос повторно — игнорируется; ДРУГОЙ голос
  -- (было "да", стало "нет" и наоборот) — перезаписывает прежний и засчитывается
  -- (заход 42: раньше любой повторный голос молча терялся, и 👎 после 👍 не работал).
  select vote into v_prev from public.event_votes
    where event_id = p_event_id and user_id = auth.uid();

  if found and v_prev = p_vote then
    return; -- тот же голос — без изменений
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
