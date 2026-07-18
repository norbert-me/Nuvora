// Modul Code-Detektiv im Rahmen.
//
// Eigenstaendige Client-App (React 19 + Vite), eingebettet per iframe unter
// Nuvoras Navbar. Kein Backend, kein Login — im Rahmen ueber ModuleGate
// geschuetzt. Voll-Hoehe, weil es ein Spiel/Werkzeug ist, das den Platz nutzt.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

const APP_URL = "/code-detektiv-app/";
// Nuvora-Navbar-Buttons steuern die eingebettete App per ?view. Default ist
// "Raetsel erstellen" (Admin), damit man nicht auf der App-Startseite landet.
const VIEW_PATH = { admin: "admin", join: "", solo: "solo" };

export default function CodeDetektivModule() {
  const ref = useRef(null);
  const [params] = useSearchParams();
  const view = params.get("view") || "admin";
  const src = APP_URL + (VIEW_PATH[view] ?? "admin");

  // Thema an die App melden, falls sie darauf reagiert (schadet sonst nicht).
  useEffect(() => {
    const send = () => ref.current?.contentWindow?.postMessage(
      { type: "nuvora:theme", dark: document.documentElement.classList.contains("dark") },
      window.location.origin
    );
    const obs = new MutationObserver(send);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <iframe
      ref={ref}
      src={src}
      title="Code-Detektiv"
      style={{ width: "100%", height: "calc(100vh - 120px)", minHeight: 480, border: "none", display: "block" }}
    />
  );
}
