// Modul Code-Detektiv im Rahmen.
//
// Eigenstaendige Client-App (React 19 + Vite), eingebettet per iframe unter
// Nuvoras Navbar. Kein Backend, kein Login — im Rahmen ueber ModuleGate
// geschuetzt. Voll-Hoehe, weil es ein Spiel/Werkzeug ist, das den Platz nutzt.
import { useEffect, useRef } from "react";

const APP_URL = "/code-detektiv-app/";

export default function CodeDetektivModule() {
  const ref = useRef(null);

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
      src={APP_URL}
      title="Code-Detektiv"
      style={{ width: "100%", height: "100vh", minHeight: 480, border: "none", display: "block" }}
    />
  );
}
