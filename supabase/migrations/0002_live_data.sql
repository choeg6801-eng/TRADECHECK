-- 실데이터 연결용: 외부 API 응답 캐시
-- 같은 회사를 여러 사용자가 조회해도 유료 API(제재 명단·신용평가)를 정해진 기간에 한 번만 부르도록 합니다.
-- 서버(service role)만 읽고 씁니다. 브라우저에서는 접근할 수 없습니다.
create table if not exists public.source_cache (
  key        text primary key,
  source     text not null,
  payload    jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists source_cache_source_idx on public.source_cache (source, fetched_at);

alter table public.source_cache enable row level security;
-- 정책을 만들지 않으므로 anon·authenticated 는 읽기·쓰기 모두 불가 (service role 은 RLS 를 우회)
revoke all on public.source_cache from anon, authenticated;
grant select, insert, update, delete on public.source_cache to service_role;

-- 오래된 캐시 정리 (선택: Supabase Cron 에서 매주 실행)
create or replace function public.purge_source_cache(p_days int default 45)
returns int language sql security definer set search_path = public as $$
  with d as (delete from public.source_cache where fetched_at < now() - make_interval(days => p_days) returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.purge_source_cache(int) from public, anon, authenticated;
grant execute on function public.purge_source_cache(int) to service_role;
