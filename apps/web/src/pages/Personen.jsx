import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  pageApp, pageTitle, cardStyle, panelStyle, badge, Icon, ICONS,
  COLORS as C, sectionLabel, toolbarInput,
} from "../components/Icons.jsx";
import Portrait from "../components/Portrait.jsx";
import SchuelerAngaben from "../components/SchuelerAngaben.jsx";
import { oeffentlicheBasis } from "../core/basis.js";
import { dateiWaehlen, btnSecondary, btnSmall, inputStyle, Modal } from "../components/Icons.jsx";
import { useLanguage } from "../i18n";

// Ein Kind, nicht eine Zeile in einer Liste.
//
// Der Grund für diese Seite steht im Datenmodell: bis zur Personen-Ebene war
// dieselbe Anna in „7.5 LZ" und „7.5 Mathematik" zweimal vorhanden, und die
// Frage „wie steht sie insgesamt da?" ließ sich nur beantworten, indem man
// Namen verglich. Hier steht jedes Kind einmal — und darunter, was in seinen
// Kursen zusammenkommt.
//
// Gerechnet wird nichts eigenes: der Themenstand kommt vom Server, der ihn aus
// derselben Quelle holt wie die Schülerseite. Zwei Rechnungen wären zwei
// Wahrheiten.
export default function Personen() {
  const { t } = useLanguage();
  const [liste, setListe] = useState([]);
  const [suche, setSuche] = useState("");
  // Aus der Auswertung kommt man mit ?person=<id> direkt zu einem Kind — der
  // Sprung soll dort landen, wo die Antwort steht, nicht in der Liste.
  const [params] = useSearchParams();
  const [offen, setOffen] = useState(null);
  const [stand, setStand] = useState(null);

  useEffect(() => {
    fetch("/api/personen").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const liste = Array.isArray(d) ? d : [];
      setListe(liste);
      const ziel = Number(params.get("person"));
      const p = ziel && liste.find((x) => x.id === ziel);
      if (p) zeigen(p);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const zeigen = async (p) => {
    if (offen === p.id) { setOffen(null); return; }
    setOffen(p.id);
    setStand(null);
    const d = await fetch(`/api/personen/${p.id}/auswertung`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setStand(d);
  };

  // Foto und Name gehoeren der PERSON (nicht ihrer Zeile in einer Liste) —
  // deshalb gehen sie an /api/personen, und der Name wandert von dort auf alle
  // Listenzeilen.
  const [nameEdit, setNameEdit] = useState(null);   // { id, wert }
  const [fotoVer, setFotoVer] = useState(0);
  const [qr, setQr] = useState(null);               // { token, name }
  const [angabenFuer, setAngabenFuer] = useState(null);   // student_id, dessen Kurs-Angaben offen sind
  const [kurse, setKurse] = useState([]);
  const [neuName, setNeuName] = useState("");
  useEffect(() => { fetch("/api/kurse").then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  // Ein Kind anlegen, ohne zuerst einen Kurs auszusuchen: wer mitten im
  // Halbjahr zuzieht, sitzt noch in keiner Liste. Die Zugehörigkeiten kommen
  // danach, im Detail.
  const personAnlegen = async () => {
    const name = neuName.trim();
    if (!name) return;
    const r = await fetch("/api/personen", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!r || !r.ok) return;
    setNeuName("");
    const d = await fetch("/api/personen").then((x) => (x.ok ? x.json() : [])).catch(() => []);
    setListe(Array.isArray(d) ? d : []);
  };

  const inKurs = async (personId, kursId) => {
    await fetch(`/api/personen/${personId}/kurse/${kursId}`, { method: "POST" }).catch(() => {});
    nachladen(personId);
  };
  const [basis, setBasis] = useState("");
  useEffect(() => { oeffentlicheBasis().then(setBasis).catch(() => {}); }, []);

  const nachladen = async (id) => {
    const d = await fetch(`/api/personen/${id}/auswertung`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setStand(d);
    fetch("/api/personen").then((r) => (r.ok ? r.json() : [])).then((d2) => setListe(Array.isArray(d2) ? d2 : []));
  };

  const nameSpeichern = async () => {
    if (!nameEdit || !nameEdit.wert.trim()) { setNameEdit(null); return; }
    await fetch(`/api/personen/${nameEdit.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameEdit.wert.trim() }),
    }).catch(() => {});
    setNameEdit(null);
    nachladen(nameEdit.id);
  };

  const fotoSetzen = (id) => dateiWaehlen(async (datei) => {
    const daten = new FormData();
    daten.append("file", datei);
    await fetch(`/api/personen/${id}/photo`, { method: "POST", body: daten }).catch(() => {});
    setFotoVer((v) => v + 1);
    nachladen(id);
  }, "image/*");

  const fotoWeg = async (id) => {
    await fetch(`/api/personen/${id}/photo`, { method: "DELETE" }).catch(() => {});
    setFotoVer((v) => v + 1);
    nachladen(id);
  };

  const gefiltert = liste.filter((p) => !suche.trim()
    || p.name.toLowerCase().includes(suche.trim().toLowerCase())
    || (p.kurse || []).some((k) => k.toLowerCase().includes(suche.trim().toLowerCase())));

  return (
    <div style={pageApp}>
      <h1 style={pageTitle}>{t("personen.titel")}</h1>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder={t("personen.suche")}
          style={{ ...toolbarInput, flex: 1, minWidth: 200, maxWidth: 320 }} />
        <span style={{ flex: 1 }} />
        <input value={neuName} onChange={(e) => setNeuName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") personAnlegen(); }}
          placeholder={t("personen.neuName")} style={{ ...toolbarInput, minWidth: 180 }} />
        <button onClick={personAnlegen} disabled={!neuName.trim()}
          style={{ ...btnSecondary, ...btnSmall, opacity: neuName.trim() ? 1 : 0.5 }}>{t("personen.neu")}</button>
      </div>

      {liste.length === 0 && <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("personen.leer")}</p>}

      {gefiltert.map((p) => (
        <div key={p.id} style={{ ...cardStyle, padding: 12, marginBottom: 8 }}>
          {/* Name UND Bild öffnen dasselbe: die Person. Ein eigener Knopf
              „Auswertung" daneben war ein dritter Weg zum selben Ort — und die
              Zeile stand voller Angaben (Kurs, E/G), die man beim Suchen nicht
              liest, auf dem Handy aber umbricht. */}
          <button onClick={() => zeigen(p)}
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%",
              border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <Portrait student={{ id: p.id, name: p.name, has_photo: p.has_photo }} size={34} form="eckig" quelle="person" />
            <span style={{ fontWeight: 600, flex: 1, color: "var(--text)" }}>{p.name}</span>
            <span style={{ color: "var(--text3)", display: "inline-flex",
              transform: offen === p.id ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
              <Icon d={ICONS.open} size={14} />
            </span>
          </button>

          {offen === p.id && (
            <div style={{ ...panelStyle, padding: 12, marginTop: 12 }}>
              {!stand && <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("common.loading")}</p>}
              {stand && (
                <>
                  {/* Die Angaben zur Person stehen HIER — beim Namen, nicht in
                      jeder Zeile der Liste. */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                    {stand.niveau && <span style={badge(stand.niveau === "E" ? C.info : C.success)}>{stand.niveau}</span>}
                    <span style={{ fontSize: 12, color: "var(--text3)", flex: 1 }}>{(p.kurse || []).join(" · ")}</span>
                    {/* Bild und Name gehören der Person — hier sind sie
                        änderbar, statt dass man dafür in eine Liste geht, in
                        der dasselbe Kind noch einmal steht. */}
                    <button onClick={() => fotoSetzen(p.id)} style={{ ...btnSecondary, ...btnSmall }}>{t("personen.fotoSetzen")}</button>
                    {p.has_photo && <button onClick={() => fotoWeg(p.id)} style={{ ...btnSecondary, ...btnSmall }}>{t("personen.fotoWeg")}</button>}
                    <button onClick={() => setNameEdit({ id: p.id, wert: p.name })} style={{ ...btnSecondary, ...btnSmall }}>{t("personen.nameAendern")}</button>
                  </div>
                  {nameEdit && nameEdit.id === p.id && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <input value={nameEdit.wert} autoFocus
                        onChange={(e) => setNameEdit({ ...nameEdit, wert: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") nameSpeichern(); if (e.key === "Escape") setNameEdit(null); }}
                        style={{ ...inputStyle, flex: 1 }} />
                      <button onClick={nameSpeichern} style={{ ...btnSecondary, ...btnSmall }}>{t("common.save")}</button>
                    </div>
                  )}

                  {/* Förderbedarf, Niveau, Notiz — dieselbe Maske wie überall
                      (components/SchuelerAngaben.jsx). Sie schreibt auf ALLE
                      Zeilen der Person; die Kurs-Maßnahmen bleiben am Kurs und
                      werden deshalb hier nicht angeboten. */}
                  {(stand.teile || [])[0] && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ ...sectionLabel, margin: "0 0 6px" }}>{t("personen.angaben")}</div>
                      {/* Niveau, Förderschwerpunkte und Notiz gehören der Person
                          und stehen deshalb einmal oben. Die NACHTEILSAUSGLEICHE
                          hängen am Kurs (mehr Zeit in Mathe heißt nicht dasselbe
                          wie in Sport) — dafür ist unten je Kurs dieselbe Maske
                          mit seiner kursId eingehängt. */}
                      <SchuelerAngaben studentId={stand.teile[0].student_id} t={t} />
                    </div>
                  )}
                  {/* In welchen Kurs gehört das Kind? Hier, beim Kind — der
                      andere Weg (im Kurs suchen) bleibt: beides führt zur
                      selben Zugehörigkeit. */}
                  {kurse.length > 0 && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("personen.inKurs")}</span>
                      <select value="" onChange={(ev) => { if (ev.target.value) inKurs(p.id, Number(ev.target.value)); }}
                        style={{ ...inputStyle, minWidth: 180 }}>
                        <option value="">{t("personen.kursWaehlen")}</option>
                        {kurse.filter((k) => !(stand.teile || []).some((teil) => teil.kurs === k.name))
                          .map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                      </select>
                    </div>
                  )}
                  {(stand.teile || []).length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("personen.nochNichts")}</p>
                  )}
                  {(stand.teile || []).map((teil) => (
                    <div key={teil.student_id} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 6px" }}>
                        <span style={{ ...sectionLabel, margin: 0 }}>{teil.kurs || "—"}</span>
                        {/* Die Noten dieses Kurses, beide Halbjahre — geholt
                            aus derselben Rechnung wie das Notenbuch. Ein
                            früheres Halbjahr steht damit neben dem laufenden:
                            das ist der Verlauf, nach dem man ein Kind ansieht. */}
                        {["1", "2"].map((hj) => ((teil.noten || {})[hj] != null ? (
                          <span key={hj} style={{ ...badge(C.info) }} title={t(`noten.term${hj}`)}>
                            {hj}. HJ: {String((teil.noten || {})[hj]).replace(".", ",")}
                          </span>
                        ) : null))}
                        {/* Fehlzeiten und Verspätungen dieses Kurses. Sie
                            gehören neben die Noten: „drei Verspätungen" erklärt
                            oft mehr als die Zahl daneben. */}
                        {teil.anwesenheit && (
                          <>
                            {teil.anwesenheit.fehlt > 0 && (
                              <span style={badge(C.danger)} title={t("anwesenheit.fehlt")}>{teil.anwesenheit.fehlt}× {t("anwesenheit.fehltShort")}</span>
                            )}
                            {teil.anwesenheit.spaet > 0 && (
                              <span style={badge(C.warning)} title={t("anwesenheit.spaet")}>{teil.anwesenheit.spaet}× {t("anwesenheit.spaetShort")}</span>
                            )}
                            {teil.anwesenheit.entsch > 0 && (
                              <span style={badge(C.info)} title={t("anwesenheit.entsch")}>{teil.anwesenheit.entsch}× {t("anwesenheit.entschShort")}</span>
                            )}
                          </>
                        )}
                        <span style={{ flex: 1 }} />
                        {/* Der ausgeteilte Zugang: derselbe QR, den das Kind im
                            Ordner hat — hier zum Nachdrucken, ohne den Umweg
                            über die Klassenliste. */}
                        {teil.token && (
                          <button onClick={() => setQr({ token: teil.token, name: p.name })}
                            style={{ ...btnSecondary, ...btnSmall }}>{t("personen.qr")}</button>
                        )}
                        {teil.kurs_id && (
                          <button onClick={() => setAngabenFuer(angabenFuer === teil.student_id ? null : teil.student_id)}
                            style={{ ...btnSecondary, ...btnSmall }}>{t("personen.kursAngaben")}</button>
                        )}
                      </div>
                      {/* Alles, was an DIESEM Kurs hängt — dieselbe Maske wie im
                          Kurs selbst, nur von der Person aus erreichbar. */}
                      {angabenFuer === teil.student_id && teil.kurs_id && (
                        <div style={{ marginBottom: 8 }}>
                          <SchuelerAngaben studentId={teil.student_id} kursId={teil.kurs_id} t={t} />
                        </div>
                      )}
                      {(teil.themen || []).length === 0 ? (
                        <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("personen.keineThemen")}</p>
                      ) : (
                        <div style={{ display: "grid", gap: 4 }}>
                          {(teil.themen || []).slice(0, 8).map((th, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                              <span style={{ flex: 1 }}>{th.thema || th.name || "—"}</span>
                              {th.pct == null ? (
                                <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("personen.zuWenig")}</span>
                              ) : (
                                <span style={{ ...badge(th.pct >= 75 ? C.success : th.pct >= 50 ? C.warning : C.danger) }}>
                                  {Math.round(th.pct)} %
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {/* QR groß: der Zettel für den Ordner. Die Adresse kommt aus SITE_URL
          (core/basis.js) — `location.origin` wäre im Schulnetz die LAN-Adresse
          und außerhalb tot. */}
      {qr && (
        <Modal onClose={() => setQr(null)} width={360} label={qr.name}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{qr.name}</h3>
          <img src={`/api/karten/qr/${qr.token}.png${basis ? `?base=${encodeURIComponent(basis)}` : ""}`}
            alt={qr.name} style={{ width: "100%", maxWidth: 260, display: "block", margin: "0 auto" }} />
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <span style={{ flex: 1 }} />
            <button onClick={() => setQr(null)} style={btnSecondary}>{t("common.close")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
