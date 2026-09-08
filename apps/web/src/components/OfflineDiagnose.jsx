// Warum geht es hier nicht offline?
//
// Offline steht und faellt mit dem Service-Worker, und der laeuft nur im
// „secure context" — https oder localhost. Im Schulnetz ueber
// `http://192.168.x.y:8090` gibt es ihn schlicht nicht: keine gecachten
// Seiten, keine Daten, kein Offline-Schreiben. Das sieht man der App nicht an,
// sie wirkt nur „kaputt, sobald das Netz weg ist" — und der Verdacht faellt auf
// Nuvora statt auf die Adresse.
//
// Deshalb sagt es das Geraet hier selbst. Gezeigt wird ausschliesslich, was
// eine Antwort auf „woran liegt es?" gibt; jede Zeile hat eine Handlung oder
// eine klare Aussage. Keine Diagnose um der Vollstaendigkeit willen.
import { useCallback, useEffect, useState } from "react";

import { btnSecondary, COLORS as C, CONTROL_R, Icon, ICONS } from "./Icons.jsx";
import { dauerhaftAnfragen } from "../core/ablage.js";
import { count as outboxCount, fehler as outboxFehler } from "../core/outbox.js";
import { vorladen } from "../core/vorladen.js";
import { useLanguage } from "../i18n/index.jsx";

function Zeile({ ok, titel, text }) {
  const farbe = ok === null ? "var(--text3)" : ok ? C.success : C.danger;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
      <span style={{ marginTop: 2, display: "inline-flex", flexShrink: 0 }}>
        <Icon d={ok === null ? ICONS.info : ok ? ICONS.check : ICONS.close} size={14} color={farbe} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{titel}</span>
        {text && <span style={{ display: "block", fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{text}</span>}
      </span>
    </div>
  );
}

export default function OfflineDiagnose() {
  const { t } = useLanguage();
  const [stand, setStand] = useState(null);
  const [laeuft, setLaeuft] = useState(false);

  const messen = useCallback(async () => {
    const sicher = typeof window !== "undefined" && window.isSecureContext;
    let sw = null;
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      sw = { anzahl: regs.length, steuert: !!navigator.serviceWorker.controller };
    }
    let namen = [];
    try { namen = await caches.keys(); } catch { /* kein Cache-Zugriff: dann bleibt die Liste leer */ }
    let platz = null;
    try { platz = await navigator.storage.estimate(); } catch { /* Safari meldet das nicht immer */ }
    let dauerhaft = null;
    try { dauerhaft = await navigator.storage.persisted(); } catch { /* dito */ }
    let zuletzt = 0;
    try { zuletzt = Number(localStorage.getItem("nuvora:vorgeladen") || 0); } catch { /* egal */ }
    setStand({ sicher, sw, namen, platz, dauerhaft, zuletzt, wartend: await outboxCount(), fehler: outboxFehler().length });
  }, []);

  useEffect(() => { messen(); }, [messen]);

  if (!stand) return null;
  const mb = (n) => `${Math.round((n || 0) / 1048576)} MB`;
  const wann = stand.zuletzt ? new Date(stand.zuletzt).toLocaleString() : "";

  const vorbereiten = async () => {
    setLaeuft(true);
    // Dauerhafte Ablage anfragen: iOS raeumt den Speicher einer Seite auf, die
    // wochenlang niemand oeffnet. Der Browser darf ablehnen — dann steht es in
    // der Zeile darueber, statt still zu scheitern.
    await dauerhaftAnfragen();
    await vorladen({ erzwingen: true });
    await messen();
    setLaeuft(false);
  };

  return (
    <div>
      <Zeile ok={stand.sicher} titel={t("offline.sicher")}
        text={stand.sicher ? "" : t("offline.sicherNein")} />
      <Zeile ok={stand.sw ? stand.sw.anzahl > 0 && stand.sw.steuert : false}
        titel={t("offline.worker")}
        text={!stand.sw ? t("offline.workerFehlt")
          : stand.sw.anzahl === 0 ? t("offline.workerKeiner")
          : !stand.sw.steuert ? t("offline.workerUngesteuert") : ""} />
      <Zeile ok={stand.namen.length > 0} titel={t("offline.caches")}
        text={stand.namen.length ? stand.namen.join(", ") : t("offline.cachesLeer")} />
      <Zeile ok={!!stand.zuletzt} titel={t("offline.vorrat")}
        text={stand.zuletzt ? t("offline.vorratWann", { wann }) : t("offline.vorratNie")} />
      <Zeile ok={stand.dauerhaft === null ? null : stand.dauerhaft} titel={t("offline.dauerhaft")}
        text={stand.dauerhaft === null ? t("offline.dauerhaftUnbekannt")
          : stand.dauerhaft ? "" : t("offline.dauerhaftNein")} />
      {stand.platz && (
        <Zeile ok={null} titel={t("offline.platz")}
          text={`${mb(stand.platz.usage)} / ${mb(stand.platz.quota)}`} />
      )}
      <Zeile ok={stand.fehler === 0} titel={t("offline.warteschlange")}
        text={t("offline.warteschlangeText", { n: stand.wartend, f: stand.fehler })} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={vorbereiten} disabled={laeuft} style={{ ...btnSecondary, opacity: laeuft ? 0.6 : 1 }}>
          {laeuft ? t("offline.laeuft") : t("offline.vorbereiten")}
        </button>
        <button type="button" onClick={messen} style={btnSecondary}>{t("offline.neuMessen")}</button>
      </div>
      {!stand.sicher && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: CONTROL_R, background: C.warning + "1f", fontSize: 12, color: "var(--text)" }}>
          {t("offline.httpsHinweis")}
        </div>
      )}
    </div>
  );
}
