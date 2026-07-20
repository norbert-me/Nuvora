// Hilfe, passend zum Bereich, aus dem man kommt.
//
// Bereich aus ?area= (die Navbar haengt ihn beim Klick auf Hilfe an). Oben die
// anderen Bereiche zum Wechseln; nur Kern plus aktive Module.
import { Link, useSearchParams } from "react-router-dom";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";

const Section = ({ title, children }) => (
  <section style={{ marginBottom: 26 }}>
    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</h3>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7 }}>{children}</div>
  </section>
);

const Faq = ({ q, children }) => (
  <details style={{ marginBottom: 10, padding: "12px 16px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12 }}>
    <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", cursor: "pointer" }}>{q}</summary>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginTop: 8 }}>{children}</div>
  </details>
);

// Text mit einem {{link}}-Platzhalter in JSX aufloesen.
function withLink(text, to, label) {
  const [before, after] = text.split("{{link}}");
  return (
    <>
      {before}
      <Link to={to} style={{ color: "var(--accent)" }}>{label}</Link>
      {after}
    </>
  );
}

function KernHilfe({ t }) {
  return (
    <>
      <Section title={t("help.core.classesT")}>{withLink(t("help.core.classes"), "/classes", t("nav.classes"))}</Section>
      <Section title={t("help.core.kurseT")}>{withLink(t("help.core.kurse"), "/kurse", t("kurse.title"))}</Section>
      <Section title={t("help.core.topicsT")}>{withLink(t("help.core.topics"), "/topics", t("help.lp.topicWord"))}</Section>
      <Section title={t("help.core.modulesT")}>{withLink(t("help.core.modules"), "/modules", t("nav.modules"))}</Section>
      <Faq q={t("help.core.faqQ")}>{withLink(t("help.core.faqA"), "/legal", t("help.privacyWord"))}</Faq>
    </>
  );
}

function CardVoteHilfe({ t }) {
  return (
    <>
      <Section title={t("help.cv.whatT")}>{t("help.cv.what")}</Section>
      <Section title={t("help.cv.printT")}>{withLink(t("help.cv.print"), "/cardvote/cards", t("help.cv.cardsWord"))}</Section>
      <Section title={t("help.cv.tipsT")}>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>{t("help.cv.tip1")}</li>
          <li>{t("help.cv.tip2")}</li>
          <li>{t("help.cv.tip3")}</li>
          <li>{t("help.cv.tip4")}</li>
        </ul>
      </Section>
      <Faq q={t("help.cv.faq1Q")}>{t("help.cv.faq1A")}</Faq>
      <Faq q={t("help.cv.faq2Q")}>{t("help.cv.faq2A")}</Faq>
    </>
  );
}

function LernpfadHilfe({ t }) {
  return (
    <>
      <Section title={t("help.lp.whatT")}>{t("help.lp.what")}</Section>
      <Section title={t("help.lp.topicsT")}>{withLink(t("help.lp.topics"), "/topics", t("help.lp.topicWord"))}</Section>
      <Section title={t("help.lp.classesT")}>{withLink(t("help.lp.classes"), "/classes", t("nav.classes"))}</Section>
      <Faq q={t("help.lp.faqQ")}>{t("help.lp.faqA")}</Faq>
    </>
  );
}

function NotenHilfe({ t }) {
  return (
    <>
      <Section title={t("help.nt.howT")}>{t("help.nt.how")}</Section>
      <Section title={t("help.nt.avgT")}>{t("help.nt.avg")}</Section>
      <Section title={t("help.nt.obsT")}>{t("help.nt.obs")}</Section>
      <Section title={t("help.nt.impT")}>{t("help.nt.imp")}</Section>
    </>
  );
}

function KartenHilfe({ t }) {
  return (
    <>
      <Section title={t("help.ka.whatT")}>{t("help.ka.what")}</Section>
      <Section title={t("help.ka.decksT")}>{t("help.ka.decks")}</Section>
      <Section title={t("help.ka.qrT")}>{t("help.ka.qr")}</Section>
      <Section title={t("help.ka.progressT")}>{t("help.ka.progress")}</Section>
      <Faq q={t("help.ka.faqQ")}>{t("help.ka.faqA")}</Faq>
    </>
  );
}

function KalenderHilfe({ t }) {
  return (
    <>
      <Section title={t("help.kal.whatT")}>{t("help.kal.what")}</Section>
      <Section title={t("help.kal.ttT")}>{t("help.kal.tt")}</Section>
      <Section title={t("help.kal.planT")}>{t("help.kal.plan")}</Section>
      <Section title={t("help.kal.breaksT")}>{t("help.kal.breaks")}</Section>
      <Section title={t("help.kal.syncT")}>{t("help.kal.sync")}</Section>
    </>
  );
}

function EinstiegeHilfe({ t }) {
  return (
    <>
      <Section title={t("help.ein.whatT")}>{t("help.ein.what")}</Section>
      <Section title={t("help.ein.useT")}>{t("help.ein.use")}</Section>
    </>
  );
}

function DetektivHilfe({ t }) {
  return (
    <>
      <Section title={t("help.cd.whatT")}>{t("help.cd.what")}</Section>
      <Section title={t("help.cd.playT")}>{t("help.cd.play")}</Section>
    </>
  );
}

function SitzplanHilfe({ t }) {
  return <Section title={t("help.si.whatT")}>{t("help.si.what")}</Section>;
}

function AnwesenheitHilfe({ t }) {
  return (
    <>
      <Section title={t("help.an.whatT")}>{t("help.an.what")}</Section>
      <Section title={t("help.an.overviewT")}>{t("help.an.overview")}</Section>
    </>
  );
}

function ZufallHilfe({ t }) {
  return <Section title={t("help.zu.whatT")}>{t("help.zu.what")}</Section>;
}

const AREA_COMP = { core: KernHilfe, cardvote: CardVoteHilfe, lernpfad: LernpfadHilfe, karten: KartenHilfe, noten: NotenHilfe, kalender: KalenderHilfe, methoden: EinstiegeHilfe, "code-detektiv": DetektivHilfe, sitzplan: SitzplanHilfe, anwesenheit: AnwesenheitHilfe, zufall: ZufallHilfe };
// Reiter-Beschriftung: Modulnamen aus den jeweiligen i18n-Titeln.
const AREA_TITLE = { cardvote: "CardVote", lernpfad: "Lernpfad", "code-detektiv": "Code-Detektiv", karten: "karten.title", noten: "noten.title", kalender: "kalender.title", methoden: "methoden.title", sitzplan: "sitzplan.title", anwesenheit: "anwesenheit.title", zufall: "zufall.title" };
const MODULE_KEYS = ["cardvote", "lernpfad", "karten", "noten", "kalender", "methoden", "code-detektiv", "sitzplan", "anwesenheit", "zufall"];

export default function Help() {
  const [params, setParams] = useSearchParams();
  const { modules } = useModules();
  const { t } = useLanguage();
  const aktiv = new Set(modules.filter((m) => m.active).map((m) => m.key));

  // Kern immer, Module nur wenn aktiv.
  const sichtbar = ["core", ...MODULE_KEYS.filter((k) => aktiv.has(k))];
  const gewuenscht = params.get("area");
  const area = sichtbar.includes(gewuenscht) ? gewuenscht : sichtbar[0];
  const Comp = AREA_COMP[area];

  // core-Reiter zeigt "Kern"; Modulnamen aus i18n-Titel (Eigennamen bleiben so).
  const label = (k) => {
    if (k === "core") return t("help.coreLabel");
    const key = AREA_TITLE[k];
    return key && key.includes(".") ? t(key) : key;
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>{t("help.title")}</h2>

      <p style={{ marginBottom: 20, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", fontSize: 14 }}>
        {withLink(t("help.tutorialBanner"), "/tutorial", t("help.tutorialWord"))}
      </p>

      {sichtbar.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
          {sichtbar.map((k) => (
            <button
              key={k}
              onClick={() => setParams({ area: k })}
              style={{
                padding: "6px 14px", borderRadius: 980, fontSize: 13.5, cursor: "pointer", fontWeight: 500,
                border: area === k ? "1px solid var(--accent)" : "1px solid var(--border2)",
                background: area === k ? "var(--accent-bg)" : "var(--card)",
                color: area === k ? "var(--accent)" : "var(--text2)",
              }}
            >
              {label(k)}
            </button>
          ))}
        </div>
      )}

      <Comp t={t} />

      <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 24 }}>
        {withLink(t("help.contact"), "/contact", t("footer.contact"))}
      </p>
    </div>
  );
}
