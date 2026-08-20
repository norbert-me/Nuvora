// Module zuschalten und abschalten. Abschalten blendet nur aus — die Daten
// des Moduls bleiben im Kern liegen und sind nach dem Wiedereinschalten da.
import { useState } from "react";
import { useModules } from "../core/modules.js";
import { badge, btnSecondary, btnSmall, cardStyle, COLORS as C, CONTROL_R, DialogKopf, Icon, ICONS, Modal, MODULE_ICONS, pageApp, pageIntro, pageTitle, panelStyle, sectionLabel, Segment, segmentBtn, StageBadge, Tabs, Toggle, toolbarBtn, toolbarInput } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

// Ausführlichere Erklärung je Modul für das Info-Popup in der Auswahl. Nutzt
// die bereits vorhandenen Seiten-Intros wieder (die dort nicht mehr angezeigt
// werden), sonst die Kurzbeschreibung.
const HELP_KEY = {
  klassenarbeit: "klassenarbeit.hint",
  methoden: "methoden.intro",
  orga: "orga.hint",
  ausleihe: "ausleihe.hint",
};

import { askConfirm } from "../core/dialog.jsx";

export default function Modules() {
  const { t } = useLanguage();
  const { modules, loading, toggle, setOption } = useModules();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState("popular"); // popular | name | status
  const [dir, setDir] = useState("asc");           // asc | desc
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});    // je Kategorie ausgeklappt?
  const [helpMod, setHelpMod] = useState(null);    // Modul für das Erklär-Popup

  if (loading) return null;

  const dispName = (m) => (t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name);
  const descOf = (m) => (t(`mod.${m.key}.desc`) !== `mod.${m.key}.desc` ? t(`mod.${m.key}.desc`) : m.description) || "";
  const helpOf = (m) => {
    const hk = `mod.${m.key}.help`;
    if (t(hk) !== hk) return t(hk);
    const k = HELP_KEY[m.key]; const h = k && t(k) !== k ? t(k) : "";
    return h || descOf(m);
  };
  const imgOf = (m) => { const ik = `mod.${m.key}.img`; return t(ik) !== ik ? t(ik) : ""; };
  // Neuer Nutzer ohne aktives Modul: nach Beliebtheit vorsortieren, damit der
  // Einstieg nicht bei einer alphabetischen Wand aus 12 Namen beginnt.
  const noneActive = modules.every((m) => !m.active);
  const effKey = sortKey === "name" && noneActive ? "popular" : sortKey;
  // „Beliebt" = die meistgenutzten Module (Top 5 mit >0 Aktivierungen).
  const beliebt = new Set([...modules].filter((m) => m.popularity > 0)
    .sort((a, b) => b.popularity - a.popularity).slice(0, 5).map((m) => m.key));
  const sorted = [...modules].sort((a, b) => {
    // Status aufsteigend = aktive zuerst; bei Gleichstand alphabetisch.
    const r = effKey === "status"
      ? (a.active === b.active ? dispName(a).localeCompare(dispName(b)) : (a.active ? -1 : 1))
      : effKey === "popular"
        ? ((b.popularity || 0) - (a.popularity || 0)) || dispName(a).localeCompare(dispName(b))
        : dispName(a).localeCompare(dispName(b));
    return dir === "asc" ? r : -r;
  });

  const handle = async (m) => {
    // Beim Deaktivieren beruhigen: der Inhalt bleibt erhalten, nur der Zugang geht.
    if (m.active && !(await askConfirm(t("modules.deactivateConfirm", { name: dispName(m) })))) return;
    setBusy(m.key);
    setError("");
    try {
      await toggle(m.key, !m.active);
    } catch (e) {
      setError(e.message || t("modules.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ ...pageApp }}>
      <h1 style={pageTitle}>{t("modules.title")}</h1>
      <p style={pageIntro}>{t("modules.intro")}</p>

      {error && (
        <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}

      {noneActive && beliebt.size > 0 && (
        <p style={{ ...panelStyle, fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>
          {t("modules.startHint")}
        </p>
      )}

      {/* Eine Leiste: Suchfeld, Reiter und Richtungsknopf auf CONTROL_H. Der
          Richtungsknopf gehoert zur Sortierung — deshalb als Segment AN den
          Reitern statt lose daneben. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("modules.searchPlaceholder")}
          style={{ ...toolbarInput, flex: "1 1 200px", minWidth: 0 }} />
        <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("modules.sortBy")}</span>
        <Segment>
          {/* In der Segment-Gruppe: keine eigenen Ecken, die bringt die Gruppe mit. */}
          <Tabs value={effKey} onChange={setSortKey} style={{ border: "none", borderRadius: 0, height: "100%" }}
            options={[["name", t("modules.sortName")], ["status", t("modules.sortStatus")], ["popular", t("modules.sortPopular")]]} />
          <button onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} title={t("modules.sortDir")}
            className="icon-btn" aria-label={t("modules.sortDir")}
            style={{ ...segmentBtn, color: "var(--text2)" }}>
            <Icon d={dir === "asc" ? ICONS.arrowUp : ICONS.arrowDown} size={16} />
          </button>
        </Segment>
      </div>

      {[["unterricht", t("modules.groupUnterricht")], ["organisation", t("modules.groupOrganisation")], ["werkzeug", t("modules.groupWerkzeug")]].map(([g, label]) => {
        const q = search.trim().toLowerCase();
        const desc = (m) => (t(`mod.${m.key}.desc`) !== `mod.${m.key}.desc` ? t(`mod.${m.key}.desc`) : m.description) || "";
        const matches = (m) => !q || dispName(m).toLowerCase().includes(q) || desc(m).toLowerCase().includes(q);
        const all = sorted.filter((m) => (m.group || "werkzeug") === g && matches(m));
        if (!all.length) return null;
        const open = !!q || expanded[g];
        const mods = open ? all : all.slice(0, 2);
        return (
        <div key={g} style={{ marginBottom: 24 }}>
          <h2 style={{ ...sectionLabel, margin: "0 0 8px" }}>{label}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mods.map((m) => (
          <div
            key={m.key}
            style={{ ...cardStyle, display: "flex", alignItems: "flex-start", gap: 16 }}
          >
            {MODULE_ICONS[m.key] && (
              <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: CONTROL_R, display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg2, var(--bg))", color: m.active ? "var(--text)" : "var(--text3)" }}>
                <Icon d={MODULE_ICONS[m.key]} size={22} color="currentColor" />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                {t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name}
                {" "}<StageBadge stage={m.stage} title={m.stage === "beta" ? t("stage.betaHint") : t("stage.alphaHint")} />
                {beliebt.has(m.key) && !m.active && (
                  <span title={t("modules.popularHint", { n: m.popularity })} style={{ ...badge(C.success), marginLeft: 8 }}>
                    {t("modules.popularBadge")}
                  </span>
                )}
                {!m.available && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)", marginLeft: 8 }}>
                    {t("modules.notAvailable")}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6 }}>
                {descOf(m)}
                {" "}
                <button onClick={() => setHelpMod(m)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {t("modules.more")} ›
                </button>
              </div>
              {/* Abschaltbare Teile — nur bei aktivem Modul. An einem
                  abgeschalteten waeren es Einstellungen an etwas, das es fuer
                  diese Lehrkraft gerade nicht gibt. */}
              {m.active && (m.optionen || []).length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  <div style={{ ...sectionLabel, margin: "0 0 8px" }}>{t("modules.parts")}</div>
                  {m.optionen.map((o) => (
                    <div key={o.key} style={{ marginBottom: 8 }}>
                      <Toggle
                        checked={(m.optionen_an || {})[o.key] !== false}
                        onChange={(v) => { setBusy(`${m.key}:${o.key}`); setOption(m.key, o.key, v).finally(() => setBusy(null)); }}
                        label={o.name}
                      />
                      {o.description && (
                        // 46 = Breite des Schalters (38) + Abstand (8), wie im
                        // ViewMenu: der Hinweis beginnt unter der Beschriftung.
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, marginLeft: 46 }}>{o.description}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => handle(m)}
              disabled={busy === m.key || !m.available}
              // Der Aktivieren-Knopf bleibt in der Akzentfarbe: er ist der eine
              // Handgriff der Seite und soll aus der Karte herausstechen. Form
              // und Hoehe kommen trotzdem aus der Leisten-Bauform.
              style={{
                ...toolbarBtn, flexShrink: 0, fontWeight: 600,
                cursor: m.available ? "pointer" : "not-allowed",
                border: m.active ? "1px solid var(--border)" : "none",
                background: m.active ? "transparent" : "var(--accent)",
                color: m.active ? "var(--text2)" : C.aufAkzent,
                opacity: busy === m.key || !m.available ? 0.5 : 1,
              }}
            >
              {m.active ? t("modules.deactivate") : t("modules.activate")}
            </button>
          </div>
        ))}
          </div>
          {all.length > 2 && !q && (
            <button onClick={() => setExpanded((p) => ({ ...p, [g]: !p[g] }))}
              style={{ ...btnSecondary, ...btnSmall, marginTop: 8 }}>
              {expanded[g] ? t("modules.showLess") : t("modules.showMore", { n: all.length - 2 })}
            </button>
          )}
        </div>
        );
      })}

      {helpMod && (
        <Modal onClose={() => setHelpMod(null)} width={520} style={{ maxHeight: "86vh", overflowY: "auto" }} label={dispName(helpMod)}>
            <DialogKopf titel={dispName(helpMod)} onClose={() => setHelpMod(null)} schliessenLabel={t("common.close")}>
              <StageBadge stage={helpMod.stage} title={helpMod.stage === "beta" ? t("stage.betaHint") : t("stage.alphaHint")} />
            </DialogKopf>
            <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, margin: "0 0 4px", whiteSpace: "pre-wrap" }}>{helpOf(helpMod)}</p>
            <ModuleIllos mkey={helpMod.key} t={t} />
            {t(`mod.${helpMod.key}.sr`) !== `mod.${helpMod.key}.sr` && (
              <Collapsible title={t("karten.srTitle")}>
                <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.7, margin: "0 0 10px", whiteSpace: "pre-wrap" }}>{t(`mod.${helpMod.key}.sr`)}</p>
                <SpacingIllo caption={t(`mod.${helpMod.key}.ill3`)} />
              </Collapsible>
            )}
            {!hasIllos(helpMod.key) && imgOf(helpMod) && (
              <div style={{ ...panelStyle, marginTop: 12, border: "1px dashed var(--border2)", padding: 16, textAlign: "center" }}>
                <div style={{ marginBottom: 4, opacity: 0.5, color: "var(--text3)" }}><Icon d={ICONS.image} size={22} /></div>
                <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>{imgOf(helpMod)}</div>
              </div>
            )}
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button onClick={() => setHelpMod(null)} style={btnSecondary}>{t("common.close")}</button>
            </div>
        </Modal>
      )}
    </div>
  );
}

// Module mit eigenen (SVG-)Illustrationen im Erklär-Popup. Für andere bleibt der
// Text-Platzhalter (imgOf) erhalten.
function hasIllos(key) { return key === "karten"; }

function ModuleIllos({ mkey, t }) {
  if (mkey !== "karten") return null;
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0 2px" }}>
      <IlloFrame caption={t("mod.karten.ill1")}><CardIllo /></IlloFrame>
      <IlloFrame caption={t("mod.karten.ill2")}><QrIllo /></IlloFrame>
    </div>
  );
}

function IlloFrame({ children, caption }) {
  return (
    <figure style={{ ...panelStyle, margin: 0, flex: "1 1 200px", minWidth: 180, padding: "12px 12px 8px", textAlign: "center" }}>
      {children}
      <figcaption style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.45, marginTop: 8 }}>{caption}</figcaption>
    </figure>
  );
}

