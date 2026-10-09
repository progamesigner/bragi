import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import Shell from "./components/Shell";
import { syncDocument } from "./lib/store/preferences";
import "./styles.css";

export default function App() {
  syncDocument();
  return (
    <Router
      root={(props) => (
        <Shell {...props}>
          <Suspense>{props.children}</Suspense>
        </Shell>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
