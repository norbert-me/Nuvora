// Modul Notizbrett — bündelt zwei besitzerlose Werkzeuge unter einem Dach:
// „Notizen" (freie Zettel) und „Aufgaben" (To-do-Liste). Beide laufen weiter
// eigenständig gegen ihre APIs (/api/notizblock, /api/todo); hier nur die
// gemeinsame Hülle mit Reitern. Nicht an Schüler gebunden (Regel 3).
import { useState } from "react";
import { pageTitle, Tabs } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import Notizblock from "./Notizblock.jsx";
import Todo from "./Todo.jsx";

export default function Notizbrett() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("notizen");
  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("notizbrett.title")}</h1>
        <Tabs value={tab} onChange={setTab} options={[["notizen", t("notizbrett.tabNotes")], ["aufgaben", t("notizbrett.tabTodos")]]} />
      </div>
      {tab === "notizen" ? <Notizblock embedded /> : <Todo embedded />}
    </div>
  );
}
