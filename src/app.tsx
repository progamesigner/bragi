import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import AppUpdate from "./components/AppUpdate";
import { syncTheme } from "./lib/store/preferences";
import "./styles.css";

export default function App() {
  syncTheme();
  return (
    <>
      <AppUpdate />
      <Router>
        <FileRoutes />
      </Router>
    </>
  );
}
