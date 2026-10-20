-- Trade Checker 초기 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run 하면 됩니다.
-- 쓰기는 모두 서버(api/*)가 service role 키로 합니다. 브라우저는 자기 데이터 읽기만 가능합니다(RLS).

create extension if not exists pgcrypto;

-- 1. 회원 프로필 · 요금제 · 조회 한도
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free', 'starter', 'team')),
  plan_expires_at timestamptz,
  credits integer not null default 3 check (credits >= 0),      -- 가입 무료 3건 + 단건 구매분
  period_start date not null default current_date,               -- 구독 조회 한도의 30일 주기 시작일
  period_used integer not null default 0 check (period_used >= 0),
  created_at timestamptz not null default now()
);

-- 2. 조회 리포트
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text,
  company_id text not null,
  company_name text not null,
  country text,
  grade text not null check (grade in ('A', 'B', 'C', 'D', 'F')),
  risk_points integer,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists reports_user_created_idx on public.reports (user_id, created_at desc);

-- 3. 관심 거래처 (등급 변동 모니터링)
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id text not null,
  company_name text not null,
  country text,
  last_grade text,
  prev_grade text,
  last_report_id uuid references public.reports(id) on delete set null,
  checked_at timestamptz,
  changed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);

-- 4. 결제 주문 (토스페이먼츠)
create table if not exists public.orders (
  id text primary key,                       -- 토스 orderId
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  amount integer not null check (amount > 0),
  status text not null default 'ready' check (status in ('ready', 'paid', 'failed', 'canceled')),
  payment_key text,
  method text,
  error text,
  raw jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

-- RLS: 본인 데이터 읽기만 허용
alter table public.profiles enable row level security;
alter table public.reports enable row level security;
alter table public.watchlist enable row level security;
alter table public.orders enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own reports" on public.reports;
create policy "own reports" on public.reports for select using (auth.uid() = user_id);
drop policy if exists "own watchlist" on public.watchlist;
create policy "own watchlist" on public.watchlist for select using (auth.uid() = user_id);
drop policy if exists "own orders" on public.orders;
create policy "own orders" on public.orders for select using (auth.uid() = user_id);

-- 가입하면 프로필 자동 생성 (무료 3건)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 조회 1건 차감: 구독 한도 → 단건 크레딧 순서. 동시 요청에도 안전하도록 행 잠금.
create or replace function public.consume_search(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  v_plan text;
  v_quota int;
begin
  select * into p from public.profiles where id = p_user for update;
  if not found then
    insert into public.profiles (id) values (p_user) returning * into p;
  end if;

  v_plan := case when p.plan <> 'free' and p.plan_expires_at > now() then p.plan else 'free' end;
  v_quota := case v_plan when 'starter' then 20 when 'team' then 150 else 0 end;

  if v_quota > 0 and p.period_start <= current_date - 30 then
    update public.profiles set period_start = current_date, period_used = 0 where id = p_user;
    p.period_used := 0;
  end if;

  if v_quota > 0 and p.period_used < v_quota then
    update public.profiles set period_used = period_used + 1 where id = p_user;
    return jsonb_build_object('ok', true, 'source', 'plan', 'plan', v_plan, 'remaining', v_quota - p.period_used - 1, 'credits', p.credits);
  end if;

  if p.credits > 0 then
    update public.profiles set credits = credits - 1 where id = p_user;
    return jsonb_build_object('ok', true, 'source', 'credit', 'plan', v_plan, 'remaining', greatest(v_quota - p.period_used, 0), 'credits', p.credits - 1);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'quota', 'plan', v_plan);
end $$;

-- 조회 실패 시 차감 되돌리기
create or replace function public.refund_search(p_user uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_source = 'plan' then
    update public.profiles set period_used = greatest(period_used - 1, 0) where id = p_user;
  elsif p_source = 'credit' then
    update public.profiles set credits = credits + 1 where id = p_user;
  end if;
end $$;

-- 결제 승인 반영: 주문을 paid 로 바꾸고 요금제 기간 또는 크레딧을 적용. 같은 주문은 한 번만 적용.
create or replace function public.apply_paid_order(
  p_order_id text, p_payment_key text, p_method text, p_raw jsonb,
  p_kind text, p_plan text, p_days int, p_credits int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  p public.profiles;
  v_base timestamptz;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_order');
  end if;
  if o.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  update public.orders
     set status = 'paid', payment_key = p_payment_key, method = p_method, raw = p_raw, approved_at = now(), error = null
   where id = p_order_id;

  select * into p from public.profiles where id = o.user_id for update;

  if p_kind = 'credit' then
    update public.profiles set credits = credits + coalesce(p_credits, 1) where id = o.user_id;
  elsif p_kind = 'plan' then
    if p.plan = p_plan and p.plan_expires_at > now() then
      v_base := p.plan_expires_at;                       -- 같은 요금제 연장
      update public.profiles set plan_expires_at = v_base + make_interval(days => p_days) where id = o.user_id;
    else
      update public.profiles                              -- 새 요금제 시작 (한도 초기화)
         set plan = p_plan, plan_expires_at = now() + make_interval(days => p_days), period_start = current_date, period_used = 0
       where id = o.user_id;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Team 무료 체험 (계정당 1회)
alter table public.profiles add column if not exists trial_used boolean not null default false;

create or replace function public.start_team_trial(p_user uuid, p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  v_exp timestamptz;
begin
  select * into p from public.profiles where id = p_user for update;
  if not found then
    insert into public.profiles (id) values (p_user) returning * into p;
  end if;
  if p.trial_used then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if p.plan <> 'free' and p.plan_expires_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'paid');
  end if;
  v_exp := now() + make_interval(days => p_days);
  update public.profiles
     set plan = 'team', plan_expires_at = v_exp, period_start = current_date, period_used = 0, trial_used = true
   where id = p_user;
  return jsonb_build_object('ok', true, 'expires_at', v_exp);
end $$;

-- 관심 거래처 알림 대상 (Team 요금제 사용자)
create or replace function public.watchlist_for_alerts(p_limit int default 200)
returns setof public.watchlist language sql security definer set search_path = public as $$
  select w.* from public.watchlist w
  join public.profiles p on p.id = w.user_id
  where p.plan = 'team' and p.plan_expires_at > now()
  order by w.checked_at nulls first
  limit p_limit;
$$;

-- 함수는 서버(service_role)만 실행할 수 있게 막기
revoke all on function public.consume_search(uuid) from public, anon, authenticated;
revoke all on function public.refund_search(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_paid_order(text, text, text, jsonb, text, text, int, int) from public, anon, authenticated;
revoke all on function public.watchlist_for_alerts(int) from public, anon, authenticated;
revoke all on function public.start_team_trial(uuid, int) from public, anon, authenticated;
grant execute on function public.start_team_trial(uuid, int) to service_role;
grant execute on function public.consume_search(uuid) to service_role;
grant execute on function public.refund_search(uuid, text) to service_role;
grant execute on function public.apply_paid_order(text, text, text, jsonb, text, text, int, int) to service_role;
grant execute on function public.watchlist_for_alerts(int) to service_role;
