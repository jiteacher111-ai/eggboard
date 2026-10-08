-- =====================================================================
-- 에그보드 Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다(업데이트할 때도 다시 실행).
--
-- 보안 구조
--  * 교사: Supabase 이메일 계정으로 로그인. 자기 학급의 행만 읽고 쓸 수 있음(RLS).
--  * 학생: 계정 없이 개인 코드로 접속. 테이블에 직접 접근할 수 없고,
--          코드를 인자로 받는 student_* 함수로만 자기 데이터를 보고 바꿀 수 있음.
--          (잔액을 직접 바꾸는 함수는 학생에게 없음)
-- =====================================================================

create schema if not exists eggboard_private;

-- ---------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  jobs jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '{"bonus": [], "penalty": []}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  name text not null,
  number text not null default '',
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  job_id text not null default '',
  balance integer not null default 0,
  earned integer not null default 0,
  pet_species text not null default 'dragon',
  pet_name text not null default '',
  xp integer not null default 0 check (xp >= 0),
  fullness integer not null default 70,
  fed_at timestamptz not null default now(),
  petted_on date,
  acc text,
  created_at timestamptz not null default now()
);
create index if not exists students_class_idx on public.students (class_id);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  type text not null check (type in ('food', 'acc', 'coupon')),
  emoji text not null default '🎁',
  name text not null,
  price integer not null default 0 check (price >= 0),
  stock integer check (stock is null or stock >= 0),
  xp integer not null default 0 check (xp >= 0),
  food integer not null default 0 check (food >= 0),
  description text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists items_class_idx on public.items (class_id);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  type text not null,
  emoji text not null,
  name text not null,
  xp integer not null default 0,
  food integer not null default 0,
  status text not null default 'owned' check (status in ('owned', 'requested')),
  requested_at timestamptz,
  bought_at timestamptz not null default now()
);
create index if not exists inventory_class_idx on public.inventory (class_id);
create index if not exists inventory_student_idx on public.inventory (student_id);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid references public.students (id) on delete set null,
  name text not null,
  kind text not null check (kind in ('wage', 'bonus', 'penalty', 'buy', 'use')),
  amt integer not null default 0,
  xp integer not null default 0,
  note text not null default '',
  undone boolean not null default false,
  ts timestamptz not null default now()
);
create index if not exists logs_class_ts_idx on public.logs (class_id, ts desc);
create index if not exists logs_student_ts_idx on public.logs (student_id, ts desc);

-- ---------------------------------------------------------------------
-- 행 수준 보안: 교사는 자기 학급 데이터만. 학생(anon)은 정책이 없어 직접 접근 불가.
-- ---------------------------------------------------------------------

alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.items enable row level security;
alter table public.inventory enable row level security;
alter table public.logs enable row level security;

drop policy if exists "teacher owns class" on public.classes;
create policy "teacher owns class" on public.classes
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "teacher class rows" on public.students;
create policy "teacher class rows" on public.students
  for all to authenticated
  using (class_id in (select id from public.classes where owner = (select auth.uid())))
  with check (class_id in (select id from public.classes where owner = (select auth.uid())));

drop policy if exists "teacher class rows" on public.items;
create policy "teacher class rows" on public.items
  for all to authenticated
  using (class_id in (select id from public.classes where owner = (select auth.uid())))
  with check (class_id in (select id from public.classes where owner = (select auth.uid())));

drop policy if exists "teacher class rows" on public.inventory;
create policy "teacher class rows" on public.inventory
  for all to authenticated
  using (class_id in (select id from public.classes where owner = (select auth.uid())))
  with check (class_id in (select id from public.classes where owner = (select auth.uid())));

drop policy if exists "teacher class rows" on public.logs;
create policy "teacher class rows" on public.logs
  for all to authenticated
  using (class_id in (select id from public.classes where owner = (select auth.uid())))
  with check (class_id in (select id from public.classes where owner = (select auth.uid())));

-- ---------------------------------------------------------------------
-- 내부 함수 (API로 노출되지 않는 eggboard_private 스키마)
-- ---------------------------------------------------------------------

create or replace function eggboard_private.today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create or replace function eggboard_private.fullness_now(p_fullness integer, p_fed_at timestamptz) returns integer
language sql stable set search_path = '' as $$
  select greatest(0, least(100, p_fullness - floor(extract(epoch from (now() - p_fed_at)) / 86400)::integer * 15))
$$;

create or replace function eggboard_private.fail(p_message text) returns void
language plpgsql as $$
begin
  raise exception using message = p_message, errcode = 'P0001';
