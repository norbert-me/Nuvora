// Hilfe, passend zum Bereich, aus dem man kommt.
//
// Bereich aus ?area= (die Navbar haengt ihn beim Klick auf Hilfe an). Oben die
// anderen Bereiche zum Wechseln; nur Kern plus aktive Module.
import { Link, useSearchParams } from "react-router-dom";
import { pageApp, pageTitle, cardStyle, Tabs } from "../components/Icons.jsx";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";

const Section = ({ title, children }) => (
  <section style={{ marginBottom: 24 }}>
    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</h3>
    <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7 }}>{children}</div>
  </section>
);

const Faq = ({ q, children }) => (
  <details style={{ ...cardStyle, marginBottom: 12, padding: "12px 16px" }}>
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
      <Section title={t("help.core.materialT")}>{t("help.core.material")}</Section>
      <Section title={t("help.core.modulesT")}>{withLink(t("help.core.modules"), "/modules", t("nav.modules"))}</Section>
      <Section title={t("help.core.searchT")}>{t("help.core.search")}</Section>
      <Section title={t("help.core.navT")}>{t("help.core.nav")}</Section>
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
        <ul style={{ paddingLeft: 16, margin: 0 }}>
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

// Modul Auswertung: zwei Reiter — Notenbuch und Klassenarbeiten.
function AuswertungHilfe({ t }) {
  return (
    <>
      <Section title={t("help.au.tabsT")}>{t("help.au.tabs")}</Section>
      <Section title={t("help.au.commentT")}>{t("help.au.comment")}</Section>
      <Section title={t("help.nt.howT")}>{t("help.nt.how")}</Section>
      <Section title={t("help.nt.avgT")}>{t("help.nt.avg")}</Section>
      <Section title={t("help.nt.trendT")}>{t("help.nt.trend")}</Section>
      <Section title={t("help.nt.obsT")}>{t("help.nt.obs")}</Section>
      <Section title={t("help.nt.impT")}>{t("help.nt.imp")} {t("help.nt.imp2")}</Section>
      <Section title={t("help.kla.whatT")}>{t("help.kla.what")}</Section>
      <Section title={t("help.kla.evalT")}>{t("help.kla.eval")}</Section>
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
      <Section title={t("help.kal.untisT")}>{t("help.kal.untis")}</Section>
      <Section title={t("help.kal.caldavT")}>{t("help.kal.caldav")}</Section>
      <Section title={t("help.kal.korrT")}>{t("help.kal.korr")}</Section>
    </>
  );
}

// Modul Unterrichtsplanung: die Einstiege. Die Jahresplanung liegt bei den
// Themen im Kern, nicht hier.
function UnterrichtsplanungHilfe({ t }) {
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

// Orga bündelt vier Reiter (Checklisten, Anwesenheit, Ausleihe, Sitzplan).
function OrgaHilfe({ t }) {
  return (
    <>
      <Section title={t("help.orga.whatT")}>{t("help.orga.what")}</Section>
      <Section title={t("help.an.whatT")}>{t("help.an.what")}</Section>
      <Section title={t("help.an.overviewT")}>{t("help.an.overview")}</Section>
      <Section title={t("help.orga.lendT")}>{t("help.orga.lend")}</Section>
      <Section title={t("help.si.whatT")}>{t("help.si.what")}</Section>
      <Section title={t("help.orga.segelT")}>{t("help.orga.segel")}</Section>
      <Section title={t("help.si.foerderT")}>{t("help.si.foerder")}</Section>
    </>
  );
}

function ZufallHilfe({ t }) {
  return (
    <>
      <Section title={t("help.zu.whatT")}>{t("help.zu.what")}</Section>
      <Section title={t("help.zu.groupsT")}>{t("help.zu.groups")}</Section>
    </>
  );
}

// Modul Notizbrett: zwei Reiter — Notizen und Aufgaben (To-do).
function NotizbrettHilfe({ t }) {
  return (
    <>
      <Section title={t("help.nb.whatT")}>{t("help.nb.what")}</Section>
      <Section title={t("help.nb.todoT")}>{t("help.nb.todo")}</Section>
    </>
  );
}

function TafelHilfe({ t }) {
  return (
    <>
      <Section title={t("help.tf.whatT")}>{t("help.tf.what")}</Section>
      <Section title={t("help.tf.useT")}>{t("help.tf.use")}</Section>
    </>
  );
}

function MathespieleHilfe({ t }) {
  return <Section title={t("help.ms.whatT")}>{t("help.ms.what")}</Section>;
}

// Bereiche mit eigener, ausführlicher Hilfe. Module ohne Eintrag fallen auf ihre
// Modul-Beschreibung zurück (unten) — so hat JEDES aktive Modul eine Erklärung.
const AREA_COMP = {
  core: KernHilfe, cardvote: CardVoteHilfe, lernpfad: LernpfadHilfe, karten: KartenHilfe,
  auswertung: AuswertungHilfe, kalender: KalenderHilfe, unterrichtsplanung: UnterrichtsplanungHilfe,
  "code-detektiv": DetektivHilfe, orga: OrgaHilfe, zufall: ZufallHilfe,
  notizbrett: NotizbrettHilfe,
  tafel: TafelHilfe, mathespiele: MathespieleHilfe,
};

export default function Help() {
  const [params, setParams] = useSearchParams();
  const { modules } = useModules();
  const { t } = useLanguage();

  // Kern immer, dann jedes aktive Modul (in Registry-Reihenfolge).
  const aktiveModule = modules.filter((m) => m.active);
  const sichtbar = ["core", ...aktiveModule.map((m) => m.key)];
  const gewuenscht = params.get("area");
  const area = sichtbar.includes(gewuenscht) ? gewuenscht : sichtbar[0];
  const Comp = AREA_COMP[area];
  const modInfo = modules.find((m) => m.key === area);

  // core-Reiter zeigt "Kern"; Modulnamen kommen aus dem Register (Eigennamen).
  const label = (k) => (k === "core" ? t("help.coreLabel") : (modules.find((m) => m.key === k)?.name || k));

  return (
    <div style={{ ...pageApp }}>
      <h2 style={{ ...pageTitle, marginBottom: 16 }}>{t("help.title")}</h2>

      <p style={{ ...cardStyle, marginBottom: 24, padding: "12px 16px", fontSize: 14 }}>
        {withLink(t("help.tutorialBanner"), "/tutorial", t("help.tutorialWord"))}
      </p>

      {sichtbar.length > 1 && (
        // Reiter kommen aus Icons.jsx — die eigenen Pillen hier sahen fast, aber
        // nicht ganz wie die im Rest der Anwendung aus. Bei vielen aktiven
        // Modulen wird waagerecht gescrollt statt umgebrochen: `Tabs` ist EIN
        // Element, kein Haufen einzelner Knöpfe.
        <div style={{ marginBottom: 24, overflowX: "auto", maxWidth: "100%" }}>
          <Tabs value={area} onChange={(k) => setParams({ area: k })}
            options={sichtbar.map((k) => [k, label(k)])} />
        </div>
      )}

      {Comp ? <Comp t={t} /> : modInfo ? (
        <Section title={modInfo.name}>{modInfo.description}</Section>
      ) : null}

      <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 24 }}>
        {withLink(t("help.contact"), "/contact", t("footer.contact"))}
      </p>
    </div>
  );
}
