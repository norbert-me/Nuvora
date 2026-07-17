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
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "lernpfad:height" && typeof e.data.height === "number") {
        setHeight(Math.max(400, Math.min(e.data.height, 20000)));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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
