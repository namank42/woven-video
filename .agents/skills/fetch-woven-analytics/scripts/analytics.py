#!/usr/bin/env python3
"""Fetch + summarize Woven product analytics from the prod Supabase DB.

Read-only. Talks to the hosted Supabase project via the PostgREST REST API and
the GoTrue auth-admin API using the service-role key. No DB password / psql
needed. Pulls the full `analytics_events` stream, resolves user_id -> email,
and cross-references billing tables (generation_jobs, usage_events) so you can
tell whether a user actually generated/rendered anything vs. just clicked around.

Env (required): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  -> source these from .env.prod before running.

Usage:
  analytics.py                 # overall summary + per-user table
  analytics.py --user <q>      # also print a chronological timeline for one
                               # user (q = email, uuid, or substring of either)
  analytics.py --json          # dump the raw aggregated dict as JSON
"""
import os, sys, json, collections, urllib.request, urllib.parse
from datetime import datetime

EVENT_TABLE = "analytics_events"
PAGE = 1000

def _env():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
                 "(source .env.prod first).")
    return url.rstrip("/"), key

def _get(url, key, path, params=None, headers=None):
    qs = ("?" + urllib.parse.urlencode(params, doseq=True)) if params else ""
    req = urllib.request.Request(url + path + qs)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    for h, v in (headers or {}).items():
        req.add_header(h, v)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode()
        cr = r.headers.get("content-range")
    return json.loads(body) if body.strip() else [], cr

def fetch_all(url, key, table, select="*"):
    """Page through a PostgREST table until exhausted."""
    out, offset = [], 0
    while True:
        rows, _ = _get(url, key, f"/rest/v1/{table}",
                       {"select": select, "order": "created_at.asc",
                        "limit": PAGE, "offset": offset})
        out.extend(rows)
        if len(rows) < PAGE:
            return out
        offset += PAGE

def fetch_user_map(url, key):
    """user_id -> {email, name} via the GoTrue admin list endpoint."""
    out, page = {}, 1
    while True:
        users, _ = _get(url, key, "/auth/v1/admin/users",
                        {"page": page, "per_page": PAGE})
        # admin endpoint returns either a list or {"users": [...]}
        if isinstance(users, dict):
            users = users.get("users", [])
        if not users:
            break
        for u in users:
            md = u.get("user_metadata") or {}
            out[u["id"]] = {
                "email": u.get("email") or "(no email)",
                "name": md.get("full_name") or md.get("name") or "",
                "created_at": (u.get("created_at") or "")[:10],
            }
        if len(users) < PAGE:
            break
        page += 1
    return out

def count_by_user(url, key, table):
    """Returns Counter of user_id -> row count for a billing table."""
    c = collections.Counter()
    rows = fetch_all(url, key, table, select="user_id")
    for r in rows:
        c[r["user_id"]] += 1
    return c

def parse_ts(s):
    s = s.replace("+00:00", "")
    if "." in s:
        head, frac = s.split(".")
        s = head + "." + (frac + "000000")[:6]
    return datetime.fromisoformat(s)

def summarize(rows, umap, gen_counts, usage_counts):
    by_name = collections.Counter(r["event_name"] for r in rows)
    by_day = collections.Counter(r["created_at"][:10] for r in rows)
    versions = collections.Counter(r["app_version"] for r in rows if r.get("app_version"))
    oses = collections.Counter(r["os_version"] for r in rows if r.get("os_version"))
    users = collections.defaultdict(list)
    for r in rows:
        users[r["user_id"]].append(r)

    per_user = []
    for uid, evs in sorted(users.items(), key=lambda kv: -len(kv[1])):
        evs.sort(key=lambda r: r["created_at"])
        names = collections.Counter(e["event_name"] for e in evs)
        info = umap.get(uid, {})
        per_user.append({
            "user_id": uid,
            "email": info.get("email", "(unknown)"),
            "name": info.get("name", ""),
            "events": len(evs),
            "sessions": len(set(e["session_id"] for e in evs if e.get("session_id"))),
            "days": sorted(set(e["created_at"][:10] for e in evs)),
            "first": evs[0]["created_at"][:19], "last": evs[-1]["created_at"][:19],
            "messages_sent": names.get("message_sent", 0),
            "feedback_submitted": names.get("feedback_submitted", 0),
            "errors": names.get("error_surfaced", 0),
            "onboarding_completed": any(
                e["event_target"] == "onboarding_completed" for e in evs),
            "gen_jobs": gen_counts.get(uid, 0),
            "usage_events": usage_counts.get(uid, 0),
            "app_versions": dict(collections.Counter(
                e["app_version"] for e in evs if e.get("app_version"))),
            "os": dict(collections.Counter(
                e["os_version"] for e in evs if e.get("os_version"))),
        })

    return {
        "total_events": len(rows),
        "unique_users": len(users),
        "unique_sessions": len(set(r["session_id"] for r in rows if r.get("session_id"))),
        "range": [rows[0]["created_at"][:19], rows[-1]["created_at"][:19]] if rows else [],
        "by_event_name": dict(by_name.most_common()),
        "by_day": dict(sorted(by_day.items())),
        "app_versions": dict(versions.most_common()),
        "os_versions": dict(oses.most_common()),
        "per_user": per_user,
    }

