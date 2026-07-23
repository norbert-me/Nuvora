// Geführte Tour: hebt der Reihe nach ein Element hervor (Spotlight) und erklärt
// es in einer Sprechblase daneben. Schritt für Schritt „Weiter", jederzeit
// „Überspringen". Ein Schritt ohne Ziel (target=null) zeigt eine zentrierte
// Karte (Begrüßung/Abschluss). Ziel-Elemente werden über data-tour="<key>"
// gefunden; fehlt eines, wird der Schritt zentriert gezeigt.
import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { btnPrimary, btnSecondary } from "./Icons.jsx";

export default function GuidedTour({ steps, onDone, t }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = steps[i];

  const measure = useCallback(() => {
    if (!step || !step.target) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("scroll", on, true); };
  }, [measure]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onDone(); if (e.key === "ArrowRight") next(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line

  if (!step) return null;
  const last = i === steps.length - 1;
  const next = () => (last ? onDone() : setI((v) => v + 1));
  const back = () => setI((v) => Math.max(0, v - 1));

  const pad = 8;
  const hole = rect && {
    position: "fixed",
    top: rect.top - pad, left: rect.left - pad,
    width: rect.width + pad * 2, height: rect.height + pad * 2,
    borderRadius: 12,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
    zIndex: 4000, pointerEvents: "none", transition: "all 0.2s ease",
  };

  // Sprechblase unter dem Ziel, sonst darüber; ohne Ziel zentriert.
  const vh = window.innerHeight, vw = window.innerWidth;
  let tip;
  if (rect) {
    const below = rect.top + rect.height + pad + 12 + 180 < vh;
    const top = below ? rect.top + rect.height + pad + 12 : Math.max(12, rect.top - pad - 12 - 180);
    let left = Math.min(Math.max(12, rect.left), vw - 332);
    tip = { position: "fixed", top, left, width: 320 };
  } else {
    tip = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 340 };
  }

  return (
    <>
      {/* Voller Abdunkler, wenn kein Ziel; sonst macht die box-shadow das Loch. */}
      {!rect && <div onClick={onDone} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", zIndex: 4000 }} />}
      {rect && <div style={hole} />}
      <div style={{ ...tip, zIndex: 4001, background: "var(--card)", border: "1px solid var(--border2)", borderRadius: 14, padding: 18, boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 700, marginBottom: 6 }}>{i + 1} / {steps.length}</div>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px", color: "var(--text)" }}>{t(step.titleKey)}</h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text2)", margin: "0 0 16px" }}>{t(step.textKey)}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onDone} style={{ ...btnSecondary, fontSize: 13, padding: "6px 12px" }}>{t("tour.skip")}</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {i > 0 && <button onClick={back} style={{ ...btnSecondary, fontSize: 13, padding: "6px 12px" }}>{t("tour.back")}</button>}
            <button onClick={next} style={{ ...btnPrimary, fontSize: 13, padding: "6px 14px" }}>{last ? t("tour.done") : t("tour.next")}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// Schritte der Kern-Tour (Navbar erklären).
export const KERN_TOUR = [
  { target: null, titleKey: "tour.k.welcome.t", textKey: "tour.k.welcome.x" },
  { target: "nav", titleKey: "tour.k.nav.t", textKey: "tour.k.nav.x" },
  { target: "home", titleKey: "tour.k.home.t", textKey: "tour.k.home.x" },
  { target: "modules", titleKey: "tour.k.modules.t", textKey: "tour.k.modules.x" },
  { target: "profile", titleKey: "tour.k.profile.t", textKey: "tour.k.profile.x" },
  { target: null, titleKey: "tour.k.done.t", textKey: "tour.k.done.x" },
];

// Touren je Modul. Schlüssel = Tour-Id; die target-Werte zeigen auf data-tour-
// Marker auf der jeweiligen Modulseite. Ein neues Modul braucht nur Marker +
// eine Schrittliste hier (und i18n tour.<id>.*).
export const MODULE_TOURS = {
  kalender: [
    { target: null, titleKey: "tour.kalender.welcome.t", textKey: "tour.kalender.welcome.x" },
    { target: "kal-views", titleKey: "tour.kalender.views.t", textKey: "tour.kalender.views.x" },
    { target: "kal-new", titleKey: "tour.kalender.new.t", textKey: "tour.kalender.new.x" },
    { target: "kal-view-menu", titleKey: "tour.kalender.viewmenu.t", textKey: "tour.kalender.viewmenu.x" },
    { target: null, titleKey: "tour.kalender.done.t", textKey: "tour.kalender.done.x" },
  ],
  noten: [
    { target: null, titleKey: "tour.noten.welcome.t", textKey: "tour.noten.welcome.x" },
    { target: "noten-class", titleKey: "tour.noten.class.t", textKey: "tour.noten.class.x" },
    { target: "noten-add", titleKey: "tour.noten.add.t", textKey: "tour.noten.add.x" },
    { target: null, titleKey: "tour.noten.done.t", textKey: "tour.noten.done.x" },
  ],
  klassenarbeit: [
    { target: null, titleKey: "tour.klassenarbeit.welcome.t", textKey: "tour.klassenarbeit.welcome.x" },
    { target: "ka-class", titleKey: "tour.klassenarbeit.class.t", textKey: "tour.klassenarbeit.class.x" },
    { target: "ka-new", titleKey: "tour.klassenarbeit.new.t", textKey: "tour.klassenarbeit.new.x" },
    { target: null, titleKey: "tour.klassenarbeit.done.t", textKey: "tour.klassenarbeit.done.x" },
  ],
  karten: [
    { target: null, titleKey: "tour.karten.welcome.t", textKey: "tour.karten.welcome.x" },
    { target: "karten-class", titleKey: "tour.karten.class.t", textKey: "tour.karten.class.x" },
    { target: "karten-new", titleKey: "tour.karten.new.t", textKey: "tour.karten.new.x" },
    { target: null, titleKey: "tour.karten.done.t", textKey: "tour.karten.done.x" },
  ],
};

// Route-Präfix → Tour-Id (für Auto-Start beim ersten Besuch der Modulseite).
export const PATH_TOUR = [
  ["/kalender", "kalender"],
  ["/noten", "noten"],
  ["/klassenarbeit", "klassenarbeit"],
  ["/karten", "karten"],
];

export function tourFor(id) {
  return id === "kern" || !id ? KERN_TOUR : (MODULE_TOURS[id] || null);
}
