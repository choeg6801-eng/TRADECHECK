#!/usr/bin/env bash
# 실서비스 모드 통합 테스트: 로컬 Postgres + 가짜 Supabase/토스 + dev-server
set -e
cd "$(dirname "$0")/.."
node tests/mock-services.mjs > /tmp/tc-mock.log 2>&1 &
MOCK=$!
SUPABASE_URL=http://127.0.0.1:54400 SUPABASE_ANON_KEY=test-anon-key SUPABASE_SERVICE_ROLE_KEY=test-service-key \
TOSS_CLIENT_KEY=test_gck_mock TOSS_SECRET_KEY=test_gsk_mock TOSS_API_BASE=http://127.0.0.1:54401 CRON_SECRET=test-cron \
PORT=3100 node dev-server.mjs > /tmp/tc-dev.log 2>&1 &
DEV=$!
trap 'kill $MOCK $DEV 2>/dev/null' EXIT
sleep 1.5
node tests/api.test.mjs
