#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# portal_smoke_test.sh
#
# End-to-end smoke test for the AEOAdmin customer-portal API.
# Auth lives at /api/auth/* (shared with admin); customer-scoped data lives
# at /api/portal/*. Exercises register-customer → auth/me → business →
# dashboard → keyword + link CRUD → analyze → reports → gbp → websites →
# cleanup → logout.
#
# Usage:
#   ./portal_smoke_test.sh                                # uses default base URL
#   BASE_URL=http://localhost:3000 ./portal_smoke_test.sh # explicit base URL
#   BASE_URL=https://staging.example.com ./portal_smoke_test.sh
#
# Requirements: bash, curl, jq
# Exits 1 on the first non-2xx step. Prints a summary on success.
#
# Re-run safe: generates a unique test email each run.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH="${BASE_URL}/api/auth"
PORTAL="${BASE_URL}/api/portal"

# Per-run unique identifiers
TS="$(date +%s)"
TEST_EMAIL="portal-test-${TS}@example.com"
TEST_PASSWORD="testpass123"
TEST_NAME="Test User"

# Cookie jar — single jar shared across all requests so the connect.sid
# session cookie persists across steps.
JAR="$(mktemp -t portal_smoke_jar.XXXXXX)"

# Track number of steps that have passed (for the final summary).
STEP_COUNT=0

# Ensure we clean up the cookie jar on any exit.
cleanup() {
  rm -f "$JAR"
}
trap cleanup EXIT

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Print a short preview (max 400 chars) of a JSON or text body.
preview() {
  local body="$1"
  if [ -z "$body" ]; then
    echo "(empty body)"
    return
  fi
  # Try to pretty-print compactly with jq; fall back to raw on failure.
  local compact
  if compact="$(printf '%s' "$body" | jq -c . 2>/dev/null)"; then
    if [ "${#compact}" -gt 400 ]; then
      echo "${compact:0:400}…"
    else
      echo "$compact"
    fi
  else
    if [ "${#body}" -gt 400 ]; then
      echo "${body:0:400}…"
    else
      echo "$body"
    fi
  fi
}

