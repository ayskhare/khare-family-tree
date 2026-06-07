# khare-family-tree

# 🌳 Khare Family Tree | खरे परिवार

A permanent, shareable, mobile-friendly digital family tree — 8 generations of the Khare family.

## Architecture

| Layer | Tool | Purpose |
|-------|------|---------|
| Database | Supabase (PostgreSQL) | Single source of truth |
| Public Viewer | Netlify (`/public/index.html`) | Family views the tree |
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
# Copy env template
cp .env.example .env
# Edit .env and fill in SUPABASE_URL and SUPABASE_SERVICE_KEY

pip install supabase python-dotenv
python migrate.py
```

### 4. Deploy Public Viewer to Netlify

1. Push this repo to GitHub: `https://github.com/ayskhare/khare-family-tree`
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
3. Save — Supabase will never sleep!

---

## Repository Structure

```
khare-family-tree/
├── public/
│   └── index.html        ← Family tree viewer (Netlify)
├── admin/
│   ├── app.py            ← Admin panel (Streamlit Cloud)
│   └── requirements.txt
├── sql/
│   └── schema.sql        ← DB schema (run once in Supabase)
├── data/
│   └── seed.json         ← Seed data (70+ members)
├── migrate.py            ← One-time migration script
├── .env.example          ← Template for credentials
└── README.md
```

---

## Data Review

After migration, some members are flagged `needs_review = true` because their names were partially legible in the handwritten source. Use the **Admin Panel → ⚠️ Needs Review** page to correct them.

---

## Family Access

Share the Netlify URL with the entire family — no login needed to view.  
Anyone can click a name to see details, post comments, or suggest corrections.  
All suggestions go to the admin queue for Ayush to approve.
