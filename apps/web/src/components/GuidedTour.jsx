// Geführte Tour: hebt der Reihe nach ein Element hervor (Spotlight) und erklärt
// es in einer Sprechblase daneben. Schritt für Schritt „Weiter", jederzeit
// „Überspringen". Ein Schritt ohne Ziel (target=null) zeigt eine zentrierte
// Karte (Begrüßung/Abschluss). Ziel-Elemente werden über data-tour="<key>"
// gefunden; fehlt eines, wird der Schritt zentriert gezeigt.
import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { btnPrimary, btnSecondary, btnSmall, cardStyle, panelStyle, SHADOW } from "./Icons.jsx";

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
    borderRadius: panelStyle.borderRadius,
    // Kein SHADOW-Token: das ist kein Schatten, sondern der Abdunkler ringsum —
    // ein Rahmen von 9999 px, der alles ausserhalb des Ziels verdeckt.
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
    zIndex: 4000, pointerEvents: "none", transition: "all 0.2s ease",
  };

  // Sprechblase unter dem Ziel, sonst darüber; ohne Ziel zentriert.
  const vh = window.innerHeight, vw = window.innerWidth;
  let tip;
  if (rect) {
    const below = rect.top + rect.height + pad + 12 + 180 < vh;
    const top = below ? rect.top + rect.height + pad + 12 : Math.max(12, rect.top - pad - 12 - 180);
    // Auf schmalen Geraeten passt die feste Breite nicht — dann den Rand nutzen.
    const breite = Math.min(320, vw - 24);
    let left = Math.min(Math.max(12, rect.left), Math.max(12, vw - breite - 12));
    tip = { position: "fixed", top, left, width: breite };
  } else {
    tip = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: Math.min(340, vw - 24) };
  }

  return (
    <>
      {/* Voller Abdunkler, wenn kein Ziel; sonst macht die box-shadow das Loch. */}
      {!rect && <div onClick={onDone} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", zIndex: 4000 }} />}
      {rect && <div style={hole} />}
      <div style={{ ...cardStyle, ...tip, zIndex: 4001, boxShadow: SHADOW.schwebend }}>
        <div style={{ fontSize: 12, color: "var(--text3)", fontWeight: 700, marginBottom: 4 }}>{i + 1} / {steps.length}</div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px", color: "var(--text)" }}>{t(step.titleKey)}</h3>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text2)", margin: "0 0 16px" }}>{t(step.textKey)}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onDone} style={{ ...btnSecondary, ...btnSmall }}>{t("tour.skip")}</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {i > 0 && <button onClick={back} style={{ ...btnSecondary, ...btnSmall }}>{t("tour.back")}</button>}
            <button onClick={next} style={{ ...btnPrimary, ...btnSmall }}>{last ? t("tour.done") : t("tour.next")}</button>
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
  // Kein Schritt für die Kursauswahl: die Sammlung (Standard-Reiter) hat keine,
  // die Auswahl steht nur bei Fortschritt und QR-Zugängen.
  karten: [
    { target: null, titleKey: "tour.karten.welcome.t", textKey: "tour.karten.welcome.x" },
    { target: "karten-new", titleKey: "tour.karten.new.t", textKey: "tour.karten.new.x" },
    { target: null, titleKey: "tour.karten.done.t", textKey: "tour.karten.done.x" },
  ],
  cardvote: [
    { target: null, titleKey: "tour.cardvote.welcome.t", textKey: "tour.cardvote.welcome.x" },
    { target: "cv-ordner", titleKey: "tour.cardvote.folders.t", textKey: "tour.cardvote.folders.x" },
    { target: "cv-neu", titleKey: "tour.cardvote.new.t", textKey: "tour.cardvote.new.x" },
    { target: null, titleKey: "tour.cardvote.done.t", textKey: "tour.cardvote.done.x" },
  ],
  // Anker in public/lp/index.html, nur im Reiter „Aufgaben“. Die Statik wird
  // erst nach dem Seitenaufruf eingehaengt; bis „Weiter“ steht sie.
  lernpfad: [
    { target: null, titleKey: "tour.lernpfad.welcome.t", textKey: "tour.lernpfad.welcome.x" },
    { target: "lp-neu", titleKey: "tour.lernpfad.new.t", textKey: "tour.lernpfad.new.x" },
    { target: "lp-liste", titleKey: "tour.lernpfad.list.t", textKey: "tour.lernpfad.list.x" },
    { target: null, titleKey: "tour.lernpfad.done.t", textKey: "tour.lernpfad.done.x" },
  ],
  // Nur der Reiter „Checklisten“ traegt Anker; die anderen Reiter sind eigene
  // Seiten (tourFuerOrt startet die Tour nur dort).
  orga: [
    { target: null, titleKey: "tour.orga.welcome.t", textKey: "tour.orga.welcome.x" },
    { target: "orga-neu", titleKey: "tour.orga.new.t", textKey: "tour.orga.new.x" },
    { target: null, titleKey: "tour.orga.done.t", textKey: "tour.orga.done.x" },
  ],
  personen: [
    { target: null, titleKey: "tour.personen.welcome.t", textKey: "tour.personen.welcome.x" },
    { target: "personen-suche", titleKey: "tour.personen.search.t", textKey: "tour.personen.search.x" },
    { target: "personen-neu", titleKey: "tour.personen.new.t", textKey: "tour.personen.new.x" },
    { target: "personen-kind", titleKey: "tour.personen.list.t", textKey: "tour.personen.list.x" },
    { target: null, titleKey: "tour.personen.done.t", textKey: "tour.personen.done.x" },
  ],
  pap: [
    { target: null, titleKey: "tour.pap.welcome.t", textKey: "tour.pap.welcome.x" },
    { target: "pap-blatt", titleKey: "tour.pap.blatt.t", textKey: "tour.pap.blatt.x" },
    { target: "pap-austeilen", titleKey: "tour.pap.austeilen.t", textKey: "tour.pap.austeilen.x" },
    { target: null, titleKey: "tour.pap.done.t", textKey: "tour.pap.done.x" },
  ],
  papAufgaben: [
    { target: null, titleKey: "tour.papAufgaben.welcome.t", textKey: "tour.papAufgaben.welcome.x" },
    { target: "pap-aufgabe-neu", titleKey: "tour.papAufgaben.new.t", textKey: "tour.papAufgaben.new.x" },
    { target: null, titleKey: "tour.papAufgaben.done.t", textKey: "tour.papAufgaben.done.x" },
  ],
  tafel: [
    { target: null, titleKey: "tour.tafel.welcome.t", textKey: "tour.tafel.welcome.x" },
    { target: "tafel-text", titleKey: "tour.tafel.text.t", textKey: "tour.tafel.text.x" },
    { target: "tafel-timer", titleKey: "tour.tafel.timer.t", textKey: "tour.tafel.timer.x" },
    { target: "tafel-speichern", titleKey: "tour.tafel.save.t", textKey: "tour.tafel.save.x" },
    { target: null, titleKey: "tour.tafel.done.t", textKey: "tour.tafel.done.x" },
  ],
  zufall: [
    { target: null, titleKey: "tour.zufall.welcome.t", textKey: "tour.zufall.welcome.x" },
    { target: "zufall-niveau", titleKey: "tour.zufall.niveau.t", textKey: "tour.zufall.niveau.x" },
    { target: "zufall-ziehen", titleKey: "tour.zufall.draw.t", textKey: "tour.zufall.draw.x" },
    { target: null, titleKey: "tour.zufall.done.t", textKey: "tour.zufall.done.x" },
  ],
  notizbrett: [
    { target: null, titleKey: "tour.notizbrett.welcome.t", textKey: "tour.notizbrett.welcome.x" },
    { target: "nb-neu", titleKey: "tour.notizbrett.new.t", textKey: "tour.notizbrett.new.x" },
    { target: null, titleKey: "tour.notizbrett.done.t", textKey: "tour.notizbrett.done.x" },
  ],
  todo: [
    { target: null, titleKey: "tour.todo.welcome.t", textKey: "tour.todo.welcome.x" },
    { target: "todo-neu", titleKey: "tour.todo.new.t", textKey: "tour.todo.new.x" },
    { target: null, titleKey: "tour.todo.done.t", textKey: "tour.todo.done.x" },
  ],
  unterrichtsplanung: [
    { target: null, titleKey: "tour.einstiege.welcome.t", textKey: "tour.einstiege.welcome.x" },
    { target: "ein-neu", titleKey: "tour.einstiege.new.t", textKey: "tour.einstiege.new.x" },
    { target: "ein-ordner", titleKey: "tour.einstiege.ordner.t", textKey: "tour.einstiege.ordner.x" },
    { target: null, titleKey: "tour.einstiege.done.t", textKey: "tour.einstiege.done.x" },
  ],
  mathespiele: [
    { target: null, titleKey: "tour.mathespiele.welcome.t", textKey: "tour.mathespiele.welcome.x" },
    { target: "ms-zahlenraum", titleKey: "tour.mathespiele.range.t", textKey: "tour.mathespiele.range.x" },
    { target: "ms-rechenarten", titleKey: "tour.mathespiele.ops.t", textKey: "tour.mathespiele.ops.x" },
    { target: "ms-feld", titleKey: "tour.mathespiele.feld.t", textKey: "tour.mathespiele.feld.x" },
    { target: null, titleKey: "tour.mathespiele.done.t", textKey: "tour.mathespiele.done.x" },
  ],
  "code-detektiv": [
    { target: null, titleKey: "tour.cd.welcome.t", textKey: "tour.cd.welcome.x" },
    { target: "cd-form", titleKey: "tour.cd.form.t", textKey: "tour.cd.form.x" },
    { target: "cd-loesung", titleKey: "tour.cd.loesung.t", textKey: "tour.cd.loesung.x" },
    { target: "cd-session", titleKey: "tour.cd.session.t", textKey: "tour.cd.session.x" },
    { target: null, titleKey: "tour.cd.done.t", textKey: "tour.cd.done.x" },
  ],
};

