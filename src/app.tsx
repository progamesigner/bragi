import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import AppUpdate from "./components/AppUpdate";
import { syncDocument } from "./lib/store/preferences";
import "./styles.css";

export default function App() {
  syncDocument();
  return (
    <>
      <AppUpdate />
      <Router>
        <FileRoutes />
      </Router>
    </>
  );
}
