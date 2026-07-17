import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";
const ANSWER_COLORS = { A: "#0066cc", B: "#5856d6", C: "#b8860b", D: "#d1350f" };

export default function Scanner() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const [sessionId, setSessionId] = useState(() => searchParams.get("session") || "");
  const resolvedIdRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [lastCards, setLastCards] = useState([]);
  const [status, setStatus] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [debug, setDebug] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [sessionError, setSessionError] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [classStudents, setClassStudents] = useState([]);
  const [recentlyScanned, setRecentlyScanned] = useState([]);
  const [hostRevealed, setHostRevealed] = useState(false);
  const [hostIsLast, setHostIsLast] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const recentTimers = useRef({});
  const confirmBuffer = useRef({});
  const CONFIRM_COUNT = 2;
  const SCAN_GAP_MS = 120; // Mindestpause zwischen zwei Scans
  const scanLoopActive = useRef(false);
  const scanInFlight = useRef(false);
  const intervalRef = useRef(null);
  const infoTimer = useRef(null);
  const wsRef = useRef(null);
  const lastSeenCards = useRef({});

  // Kamera erst starten, wenn Scannen beginnt (nicht beim Seitenaufruf)
  const startCamera = async () => {
    if (streamRef.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
      return true;
    } catch {
      setStatus(t("scanner.cameraDenied"));
      return false;
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  useEffect(() => {
    return () => {
      scanLoopActive.current = false;
      if (intervalRef.current) clearTimeout(intervalRef.current);
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const connectWs = useCallback((sid) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/session/${sid}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: localStorage.getItem("token") || "" }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "next_question") {
          setLastCards([]);
          setRecentlyScanned([]);
          setHostRevealed(false);
          confirmBuffer.current = {};
          lastSeenCards.current = {};
          setStatus(t("scanner.newQuestion"));
          if (overlayRef.current) {
            const ctx = overlayRef.current.getContext("2d");
            ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
          }
        }
        if (msg.type === "host_state") {
          setHostRevealed(!!msg.revealed);
          setHostIsLast(!!msg.is_last);
        }
        if (msg.type === "session_finished") {
          scanLoopActive.current = false;
          clearTimeout(intervalRef.current);
          intervalRef.current = null;
          setScanning(false);
          setSessionFinished(true);
          setStatus(t("scanner.finishedTitle"));
        }
      } catch {}
    };
    ws.onclose = () => { wsRef.current = null; };
    wsRef.current = ws;
  }, []);

  const debugRef = useRef(debug);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  const classStudentsRef = useRef(classStudents);
  useEffect(() => { classStudentsRef.current = classStudents; }, [classStudents]);

  const drawOverlay = useCallback((cards) => {
    // Update last-seen positions for all detected cards
    for (const card of cards) {
      if (card.corners && card.corners.length >= 4) {
        lastSeenCards.current[card.marker_id] = { marker_id: card.marker_id, corners: card.corners, answer: card.answer, ts: Date.now() };
      }
    }
    // Remove cards not seen for > 1s
    const now = Date.now();
    for (const id of Object.keys(lastSeenCards.current)) {
      if (now - lastSeenCards.current[id].ts > 1000) delete lastSeenCards.current[id];
    }

    const overlay = overlayRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!debugRef.current) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const vidAspect = vw / vh;
    const boxAspect = rect.width / rect.height;
    let drawW, drawH, offX, offY;
    if (vidAspect > boxAspect) {
      drawW = rect.width;
      drawH = rect.width / vidAspect;
      offX = 0;
      offY = (rect.height - drawH) / 2;
    } else {
      drawH = rect.height;
      drawW = rect.height * vidAspect;
      offX = (rect.width - drawW) / 2;
      offY = 0;
    }

    for (const card of Object.values(lastSeenCards.current)) {
      const pts = card.corners.map(([nx, ny]) => [offX + nx * drawW, offY + ny * drawH]);
      const student = classStudentsRef.current.find((s) => s.card_id === card.marker_id);
      const label = student ? `${student.name}: ${card.answer}` : `#${card.marker_id}: ${card.answer}`;
      const color = ANSWER_COLORS[card.answer] || "#0066cc";

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.stroke();

      const minY = Math.min(...pts.map((p) => p[1]));
      const minX = Math.min(...pts.map((p) => p[0]));
      ctx.font = "bold 14px -apple-system, sans-serif";
      const tw = ctx.measureText(label).width;
      const lx = minX;
      const ly = minY - 6;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(lx - 2, ly - 16, tw + 8, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, lx + 2, ly);
    }
  }, []);

  const scanLoop = useCallback(async () => {
    if (!scanLoopActive.current) return;
    if (!scanInFlight.current) {
      scanInFlight.current = true;
      try { await captureAndScan(); } catch {}
      scanInFlight.current = false;
    }
    if (scanLoopActive.current) {
      intervalRef.current = setTimeout(scanLoop, SCAN_GAP_MS);
    }
  }, []);

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !resolvedIdRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    const jpeg = canvas.toDataURL("image/jpeg", 0.8);

    try {
      const res = await fetch(`${API}/scan-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: resolvedIdRef.current, image: jpeg, save: false }),
      });
      const data = await res.json();
      drawOverlay(data.cards || []);

      if (!data.cards || data.cards.length === 0) return;

      const confirmed = [];
      for (const card of data.cards) {
        const buf = confirmBuffer.current[card.marker_id];
        if (buf && buf.answer === card.answer) {
          buf.count++;
          if (buf.count >= CONFIRM_COUNT) {
            confirmed.push(card);
          }
        } else {
          confirmBuffer.current[card.marker_id] = { answer: card.answer, count: 1 };
        }
      }

      setStatus(t("scanner.detected", { count: data.cards.length }) + (confirmed.length > 0 ? ` · ${confirmed.length} ${t("scanner.confirmed")}` : ""));

      if (confirmed.length > 0) {
        await fetch(`${API}/scan-confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: resolvedIdRef.current,
            scans: confirmed.map((c) => ({ marker_id: c.marker_id, answer: c.answer })),
          }),
        });

        setLastCards((prev) => {
          const updated = [...prev];
          const newIds = [];
          for (const card of confirmed) {
            const idx = updated.findIndex((c) => c.marker_id === card.marker_id);
            if (idx >= 0) updated[idx] = card;
            else {
              updated.push(card);
              newIds.push(card.marker_id);
            }
            confirmBuffer.current[card.marker_id].count = 0;
          }
          if (newIds.length > 0) {
            setRecentlyScanned((prev) => [...new Set([...newIds, ...prev])]);
            for (const id of newIds) {
              clearTimeout(recentTimers.current[id]);
              recentTimers.current[id] = setTimeout(() => {
                setRecentlyScanned((prev) => prev.filter((x) => x !== id));
                delete recentTimers.current[id];
              }, 800);
            }
          }
          return updated;
        });
      }
    } catch (err) {
      setStatus(t("login.connectionError"));
    }
  }, []);

  const sendRemote = (action) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "remote", action }));
      const labels = { reveal: t("scanner.sentReveal"), hide: t("scanner.sentHide"), next: t("scanner.sentNext"), finish: t("scanner.sentFinish") };
      setStatus(labels[action] || "");
    }
  };

  const checkSession = async () => {
    setSessionError("");
    setSessionInfo(null);
    setClassStudents([]);
    if (!sessionId) return;
    try {
      // Try by code first, then by ID
      let res = await fetch(`${API}/sessions/by-code/${sessionId.padStart(4, "0")}`);
      if (!res.ok) res = await fetch(`${API}/sessions/${sessionId}`);
      if (!res.ok) { setSessionError(t("scanner.sessionNotFound")); return null; }
      const data = await res.json();
      resolvedIdRef.current = data.id;
      setSessionInfo(data);
      setShowInfo(true);
      clearTimeout(infoTimer.current);
      infoTimer.current = setTimeout(() => setShowInfo(false), 3000);
      if (!data.current_question_id) {
        setSessionError(t("scanner.noActiveQuestion"));
        return null;
      }
      if (data.class_id) {
        const cr = await fetch(`${API}/classes/${data.class_id}`);
        if (cr.ok) {
          const cls = await cr.json();
          setClassStudents(cls.students || []);
        }
      }
      return data;
    } catch { setSessionError(t("login.connectionError")); return null; }
  };

  const toggleScanning = async () => {
    if (scanning) {
      scanLoopActive.current = false;
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
      setScanning(false);
      setRecentlyScanned([]);
      confirmBuffer.current = {};
      lastSeenCards.current = {};
      setStatus(t("scanner.stopped"));
      stopCamera();
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    } else {
      setStatus(t("scanner.connecting"));
      const info = await checkSession();
      if (!info) return;
      const camOk = await startCamera();
      if (!camOk) return;
      setScanning(true);
      setLastCards([]);
      setStatus(t("scanner.scanning"));
      connectWs(resolvedIdRef.current);
      scanLoopActive.current = true;
      scanInFlight.current = false;
      scanLoop();
    }
  };

  const scannedIds = new Set(lastCards.map((c) => c.marker_id));
  const unscanned = classStudents.filter((s) => !scannedIds.has(s.card_id));
  const scannedStudents = classStudents.filter((s) => scannedIds.has(s.card_id));

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <style>{`@keyframes scanFlash { 0% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 0.6; } }`}</style>

      {/* Testende-Hinweis */}
      {!scanning && sessionFinished && (
        <div style={{ padding: 20, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 12, textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{t("scanner.finishedTitle")}</div>
          <p style={{ fontSize: 14, color: "var(--text3)", margin: "0 0 14px" }}>{t("scanner.finishedHint")}</p>
          <button onClick={() => { setSessionFinished(false); setLastCards([]); }} style={{
            padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980,
          }}>
            {t("scanner.newSession")}
          </button>
        </div>
      )}

      {/* Elegante Code-Eingabe */}
      {!scanning ? (!sessionFinished &&
        <div style={{ padding: "28px 20px", background: "var(--bg3)", borderRadius: 20, border: "1px solid var(--border)", marginBottom: 12, textAlign: "center" }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text3)", display: "block", marginBottom: 14 }}>{t("scanner.sessionCode")}</label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            style={{
              padding: "6px 0", width: "100%", maxWidth: 240, margin: "0 auto", display: "block",
              fontSize: 44, fontWeight: 700, fontFamily: "ui-monospace, monospace", letterSpacing: "0.4em",
              textAlign: "center", border: "none", borderBottom: "2px solid var(--border2)",
              background: "transparent", color: "var(--text)", boxSizing: "border-box", outline: "none",
              caretColor: "var(--text)",
            }}
          />
          <button
            onClick={toggleScanning}
            disabled={sessionId.length < 4}
            style={{
              marginTop: 22, width: "100%", maxWidth: 240, padding: "13px 24px", fontSize: 15, fontWeight: 600,
              cursor: sessionId.length >= 4 ? "pointer" : "default",
              background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980,
              opacity: sessionId.length >= 4 ? 1 : 0.35,
            }}
          >
            {t("scanner.join")}
          </button>
          <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 14 }}>
            {t("scanner.cameraHint")}
          </p>
          {status && (
            <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}>{status}</div>
          )}
        </div>
      ) : (
        <>
          {/* Fehlende Lernende kompakt über dem Video */}
          {classStudents.length > 0 && (unscanned.length > 0 || recentlyScanned.length > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, padding: "0 4px", flexWrap: "wrap" }}>
              {recentlyScanned.map((id) => {
                const s = classStudents.find((st) => st.card_id === id);
                if (!s) return null;
                return (
                  <span key={`recent-${id}`} style={{
                    fontSize: 12, color: "#fff", background: "#0a7d3e", padding: "2px 8px",
                    borderRadius: 980, fontWeight: 600, animation: "scanFlash 0.8s ease-out forwards",
                  }}>
                    {s.name} <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign: "-1px"}}><path d="M20 6L9 17l-5-5"/></svg>
                  </span>
                );
              })}
              {unscanned.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)" }}>{t("scanner.missing")}</span>}
              {unscanned.slice(0, 5).map((s) => (
                <span key={s.card_id} style={{ fontSize: 12, color: "var(--text3)", background: "var(--bg2)", padding: "2px 8px", borderRadius: 980, border: "1px solid var(--border3)" }}>
                  {s.name}
                </span>
              ))}
              {unscanned.length > 5 && <span style={{ fontSize: 11, color: "var(--text3)" }}>+{unscanned.length - 5}</span>}
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0a7d3e", marginLeft: "auto" }}>
                {scannedStudents.length}/{classStudents.length}
              </span>
            </div>
          )}
          {classStudents.length > 0 && unscanned.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 6, padding: "0 4px" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#0a7d3e" }}>{t("scanner.allCaptured", { count: classStudents.length })} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0a7d3e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign: "-1px"}}><path d="M20 6L9 17l-5-5"/></svg></span>
            </div>
          )}
        </>
      )}

      {sessionError && (
        <div style={{ padding: "10px 16px", marginBottom: 8, background: "#fde2d9", borderRadius: 12, fontSize: 14, fontWeight: 500, color: "#d1350f" }}>
          {sessionError}
        </div>
      )}

      {sessionInfo && showInfo && (
        <div style={{ padding: "10px 14px", marginBottom: 8, background: "#e8f0fe", borderRadius: 12, fontSize: 13, color: "var(--text)" }}>
          <strong>{sessionInfo.class_name || `Session #${sessionInfo.id}`}</strong>
          {sessionInfo.set_name && <span style={{ color: "#6e6e73" }}> · {sessionInfo.set_name}</span>}
        </div>
      )}

      {/* Video — nur während des Scannens sichtbar */}
      <div style={{ position: "relative", marginBottom: 8, borderRadius: 12, overflow: "hidden", background: "#000", display: scanning ? "block" : "none" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", objectFit: "contain" }} />
        <canvas ref={overlayRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Fernsteuerung: spiegelt den Host-Zustand */}
      {scanning && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8, padding: "0 4px" }}>
          <button onClick={() => sendRemote(hostRevealed ? "hide" : "reveal")} style={{
            flex: 1, padding: "12px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
            background: hostRevealed ? "var(--bg2)" : "var(--text)", color: hostRevealed ? "var(--text)" : "var(--bg)",
            border: "none", borderRadius: 12,
          }}>
            {hostRevealed ? t("scanner.hide") : t("scanner.reveal")}
          </button>
          {hostRevealed && (
            hostIsLast ? (
              <button onClick={() => sendRemote("finish")} style={{
                flex: 1, padding: "12px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                background: "#d1350f", color: "white", border: "none", borderRadius: 12,
              }}>
                {t("scanner.finishTest")}
              </button>
            ) : (
              <button onClick={() => sendRemote("next")} style={{
                flex: 1, padding: "12px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 12,
              }}>
                {t("scanner.next")}
              </button>
            )
          )}
        </div>
      )}

      {/* Debug + Stopp unter dem Video */}
      {scanning && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 8, padding: "0 4px" }}>
          <label style={{ cursor: "pointer", fontSize: 13, color: "var(--text3)", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} style={{ accentColor: "#0066cc" }} />
            {t("scanner.detectShow")}
          </label>
          <button
            onClick={toggleScanning}
            style={{
              padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "#d1350f", color: "white", border: "none", borderRadius: 980,
            }}
          >
            {t("scanner.stop")}
          </button>
        </div>
      )}

      {/* Fallback: Karten ohne Klasse */}
      {classStudents.length === 0 && lastCards.length > 0 && (
        <div style={{ padding: 12, background: "var(--bg3)", borderRadius: 12, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{t("scanner.captured", { count: lastCards.length })}</span>
            <button onClick={() => setLastCards([])} style={{ fontSize: 12, color: "var(--text3)", background: "none", border: "none", cursor: "pointer" }}>{t("scanner.clear")}</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {lastCards
              .sort((a, b) => a.marker_id - b.marker_id)
              .map((card) => (
                <div key={card.marker_id} style={{
                  padding: "3px 8px", borderRadius: 980, fontSize: 12, fontWeight: 600,
                  background: debug ? ANSWER_COLORS[card.answer] : "#0066cc", color: "white",
                }}>
                  #{card.marker_id}{debug ? ` → ${card.answer}` : ""}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
