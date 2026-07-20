import { modalOverlay, modalPanel } from "../components/Icons.jsx";
// Modul Lernpfad — nativ in die Shell eingebaut (kein eigener Container mehr).
//
// Die erprobte Vanilla-JS-App wurde ins Web-Projekt uebernommen: ihre Statik
// liegt jetzt unter apps/web/public/lp/ und wird vom selben Web-Server
// ausgeliefert (frueher ein eigener lernpfad-Container hinter /lernpfad-app/).
// Der Mount ist die Schnittstelle: HTML in einen Host (#lp-app) injizieren, CSS
// unter #lp-app gescopet (style.scoped.css), dann app.js im selben Fenster.
// Kommunikation per window.postMessage: Theme/Tab rein, Modal/Toast/Tab raus.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const BASE = "/lp/";
const ORIGIN = window.location.origin;

// Ein Asset (CSS/JS) einmalig ins <head> laden.
function ensureAsset(kind, href) {
  return new Promise((resolve) => {
    if (document.querySelector(`[data-lp-asset="${href}"]`)) return resolve();
    const el = kind === "css" ? document.createElement("link") : document.createElement("script");
    el.dataset.lpAsset = href;
    if (kind === "css") { el.rel = "stylesheet"; el.href = href; }
    else { el.src = href; el.defer = false; }
    el.onload = () => resolve();
    el.onerror = () => resolve();
    document.head.appendChild(el);
  });
}

export default function LernpfadModule() {
  const hostRef = useRef(null);
  const [modal, setModal] = useState(null); // { title, html }
  const [toast, setToast] = useState("");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "aufgaben";
  const tabRef = useRef(tab); tabRef.current = tab;

  const post = (msg) => window.postMessage(msg, ORIGIN);
  const sendeTheme = () => post({ type: "nuvora:theme", dark: document.documentElement.classList.contains("dark") });
  const sendeTab = () => post({ type: "nuvora:lernpfad-tab", tab: tabRef.current });

  // App mounten: HTML injizieren, Assets laden, app.js ausfuehren.
  useEffect(() => {
    let abgebrochen = false;
    window.__nuvoraInPage = true;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      // Markup der App holen und (ohne ihre <script>/<link>) einsetzen.
      const html = await fetch(BASE + "index.html").then((r) => r.text()).catch(() => "");
      if (abgebrochen || !html) return;
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("script, link, style").forEach((n) => n.remove());
      host.innerHTML = doc.body.innerHTML;
      await ensureAsset("css", BASE + "css/style.scoped.css");
      await ensureAsset("css", BASE + "vendor/katex/katex.min.css");
      await ensureAsset("js", BASE + "vendor/katex/katex.min.js");
      await ensureAsset("js", BASE + "js/jspdf.umd.min.js");
      if (abgebrochen) return;
      // app.js jedes Mal frisch ausfuehren (IIFE, isoliert) und an die neu
      // eingesetzten Knoten binden.
      const s = document.createElement("script");
      s.src = BASE + "js/app.js?inpage=" + Date.now();
      s.dataset.lpApp = "1";
      document.body.appendChild(s);
    })();

    const onMessage = (e) => {
      if (e.origin !== ORIGIN) return;
      const d = e.data || {};
      if (d.type === "lernpfad:ready") { sendeTheme(); sendeTab(); }
      if (d.type === "lernpfad:tab" && d.tab && d.tab !== tabRef.current) setParams({ tab: d.tab }, { replace: true });
      if (d.type === "lernpfad:modal" && typeof d.html === "string") setModal({ title: d.title || "", html: d.html });
      if (d.type === "lernpfad:toast" && d.msg) { setToast(String(d.msg)); clearTimeout(window.__lpToast); window.__lpToast = setTimeout(() => setToast(""), 2500); }
    };
    window.addEventListener("message", onMessage);
    const obs = new MutationObserver(sendeTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      abgebrochen = true;
      window.removeEventListener("message", onMessage);
      obs.disconnect();
      document.querySelectorAll('[data-lp-app="1"]').forEach((n) => n.remove());
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, []);

  // Tab-Wechsel aus Nuvoras Navbar an die App geben.
  useEffect(() => { sendeTab(); }, [tab]);

  return (
    <>
      {modal && (
        <div onClick={() => setModal(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 560 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, flex: 1, margin: 0 }}>{modal.title}</h3>
              <button onClick={() => setModal(null)} style={{ width: 30, height: 30, borderRadius: 15, border: "none", background: "var(--bg2)", color: "var(--text3)", cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
            <div dangerouslySetInnerHTML={{ __html: modal.html }} />
          </div>
        </div>
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 400, background: "#1e293b", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 14, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>{toast}</div>
      )}
      <div id="lp-app" ref={hostRef} />
    </>
  );
}
