begin;

alter table public.rooms
  add column if not exists round_number integer not null default 0,
  add column if not exists difficulty integer,
  add column if not exists theme text;

create or replace function public.get_room_state(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'status', r.status,
    'is_host', r.created_by = auth.uid(),
    'players', (
      select coalesce(jsonb_agg(
        jsonb_build_object('name', p.display_name, 'is_me', p.user_id = auth.uid())
        order by p.joined_at
      ), '[]'::jsonb)
      from public.participants p
      where p.room_id = r.id
    ),
    'my_number', mine.number,
    'round_number', r.round_number,
    'difficulty', r.difficulty,
    'theme', r.theme
  )
  into v_result
  from public.rooms r
  join public.participants mine
    on mine.room_id = r.id and mine.user_id = auth.uid()
  where r.id = p_room_id;

  if not found then
    raise exception 'この部屋に参加していません';
  end if;

  return v_result;
end;
$$;

create or replace function public.start_round(
  p_room_id uuid,
  p_expected_round integer,
  p_difficulty integer,
  p_theme text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round integer;
  v_count integer;
  v_numbers integer[];
  v_player record;
  v_index integer := 0;
  v_theme text := btrim(p_theme);
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if (p_theme is null and p_difficulty is not null)
     or (p_theme is not null and (
       p_difficulty is null or p_difficulty not between 1 and 4
       or char_length(v_theme) not between 1 and 100
     )) then
    raise exception 'お題は1〜100文字、レベルは1〜4で指定してください';
  end if;

  select r.round_number
  into v_round
  from public.rooms r
  where r.id = p_room_id and r.created_by = auth.uid()
  for update;

  if not found then
    raise exception '部屋のホストだけが開始できます';
  end if;
  if p_expected_round is distinct from v_round then
    raise exception 'すでに次の回が始まりました。画面を更新してください';
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

  update public.participants
  set number = null
  where room_id = p_room_id;

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
  set status = 'started',
      round_number = v_round + 1,
      difficulty = p_difficulty,
      theme = v_theme,
      updated_at = clock_timestamp()
  where id = p_room_id;
end;
$$;

revoke all on function public.start_round(uuid, integer, integer, text) from public;
grant execute on function public.start_round(uuid, integer, integer, text) to authenticated;

commit;
