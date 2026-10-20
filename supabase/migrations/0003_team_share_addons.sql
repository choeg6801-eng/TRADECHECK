-- Team 좌석(최대 5명) · 리포트 공유 링크 · 추가 조회 묶음 · 등급 변동 알림 대상
-- 0001, 0002 다음에 SQL Editor 에서 실행하세요. 여러 번 실행해도 안전합니다.

-- 1. 팀: 멤버는 profiles.team_owner 로 팀 소유자(Team 요금제 결제자)를 가리킵니다.
alter table public.profiles add column if not exists team_owner uuid references public.profiles(id) on delete set null;
create index if not exists profiles_team_owner_idx on public.profiles (team_owner);

create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists team_invites_owner_email_idx on public.team_invites (owner_id, lower(email));
alter table public.team_invites enable row level security;
revoke all on public.team_invites from anon, authenticated;
grant select, insert, update, delete on public.team_invites to service_role;

-- 팀 소유자 포함 최대 좌석 (Team 요금제 = 5명)
create or replace function public.team_seat_limit() returns int language sql immutable as $$ select 5 $$;

-- 조회 한도를 누구 것으로 쓸지: 활성 Team 요금제 소유자의 멤버면 소유자, 아니면 본인
create or replace function public.payer_of(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case when me.team_owner is not null and o.plan = 'team' and o.plan_expires_at > now() then me.team_owner else me.id end
    from public.profiles me left join public.profiles o on o.id = me.team_owner
   where me.id = p_user;
$$;

-- 2. 조회 1건 차감 (팀 반영): 소유자의 구독 한도 → 본인 크레딧 → 소유자 크레딧
create or replace function public.consume_search(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  p public.profiles;
  v_payer uuid;
  v_plan text;
  v_quota int;
begin
  select * into me from public.profiles where id = p_user for update;
  if not found then
    insert into public.profiles (id) values (p_user) returning * into me;
  end if;
  v_payer := coalesce(public.payer_of(p_user), p_user);
  if v_payer = p_user then p := me;
  else select * into p from public.profiles where id = v_payer for update;
  end if;

  v_plan := case when p.plan <> 'free' and p.plan_expires_at > now() then p.plan else 'free' end;
  v_quota := case v_plan when 'starter' then 20 when 'team' then 150 else 0 end;

  if v_quota > 0 and p.period_start <= current_date - 30 then
    update public.profiles set period_start = current_date, period_used = 0 where id = v_payer;
    p.period_used := 0;
  end if;

  if v_quota > 0 and p.period_used < v_quota then
    update public.profiles set period_used = period_used + 1 where id = v_payer;
    return jsonb_build_object('ok', true, 'source', 'plan', 'plan', v_plan, 'remaining', v_quota - p.period_used - 1, 'credits', me.credits);
  end if;

  if me.credits > 0 then
    update public.profiles set credits = credits - 1 where id = p_user;
    return jsonb_build_object('ok', true, 'source', 'credit', 'plan', v_plan, 'remaining', greatest(v_quota - p.period_used, 0), 'credits', me.credits - 1);
  end if;

  if v_payer <> p_user and p.credits > 0 then
    update public.profiles set credits = credits - 1 where id = v_payer;
    return jsonb_build_object('ok', true, 'source', 'owner_credit', 'plan', v_plan, 'remaining', 0, 'credits', 0);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'quota', 'plan', v_plan);
end $$;

create or replace function public.refund_search(p_user uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare v_payer uuid := coalesce(public.payer_of(p_user), p_user);
begin
  if p_source = 'plan' then
    update public.profiles set period_used = greatest(period_used - 1, 0) where id = v_payer;
  elsif p_source = 'credit' then
    update public.profiles set credits = credits + 1 where id = p_user;
  elsif p_source = 'owner_credit' then
    update public.profiles set credits = credits + 1 where id = v_payer;
  end if;
end $$;

-- 3. 팀 초대 · 수락 · 내보내기
create or replace function public.invite_team_member(p_owner uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.profiles;
  v_email text := lower(trim(p_email));
  v_used int;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'reason', 'email'); end if;
  select * into o from public.profiles where id = p_owner for update;
  if not found or o.plan <> 'team' or o.plan_expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'plan'); end if;
  if o.team_owner is not null then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if lower(o.email) = v_email then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.team_invites where owner_id = p_owner and lower(email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'exists');
  end if;
  select count(*) into v_used from (
    select id from public.profiles where team_owner = p_owner
    union all
    select id from public.team_invites where owner_id = p_owner and accepted_at is null
  ) s;
  if v_used >= public.team_seat_limit() - 1 then return jsonb_build_object('ok', false, 'reason', 'seats'); end if;

  -- 초대만 남깁니다. 합류는 초대받은 사람이 직접 '수락'해야 합니다 (동의 없이 기록이 공유되지 않도록).
  insert into public.team_invites (owner_id, email) values (p_owner, v_email);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.accept_team_invite(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  inv public.team_invites;
begin
  select * into me from public.profiles where id = p_user for update;
  if not found or me.email is null then return jsonb_build_object('ok', false, 'reason', 'no_profile'); end if;
  -- 이메일 인증을 마친 계정만 초대를 받을 수 있음 (남의 이메일로 가입해 초대를 가로채지 못하게)
  if not exists (select 1 from auth.users u where u.id = p_user and u.email_confirmed_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'unconfirmed');
  end if;
  if me.team_owner is not null then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if exists (select 1 from public.profiles where team_owner = p_user) then return jsonb_build_object('ok', false, 'reason', 'owner'); end if;
  select i.* into inv from public.team_invites i join public.profiles o on o.id = i.owner_id
   where lower(i.email) = lower(me.email) and i.accepted_at is null and i.owner_id <> p_user
     and o.plan = 'team' and o.plan_expires_at > now() and o.team_owner is null
   order by i.created_at limit 1 for update of i;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_invite'); end if;
  update public.profiles set team_owner = inv.owner_id where id = p_user;
  update public.team_invites set accepted_at = now(), accepted_by = p_user where id = inv.id;
  return jsonb_build_object('ok', true, 'owner', inv.owner_id);
end $$;

-- 소유자가 멤버·초대를 지우거나, 멤버가 스스로 나가기
create or replace function public.remove_team_member(p_actor uuid, p_member uuid, p_invite uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_member is not null then
    if p_member <> p_actor and not exists (select 1 from public.profiles where id = p_member and team_owner = p_actor) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    update public.profiles set team_owner = null where id = p_member and team_owner is not null;
    delete from public.team_invites where accepted_by = p_member;
  end if;
  if p_invite is not null then
    delete from public.team_invites where id = p_invite and owner_id = p_actor;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 가입하면 프로필 생성 (팀 초대는 로그인 후 화면에서 직접 수락)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

-- 4. 팀 리포트 열람: Team 요금제가 유효한 동안 같은 팀이면 서로의 조회 기록을 볼 수 있음
--    (서버 API가 같은 규칙을 쓰고, 브라우저가 직접 조회할 때는 아래 RLS 정책이 적용됨)
create or replace function public.team_root(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when me.team_owner is not null and o.plan = 'team' and o.plan_expires_at > now() then me.team_owner
    else me.id end
  from public.profiles me left join public.profiles o on o.id = me.team_owner
  where me.id = p_user;
$$;
-- 로그인한 사람 기준으로 '상대가 내 팀원인가'만 알려 줌 (다른 사람의 팀 구조는 노출하지 않음)
create or replace function public.is_teammate(p_other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p_other is not null
     and public.team_root(auth.uid()) = public.team_root(p_other)
     and exists (select 1 from public.profiles r where r.id = public.team_root(auth.uid()) and r.plan = 'team' and r.plan_expires_at > now());
$$;
drop policy if exists "own reports" on public.reports;
drop policy if exists "team reports" on public.reports;
create policy "team reports" on public.reports for select
  using (auth.uid() = user_id or public.is_teammate(user_id));

-- 5. 리포트 공유 링크 (로그인 없이 읽기 전용, 기한 있음)
alter table public.reports add column if not exists share_token text;
alter table public.reports add column if not exists share_expires_at timestamptz;
create unique index if not exists reports_share_token_idx on public.reports (share_token) where share_token is not null;

-- 6. 등급 변동 알림 대상: Team 요금제(소유자·멤버)의 관심 거래처 + 받는 사람 이메일
create or replace function public.watchlist_due(p_limit int default 200)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'checked_at' nulls first), '[]'::jsonb) from (
    select to_jsonb(w) || jsonb_build_object('email', p.email) as x
      from public.watchlist w
      join public.profiles p on p.id = w.user_id
      left join public.profiles o on o.id = p.team_owner
     where (p.plan = 'team' and p.plan_expires_at > now())
        or (o.plan = 'team' and o.plan_expires_at > now())
     order by w.checked_at nulls first
     limit p_limit
  ) s;
$$;

-- 함수 권한: 서버(service_role)만
do $$
declare f text;
begin
  foreach f in array array[
    'public.payer_of(uuid)', 'public.consume_search(uuid)', 'public.refund_search(uuid, text)',
    'public.invite_team_member(uuid, text)', 'public.accept_team_invite(uuid)', 'public.remove_team_member(uuid, uuid, uuid)',
    'public.watchlist_due(int)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function public.team_root(uuid) from public, anon, authenticated;
grant execute on function public.team_root(uuid) to service_role;
-- is_teammate 는 RLS 정책 안에서 쓰이므로 로그인 사용자에게 실행 권한이 필요합니다 (참/거짓만 돌려줌).
revoke all on function public.is_teammate(uuid) from public, anon;
grant execute on function public.is_teammate(uuid) to authenticated, service_role;

-- 7. 결제: 가상계좌 등 입금 대기 상태 + 관심 거래처 재평가 오류 기록
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('ready', 'waiting', 'paid', 'failed', 'canceled'));
alter table public.watchlist add column if not exists last_error text;

-- 8. 요금제 변경 시 남은 기간 환산: Starter ↔ Team 으로 바꿔도 결제한 남은 기간이 사라지지 않도록
--    남은 일수 × (기존 월 요금 ÷ 새 월 요금) 만큼 새 요금제 기간에 더합니다. (무료 체험 기간은 환산하지 않음)
--    월 요금(공급가)은 lib/products.js 와 맞춰 두세요.
create or replace function public.plan_monthly_price(p_plan text) returns numeric language sql immutable as $$
  select case p_plan when 'starter' then 49000 when 'team' then 199000 else 0 end::numeric
$$;

create or replace function public.apply_paid_order(
  p_order_id text, p_payment_key text, p_method text, p_raw jsonb,
  p_kind text, p_plan text, p_days int, p_credits int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  p public.profiles;
  v_bonus int := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_order'); end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;

  update public.orders
     set status = 'paid', payment_key = p_payment_key, method = p_method, raw = p_raw, approved_at = now(), error = null
   where id = p_order_id;

  select * into p from public.profiles where id = o.user_id for update;

  if p_kind = 'credit' then
    update public.profiles set credits = credits + coalesce(p_credits, 1) where id = o.user_id;
  elsif p_kind = 'plan' then
    if p.plan = p_plan and p.plan_expires_at > now() then
      update public.profiles set plan_expires_at = p.plan_expires_at + make_interval(days => p_days) where id = o.user_id;
    else
      if p.plan <> 'free' and p.plan_expires_at > now() and public.plan_monthly_price(p_plan) > 0
         and exists (select 1 from public.orders x where x.user_id = o.user_id and x.status = 'paid' and x.id <> p_order_id and x.product_id like p.plan || '%') then
        v_bonus := floor(extract(epoch from (p.plan_expires_at - now())) / 86400 * public.plan_monthly_price(p.plan) / public.plan_monthly_price(p_plan));
      end if;
      update public.profiles
         set plan = p_plan, plan_expires_at = now() + make_interval(days => p_days + v_bonus), period_start = current_date, period_used = 0
       where id = o.user_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'bonusDays', v_bonus);
end $$;
revoke all on function public.apply_paid_order(text, text, text, jsonb, text, text, int, int) from public, anon, authenticated;
grant execute on function public.apply_paid_order(text, text, text, jsonb, text, text, int, int) to service_role;
