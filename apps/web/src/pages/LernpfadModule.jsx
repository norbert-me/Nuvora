// Modul Lernpfad im Rahmen.
//
// Die erprobte App laeuft eingebettet unter Nuvoras Navbar; ihre eigene Navbar
// ist ausgeblendet, die Tabs steuert Nuvora ueber ?tab= und postMessage.
//
// Gleiche Origin: die App liest Nuvoras Token aus demselben localStorage und
// spricht dieselbe API. Kein zweiter Login.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

const APP_URL = "/lernpfad-app/";

export default function LernpfadModule() {
  const ref = useRef(null);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "aufgaben";
  // Aktuellen Tab in einem Ref halten, damit onLoad/onMessage-Handler nicht
  // eine veraltete Kopie senden (Stale-Closure).
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const post = (msg) => ref.current?.contentWindow?.postMessage(msg, window.location.origin);
  const sendeTheme = () => post({ type: "nuvora:theme", dark: document.documentElement.classList.contains("dark") });
  const sendeTab = () => post({ type: "nuvora:lernpfad-tab", tab: tabRef.current });
  const sendeAlles = () => { sendeTheme(); sendeTab(); };

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "lernpfad:height" && typeof e.data.height === "number") {
        ref.current.style.height = Math.max(400, Math.min(e.data.height, 20000)) + "px";
      }
      // Die App meldet, dass sie bereit ist — dann Thema und Tab (erneut) setzen.
      if (e.data?.type === "lernpfad:ready") sendeAlles();
      // Interner Tab-Wechsel der App (z. B. nach "+ Lernleiter") → Nuvora-Menue
      // mitziehen: ?tab aktualisieren, damit die Navbar-Markierung stimmt.
      if (e.data?.type === "lernpfad:tab" && e.data.tab && e.data.tab !== tabRef.current) {
        setParams({ tab: e.data.tab }, { replace: true });
      }
    };
    window.addEventListener("message", onMessage);
    const obs = new MutationObserver(sendeTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { window.removeEventListener("message", onMessage); obs.disconnect(); };
  }, []);

  // Tab-Wechsel aus Nuvoras Navbar an die App geben.
  useEffect(() => { sendeTab(); }, [tab]);

  return (
    <iframe
      ref={ref}
      src={APP_URL}
      title="Lernpfad"
      onLoad={sendeAlles}  // sicher senden, sobald die App geladen ist
      style={{ width: "100%", height: 800, border: "none", display: "block" }}
    />
  );
}
