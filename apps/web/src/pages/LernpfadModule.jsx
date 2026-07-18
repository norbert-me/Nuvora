// Modul Lernpfad im Rahmen.
//
// Die erprobte App laeuft eingebettet unter Nuvoras Navbar; ihre eigene Navbar
// ist ausgeblendet, die Tabs steuert Nuvora ueber ?tab= und postMessage.
//
// Gleiche Origin: die App liest Nuvoras Token aus demselben localStorage und
// spricht dieselbe API. Kein zweiter Login.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const APP_URL = "/lernpfad-app/";

export default function LernpfadModule() {
  const ref = useRef(null);
  // Modal auf Nuvora-Ebene: die eingebettete App schickt Detail-HTML, wir
  // rendern es zentriert ueber der ganzen Seite (nicht im hohen iframe).
  const [modal, setModal] = useState(null); // { title, html } | null
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
      // Detail-Modal der App: ueber der ganzen Nuvora-Seite rendern.
      if (e.data?.type === "lernpfad:modal" && typeof e.data.html === "string") {
        setModal({ title: e.data.title || "", html: e.data.html });
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
    <>
      {modal && (
        <div onClick={() => setModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 400 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", color: "var(--text)", borderRadius: 18, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 24, border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, flex: 1, margin: 0 }}>{modal.title}</h3>
              <button onClick={() => setModal(null)} style={{ width: 30, height: 30, borderRadius: 15, border: "none", background: "var(--bg2)", color: "var(--text3)", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <div dangerouslySetInnerHTML={{ __html: modal.html }} />
          </div>
        </div>
      )}
      <iframe
      ref={ref}
      src={APP_URL}
      title="Lernpfad"
      onLoad={sendeAlles}  // sicher senden, sobald die App geladen ist
      style={{ width: "100%", height: 800, border: "none", display: "block" }}
    />
    </>
  );
}
