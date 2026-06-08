// api.js — all Supabase fetch calls

export const SUPA_URL  = "https://pozpdssxiykixodupanu.supabase.co";
export const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvenBkc3N4aXlraXhvZHVwYW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4Mzk5NDMsImV4cCI6MjA5NjQxNTk0M30.3nE59InmMpsczdcay2lRKry9_D0O4aIQZ7xQLEM1BUo";

const H = {
  "apikey": SUPA_ANON,
  "Authorization": `Bearer ${SUPA_ANON}`,
};

const POST_H = { ...H, "Content-Type": "application/json", "Prefer": "return=minimal" };

/** Fetch all persons, relationships, and approved comments in parallel. */
export async function fetchAll() {
  const [pR, rR, cR] = await Promise.all([
    fetch(`${SUPA_URL}/rest/v1/persons?select=*&order=generation,birth_order`, { headers: H }),
    fetch(`${SUPA_URL}/rest/v1/relationships?select=*`, { headers: H }),
    fetch(`${SUPA_URL}/rest/v1/comments?select=*&status=eq.approved&order=created_at.desc`, { headers: H }),
  ]);
  if (!pR.ok || !rR.ok || !cR.ok) throw new Error("Failed to load family data");
  return {
    persons:       await pR.json(),
    relationships: await rR.json(),
    comments:      await cR.json(),
  };
}

/** Post a new comment (status: pending). */
export async function postComment({ person_id, commenter_name, commenter_email, content }) {
  const r = await fetch(`${SUPA_URL}/rest/v1/comments`, {
    method: "POST",
    headers: POST_H,
    body: JSON.stringify({ person_id, commenter_name, commenter_email, content, status: "pending" }),
  });
  if (!r.ok) throw new Error("Failed to submit comment");
}

/** Post a change request (status: pending). */
export async function postChangeRequest({ person_id, requested_by_name, requested_by_email, field_name, old_value, new_value }) {
  const r = await fetch(`${SUPA_URL}/rest/v1/change_requests`, {
    method: "POST",
    headers: POST_H,
    body: JSON.stringify({ person_id, requested_by_name, requested_by_email, field_name, old_value, new_value, status: "pending" }),
  });
  if (!r.ok) throw new Error("Failed to submit suggestion");
}
