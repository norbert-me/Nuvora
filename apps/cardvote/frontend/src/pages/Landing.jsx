import { Link } from "react-router-dom";
import { useLanguage } from "../i18n/index.jsx";

const featureIcons = [
  (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="16" height="20" rx="3" />
      <path d="M10 14h8M10 18h5" />
      <rect x="26" y="6" width="16" height="20" rx="3" />
      <path d="M30 14h8M30 18h5" />
      <path d="M14 30v6a4 4 0 004 4h12a4 4 0 004-4v-6" />
      <path d="M24 30v12" />
    </svg>
  ),
  (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="10" y="4" width="28" height="40" rx="4" />
      <circle cx="24" cy="24" r="8" />
      <circle cx="24" cy="24" r="3" />
      <line x1="18" y1="40" x2="30" y2="40" />
    </svg>
  ),
  (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="36" height="36" rx="4" />
      <path d="M14 34V24M22 34V18M30 34V22M38 34V14" />
      <path d="M6 34h36" />
    </svg>
  ),
  (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 6h16v12H16z" />
      <path d="M24 18v10M20 24l4 4 4-4" />
      <path d="M8 32h32v10H8z" />
      <path d="M14 37h6M28 37h6" />
    </svg>
  ),
];

export default function Landing() {
  const { t } = useLanguage();
  const features = [1, 2, 3, 4].map((n, i) => ({
    icon: featureIcons[i],
    title: t(`landing.feature${n}.title`),
    desc: t(`landing.feature${n}.desc`),
  }));
  const [contributeBefore, contributeAfter] = t("landing.contribute").split("{{link}}");

  return (
    <div>
      <style>{`
        .landing-hero { text-align: center; padding: 60px 24px 40px; }
        .landing-features { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 0 24px 48px; max-width: 860px; margin: 0 auto; }
        .landing-feature { padding: 28px 24px; background: var(--card); border-radius: 16; border: 1px solid var(--border); }
        .landing-cta { text-align: center; padding: 0 24px 60px; }
        @media (max-width: 640px) {
          .landing-hero { padding: 40px 16px 28px; }
          .landing-features { grid-template-columns: 1fr; padding: 0 16px 36px; }
          .landing-cta { padding: 0 16px 48px; }
        }
      `}</style>

      <div className="landing-hero">
        <h1 style={{ fontSize: 36, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.5px", margin: "0 0 12px" }}>
          {t("landing.title")}
        </h1>
        <p style={{ fontSize: 18, color: "var(--text2)", lineHeight: 1.6, margin: "0 0 8px", maxWidth: 520, marginLeft: "auto", marginRight: "auto" }}>
          {t("landing.subtitle")}
        </p>
        <p style={{ fontSize: 15, color: "var(--text3)", lineHeight: 1.6, margin: "0 auto", maxWidth: 520 }}>
          {t("landing.description")}
        </p>
      </div>

      <div className="landing-features">
        {features.map((f, i) => (
          <div key={i} style={{ padding: "28px 24px", background: "var(--card)", borderRadius: 16, border: "1px solid var(--border)" }}>
            <div style={{ marginBottom: 14 }}>{f.icon}</div>
            <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: "0 0 8px" }}>{f.title}</h3>
            <p style={{ fontSize: 14, color: "var(--text3)", lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="landing-cta">
        <Link to="/login" style={{
          display: "inline-block", padding: "14px 36px", fontSize: 16, fontWeight: 600,
          background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980,
          textDecoration: "none", letterSpacing: "-0.2px",
        }}>
          {t("landing.cta")}
        </Link>
        <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 12 }}>
          {t("landing.ctaHint")}
        </p>
      </div>

      <div style={{ textAlign: "center", padding: "0 24px 60px" }}>
        <div style={{ display: "inline-block", padding: "18px 28px", background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", maxWidth: 480 }}>
          <p style={{ fontSize: 14, color: "var(--text2)", margin: 0, lineHeight: 1.6 }}>
            {contributeBefore}
            <Link to="/contact" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>{t("landing.contactLink")}</Link>
            {contributeAfter}
          </p>
        </div>
      </div>
    </div>
  );
}