// Welche Tour gehört zu diesem Ort? Auf /auswertung entscheidet der Reiter:
// dieselbe Adresse zeigt Notenbuch oder Klassenarbeiten (?tab=…).
export function tourFuerOrt(pathname, search = "") {
  const tab = new URLSearchParams(search).get("tab");
  if (pathname.startsWith("/auswertung")) {
    return tab === "klassenarbeit" ? "klassenarbeit" : "noten";
  }
  // Auch hier entscheidet der Reiter: eine Tour, deren Anker auf einem anderen
  // Reiter stehen, zeigte nur zentrierte Karten.
  // /pap-frei ist die offene Seite ohne Konto — dort gibt es keine Tour.
  if (pathname.startsWith("/pap")) return pathname === "/pap" ? (tab === "aufgaben" ? "papAufgaben" : "pap") : null;
  if (pathname.startsWith("/notizbrett")) {
    return tab === "aufgaben" || new URLSearchParams(search).get("todo") ? "todo" : "notizbrett";
  }
  if (pathname.startsWith("/orga")) return !tab || tab === "checklisten" ? "orga" : null;
  if (pathname.startsWith("/lernpfad")) return !tab || tab === "aufgaben" ? "lernpfad" : null;
  if (pathname.startsWith("/zufall")) return tab === "gruppen" ? null : "zufall";
  // Code-Detektiv: nur „Rätsel erstellen" (Start und /admin) trägt Anker.
  if (pathname.startsWith("/code-detektiv")) {
    return /^\/code-detektiv(\/admin)?\/?$/.test(pathname) ? "code-detektiv" : null;
  }
  const hit = PATH_TOUR.find(([p]) => pathname.startsWith(p));
  return hit ? hit[1] : null;
}

// Route-Präfix → Tour-Id (für Auto-Start beim ersten Besuch der Modulseite).
// /auswertung steht hier mit der Notenbuch-Tour; den Reiter beachtet
// `tourFuerOrt` — wer eine Tour zum Ort sucht, fragt dort.
const auswertungTour = ["/auswertung", "noten"];
export const PATH_TOUR = [
  ["/kalender", "kalender"],
  auswertungTour,
  ["/karten", "karten"],
  // CardVote: nur die Fragen-Seite hat Anker, nicht Session, Scanner, Tests.
  ["/cardvote/questions", "cardvote"],
  ["/lernpfad", "lernpfad"],
  ["/orga", "orga"],
  ["/personen", "personen"],
  ["/pap", "pap"],
  ["/tafel", "tafel"],
  ["/zufall", "zufall"],
  ["/notizbrett", "notizbrett"],
  ["/unterrichtsplanung", "unterrichtsplanung"],
  ["/mathespiele", "mathespiele"],
  ["/code-detektiv", "code-detektiv"],
];

export function tourFor(id) {
  return id === "kern" || !id ? KERN_TOUR : (MODULE_TOURS[id] || null);
}
