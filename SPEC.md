# Moanyfans — v1 Spec

Locked 2026-04-29. Strategic decisions captured from the design grilling session. Source of truth for what v1 is and isn't.

## Strategy

| Decision | Choice |
|---|---|
| Ambition | Swing for the fences (multi-million-user social platform potential), low burn until traction |
| Wedge | UK football fans (104 clubs at launch: PL 20, Championship 24, L1 24, L2 24, SPL 12) |
| Identity | Pseudonymous handles (Reddit/Twitter model). Email signup, pick handle, pick team. 30-day team-switch cooldown |
| Brand position | **A — premium banter, no betting at launch.** Future option to add `tips.moanyfans.com` subdomain in Phase 3 if data justifies |
| Time horizon | 12 months (kill review at month 6) |
| Kill criteria (month 6, ~Oct 2026) | <2,500 signups OR DAU/MAU <15% OR Day-7 retention <15% |
| Launch window | World Cup opener ~11 Jun 2026 (soft launch) → PL season opener ~17 Aug 2026 (real launch) |
| Legal vehicle | Moanyfans Ltd registered before public launch |

## Tech foundation

| Layer | Choice |
|---|---|
| Frontend | Vite + React 18 + TS, Tanstack Router, Tanstack Query, Zustand |
| Backend | FastAPI + Python 3.12, async, Pydantic v2 |
| Database | Postgres on host (`moanyfans` DB on shared 10.0.1.1:5432) |
| Cache/realtime fan-out | Redis |
| Real-time | Server-Sent Events (SSE) — one-way push down. WebSockets only when DM/chat ships in v2 |
| Auth | Stack Auth (email + handle + team-on-signup) |
| Email | Resend (already verified domain) |
| Storage | Backblaze B2 |
| Search | Postgres full-text (Meilisearch later if needed) |
| CDN / WAF | Cloudflare (free tier from day one) |
| Hosting | Fasthosts (UK data sovereignty, existing Coolify pattern). See `project_moanyfans_infra` memory for tier ladder |
| Monitoring | Plausible (product), Sentry (errors), PostHog (funnels later) |
| Fixtures data | football-data.org Tier-One (£12/mo, covers PL + EFL + SPL) |

## Repo structure (target)

```
moanyfans/
  apps/
    web/         # current Vite app, refactored for real API
    api/         # FastAPI service
  packages/
    schema/      # shared TS types from FastAPI OpenAPI
  infra/
    docker/      # Dockerfiles per service
    sql/         # migrations
```

## v1 scope — ships

**Onboarding & identity**
- Stack Auth signup (email + handle + password)
- "Pick your team" onboarding (104 UK football clubs)
- Basic profile: avatar (auto from team colours), handle, team, badge slot, recent moans
- 30-day team-switch cooldown

**Core posting loop**
- Feed (paginated, sport filter chips, kind filter MOAN/ROAST/COPE, "your team" / "rivals" / "all" toggle)
- Composer (kind picker, team picker, 280 chars, tags, rage meter, AI moderation pre-publish)
- Reactions: laughs / agrees / cope / ratio
- Threaded replies (1 level deep)
- Tags + trending tags rail (Postgres aggregations cached in Redis)

**Cold-start & growth machinery**
- Auto-generated tabloid card per moan (Puppeteer PNG render, OG image meta)
- Share buttons: WhatsApp deep link, Twitter intent, Reddit submit, Facebook, copy-link
- Match-day live thread (auto-created 1hr before kickoff for every fixture)
- AI match recap pages — PL + SPL only at launch (SEO honeypots, Claude-generated, pre-filled composer below)
- Rivalry pages — auto-generated all 5,356 combos (104 choose 2), lazy-rendered
- Basic per-team leaderboards (weekly reset, top 10 moaners + top 10 roasters per team)

**Drama mechanics**
- Roast Battle: challenge another user, 48hr battle, public voting, result = shareable card
- Non-users challenged via shared link → forced signup to fight back

**AI features**
- AI-assisted moderation: Claude scores every moan pre-publish, auto-holds risky ones for human review
- 3 house AI accounts (clearly badged `[AI]`):
  - `@HOT_TAKE_HARRY` — post-match takes within 5 min of FT
  - `@COPELORD_BOT` — auto-replies the most copium take to any moan
  - `@RAGE_RANKER` — weekly "most embarrassing performance"
- AI match recaps (covered above)

**Notifications (email only at v1, no push)**
- Match-day reminder (your team plays in 2hrs)
- Someone roasted/replied to you
- Roast battle challenged
- Weekly digest (your stats + top moan you missed)
- One-tap unsubscribe per type

