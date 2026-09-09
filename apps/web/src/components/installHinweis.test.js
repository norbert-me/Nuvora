// Der Installationshinweis darf NUR auf dem iPhone in Safari erscheinen. Alles
// andere waere eine Anleitung, die ins Leere fuehrt (Chrome auf iOS kann es
// nicht) oder gar keinen Sinn ergibt (Rechner, Android) — und ein Hinweis, den
// man nicht befolgen kann, ist schlimmer als keiner.
import { describe, it, expect } from "vitest";
import { zeigenNoetig } from "./InstallHinweis.jsx";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const nav = (o) => ({ userAgent: IPHONE, maxTouchPoints: 5, ...o });

describe("Installationshinweis", () => {
  it("erscheint auf dem iPhone in Safari", () => {
    expect(zeigenNoetig(nav())).toBe(true);
  });
  it("erscheint nicht, wenn die App schon installiert ist", () => {
    expect(zeigenNoetig(nav({ standalone: true }))).toBe(false);
  });
  it("erscheint nicht in Chrome auf dem iPhone — dort geht es gar nicht", () => {
    expect(zeigenNoetig(nav({ userAgent: IPHONE.replace("Version/17.5", "CriOS/126.0") }))).toBe(false);
  });
  it("erscheint nicht auf dem Mac", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
    expect(zeigenNoetig({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
  });
  it("erscheint auf dem iPad, das sich als Mac ausgibt", () => {
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
    expect(zeigenNoetig({ userAgent: ipad, maxTouchPoints: 5 })).toBe(true);
  });
  it("erscheint nicht auf Android", () => {
    expect(zeigenNoetig({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/126", maxTouchPoints: 5 })).toBe(false);
  });
});
