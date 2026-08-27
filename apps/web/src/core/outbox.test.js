// Was darf offline gepuffert werden — und was auf keinen Fall.
//
// Die Regel ist seit dem Ausbau umgekehrt: JEDER schreibende Aufruf wird
// gepuffert, ausser er steht auf der Sperrliste. Damit ist die Sperrliste der
// eigentliche Sicherheitsmechanismus, und ein versehentlich entfernter Eintrag
// faellt niemandem auf — bis eine Anmeldung offline "gelingt" oder eine
// Sitzung ohne Server startet. Deshalb dieser Test.
import { describe, expect, it } from "vitest";
import { classify, gesperrt } from "./outbox.js";

// classify baut Pfade ueber new URL(url, location.origin) — in der
// Node-Umgebung gibt es kein location.
globalThis.location = { origin: "https://example.test" };

describe("Sperrliste", () => {
  const gesperrtWege = [
    ["/api/auth/login", "Anmeldung"],
    ["/api/auth/change-password", "Passwort"],
    ["/api/modules/karten/activate", "Modul-Schranke"],
    ["/api/sessions", "laufende Sitzung"],
    ["/api/sessions/ABC/advance", "laufende Sitzung"],
    ["/api/results/sessions/3/results", "Scan-Ergebnisse"],
    ["/api/codedetektiv/sessions/ABCD/join", "laufende Sitzung"],
    ["/api/kalender/subscribe", "reicht nach aussen"],
    ["/api/kalender/untis/vorschau", "traegt ein Passwort"],
    ["/api/caldav-zugaenge", "Geraete-Passwort kommt nur einmal zurueck"],
    ["/api/kalender/untis/uebernehmen", "braucht den Abruf von eben"],
    ["/api/marketplace/quizzes", "Veroeffentlichung"],
    ["/api/admin/users/3", "Betrieb"],
    ["/api/backup/tag/zurueckspielen", "Betrieb"],
    ["/api/karten/decks/3/purge", "endgueltig"],
    ["/api/karten/tokens/rotate", "macht Ausdrucke tot"],
    ["/api/klassenarbeit/works/3/copy", "Aktion"],
    ["/api/klassenarbeit/works/3/remediate", "Aktion"],
    ["/api/classes/3/students/9/photo", "Bild"],
    ["/api/karten/cards/3/image/front", "Bild"],
    ["/api/material", "Datei"],
    ["/api/lernpfad/exercises", "eigene Warteschlange"],
  ];
  it.each(gesperrtWege)("%s bleibt netzwerk-only", (pfad) => {
    expect(gesperrt(pfad)).toBeTruthy();
    expect(classify("POST", pfad, {})).toBeNull();
    expect(classify("PUT", pfad, {})).toBeNull();
    expect(classify("DELETE", pfad, null)).toBeNull();
  });
});

describe("gepuffert wird der Alltag", () => {
  it("anlegen bekommt eine Behelfs-ID", () => {
    expect(classify("POST", "/api/karten/decks", { name: "x" })).toBe("create");
    expect(classify("POST", "/api/topics", { name: "x" })).toBe("create");
  });
  it("aendern und loeschen an einer echten ID", () => {
    expect(classify("PUT", "/api/karten/decks/12", { name: "x" })).toBe("write");
    expect(classify("DELETE", "/api/karten/decks/12", null)).toBe("delete");
    expect(classify("PUT", "/api/kalender/timetable/slot", {})).toBe("write");
  });
  it("POST auf etwas Bestehendes legt nichts an", () => {
    // /archive und /restore aendern einen Zustand — eine Behelfs-ID dafuer
    // waere eine ID, auf die nie jemand zeigt.
    expect(classify("POST", "/api/classes/7/archive", null)).toBe("write");
    expect(classify("POST", "/api/kurse/7/restore", null)).toBe("write");
  });
});

describe("Grenzen", () => {
  it("Lesen wird nie gepuffert", () => {
    expect(classify("GET", "/api/classes", null)).toBeNull();
    expect(classify("HEAD", "/api/classes", null)).toBeNull();
  });
  it("nichts ausserhalb von /api", () => {
    expect(classify("POST", "/lp/index.html", {})).toBeNull();
  });
  it("ein Koerper ohne JSON wird abgelehnt", () => {
    // Datei-Upload (FormData): laesst sich nicht ablegen und beim Nachspielen
    // nicht wiederherstellen — lieber der ehrliche Netzwerkfehler.
    expect(classify("POST", "/api/karten/decks", null, false)).toBeNull();
  });
});