def print_report(s):
    print(f"\n=== WOVEN ANALYTICS — {s['total_events']} events, "
          f"{s['unique_users']} users, {s['unique_sessions']} sessions ===")
    if s["range"]:
        print(f"range: {s['range'][0]}  ->  {s['range'][1]}")
    print("\nby event:")
    for k, v in s["by_event_name"].items():
        print(f"  {v:4}  {k}")
    print("\nby day:")
    for k, v in s["by_day"].items():
        print(f"  {v:4}  {k}")
    print("\napp versions:", ", ".join(f"{k}({v})" for k, v in s["app_versions"].items()))
    print("\n=== PER USER ===")
    hdr = f"{'email':<28} {'name':<16} {'ev':>4} {'sess':>4} {'msg':>4} {'fb':>3} {'err':>3} {'onb':>4} {'gen':>4} {'usg':>4}"
    print(hdr); print("-" * len(hdr))
    for u in s["per_user"]:
        print(f"{u['email']:<28} {u['name'][:16]:<16} {u['events']:>4} "
              f"{u['sessions']:>4} {u['messages_sent']:>4} {u['feedback_submitted']:>3} "
              f"{u['errors']:>3} {'yes' if u['onboarding_completed'] else 'no':>4} "
              f"{u['gen_jobs']:>4} {u['usage_events']:>4}")
    print("\n(gen = billed generation_jobs, usg = usage_events. 0/0 = never ran a "
          "hosted/billed generation, i.e. no reel rendered through Woven.)")

def print_timeline(rows, umap, query):
    q = query.lower()
    matches = {uid for uid, info in umap.items()
               if q in uid.lower() or q in info.get("email", "").lower()
               or q in info.get("name", "").lower()}
    evs = sorted([r for r in rows if r["user_id"] in matches],
                 key=lambda r: r["created_at"])
    if not evs:
        print(f"\nno events for user matching '{query}'"); return
    uid = evs[0]["user_id"]; info = umap.get(uid, {})
    print(f"\n=== TIMELINE: {info.get('email','?')} ({info.get('name','')}) ===")
    t0 = parse_ts(evs[0]["created_at"])
    print(f"{'time':>8}  {'+sec':>6}  event / target")
    for r in evs:
        off = (parse_ts(r["created_at"]) - t0).total_seconds()
        tgt = f" -> {r['event_target']}" if r.get("event_target") else ""
        print(f"{r['created_at'][11:19]}  {off:6.0f}  {r['event_name']}{tgt}")

def main():
    args = sys.argv[1:]
    url, key = _env()
    rows = fetch_all(url, key, EVENT_TABLE)
    if not rows:
        print("no analytics events found."); return
    umap = fetch_user_map(url, key)
    gen = count_by_user(url, key, "generation_jobs")
    usage = count_by_user(url, key, "usage_events")
    s = summarize(rows, umap, gen, usage)
    if "--json" in args:
        print(json.dumps(s, indent=2)); return
    print_report(s)
    if "--user" in args:
        i = args.index("--user")
        if i + 1 < len(args):
            print_timeline(rows, umap, args[i + 1])

if __name__ == "__main__":
    main()
