create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{8}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'started')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  number integer check (number between 1 and 100),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, number)
);

alter table public.rooms enable row level security;
alter table public.participants enable row level security;

drop policy if exists "room members can read rooms" on public.rooms;
create policy "room members can read rooms"
  on public.rooms for select to authenticated
  using (
    exists (
      select 1
      from public.participants p
      where p.room_id = public.rooms.id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "participants can read their own row" on public.participants;
create policy "participants can read their own row"
  on public.participants for select to authenticated
  using (user_id = auth.uid());

grant select on public.rooms, public.participants to authenticated;

create or replace function public.create_room(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
  v_attempt integer := 0;
  v_display_name text := btrim(p_display_name);
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if char_length(v_display_name) not between 1 and 24 then
    raise exception '名前は1〜24文字で入力してください';
  end if;

  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 10 then
      raise exception '部屋コードを作成できませんでした。もう一度お試しください';
    end if;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.rooms (code, created_by)
    values (v_code, auth.uid())
    on conflict (code) do nothing
    returning id into v_room_id;

    exit when v_room_id is not null;
  end loop;

  insert into public.participants (room_id, user_id, display_name)
  values (v_room_id, auth.uid(), v_display_name);

  return jsonb_build_object('id', v_room_id, 'code', v_code);
end;
$$;

create or replace function public.join_room(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_status text;
  v_display_name text := btrim(p_display_name);
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if char_length(v_display_name) not between 1 and 24 then
    raise exception '名前は1〜24文字で入力してください';
  end if;

  select r.id, r.status
  into v_room_id, v_status
  from public.rooms r
  where r.code = upper(btrim(p_code))
  for update;

  if not found then
    raise exception '部屋が見つかりません。コードを確認してください';
  end if;

  if v_status = 'started' then
    if exists (
      select 1
      from public.participants p
      where p.room_id = v_room_id and p.user_id = auth.uid()
    ) then
      return v_room_id;
    end if;
    raise exception 'この部屋ではすでに数字を配布しています';
  end if;

  insert into public.participants (room_id, user_id, display_name)
  values (v_room_id, auth.uid(), v_display_name)
  on conflict (room_id, user_id)
  do update set display_name = excluded.display_name;

  update public.rooms
  set updated_at = clock_timestamp()
  where id = v_room_id;

  return v_room_id;
end;
$$;

create or replace function public.get_room_state(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_players jsonb;
  v_my_number integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id;

  if not found or not exists (
    select 1
    from public.participants p
    where p.room_id = p_room_id and p.user_id = auth.uid()
  ) then
    raise exception 'この部屋に参加していません';
  end if;

  select jsonb_agg(
    jsonb_build_object('name', p.display_name, 'is_me', p.user_id = auth.uid())
    order by p.joined_at
  )
  into v_players
  from public.participants p
  where p.room_id = p_room_id;

  select p.number
  into v_my_number
  from public.participants p
  where p.room_id = p_room_id and p.user_id = auth.uid();

  return jsonb_build_object(
    'id', v_room.id,
    'code', v_room.code,
    'status', v_room.status,
    'is_host', v_room.created_by = auth.uid(),
    'players', coalesce(v_players, '[]'::jsonb),
    'my_number', v_my_number
  );
end;
$$;

create or replace function public.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
  v_numbers integer[];
  v_player record;
  v_index integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select r.status
  into v_status
  from public.rooms r
  where r.id = p_room_id and r.created_by = auth.uid()
  for update;

  if not found then
    raise exception '部屋のホストだけが開始できます';
  end if;
  if v_status <> 'waiting' then
    raise exception 'この部屋ではすでに数字を配布しています';
  end if;

  select count(*)
  into v_count
  from public.participants p
  where p.room_id = p_room_id;

  if v_count < 1 or v_count > 100 then
    raise exception '参加人数は1〜100人にしてください';
  end if;

  select array_agg(n order by random())
  into v_numbers
  from generate_series(1, 100) as numbers(n);

  for v_player in
    select p.user_id
    from public.participants p
    where p.room_id = p_room_id
    order by p.joined_at
  loop
    v_index := v_index + 1;
    update public.participants
    set number = v_numbers[v_index]
    where room_id = p_room_id and user_id = v_player.user_id;
  end loop;

  update public.rooms
  set status = 'started', updated_at = clock_timestamp()
  where id = p_room_id;
end;
$$;

create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found or not exists (
    select 1
    from public.participants p
    where p.room_id = p_room_id and p.user_id = auth.uid()
  ) then
    raise exception 'この部屋に参加していません';
  end if;

  if v_room.status = 'waiting' and v_room.created_by = auth.uid() then
    delete from public.rooms where id = p_room_id;
  elsif v_room.status = 'waiting' then
    delete from public.participants
    where room_id = p_room_id and user_id = auth.uid();
    update public.rooms
    set updated_at = clock_timestamp()
    where id = p_room_id;
  end if;
end;
$$;

revoke all on function public.create_room(text) from public;
revoke all on function public.join_room(text, text) from public;
revoke all on function public.get_room_state(uuid) from public;
revoke all on function public.start_game(uuid) from public;
revoke all on function public.leave_room(uuid) from public;

grant execute on function public.create_room(text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end;
$$;
