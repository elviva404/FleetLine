import { useState } from "react";
import { errorMessage, supabase } from "../lib/supabase.js";
import { Button, Card, Field, Notice } from "../ui.jsx";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus("sending");
    setError("");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (signInError) {
      setStatus("idle");
      setError(
        /signups not allowed|not found/i.test(signInError.message)
          ? "This email does not have dashboard access."
          : errorMessage(signInError)
      );
      return;
    }
    setStatus("sent");
  }

  return (
    <div className="center-screen">
      <div className="stack" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div className="masthead-eyebrow">FleetLine</div>
          <h1 className="masthead-title" style={{ color: "var(--navy)" }}>
            Owner sign-in
          </h1>
        </div>
        <Card>
          {status === "sent" ? (
            <div className="stack">
              <Notice tone="green">Check your email. We sent a sign-in link to {email.trim()}.</Notice>
              <p className="muted small">
                Open the link on this device. It expires after an hour.
              </p>
              <Button variant="ghost" onClick={() => setStatus("idle")}>
                Use a different email
              </Button>
            </div>
          ) : (
            <form className="form" onSubmit={handleSubmit}>
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              {error && <Notice tone="red">{error}</Notice>}
              <Button type="submit" disabled={status === "sending"}>
                {status === "sending" ? "Sending…" : "Email me a sign-in link"}
              </Button>
            </form>
          )}
        </Card>
        <p className="muted small" style={{ textAlign: "center" }}>
          Drivers: open the personal link you were sent instead.
        </p>
      </div>
    </div>
  );
}
