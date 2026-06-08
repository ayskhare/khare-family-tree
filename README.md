# 🌳 Khare Family Tree | खरे परिवार

A permanent, shareable, mobile-first digital family tree — 8 generations of the Khare family.

## Architecture

| Layer | Tool | Purpose |
|-------|------|---------|
| Database | Supabase (PostgreSQL) | Single source of truth |
| Public Viewer | Netlify (`/public/`) | Family views the tree |
| Admin Panel | Streamlit Cloud (`/admin/app.py`) | Ayush manages data |
| Code | GitHub | Version control + auto-deploy |

---

## Setup — Step by Step

### 1. Supabase — Run Schema

1. Go to [supabase.com](https://supabase.com) → your project → **SQL Editor**
2. Paste the contents of `/sql/schema.sql` and click **Run**
3. All 6 tables + RLS policies will be created

### 2. Get your Service Role Key

- Supabase Dashboard → Settings → API
- Copy the **service_role** key (NOT the anon key — this is for migration + admin only)

### 3. Migrate Seed Data

```bash
cp .env.example .env
# Edit .env and fill in SUPABASE_URL and SUPABASE_SERVICE_KEY

pip install supabase python-dotenv
python migrate.py
```

### 4. Deploy Public Viewer to Netlify

1. Push this repo to GitHub
2. Go to [netlify.com](https://netlify.com) → New site from Git
3. Set **Publish directory** to `public`
4. Deploy — your family tree is live!

### 5. Deploy Admin Panel to Streamlit Cloud

1. Go to [share.streamlit.io](https://share.streamlit.io)
2. New app → repo `ayskhare/khare-family-tree` → file `admin/app.py`
3. Add secrets (Settings → Secrets):
```toml
SUPABASE_URL = "https://pozpdssxiykixodupanu.supabase.co"
SUPABASE_SERVICE_KEY = "your_service_role_key"
ADMIN_PASSWORD = "your_chosen_password"
```
4. Deploy!

### 6. Keep Supabase Alive (Anti-Sleep)

Supabase free tier pauses after 1 week of inactivity.

1. Go to [cron-job.org](https://cron-job.org) (free account)
2. Create a new cron job:
   - URL: `https://pozpdssxiykixodupanu.supabase.co/rest/v1/persons?limit=1`
   - Add header: `apikey: your_anon_key`
   - Schedule: Every 3 days

---

## Repository Structure

```
khare-family-tree/
├── public/
│   ├── index.html          ← Shell: bottom nav + tab router
│   ├── js/
│   │   ├── app.js          ← Init, router, shared state + graph helpers
│   │   ├── api.js          ← All Supabase fetch/post calls
│   │   ├── utils.js        ← Shared helpers (cleanName, fmtDate, etc.)
│   │   ├── tree.js         ← 🌳 Tree render + navigation + profile sheet
│   │   ├── search.js       ← 🔍 Search + filter chips + person cards
│   │   ├── dates.js        ← 🎂 Birthday & anniversary calendar
│   │   └── match.js        ← 🔗 Relationship finder (BFS)
│   └── css/
│       ├── main.css        ← Design tokens, layout, header, bottom nav, sheet
│       ├── tree.css        ← Tree-specific styles (cards, connectors, siblings)
│       └── components.css  ← Search, dates, matcher, picker styles
├── admin/
│   └── app.py              ← Admin panel (Streamlit Cloud)
├── sql/
│   └── schema.sql          ← DB schema (run once in Supabase) — NO CHANGES NEEDED
├── data/
│   └── seed.json           ← Seed data (70+ members) — NO CHANGES NEEDED
├── migrate.py              ← One-time migration script — NO CHANGES NEEDED
├── .env.example            ← Template for credentials
└── README.md
```

---

## Tab Overview

| Tab | What it does |
|-----|-------------|
| 🌳 Tree | Navigate the tree up/down by tapping cards. Long-press any card to open the full profile sheet with Info, Relatives, Comment and Suggest tabs. |
| 🔍 Search | Full-text search across name + location + notes. Filter by Khare bloodline, Married-in, or Deceased. Results grouped by generation. |
| 🎂 Dates | Three views: upcoming birthdays & anniversaries (next 60 days), all birthdays by month, all anniversaries. Requires `birth_date` to be set in the database. |
| 🔗 Match | Pick any two people → BFS shortest path across the full relationship graph → see the step-by-step connection and a plain-English relationship label. |

---

## What Changed vs v1 (single index.html)

| Area | v1 | v2 |
|------|----|----|
| Architecture | Single monolithic `index.html` (inline CSS + JS) | Shell `index.html` + 7 ES module JS files + 3 CSS files |
| Navigation | Breadcrumb only | Bottom nav with 4 tabs |
| Search | Overlay modal triggered by header button | Dedicated Search tab with filter chips |
| Birthdays | Not present | 🎂 Dates tab |
| Relationship finder | Not present | 🔗 Match tab with BFS |
| Profile sheet | Drawer (Info / Comment / Suggest) | Sheet (Info / **Relatives** / Comment / Suggest) |
| Admin | No date fields in Add/Edit forms | `birth_date`, `death_date`, `birth_place`, `marriage_date`, `marriage_place` all editable |

---

## Schema — No Changes Required

The existing schema already has all needed columns:
- `persons.birth_date` — used by 🎂 Dates
- `persons.death_date` — used by is_alive status
- `relationships.marriage_date` — used by anniversary view
- `relationships.marriage_place` — editable in admin

The only thing that was missing was the **admin UI** to populate these fields — that's now fixed in `admin/app.py`.

---

## Family Access

Share the Netlify URL with the entire family — no login needed to view.
Anyone can long-press a name to see details, post comments, or suggest corrections.
All suggestions go to the admin queue for approval.
