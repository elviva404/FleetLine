import { Suspense, lazy, useEffect, useState } from "react";
import AdminApp from "./admin/AdminApp.jsx";
import DriverApp from "./driver/DriverApp.jsx";
import { readRoute } from "./lib/route.js";

export default function App() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (import.meta.env.DEV && route.kind === "preview") {
    const Preview = lazy(() => import("./dev/Preview.jsx"));
    return (
      <Suspense fallback={null}>
        <Preview name={route.name} />
      </Suspense>
    );
  }

  if (route.kind === "driver") {
    return <DriverApp key={route.token} token={route.token} />;
  }
  return <AdminApp />;
}
