// Driver links look like  https://…/#d=<access_token>
// Anything else (including Supabase's sign-in redirect hash) is the admin app.
export function readRoute() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("d");
  return token ? { kind: "driver", token } : { kind: "admin" };
}

export function driverLink(accessToken) {
  const base = window.location.origin + window.location.pathname;
  return `${base}#d=${accessToken}`;
}
