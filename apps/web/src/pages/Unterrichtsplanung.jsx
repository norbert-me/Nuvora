// Modul Unterrichtsplanung — bündelt die Vorbereitung unter einem Dach:
// „Stoffverteilung" (Jahressicht) und „Einstiege" (Ideensammlung). Beide laufen
// unverändert gegen ihre APIs (/api/stoffplan, /api/methoden); hier nur die
// gemeinsame Hülle mit Reitern. Deep-Link aus dem Kalender (?open=<id> für einen
// Einstieg, ?tab=einstiege) öffnet direkt den Einstiege-Reiter.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { pageTitle, Tabs } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import Stoffplan from "./Stoffplan.jsx";
import Methoden from "./Methoden.jsx";

export default function Unterrichtsplanung() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  // Aus dem Kalender kommt ?open=<id> (Einstieg) bzw. ?tab=einstiege.
  const initial = params.get("open") || params.get("tab") === "einstiege" ? "einstiege" : "stoff";
  const [tab, setTab] = useState(initial);
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("unterrichtsplanung.title")}</h1>
        <Tabs value={tab} onChange={setTab} options={[["stoff", t("unterrichtsplanung.tabStoff")], ["einstiege", t("unterrichtsplanung.tabEinstiege")]]} />
      </div>
      {tab === "stoff" ? <Stoffplan embedded /> : <Methoden embedded />}
    </div>
  );
}
