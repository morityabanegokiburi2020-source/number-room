begin;

create or replace function public.enforce_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform 1 from public.rooms where id = new.room_id for update;

  select count(*) into v_count
  from public.participants
  where room_id = new.room_id;

  if tg_op = 'INSERT' or new.room_id is distinct from old.room_id then
    if v_count >= 20 and not exists (
      select 1 from public.participants
      where room_id = new.room_id and user_id = new.user_id
    ) then
      raise exception 'この部屋は定員の20人に達しています';
    end if;
  elsif new.number is not null and v_count > 20 then
    raise exception '参加人数が20人を超えています。新しい部屋を作ってください';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_room_capacity() from public;

drop trigger if exists enforce_room_capacity on public.participants;
create trigger enforce_room_capacity
before insert or update of room_id, number on public.participants
for each row execute function public.enforce_room_capacity();

commit;
