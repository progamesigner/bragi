import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import AppUpdate from "./components/AppUpdate";
import "./styles.css";

export default function App() {
  return (
    <>
      <AppUpdate />
      <Router>
        <FileRoutes />
      </Router>
    </>
  );
}
