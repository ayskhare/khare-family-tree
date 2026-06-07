"""
Khare Family Tree — Supabase Migration Script
Loads seed.json into Supabase persons + relationships tables.

Usage:
  pip install supabase python-dotenv
  python migrate.py

.env file must have:
  SUPABASE_URL=https://pozpdssxiykixodupanu.supabase.co
  SUPABASE_SERVICE_KEY=your_service_role_key  ← NOT the anon key
"""

import json
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

SEED_FILE = os.path.join(os.path.dirname(__file__), "data", "seed.json")

def load_seed():
    with open(SEED_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def migrate_persons(members):
    print(f"\n📋 Migrating {len(members)} persons...")
    rows = []
    for m in members:
        row = {
            "id":               m["id"],
            "name":             m["name"],
            "gender":           m.get("gender"),
            "generation":       m.get("generation"),
            "blood_member":     m.get("blood_member", True),
            "birth_order":      m.get("birth_order"),
            "current_location": m.get("location"),
            "birth_place":      m.get("birth_place"),
            "is_alive":         m.get("is_alive", True),
            "needs_review":     m.get("needs_review", False),
            "notes":            m.get("notes"),
        }
        rows.append(row)

    # Upsert in batches of 50
    batch_size = 50
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        result = supabase.table("persons").upsert(batch).execute()
        print(f"  ✅ Persons batch {i//batch_size + 1}: {len(batch)} rows inserted")

def migrate_relationships(relationships):
    print(f"\n🔗 Migrating {len(relationships)} relationships...")
    rows = []
    for r in relationships:
        row = {
            "person1_id": r["person1_id"] if "person1_id" in r else r["parent_id"],
            "person2_id": r["person2_id"] if "person2_id" in r else r["child_id"],
            "type":       r["type"],
        }
        rows.append(row)

    batch_size = 50
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        result = supabase.table("relationships").upsert(batch).execute()
        print(f"  ✅ Relationships batch {i//batch_size + 1}: {len(batch)} rows inserted")

def verify():
    print("\n🔍 Verifying migration...")
    persons_count = supabase.table("persons").select("id", count="exact").execute()
    rels_count = supabase.table("relationships").select("id", count="exact").execute()
    print(f"  Persons in DB:       {persons_count.count}")
    print(f"  Relationships in DB: {rels_count.count}")

    # Show needs_review members
    flagged = supabase.table("persons").select("id, name, generation").eq("needs_review", True).execute()
    if flagged.data:
        print(f"\n⚠️  {len(flagged.data)} members flagged for review:")
        for p in flagged.data:
            print(f"    Gen {p['generation']}: {p['name']} ({p['id']})")

def main():
    print("🌳 Khare Family Tree — Migration Script")
    print("=" * 45)

    data = load_seed()
    members = data["members"]
    relationships = data["relationships"]

    migrate_persons(members)
    migrate_relationships(relationships)
    verify()

    print("\n✅ Migration complete!")
    print("   Next step: run the Streamlit admin panel to review flagged members.")

if __name__ == "__main__":
    main()