end;
$$;

-- 잔액 변경 + 경험치 + 기록. 실제로 반영된 금액을 돌려줌.
create or replace function eggboard_private.change_balance(p_sid uuid, p_amt integer, p_kind text, p_note text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  c public.classes;
  v_real integer := p_amt;
  v_xp integer := 0;
begin
  select * into s from public.students where id = p_sid for update;
  if not found then
    perform eggboard_private.fail('학생을 찾을 수 없어요.');
  end if;
  select * into c from public.classes where id = s.class_id;
  if not coalesce((c.settings ->> 'allowNegative')::boolean, false) and s.balance + p_amt < 0 then
    v_real := -greatest(0, s.balance);
  end if;
  if v_real > 0 and coalesce((c.settings ->> 'rewardXp')::boolean, true) then
    v_xp := v_real;
  end if;
  update public.students
     set balance = balance + v_real,
         earned = earned + greatest(v_real, 0),
         xp = xp + v_xp
   where id = s.id;
  insert into public.logs (class_id, student_id, name, kind, amt, xp, note)
  values (s.class_id, s.id, s.name, p_kind, v_real, v_xp, coalesce(nullif(p_note, ''), case when p_amt > 0 then '추가 보상' else '차감' end));
  return v_real;
end;
$$;

create or replace function eggboard_private.buy(p_sid uuid, p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  it public.items;
begin
  select * into s from public.students where id = p_sid for update;
  select * into it from public.items where id = p_item and class_id = s.class_id for update;
  if not found then
    perform eggboard_private.fail('상품을 찾을 수 없어요.');
  end if;
  if it.stock is not null and it.stock <= 0 then
    perform eggboard_private.fail('품절된 상품이에요.');
  end if;
  if s.balance < it.price then
    perform eggboard_private.fail('잔액이 부족해요.');
  end if;
  update public.students set balance = balance - it.price where id = s.id;
  if it.stock is not null then
    update public.items set stock = stock - 1 where id = it.id;
  end if;
  insert into public.inventory (class_id, student_id, item_id, type, emoji, name, xp, food)
  values (s.class_id, s.id, it.id, it.type, it.emoji, it.name, it.xp, it.food);
  insert into public.logs (class_id, student_id, name, kind, amt, note)
  values (s.class_id, s.id, s.name, 'buy', -it.price, it.emoji || ' ' || it.name);
end;
$$;

-- 가방 물건 사용. 학생이 쿠폰을 쓰면 '요청' 상태가 되고 교사가 승인해야 사용 처리된다.
create or replace function eggboard_private.use_item(p_sid uuid, p_inv uuid, p_by_teacher boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  v public.inventory;
begin
  select * into s from public.students where id = p_sid for update;
  select * into v from public.inventory where id = p_inv and student_id = p_sid for update;
  if not found then
    perform eggboard_private.fail('가방에 없는 물건이에요.');
  end if;

  if v.type = 'acc' then
    update public.students set acc = case when acc = v.emoji then null else v.emoji end where id = s.id;
    return 'acc';
  end if;

  if v.type = 'food' then
    delete from public.inventory where id = v.id;
    update public.students
       set fullness = least(100, eggboard_private.fullness_now(s.fullness, s.fed_at) + v.food),
           fed_at = now(),
           xp = xp + v.xp
     where id = s.id;
    insert into public.logs (class_id, student_id, name, kind, amt, xp, note)
    values (s.class_id, s.id, s.name, 'use', 0, v.xp, v.emoji || ' ' || v.name || ' 먹이기');
    return 'food';
  end if;

  if not p_by_teacher then
    if v.status = 'requested' then
      perform eggboard_private.fail('이미 선생님께 사용 요청을 보냈어요.');
    end if;
    update public.inventory set status = 'requested', requested_at = now() where id = v.id;
    return 'requested';
  end if;

  delete from public.inventory where id = v.id;
  insert into public.logs (class_id, student_id, name, kind, amt, note)
  values (s.class_id, s.id, s.name, 'use', 0, v.emoji || ' ' || v.name || ' 쿠폰 사용');
  return 'coupon';
end;
$$;

create or replace function eggboard_private.pet(p_sid uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
begin
  select * into s from public.students where id = p_sid for update;
  if s.petted_on = eggboard_private.today() then
    perform eggboard_private.fail('오늘은 이미 쓰다듬었어요. 내일 또 만나요!');
  end if;
  update public.students set petted_on = eggboard_private.today(), xp = xp + 2 where id = s.id;
end;
$$;

create or replace function eggboard_private.student_by_code(p_code text)
returns public.students language plpgsql stable security definer set search_path = '' as $$
declare
  s public.students;
begin
  select * into s from public.students where code = upper(trim(p_code));
  if not found then
    perform eggboard_private.fail('코드를 찾을 수 없어요. 선생님께 받은 코드를 다시 확인해 주세요.');
  end if;
  return s;
end;
$$;

create or replace function eggboard_private.assert_teacher(p_sid uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
     where s.id = p_sid and c.owner = auth.uid()
  ) then
    perform eggboard_private.fail('권한이 없어요.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 교사용 함수 (로그인한 교사만, 자기 학급 학생에게만)
-- ---------------------------------------------------------------------

create or replace function public.teacher_reward(p_ids uuid[], p_amt integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_amt = 0 then
    return;
  end if;
  foreach v_id in array p_ids loop
    perform eggboard_private.assert_teacher(v_id);
    perform eggboard_private.change_balance(v_id, p_amt, case when p_amt > 0 then 'bonus' else 'penalty' end, p_note);
  end loop;
end;
$$;

create or replace function public.teacher_pay_wage(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  s public.students;
  c public.classes;
  v_job jsonb;
  v_total integer := 0;
begin
  foreach v_id in array p_ids loop
    perform eggboard_private.assert_teacher(v_id);
    select * into s from public.students where id = v_id;
    select * into c from public.classes where id = s.class_id;
    select j into v_job from jsonb_array_elements(c.jobs) j where j ->> 'id' = s.job_id limit 1;
    v_total := v_total + eggboard_private.change_balance(
      s.id,
      coalesce((v_job ->> 'wage')::integer, (c.settings ->> 'baseWage')::integer, 10),
      'wage',
      case when v_job is null then '일급' else '일급 (' || (v_job ->> 'name') || ')' end
    );
  end loop;
  return v_total;
end;
$$;

create or replace function public.teacher_undo(p_log uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.logs;
begin
  select l2.* into l from public.logs l2 join public.classes c on c.id = l2.class_id
   where l2.id = p_log and c.owner = auth.uid() for update of l2;
  if not found or l.undone or l.kind not in ('wage', 'bonus', 'penalty') then
    perform eggboard_private.fail('되돌릴 수 없는 기록이에요.');
  end if;
  update public.students
     set balance = balance - l.amt,
         earned = greatest(0, earned - greatest(l.amt, 0)),
         xp = greatest(0, xp - l.xp)
   where id = l.student_id;
  update public.logs set undone = true where id = l.id;
end;
$$;

create or replace function public.teacher_set_balance(p_sid uuid, p_value integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
begin
  perform eggboard_private.assert_teacher(p_sid);
  select * into s from public.students where id = p_sid for update;
  if s.balance = p_value then
    return;
  end if;
  update public.students set balance = p_value where id = s.id;
  insert into public.logs (class_id, student_id, name, kind, amt, note)
  values (s.class_id, s.id, s.name, case when p_value > s.balance then 'bonus' else 'penalty' end, p_value - s.balance, '교사 직접 수정');
end;
$$;

create or replace function public.teacher_buy(p_sid uuid, p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform eggboard_private.assert_teacher(p_sid);
  perform eggboard_private.buy(p_sid, p_item);
end;
$$;

create or replace function public.teacher_use(p_sid uuid, p_inv uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  perform eggboard_private.assert_teacher(p_sid);
  return eggboard_private.use_item(p_sid, p_inv, true);
end;
$$;

create or replace function public.teacher_pet(p_sid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform eggboard_private.assert_teacher(p_sid);
  perform eggboard_private.pet(p_sid);
end;
$$;

-- 학생의 쿠폰 사용 요청 승인(사용 처리) 또는 거절(가방으로 돌려줌)
create or replace function public.teacher_resolve_coupon(p_inv uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.inventory;
begin
  select * into v from public.inventory where id = p_inv;
  if not found then
    perform eggboard_private.fail('요청을 찾을 수 없어요.');
  end if;
  perform eggboard_private.assert_teacher(v.student_id);
  if p_approve then
    perform eggboard_private.use_item(v.student_id, v.id, true);
  else
    update public.inventory set status = 'owned', requested_at = null where id = v.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 학생용 함수 (개인 코드로 접속)
-- ---------------------------------------------------------------------

create or replace function public.student_login(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.students;
  c public.classes;
begin
  s := eggboard_private.student_by_code(p_code);
  select * into c from public.classes where id = s.class_id;
  return jsonb_build_object(
    'me', to_jsonb(s),
    'today', eggboard_private.today(),
    'paid_today', exists (
      select 1 from public.logs
       where student_id = s.id and kind = 'wage' and not undone
         and (ts at time zone 'Asia/Seoul')::date = eggboard_private.today()
    ),
    'settings', c.settings,
    'jobs', c.jobs,
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.sort, i.created_at), '[]'::jsonb)
                from public.items i where i.class_id = c.id),
    'inventory', (select coalesce(jsonb_agg(to_jsonb(v) order by v.bought_at), '[]'::jsonb)
                    from public.inventory v where v.student_id = s.id),
    'logs', (select coalesce(jsonb_agg(to_jsonb(l) order by l.ts desc), '[]'::jsonb)
               from (select * from public.logs where student_id = s.id order by ts desc limit 50) l),
    -- 반 친구들의 펫(잔액은 공개하지 않음)
    'classmates', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', m.id, 'name', m.name, 'number', m.number, 'pet_species', m.pet_species,
                      'pet_name', m.pet_name, 'xp', m.xp, 'fullness', m.fullness, 'fed_at', m.fed_at, 'acc', m.acc)), '[]'::jsonb)
                     from public.students m where m.class_id = c.id)
  );
end;
$$;

create or replace function public.student_buy(p_code text, p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
  c public.classes;
begin
  s := eggboard_private.student_by_code(p_code);
  select * into c from public.classes where id = s.class_id;
  if not coalesce((c.settings ->> 'marketOpen')::boolean, true) then
    perform eggboard_private.fail('지금은 마켓이 닫혀 있어요.');
  end if;
  perform eggboard_private.buy(s.id, p_item);
end;
$$;

create or replace function public.student_use(p_code text, p_inv uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
begin
  s := eggboard_private.student_by_code(p_code);
  return eggboard_private.use_item(s.id, p_inv, false);
end;
$$;

create or replace function public.student_cancel_request(p_code text, p_inv uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
begin
  s := eggboard_private.student_by_code(p_code);
  update public.inventory set status = 'owned', requested_at = null where id = p_inv and student_id = s.id;
end;
$$;

create or replace function public.student_pet(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
begin
  s := eggboard_private.student_by_code(p_code);
  perform eggboard_private.pet(s.id);
end;
$$;

create or replace function public.student_rename_pet(p_code text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.students;
begin
  s := eggboard_private.student_by_code(p_code);
  update public.students set pet_name = left(trim(coalesce(p_name, '')), 12) where id = s.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 실행 권한
-- ---------------------------------------------------------------------

revoke all on schema eggboard_private from public, anon, authenticated;
revoke execute on all functions in schema eggboard_private from public, anon, authenticated;

revoke execute on function public.teacher_reward(uuid[], integer, text) from public, anon;
revoke execute on function public.teacher_pay_wage(uuid[]) from public, anon;
revoke execute on function public.teacher_undo(uuid) from public, anon;
revoke execute on function public.teacher_set_balance(uuid, integer) from public, anon;
revoke execute on function public.teacher_buy(uuid, uuid) from public, anon;
revoke execute on function public.teacher_use(uuid, uuid) from public, anon;
revoke execute on function public.teacher_pet(uuid) from public, anon;
revoke execute on function public.teacher_resolve_coupon(uuid, boolean) from public, anon;
grant execute on function public.teacher_reward(uuid[], integer, text) to authenticated;
grant execute on function public.teacher_pay_wage(uuid[]) to authenticated;
grant execute on function public.teacher_undo(uuid) to authenticated;
grant execute on function public.teacher_set_balance(uuid, integer) to authenticated;
grant execute on function public.teacher_buy(uuid, uuid) to authenticated;
grant execute on function public.teacher_use(uuid, uuid) to authenticated;
grant execute on function public.teacher_pet(uuid) to authenticated;
grant execute on function public.teacher_resolve_coupon(uuid, boolean) to authenticated;

grant execute on function public.student_login(text) to anon, authenticated;
grant execute on function public.student_buy(text, uuid) to anon, authenticated;
grant execute on function public.student_use(text, uuid) to anon, authenticated;
grant execute on function public.student_cancel_request(text, uuid) to anon, authenticated;
grant execute on function public.student_pet(text) to anon, authenticated;
grant execute on function public.student_rename_pet(text, text) to anon, authenticated;