**Admin & ops**
- Admin panel: held-moans queue, ban handle, suspend account, flagged content queue
- football-data.org PL/EFL/SPL fixtures imported, daily refresh cron
- Cloudflare Turnstile on signup (anti-bot)
- Sentry, error budgets, backup verification, runbook

**Compliance & legal**
- T&Cs + Privacy Policy + Cookie banner (AI-drafted from Reddit/Twitter/Sky Sports T&Cs as references)
- Age gate on signup (16+ recommended, 13+ minimum)
- Report-and-takedown flow with documented 24hr SLA (Online Safety Act + Defamation Act 2013 operator defence)
- Online Safety Act risk assessment doc
- Moanyfans Ltd registered before launch

## v1 explicitly does NOT ship

- Pro subscription / Stripe / payments / cosmetics shop (Phase 2)
- Push notifications / PWA install / mobile app (v2)
- DMs / friend-graph / follower lists (v2)
- Search beyond browser ctrl-F (v2)
- Verification / blue ticks / press accounts (v2)
- Profile customisation / custom frames (Phase 2 cosmetics)
- Multi-sport beyond a "coming soon" ghost section (Phase 2 wedge expansion)
- WebSockets / live chat (SSE handles all push-down for v1)
- Trophy/season-end summaries / historical archive (v2)

## Cold-start engine

- Seeder runs daily route: 6 priority team groups × 1 card per day = ~42 posts/week
- Priority teams (week 1): Man Utd, Arsenal, Spurs, Liverpool, Chelsea, Newcastle
- Add 6 clubs/week as bandwidth allows; by month 3 covering all 20 PL + 6 most active Championship + Old Firm
- Seeder posts auto-generated tabloid cards into Facebook footy groups (UK has thousands)
- Onboarding: card link → preview moan → signup required to react/reply → committed user
- Target: 1,000 signups by month 3, 5,000 by month 6, 25,000 by month 12

## Monetisation phasing

**Phase 1 (0-5k DAU, months 1-6):** Zero monetisation. No Stripe.

**Phase 2 (5k-50k DAU, months 6-18):**
- Moanyfans Pro: £3.99/mo or £29/yr — cosmetic + QoL only (custom frames, animated stamps, longer moans, ad-free, PRO badge)
- One-off cosmetic shop (£0.99-£2.99 per item)

**Phase 3 (50k+ DAU, year 2+):**
- Programmatic ads via Ezoic
- Sponsored Roast Battles
- Affiliate (FPL tools, kit retailers — NO betting)

**Phase 4 (mass scale):** Club partnerships, creator program, press tier.

**Hard rule:** never monetise visibility. No paying to win battles, rank leaderboards, or boost feed placement.

## Success metrics

| Metric | Month 3 | Month 6 (kill review) | Month 12 |
|---|---|---|---|
| Signups | 1,000 | 5,000 | 25,000 |
| DAU/MAU | 25% | 25% | 35% |
| Day-7 retention | 25% | 25% | 35% |
| Posts/active/week | 2 | 2.5 | 4 |
| K-factor | 0.15 | 0.3 | 0.6 |
| Card share rate | 5% | 5% | 8% |

## Build sequence

Order of work, no fixed week-by-week calendar — soft launch ~11 June if ready, otherwise when ready:

1. **Foundation**: repo restructure, `moanyfans` Postgres DB, Stack Auth, onboarding flow, fixtures import, Cloudflare in front, frontend swapped to real API
2. **Core posting loop**: composer, feed, reactions, replies, tags, AI moderation, admin panel v0
3. **Cold-start engine**: tabloid card render service, OG meta, share buttons, email notifications via Resend, SEO basics
4. **Drama + match-day**: live threads (SSE), roast battles, match-day notifications
5. **SEO + AI features**: rivalry pages, AI match recaps, house AI accounts, basic leaderboards
6. **Polish, legal, launch prep**: T&Cs, Cookie banner, age gate, takedown flow, landing page, Turnstile, hardening, Moanyfans Ltd registered

## Sync cadence with Wayne

- Weekly summary of what shipped + what's next
- Immediate ping on blockers or product decisions that need his input
- No daily noise

## Open follow-ups

- Wayne to buy `moanyfans.co.uk` (already owns `.com`)
- Wayne's seeder confirmed available from soft launch
- Solicitor review of T&Cs explicitly declined — risk owned by Wayne
- Moanyfans Ltd registration before public launch
