import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "./supabase.js";

// Runs an async loader when deps change; `reload()` runs it again.
// Keeps the previous data visible while reloading.
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => {
        if (!cancelled) setState({ data, error: "", loading: false });
      })
      .catch((err) => {
        if (!cancelled) setState((s) => ({ data: s.data, error: errorMessage(err), loading: false }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

// Unwraps a Supabase query result, throwing on error.
export async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
