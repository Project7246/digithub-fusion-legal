# Handover - current folder state
Last agent: Codex - 6 Nov 2026. Task: resume Claude migration; blocked on browser input.
- Owner explicitly transferred Claude's unfinished task and folder lock to Codex.
- HEAD at takeover: 08faca6; successful fetch confirmed origin/main equal.
- Pre-existing dirty CLAUDE.md: ONLY Steps C/D authorization extension; preserve it.
- A/B completed by Claude: e.availity.pk primary, BASE_URL switched; ca DNS/domain removed.
- Intuit production callback uses e; old ca callback removed. Fresh OAuth round-trip NOT proven.
- Shopify Fusion/Pureclans fusion-4: app URL and callback use e; ca removed.
- C: Claude observed DigitalOcean SGP1. Codex has not independently verified console region.
- D is NOT complete: Singapore copy prepared; DigitalOcean DATABASE_URL cutover still pending.
- Target Neon: Fusion Singapore, wispy-dream-34764792, ap-southeast-1, Postgres 18,
  production br-calm-bonus-ao4mnaaa, neondb. Ohio source billowing-poetry-08559264 retained.
- Claude used app boot for schema and postgres_fdw for explicit-column copy; reported
  47 matching table counts and 28 reset sequences, then removed FDW/helper objects.
- These were historical count checks, NOT content/schema equivalence or a current snapshot.
- No writer freeze was demonstrated. keeper.js scheduled writes and server.js webhooks exist;
  owner being sole user does NOT quiesce them. Check drift and plan final writer freeze first.
- Preserve SESSION_SECRET, PORTAL_KEY behavior and courier relay; never log credentials.
- Next: inspect current app DATABASE_URL target without revealing its secret, verify source
  and destination schema/data/sequences, reconcile changes under a controlled write freeze,
  then authorized DATABASE_URL switch/save/deploy. Keep Ohio >= one week; no deletion.
- Verify setup-check, companies/couriers/receipts, courier portal pull/decryption,
  Trax relay reach, Settings Database, and fresh OAuth callback if authorized/needed.
- Codex read-only live check: version 1793930062114; baseUrl/redirectUri use e; needed all true.
- Browser host unavailable; native Chrome read works, click failed geometry, recovery failed
  to activate captured window. Asked owner to foreground Chrome/DigitalOcean; no live edits.
- Earlier detailed migration method remains in HANDOFF.md history at commit 08faca6.
- Open leftovers: Trax ElRB/older M&P parcel backfill; nine Trax CPRs unposted;
  PostEx AH/UR webhooks missing; M&P Rose Belle untouched. No migration number reserved.
