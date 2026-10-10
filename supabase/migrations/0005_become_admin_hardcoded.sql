-- Заход 44: пароль админа временно зашит в become_admin (по просьбе Alex;
-- позже вернуть в admin_config/другое хранилище).
-- Причина отказа прежней версии: crypt() из pgcrypto лежит в схеме
-- extensions, а у функции search_path = public → "function crypt does not exist".
create or replace function public.become_admin(p_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_password is null or p_password is distinct from '54321' then
    raise exception 'Invalid request';
  end if;

  update public.profiles set is_admin = true where id = auth.uid();
end;
$$;

grant execute on function public.become_admin(text) to authenticated;