# Pick the right base URL: auth steps target /api/auth, data steps /api/portal.
url_for() {
  local path="$1"
  case "$path" in
    /auth/*) printf '%s%s' "$AUTH" "${path#/auth}" ;;
    *)       printf '%s%s' "$PORTAL" "$path" ;;
  esac
}

# step <name> <method> <path> [json-body]
# Sends the request, splits body/status, prints them, fails on non-2xx.
# After a successful call, exposes the response body in the global $BODY and the
# status code in $STATUS for assertion logic in the caller.
BODY=""
STATUS=""
step() {
  local name="$1"
  local method="$2"
  local path="$3"
  local data="${4:-}"
  local target
  target="$(url_for "$path")"

  echo ""
  echo "──▶ Step $((STEP_COUNT + 1)): ${name}"
  echo "    ${method} ${path}"

  local raw
  if [ -n "$data" ]; then
    raw="$(curl -sS -X "$method" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -c "$JAR" -b "$JAR" \
      -w $'\n%{http_code}' \
      --data "$data" \
      "$target")"
  else
    raw="$(curl -sS -X "$method" \
      -H "Accept: application/json" \
      -c "$JAR" -b "$JAR" \
      -w $'\n%{http_code}' \
      "$target")"
  fi

  # Last line is status, everything before is body.
  STATUS="$(printf '%s' "$raw" | tail -n1)"
  BODY="$(printf '%s' "$raw" | sed '$d')"

  echo "    status: ${STATUS}"
  echo "    body:   $(preview "$BODY")"

  if [[ ! "$STATUS" =~ ^2[0-9][0-9]$ ]]; then
    echo ""
    echo "✗ FAIL: step '${name}' returned HTTP ${STATUS} (expected 2xx)" >&2
    exit 1
  fi

  STEP_COUNT=$((STEP_COUNT + 1))
}

# step_expect_status <name> <method> <path> <expected-status> [json-body]
# Like step(), but asserts an exact status code (used for the final 401 check
# and the 204 deletes). Does not fail the script on a 4xx if it matches expected.
step_expect_status() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected="$4"
  local data="${5:-}"
  local target
  target="$(url_for "$path")"

  echo ""
  echo "──▶ Step $((STEP_COUNT + 1)): ${name}"
  echo "    ${method} ${path}  (expect ${expected})"

  local raw
  if [ -n "$data" ]; then
    raw="$(curl -sS -X "$method" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      -c "$JAR" -b "$JAR" \
      -w $'\n%{http_code}' \
      --data "$data" \
      "$target")"
  else
    raw="$(curl -sS -X "$method" \
      -H "Accept: application/json" \
      -c "$JAR" -b "$JAR" \
      -w $'\n%{http_code}' \
      "$target")"
  fi

  STATUS="$(printf '%s' "$raw" | tail -n1)"
  BODY="$(printf '%s' "$raw" | sed '$d')"

  echo "    status: ${STATUS}"
  echo "    body:   $(preview "$BODY")"

  if [ "$STATUS" != "$expected" ]; then
    echo ""
    echo "✗ FAIL: step '${name}' returned HTTP ${STATUS} (expected ${expected})" >&2
    exit 1
  fi

  STEP_COUNT=$((STEP_COUNT + 1))
}

# assert <description> <jq-filter-returning-true-or-false> [body]
# Fails the script if the jq filter doesn't return `true`. Defaults to $BODY.
assert() {
  local desc="$1"
  local filter="$2"
  local body="${3:-$BODY}"

  local result
  if ! result="$(printf '%s' "$body" | jq -er "$filter" 2>/dev/null)"; then
    echo "✗ FAIL assertion: ${desc}" >&2
    echo "    filter: ${filter}" >&2
    echo "    body:   $(preview "$body")" >&2
    exit 1
  fi
  if [ "$result" != "true" ]; then
    echo "✗ FAIL assertion: ${desc} (filter returned: ${result})" >&2
    echo "    filter: ${filter}" >&2
    echo "    body:   $(preview "$body")" >&2
    exit 1
  fi
  echo "    ✓ ${desc}"
}

# ─── Banner ─────────────────────────────────────────────────────────────────

echo "════════════════════════════════════════════════════════════════════════"
echo " AEOAdmin customer-portal smoke test"
echo " base url:    ${BASE_URL}"
echo " test email:  ${TEST_EMAIL}"
echo " cookie jar:  ${JAR}"
echo "════════════════════════════════════════════════════════════════════════"

# ─── a) Register ────────────────────────────────────────────────────────────

step "register new customer" \
  POST "/auth/register-customer" \
  "$(jq -n --arg email "$TEST_EMAIL" --arg password "$TEST_PASSWORD" --arg name "$TEST_NAME" \
        '{email: $email, password: $password, name: $name}')"
assert "role is customer" '.role == "customer"'

# ─── b) auth/me — logged in ─────────────────────────────────────────────────

step "auth/me after register" GET "/auth/me"
assert "email matches registered email" \
  ".email == \"${TEST_EMAIL}\""
assert "role is customer" '.role == "customer"'

# ─── c) businesses/me — auto-created ────────────────────────────────────────

step "businesses/me (auto-created on register)" GET "/businesses/me"
assert "businessName contains 'Test User'" \
  '(.businessName // "") | contains("Test User")'

# ─── d) dashboard summary ───────────────────────────────────────────────────

step "businesses/me/dashboard" GET "/businesses/me/dashboard"
assert "DashboardSummary has totalKeywords field" 'has("totalKeywords")'
assert "DashboardSummary has activeKeywords field" 'has("activeKeywords")'
assert "DashboardSummary has visibilityScore field" 'has("visibilityScore")'
assert "DashboardSummary has onboardingComplete field" 'has("onboardingComplete")'

# ─── e) PATCH business name ─────────────────────────────────────────────────

step "PATCH businesses/me — update businessName" \
  PATCH "/businesses/me" \
  '{"businessName": "Updated Biz Name"}'
assert "businessName updated to 'Updated Biz Name'" \
  '.businessName == "Updated Biz Name"'

# ─── f) Create keyword ──────────────────────────────────────────────────────

step "POST businesses/me/keywords — create keyword" \
  POST "/businesses/me/keywords" \
  '{"keyword": "best coffee shop in SF", "status": "active"}'
assert "response has integer id" '(.id | type) == "number"'
KW_ID="$(printf '%s' "$BODY" | jq -r '.id')"
echo "    captured keyword id: ${KW_ID}"

# ─── g) List keywords — contains new keyword ────────────────────────────────

step "GET businesses/me/keywords — list" GET "/businesses/me/keywords"
assert "response is an array" 'type == "array"'
assert "keyword list contains 'best coffee shop in SF'" \
  '[.[] | .keyword] | index("best coffee shop in SF") != null'

# ─── h) PATCH keyword — set notes ───────────────────────────────────────────

step "PATCH businesses/me/keywords/\$ID — set notes" \
  PATCH "/businesses/me/keywords/${KW_ID}" \
  '{"notes": "test note"}'
assert "notes == 'test note'" '.notes == "test note"'

# ─── i) Create link ─────────────────────────────────────────────────────────

step "POST businesses/me/keywords/\$ID/links — create link" \
  POST "/businesses/me/keywords/${KW_ID}/links" \
  '{"url": "https://example.com/menu", "linkType": "website"}'
assert "response has integer id" '(.id | type) == "number"'
LINK_ID="$(printf '%s' "$BODY" | jq -r '.id')"
echo "    captured link id: ${LINK_ID}"

# ─── j) List links — contains new link ──────────────────────────────────────

step "GET businesses/me/keywords/\$ID/links" GET "/businesses/me/keywords/${KW_ID}/links"
assert "response is an array" 'type == "array"'
assert "link list contains 'https://example.com/menu'" \
  '[.[] | .url] | index("https://example.com/menu") != null'

# ─── k) Analyze link ────────────────────────────────────────────────────────

step "POST businesses/me/keywords/links/\$LINK_ID/analyze" \
  POST "/businesses/me/keywords/links/${LINK_ID}/analyze"
assert "analyze response has aiEfficiencyPercent field" 'has("aiEfficiencyPercent")'

# ─── l) Reports list ────────────────────────────────────────────────────────

step "GET businesses/me/reports" GET "/businesses/me/reports"
assert "reports response is an array" 'type == "array"'

# ─── m) GBP list ────────────────────────────────────────────────────────────

step "GET businesses/me/gbp" GET "/businesses/me/gbp"
assert "gbp response is an array" 'type == "array"'

# ─── n) Websites list ───────────────────────────────────────────────────────

step "GET businesses/me/websites" GET "/businesses/me/websites"
assert "websites response is an array" 'type == "array"'

# ─── o) DELETE link (204) ───────────────────────────────────────────────────

step_expect_status "DELETE link" \
  DELETE "/businesses/me/keywords/links/${LINK_ID}" \
  "204"

# ─── p) DELETE keyword (204) ────────────────────────────────────────────────

step_expect_status "DELETE keyword" \
  DELETE "/businesses/me/keywords/${KW_ID}" \
  "204"

# ─── q) Verify keyword removed ──────────────────────────────────────────────

step "GET businesses/me/keywords — after delete" GET "/businesses/me/keywords"
assert "response is an array" 'type == "array"'
assert "deleted keyword no longer present" \
  '[.[] | .keyword] | index("best coffee shop in SF") == null'

# ─── r) Logout ──────────────────────────────────────────────────────────────

step "POST auth/logout" POST "/auth/logout"

# ─── s) auth/me after logout → 401 ──────────────────────────────────────────

step_expect_status "auth/me after logout (should be 401)" \
  GET "/auth/me" \
  "401"

# ─── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════════"
echo " All ${STEP_COUNT} steps passed"
echo "════════════════════════════════════════════════════════════════════════"
