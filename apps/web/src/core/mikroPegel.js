// Lautstaerke im Raum messen — EINE Quelle fuer alle Tafel-Felder, die hoeren
// (Lautstaerke-Anzeige, Stille-Safari).
//
// Drei Regeln, die nicht aufweichen:
// (a) Das Mikrofon laeuft erst auf Knopfdruck (`start`). Ein Werkzeug, das sich
//     beim Oeffnen selbst einschaltet, hoert ohne Zustimmung mit.
// (b) Es wird NICHTS aufgenommen und nichts verschickt: gemessen wird nur der
//     Pegel im Browser (AnalyserNode).
// (c) Der Pegel ist geglaettet — ein zappelnder Balken laesst sich aus der
//     letzten Reihe nicht lesen.
//
// `onMessung(wert, deltaMs)` wird je Bild gerufen (ausserhalb von React, also
// ueber ein Ref — er sieht immer die aktuelle Fassung).
import { useEffect, useRef, useState } from "react";

export function useMikroPegel(onMessung) {
  const [an, setAn] = useState(false);
  const [pegel, setPegel] = useState(0);      // 0..100, geglaettet
  const [fehler, setFehler] = useState(false);
  const technik = useRef(null);               // { stream, ctx, raf }
  const rueckruf = useRef(onMessung);
  rueckruf.current = onMessung;

  const stopp = () => {
    const tk = technik.current;
    if (!tk) return;
    cancelAnimationFrame(tk.raf);
    tk.stream.getTracks().forEach((sp) => sp.stop());
    tk.ctx.close().catch(() => {});
    technik.current = null;
    setAn(false); setPegel(0);
  };
  // Aus, wenn das Feld geloescht oder die Seite verlassen wird — sonst
  // leuchtet die Aufnahme-Anzeige des Browsers weiter.
  useEffect(() => () => stopp(), []);

  const start = async () => {
    setFehler(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Keine Aufbereitung: die Automatiken regeln genau das weg, was hier
        // gemessen werden soll.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const quelle = ctx.createMediaStreamSource(stream);
      const analyse = ctx.createAnalyser();
      analyse.fftSize = 1024;
      quelle.connect(analyse);
      const puffer = new Float32Array(analyse.fftSize);
      let geglaettet = 0, vorher = performance.now();
      const schleife = () => {
        analyse.getFloatTimeDomainData(puffer);
        let summe = 0;
        for (let i = 0; i < puffer.length; i++) summe += puffer[i] * puffer[i];
        const rms = Math.sqrt(summe / puffer.length);
        // dBFS auf 0..100: -60 dB (sehr leise) bis -10 dB (sehr laut).
        const db = 20 * Math.log10(Math.max(rms, 1e-7));
        const roh = Math.max(0, Math.min(100, ((db + 60) / 50) * 100));
        geglaettet = geglaettet * 0.85 + roh * 0.15;
        const wert = Math.round(geglaettet);
        setPegel(wert);
        const jetzt = performance.now();
        const delta = jetzt - vorher; vorher = jetzt;
        if (rueckruf.current) rueckruf.current(wert, delta, ctx);
        if (technik.current) technik.current.raf = requestAnimationFrame(schleife);
      };
      technik.current = { stream, ctx, raf: 0 };
      setAn(true);
      technik.current.raf = requestAnimationFrame(schleife);
    } catch {
      // Abgelehnt, kein Mikrofon, oder unsicherer Kontext (http).
      setFehler(true);
    }
  };

  return { an, pegel, fehler, start, stopp, ctx: () => technik.current && technik.current.ctx };
}
