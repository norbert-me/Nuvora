// Modul Lernpfad im Rahmen.
//
// Die App wird bewusst NICHT in React nachgebaut — ihre Oberflaeche ist
// erprobt (Aufgaben, Klasse, Generator, Lernpfade). Sie laeuft eingebettet
// unter Nuvoras Navbar; ihre eigene Navbar ist ausgeblendet, die Tabs steuert
// Nuvora ueber ?tab= und postMessage.
//
// Gleiche Origin: die App liest Nuvoras Token aus demselben localStorage und
// spricht dieselbe API. Es gibt keinen zweiten Login.
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

const APP_URL = "/lernpfad-app/";

export default function LernpfadModule() {
  const ref = useRef(null);
  const [params] = useSearchParams();
  const tab = params.get("tab") || "aufgaben";

  const post = (msg) => ref.current?.contentWindow?.postMessage(msg, window.location.origin);
  const sendeTheme = () => post({ type: "nuvora:theme", dark: document.documentElement.classList.contains("dark") });
  const sendeTab = () => post({ type: "nuvora:lernpfad-tab", tab });

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "lernpfad:height" && typeof e.data.height === "number") {
        // Die App meldet ihre Hoehe; der Rahmen scrollt, nicht das iframe.
        ref.current.style.height = Math.max(400, Math.min(e.data.height, 20000)) + "px";
      }
      if (e.data?.type === "lernpfad:ready") { sendeTheme(); sendeTab(); }
    };
    window.addEventListener("message", onMessage);
    const obs = new MutationObserver(sendeTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => { window.removeEventListener("message", onMessage); obs.disconnect(); };
  }, []);

  // Tab-Wechsel aus Nuvoras Navbar an die App weitergeben.
  useEffect(() => { sendeTab(); }, [tab]);

  return (
    <iframe
      ref={ref}
      src={APP_URL}
      title="Lernpfad"
      style={{ width: "100%", height: 800, border: "none", display: "block" }}
    />
  );
}
