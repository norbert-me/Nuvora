// Modul Lernpfad im Rahmen.
//
// Die App wird bewusst NICHT in React nachgebaut — ihre Oberflaeche ist
// erprobt (Aufgaben, Klasse, Generator, Lernpfade). Sie laeuft eingebettet
// unter Nuvoras Navbar, damit die alte Struktur vollstaendig bleibt und der
// Rahmen trotzdem steht.
//
// Gleiche Origin: die App liest Nuvoras Token aus demselben localStorage und
// spricht dieselbe API. Es gibt keinen zweiten Login.
import { useEffect, useRef, useState } from "react";

const APP_URL = "/lernpfad-app/";

export default function LernpfadModule() {
  const ref = useRef(null);
  const [height, setHeight] = useState(800);

  // Die eingebettete App bringt ihre eigene Hoehe mit; ohne das entstuende
  // entweder ein zweiter Scrollbalken oder abgeschnittener Inhalt.
  // Thema an die App melden: sie hat keinen eigenen Umschalter und soll dem
  // Rahmen folgen — sonst leuchtet sie im dunklen Design weiss.
  const sendeTheme = () => {
    const dark = document.documentElement.classList.contains("dark");
    ref.current?.contentWindow?.postMessage(
      { type: "nuvora:theme", dark }, window.location.origin
    );
  };

  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "lernpfad:height" && typeof e.data.height === "number") {
        setHeight(Math.max(400, Math.min(e.data.height, 20000)));
      }
      if (e.data?.type === "lernpfad:ready") sendeTheme();
    };
    window.addEventListener("message", onMessage);

    // Nuvoras Umschalter aendert die Klasse auf <html> — darauf lauschen,
    // damit die App live mitzieht statt erst beim naechsten Laden.
    const obs = new MutationObserver(sendeTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      window.removeEventListener("message", onMessage);
      obs.disconnect();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src={APP_URL}
      title="Lernpfad"
      style={{ width: "100%", height, border: "none", display: "block" }}
    />
  );
}