// Vorder-/Rückseite: Frage links, Antwort rechts, dazwischen der „Umdrehen"-Pfeil.
function CardIllo() {
  return (
    <svg viewBox="0 0 168 92" width="100%" height="84" style={{ display: "block" }} aria-hidden="true">
      <rect x="6" y="14" width="64" height="64" rx="10" fill="var(--card)" stroke="var(--accent)" strokeWidth="2" />
      <text x="38" y="44" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--text)">7·8</text>
      <text x="38" y="64" textAnchor="middle" fontSize="15" fill="var(--text3)">?</text>
      <path d="M78 40a8 8 0 0116 0M78 52a8 8 0 0016 0" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round" />
      <path d="M92 36l2 6-6 1M80 56l-2-6 6-1" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="98" y="14" width="64" height="64" rx="10" fill="var(--card)" stroke="var(--border2)" strokeWidth="2" />
      <text x="130" y="52" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--accent)">56</text>
    </svg>
  );
}

// Üben ohne Konto: QR-Code, Pfeil, Gerät mit Häkchen.
function QrIllo() {
  return (
    <svg viewBox="0 0 168 92" width="100%" height="84" style={{ display: "block" }} aria-hidden="true">
      <rect x="8" y="18" width="56" height="56" rx="8" fill="var(--card)" stroke="var(--border2)" strokeWidth="2" />
      <rect x="16" y="26" width="14" height="14" rx="3" fill="none" stroke="var(--text2)" strokeWidth="2.5" />
      <rect x="42" y="26" width="14" height="14" rx="3" fill="none" stroke="var(--text2)" strokeWidth="2.5" />
      <rect x="16" y="52" width="14" height="14" rx="3" fill="none" stroke="var(--text2)" strokeWidth="2.5" />
      <rect x="44" y="52" width="4" height="4" fill="var(--text2)" />
      <rect x="52" y="52" width="4" height="4" fill="var(--text2)" />
      <rect x="44" y="60" width="4" height="4" fill="var(--text2)" />
      <path d="M74 46h18m0 0l-5-5m5 5l-5 5" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="104" y="12" width="42" height="68" rx="9" fill="var(--card)" stroke="var(--border2)" strokeWidth="2" />
      <path d="M113 46l7 7 13-15" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Wachsende Wiederholungs-Abstände auf einer Zeitachse.
function SpacingIllo({ caption }) {
  const xs = [14, 40, 84, 152, 232];
  const labels = ["heute", "1 T", "3 T", "1 Wo", "3 Wo"];
  return (
    <figure style={{ ...panelStyle, margin: 0, padding: "16px 12px 8px", textAlign: "center" }}>
      <svg viewBox="0 0 248 60" width="100%" height="56" style={{ display: "block" }} aria-hidden="true">
        <line x1="10" y1="30" x2="240" y2="30" stroke="var(--border2)" strokeWidth="2" />
        {xs.map((x, i) => (
          <g key={x}>
            <circle cx={x} cy="30" r={i === 0 ? 4 : 5} fill={i === 0 ? "var(--text3)" : "var(--accent)"} />
            <text x={x} y="50" textAnchor="middle" fontSize="10" fill="var(--text3)">{labels[i]}</text>
          </g>
        ))}
      </svg>
      <figcaption style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.45, marginTop: 4 }}>{caption}</figcaption>
    </figure>
  );
}

function Collapsible({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...panelStyle, marginTop: 12, padding: 0, background: "transparent", overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 12, background: "var(--bg3)", border: "none", cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "left" }}>
        <span>{title}</span>
        <span style={{ color: "var(--text3)", display: "inline-flex" }}><Icon d={open ? ICONS.chevronUp : ICONS.chevronDown} size={14} /></span>
      </button>
      {open && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
}
