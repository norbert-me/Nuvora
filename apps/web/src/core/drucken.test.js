import { describe, expect, it } from "vitest";
import { bogenName, dateiname } from "./drucken.js";

describe("Dateiname des Rückmeldebogens", () => {
  it("Rückmeldebogen_<Name der Arbeit>", () => {
    expect(bogenName("Klassenarbeit 1 – Rationale Zahlen")).toBe("Rückmeldebogen_Klassenarbeit 1 – Rationale Zahlen");
  });
  it("ohne Namen nur „Rückmeldebogen“", () => {
    expect(bogenName("")).toBe("Rückmeldebogen");
    expect(bogenName(null)).toBe("Rückmeldebogen");
  });
  it("unzulässige Zeichen werden entschärft", () => {
    expect(dateiname('KA 7/8: "Brüche"?')).toBe("KA 7-8- -Brüche-");
    expect(dateiname("  zwei   Leerzeichen ")).toBe("zwei Leerzeichen");
  });
});
