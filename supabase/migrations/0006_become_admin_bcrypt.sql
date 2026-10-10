-- Заход 50: пароль админа заменён на новый; в коде хранится только bcrypt-хеш
-- (открытый пароль в репозиторий не попадает). Проверка: extensions.crypt().
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

  if p_password is null
     or extensions.crypt(p_password, '$2a$10$GO6P5dYT/IulO/4PKNDLDuMe3D9L6UQaPR7Fdu2aX72EeZWMoRVxW') <> '$2a$10$GO6P5dYT/IulO/4PKNDLDuMe3D9L6UQaPR7Fdu2aX72EeZWMoRVxW' then
    raise exception 'Invalid request';
  end if;

  update public.profiles set is_admin = true where id = auth.uid();
end;
$$;

grant execute on function public.become_admin(text) to authenticated;
