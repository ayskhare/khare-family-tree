"""
Khare Family Tree — Streamlit Admin Panel
Deploy to Streamlit Cloud. Set secrets in Streamlit Cloud dashboard:
  SUPABASE_URL = "https://pozpdssxiykixodupanu.supabase.co"
  SUPABASE_SERVICE_KEY = "your_service_role_key"
  ADMIN_PASSWORD = "your_chosen_password"
"""

import streamlit as st
from supabase import create_client
import pandas as pd
from datetime import datetime

# ── Config ──────────────────────────────────────────────────
st.set_page_config(
    page_title="Khare Family Tree — Admin",
    page_icon="🌳",
    layout="wide"
)

SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = st.secrets["SUPABASE_SERVICE_KEY"]
ADMIN_PASSWORD = st.secrets["ADMIN_PASSWORD"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── Auth ─────────────────────────────────────────────────────
def check_auth():
    if "authenticated" not in st.session_state:
        st.session_state.authenticated = False

    if not st.session_state.authenticated:
        st.title("🌳 Khare Family Tree — Admin")
        st.subheader("Login")
        pw = st.text_input("Password", type="password")
        if st.button("Login"):
            if pw == ADMIN_PASSWORD:
                st.session_state.authenticated = True
                st.rerun()
            else:
                st.error("Incorrect password")
        st.stop()

check_auth()

# ── Helpers ──────────────────────────────────────────────────
def get_persons():
    res = supabase.table("persons").select("*").order("generation").order("birth_order").execute()
    return res.data

def get_relationships():
    res = supabase.table("relationships").select("*").execute()
    return res.data

def get_pending_comments():
    res = supabase.table("comments").select("*").eq("status", "pending").order("created_at").execute()
    return res.data

def get_pending_photos():
    res = supabase.table("photos").select("*").eq("status", "pending").order("created_at").execute()
    return res.data

def get_pending_changes():
    res = supabase.table("change_requests").select("*").eq("status", "pending").order("created_at").execute()
    return res.data

def get_flagged():
    res = supabase.table("persons").select("*").eq("needs_review", True).execute()
    return res.data

def safe_date(val):
    """Return a date string or empty string — safe for st.date_input value param."""
    if val:
        try:
            return datetime.strptime(val[:10], "%Y-%m-%d").date()
        except Exception:
            pass
    return None

# ── Sidebar ──────────────────────────────────────────────────
st.sidebar.title("🌳 Khare Family Admin")
st.sidebar.markdown("---")
page = st.sidebar.radio("Navigate", [
    "📊 Dashboard",
    "👥 Members",
    "➕ Add Member",
    "🔗 Relationships",
    "💬 Comments",
    "📸 Photos",
    "✏️ Change Requests",
    "⚠️ Needs Review",
])

if st.sidebar.button("🚪 Logout"):
    st.session_state.authenticated = False
    st.rerun()

# ── Dashboard ────────────────────────────────────────────────
if page == "📊 Dashboard":
    st.title("📊 Dashboard")

    persons = get_persons()
    rels = get_relationships()
    comments = get_pending_comments()
    photos = get_pending_photos()
    changes = get_pending_changes()
    flagged = get_flagged()

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Members", len(persons))
    col2.metric("Relationships", len(rels))
    col3.metric("Pending Items", len(comments) + len(photos) + len(changes))
    col4.metric("Needs Review", len(flagged))

    # NEW: birthday coverage stat
    with_bday = sum(1 for p in persons if p.get("birth_date"))
    st.info(f"🎂 **{with_bday} / {len(persons)}** members have a birth date recorded — used by the Dates tab in the family viewer.")

    st.markdown("---")

    col_a, col_b = st.columns(2)
    with col_a:
        st.subheader("Members by Generation")
        gen_counts = {}
        for p in persons:
            g = p.get("generation", "?")
            gen_counts[g] = gen_counts.get(g, 0) + 1
        gen_df = pd.DataFrame(sorted(gen_counts.items()), columns=["Generation", "Count"])
        st.bar_chart(gen_df.set_index("Generation"))

    with col_b:
        st.subheader("⚠️ Flagged for Review")
        if flagged:
            for f in flagged:
                st.warning(f"Gen {f['generation']}: **{f['name']}** ({f['id']})")
        else:
            st.success("No members flagged for review!")

# ── Members ──────────────────────────────────────────────────
elif page == "👥 Members":
    st.title("👥 All Members")

    persons = get_persons()

    col1, col2 = st.columns(2)
    with col1:
        gen_filter = st.selectbox("Filter by Generation", ["All"] + list(range(0, 9)))
    with col2:
        search = st.text_input("Search by name")

    filtered = persons
    if gen_filter != "All":
        filtered = [p for p in filtered if p.get("generation") == gen_filter]
    if search:
        filtered = [p for p in filtered if search.lower() in p["name"].lower()]

    st.markdown(f"Showing **{len(filtered)}** members")

    for p in filtered:
        with st.expander(f"{'⚠️ ' if p.get('needs_review') else ''}Gen {p.get('generation','?')} | {p['name']} ({p['id']}) {'🩸' if p.get('blood_member') else '💍'}"):
            col1, col2 = st.columns(2)
            with col1:
                new_name     = st.text_input("Name", value=p["name"], key=f"name_{p['id']}")
                new_gender   = st.selectbox("Gender", ["M", "F", "Other"],
                                            index=["M","F","Other"].index(p["gender"]) if p.get("gender") in ["M","F","Other"] else 0,
                                            key=f"gender_{p['id']}")
                new_gen      = st.number_input("Generation", value=p.get("generation") or 0, min_value=0, max_value=10, key=f"gen_{p['id']}")
                new_location = st.text_input("Current Location", value=p.get("current_location") or "", key=f"loc_{p['id']}")
                # ── NEW: date fields ──────────────────────────
                new_birth_date = st.date_input(
                    "Birth Date",
                    value=safe_date(p.get("birth_date")),
                    key=f"bday_{p['id']}",
                    help="Used by the 🎂 Dates tab"
                )
                new_death_date = st.date_input(
                    "Death Date (leave blank if alive)",
                    value=safe_date(p.get("death_date")),
                    key=f"dday_{p['id']}"
                )
                new_birth_place = st.text_input("Birth Place", value=p.get("birth_place") or "", key=f"bplace_{p['id']}")
            with col2:
                new_blood  = st.checkbox("Blood member (Khare)", value=p.get("blood_member", True), key=f"blood_{p['id']}")
                new_alive  = st.checkbox("Is alive", value=p.get("is_alive", True), key=f"alive_{p['id']}")
                new_review = st.checkbox("Needs review", value=p.get("needs_review", False), key=f"review_{p['id']}")
                new_notes  = st.text_area("Notes", value=p.get("notes") or "", key=f"notes_{p['id']}")

            col_save, col_del = st.columns(2)
            with col_save:
                if st.button("💾 Save", key=f"save_{p['id']}"):
                    update_data = {
                        "name":             new_name,
                        "gender":           new_gender,
                        "generation":       new_gen,
                        "current_location": new_location,
                        "blood_member":     new_blood,
                        "is_alive":         new_alive,
                        "needs_review":     new_review,
                        "notes":            new_notes,
                        "birth_place":      new_birth_place or None,
                        # Store dates as ISO strings, or None if not set
                        "birth_date":       str(new_birth_date) if new_birth_date else None,
                        "death_date":       str(new_death_date) if new_death_date else None,
                    }
                    supabase.table("persons").update(update_data).eq("id", p["id"]).execute()
                    st.success("Saved!")
            with col_del:
                if st.button("🗑️ Delete", key=f"del_{p['id']}"):
                    supabase.table("persons").delete().eq("id", p["id"]).execute()
                    st.warning(f"Deleted {p['name']}")
                    st.rerun()

# ── Add Member ───────────────────────────────────────────────
elif page == "➕ Add Member":
    st.title("➕ Add New Member")

    persons = get_persons()
    person_options = {p["id"]: f"{p['name']} (Gen {p.get('generation','?')})" for p in persons}

    with st.form("add_member"):
        col1, col2 = st.columns(2)
        with col1:
            new_id      = st.text_input("ID (e.g. P201)", help="Must be unique")
            name        = st.text_input("Full Name *")
            gender      = st.selectbox("Gender", ["M", "F", "Other"])
            generation  = st.number_input("Generation", min_value=0, max_value=10, value=0)
            location    = st.text_input("Current Location")
            birth_place = st.text_input("Birth Place")
            # ── NEW: date fields ──────────────────────────────
            birth_date  = st.date_input("Birth Date", value=None, help="Used by the 🎂 Dates tab in the family viewer")
            death_date  = st.date_input("Death Date (leave blank if alive)", value=None)
        with col2:
            blood_member = st.checkbox("Blood member (Khare)", value=True)
            is_alive     = st.checkbox("Is alive", value=True)
            birth_order  = st.number_input("Birth order (among siblings)", min_value=1, value=1)
            notes        = st.text_area("Notes")

        st.markdown("**Relationship**")
        rel_type       = st.selectbox("Relationship type", ["parent_child", "spouse", "sibling", "none"])
        related_person = st.selectbox("Related to", ["None"] + [f"{k}: {v}" for k, v in person_options.items()])

        submitted = st.form_submit_button("➕ Add Member")
        if submitted:
            if not new_id or not name:
                st.error("ID and Name are required")
            else:
                insert_data = {
                    "id":               new_id,
                    "name":             name,
                    "gender":           gender,
                    "generation":       generation,
                    "current_location": location,
                    "blood_member":     blood_member,
                    "is_alive":         is_alive,
                    "birth_order":      birth_order,
                    "notes":            notes,
                    "birth_place":      birth_place or None,
                    "birth_date":       str(birth_date) if birth_date else None,
                    "death_date":       str(death_date) if death_date else None,
                }
                supabase.table("persons").insert(insert_data).execute()

                if rel_type != "none" and related_person != "None":
                    related_id = related_person.split(":")[0]
                    if rel_type == "parent_child":
                        supabase.table("relationships").insert({
                            "person1_id": related_id,
                            "person2_id": new_id,
                            "type": "parent_child"
                        }).execute()
                    else:
                        supabase.table("relationships").insert({
                            "person1_id": new_id,
                            "person2_id": related_id,
                            "type": rel_type
                        }).execute()

                st.success(f"✅ Added {name} ({new_id})")

# ── Relationships ────────────────────────────────────────────
elif page == "🔗 Relationships":
    st.title("🔗 Relationships")

    rels = get_relationships()
    persons = get_persons()
    person_map = {p["id"]: p["name"] for p in persons}

    rel_rows = []
    for r in rels:
        rel_rows.append({
            "ID": r["id"],
            "Person 1": person_map.get(r["person1_id"], r["person1_id"]),
            "Type": r["type"],
            "Person 2": person_map.get(r["person2_id"], r["person2_id"]),
            # NEW: show marriage date if present
            "Marriage Date": r.get("marriage_date") or "—",
        })

    df = pd.DataFrame(rel_rows)
    st.dataframe(df, use_container_width=True)

    st.markdown("---")
    st.subheader("Add Relationship")
    person_options = [f"{p['id']}: {p['name']}" for p in persons]
    with st.form("add_rel"):
        col1, col2, col3 = st.columns(3)
        with col1:
            p1 = st.selectbox("Person 1 (parent/spouse)", person_options)
        with col2:
            rel_type = st.selectbox("Type", ["parent_child", "spouse", "sibling"])
        with col3:
            p2 = st.selectbox("Person 2 (child/spouse)", person_options)
        # ── NEW: marriage date for spouse relationships ────────
        marriage_date = st.date_input("Marriage Date (for spouse only, optional)", value=None)
        marriage_place = st.text_input("Marriage Place (optional)")

        if st.form_submit_button("Add"):
            rel_row = {
                "person1_id": p1.split(":")[0],
                "person2_id": p2.split(":")[0],
                "type": rel_type,
            }
            if rel_type == "spouse" and marriage_date:
                rel_row["marriage_date"] = str(marriage_date)
            if rel_type == "spouse" and marriage_place:
                rel_row["marriage_place"] = marriage_place
            supabase.table("relationships").insert(rel_row).execute()
            st.success("Relationship added!")
            st.rerun()

    st.markdown("---")
    st.subheader("Delete Relationship")
    del_id = st.text_input("Relationship ID to delete")
    if st.button("Delete") and del_id:
        supabase.table("relationships").delete().eq("id", del_id).execute()
        st.warning("Deleted")
        st.rerun()

# ── Comments ─────────────────────────────────────────────────
elif page == "💬 Comments":
    st.title("💬 Comments")
    persons = get_persons()
    person_map = {p["id"]: p["name"] for p in persons}

    tab1, tab2 = st.tabs(["Pending", "All"])

    with tab1:
        comments = get_pending_comments()
        if not comments:
            st.info("No pending comments")
        for c in comments:
            with st.expander(f"{person_map.get(c['person_id'], c['person_id'])} — {c['commenter_name']} ({c['created_at'][:10]})"):
                st.write(c["content"])
                col1, col2 = st.columns(2)
                with col1:
                    if st.button("✅ Approve", key=f"app_c_{c['id']}"):
                        supabase.table("comments").update({"status": "approved"}).eq("id", c["id"]).execute()
                        st.rerun()
                with col2:
                    if st.button("❌ Reject", key=f"rej_c_{c['id']}"):
                        supabase.table("comments").update({"status": "rejected"}).eq("id", c["id"]).execute()
                        st.rerun()

    with tab2:
        all_comments = supabase.table("comments").select("*").order("created_at", desc=True).execute().data
        for c in all_comments:
            st.markdown(f"**{person_map.get(c['person_id'], '?')}** | {c['commenter_name']} | `{c['status']}` | {c['created_at'][:10]}")
            st.caption(c["content"])
            st.divider()

# ── Photos ───────────────────────────────────────────────────
elif page == "📸 Photos":
    st.title("📸 Photos")
    persons = get_persons()
    person_map = {p["id"]: p["name"] for p in persons}

    photos = get_pending_photos()
    if not photos:
        st.info("No pending photos")
    for ph in photos:
        with st.expander(f"{person_map.get(ph['person_id'], ph['person_id'])} — {ph['uploaded_by_name']}"):
            st.image(ph["photo_url"], width=300)
            st.caption(ph.get("caption", ""))
            col1, col2 = st.columns(2)
            with col1:
                if st.button("✅ Approve", key=f"app_p_{ph['id']}"):
                    supabase.table("photos").update({"status": "approved"}).eq("id", ph["id"]).execute()
                    st.rerun()
            with col2:
                if st.button("❌ Reject", key=f"rej_p_{ph['id']}"):
                    supabase.table("photos").update({"status": "rejected"}).eq("id", ph["id"]).execute()
                    st.rerun()

# ── Change Requests ──────────────────────────────────────────
elif page == "✏️ Change Requests":
    st.title("✏️ Change Requests")
    persons = get_persons()
    person_map = {p["id"]: p["name"] for p in persons}

    changes = get_pending_changes()
    if not changes:
        st.info("No pending change requests")

    for ch in changes:
        person_name = person_map.get(ch["person_id"], ch["person_id"])
        with st.expander(f"{person_name} — {ch['field_name']} — {ch['requested_by_name']}"):
            col1, col2 = st.columns(2)
            with col1:
                st.markdown(f"**Old value:** {ch.get('old_value', '—')}")
            with col2:
                st.markdown(f"**New value:** {ch.get('new_value', '—')}")
            admin_note = st.text_input("Admin note", key=f"note_{ch['id']}")
            col_a, col_b = st.columns(2)
            with col_a:
                if st.button("✅ Approve & Apply", key=f"app_ch_{ch['id']}"):
                    supabase.table("persons").update({
                        ch["field_name"]: ch["new_value"]
                    }).eq("id", ch["person_id"]).execute()
                    supabase.table("change_requests").update({
                        "status": "approved",
                        "admin_notes": admin_note
                    }).eq("id", ch["id"]).execute()
                    st.success("Applied!")
                    st.rerun()
            with col_b:
                if st.button("❌ Reject", key=f"rej_ch_{ch['id']}"):
                    supabase.table("change_requests").update({
                        "status": "rejected",
                        "admin_notes": admin_note
                    }).eq("id", ch["id"]).execute()
                    st.rerun()

# ── Needs Review ─────────────────────────────────────────────
elif page == "⚠️ Needs Review":
    st.title("⚠️ Members Needing Review")
    st.info("These members were auto-flagged during migration because their names were unclear in the handwritten source.")

    flagged = get_flagged()
    if not flagged:
        st.success("🎉 All members have been reviewed!")
    else:
        st.markdown(f"**{len(flagged)} members** need attention:")
        for p in flagged:
            with st.expander(f"Gen {p.get('generation','?')} | {p['name']} ({p['id']})"):
                col1, col2 = st.columns(2)
                with col1:
                    new_name  = st.text_input("Correct name", value=p["name"], key=f"rname_{p['id']}")
                    new_notes = st.text_area("Notes", value=p.get("notes") or "", key=f"rnotes_{p['id']}")
                    # ── NEW: allow setting birth date during review ──────
                    new_birth_date = st.date_input(
                        "Birth Date (if known)",
                        value=safe_date(p.get("birth_date")),
                        key=f"rbday_{p['id']}"
                    )
                with col2:
                    st.markdown(f"**Gender:** {p.get('gender','?')}")
                    st.markdown(f"**Generation:** {p.get('generation','?')}")
                    st.markdown(f"**Location:** {p.get('current_location','—')}")
                if st.button("✅ Mark as Reviewed", key=f"rev_{p['id']}"):
                    supabase.table("persons").update({
                        "name":         new_name,
                        "notes":        new_notes,
                        "needs_review": False,
                        "birth_date":   str(new_birth_date) if new_birth_date else None,
                    }).eq("id", p["id"]).execute()
                    st.success("Marked as reviewed!")
                    st.rerun()
