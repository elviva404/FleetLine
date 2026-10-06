import { useState } from "react";
import { errorMessage, supabase } from "../lib/supabase.js";
import { must, useLoad } from "../lib/useLoad.js";
import { Badge, Button, Card, Field, Loading, Notice } from "../ui.jsx";

// Who can open the dashboard. Everyone listed can do everything in the app;
// only an owner can change this list.
export default function PeopleCard({ session, isOwner }) {
  const { data: people, error, reload } = useLoad(
    () => must(supabase.from("admins").select("*").order("role").order("email")),
    []
  );
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ tone: "", text: "" });
  const [busy, setBusy] = useState(false);

  async function addPerson(event) {
    event.preventDefault();
    setBusy(true);
    setStatus({ tone: "", text: "" });
    const address = email.trim().toLowerCase();
    const { error: insertError } = await supabase
      .from("admins")
      .insert({ email: address, role: "admin", invited_by: session.user.email });
    setBusy(false);
    if (insertError) {
      setStatus({ tone: "red", text: errorMessage(insertError) });
      return;
    }
    setEmail("");
    setStatus({ tone: "green", text: `${address} can now sign in with that email address.` });
    reload();
  }

  async function removePerson(person) {
    if (!window.confirm(`Remove ${person.email}? They lose access immediately.`)) return;
    const { error: deleteError } = await supabase.from("admins").delete().eq("email", person.email);
    if (deleteError) {
      setStatus({ tone: "red", text: errorMessage(deleteError) });
      return;
    }
    setStatus({ tone: "green", text: `${person.email} removed.` });
    reload();
  }

  return (
    <Card title="People with access">
      {error && <Notice tone="red">{error}</Notice>}
      {!people && !error && <Loading />}
      {people && (
        <ul className="ledger">
          {people.map((person) => (
            <li key={person.email} className="ledger-row">
              <div className="ledger-main">
                <div className="ledger-title">{person.email}</div>
                <div className="ledger-meta">
                  {person.role === "owner" ? "Owner · can manage people" : "Admin"}
                  {person.email === session.user.email ? " · you" : ""}
                </div>
              </div>
              <div className="ledger-side">
                {isOwner && person.email !== session.user.email ? (
                  <Button variant="danger" className="btn-sm" onClick={() => removePerson(person)}>
                    Remove
                  </Button>
                ) : (
                  <Badge tone={person.role === "owner" ? "navy" : "muted"}>{person.role}</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {status.text && <Notice tone={status.tone}>{status.text}</Notice>}

      {isOwner ? (
        <form className="form" onSubmit={addPerson} style={{ marginTop: 12 }}>
          <Field
            label="Invite someone"
            hint="They sign in at this address with their own email. No password, just the emailed link."
          >
            <input
              className="input"
              type="email"
              inputMode="email"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding…" : "Give access"}
          </Button>
        </form>
      ) : (
        <p className="muted small">Only an owner can add or remove people.</p>
      )}
    </Card>
  );
}
