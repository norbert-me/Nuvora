import { describe, it, expect } from "vitest";
import { anonym } from "./protokoll.js";

describe("anonym", () => {
  it("ersetzt Zahlen und lange Tokens", () => {
    expect(anonym("/api/classes/12/students/7?x=1")).toBe("/api/classes/{id}/students/{id}");
    expect(anonym("/lernen/abcdefghijklmnopqrstuvwx")).toBe("/lernen/{token}");
  });

  it("maskiert Code-Detektiv-Sitzungscodes", () => {
    expect(anonym("/cd/AB12CD")).toBe("/cd/{code}");
    expect(anonym("/cd/AB12CD/play/AB12CD")).toBe("/cd/{code}/play/{code}");
    expect(anonym("/api/codedetektiv/sessions/XY9Z8Q/join")).toBe("/api/codedetektiv/sessions/{code}/join");
    expect(anonym("/api/codedetektiv/sessions/ab12cd")).toBe("/api/codedetektiv/sessions/{code}");
  });

  it("lässt normale Wege stehen", () => {
    expect(anonym("/code-detektiv/start")).toBe("/code-detektiv/start");
    expect(anonym("/api/codedetektiv/sessions")).toBe("/api/codedetektiv/sessions");
  });
});
