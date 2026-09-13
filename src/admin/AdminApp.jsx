import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { Button, Card, Loading } from "../ui.jsx";
import AdminShell from "./AdminShell.jsx";
import SignIn from "./SignIn.jsx";

export default function AdminApp() {
  // undefined = still checking, null = signed out
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(null);
  const userId = session?.user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(null);
      return;
    }
    let cancelled = false;
    supabase.rpc("is_admin").then(({ data, error }) => {
      if (!cancelled) setIsAdmin(!error && data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (session === undefined || (session && isAdmin === null)) {
    return <Loading />;
  }

  if (!session) {
    return <SignIn />;
  }

  if (!isAdmin) {
    return (
      <div className="center-screen">
        <Card title="No access">
          <div className="stack">
            <p className="muted">
              {session.user.email} is not allowed to open the dashboard. If you are a driver, use the link you
              were sent.
            </p>
            <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <AdminShell session={session} />;
}
