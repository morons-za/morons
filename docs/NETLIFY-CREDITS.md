# Netlify Credit Budget

Netlify is used as a **backup site** for morons.org.za. The free tier provides **300 credits/month**, with **15 credits per production deploy**.

## Current setup

| Source | Frequency | Deploys/month | Credits |
|-------|-----------|---------------|---------|
| Weekly Netlify Deploy (build hook) | Sunday 04:00 SAST | 4 | 60 |
| Manual workflow_dispatch | Occasional | ~1–2 | ~30 |
| Bandwidth, web requests | — | — | < 1 |
| **Total (typical)** | | | **~90** |

## Safeguards

- **`[skip netlify]`** in daily-sync and process-decisions commit messages — pushes from those workflows do **not** trigger Netlify builds
- **Build hook only** — Netlify deploys only when the weekly workflow (or manual run) calls the hook; no automatic deploys on git push

## Probability of exceeding 300 credits

| Scenario | Deploys | Credits | Over limit? |
|----------|---------|---------|-------------|
| Normal (weekly only) | 4 | 60 | No |
| + 2 manual runs | 6 | 90 | No |
| + 10 manual runs | 14 | 210 | No |
| **Worst case** (daily + manual) | 34 | 510 | Yes |

**Probability of exceeding 300 credits:** **< 5%** — only if someone runs manual deploys many times per month or the `[skip netlify]` safeguards are bypassed.

## Changing deploy frequency

Edit `.github/workflows/daily-netlify-deploy.yml`:

- **Weekly (current):** `cron: '0 2 * * 0'` — Sunday 04:00 SAST
- **Twice weekly:** Add `cron: '0 2 * * 0,3'` — Sunday + Wednesday
- **Monthly:** `cron: '0 2 1 * *'` — 1st of month
