// Förder-Vokabular — EINE Quelle für die Oberfläche.
//
// Die Listen sind fest und wortgleich zum Server (FOERDER_VALUES und
// MASSNAHMEN_VALUES in apps/api/app/routers/classes.py): die Bestandsdaten
// benutzen genau diese Zeichenketten, jede Abweichung macht sie beim
// Übernehmen unbrauchbar — inklusive Umlaut in „Hören".
//
// Vorher standen sie in Classes.jsx und Kurse.jsx, und mit dem Schülerdialog
// im Notenbuch wären es drei Kopien geworden.

export const FOERDER = [
  ["LRS", "Schwierigkeiten beim Lesen und Schreiben"],
  ["Dyskalkulie", "Schwierigkeiten mit Zahlen, Mengen und Rechenoperationen"],
  ["Lesen", "Schwierigkeiten beim Textverständnis"],
  ["DaZ", "Deutsch als Zweitsprache – Fachsprache fällt schwer"],
  ["Lernen", "Allgemeine Lernschwierigkeiten, braucht mehr Zeit und Struktur"],
  ["Sozial-Emotional", "Schwierigkeiten in Gruppenarbeit oder bei Frustration"],
  ["Auditive Wahrnehmung", "Schwierigkeiten bei der Verarbeitung gehörter Informationen"],
  ["Motorik", "Schwierigkeiten bei feinmotorischen Aufgaben (Schreiben, Zeichnen)"],
  ["Konzentration", "Kann sich nur kurz konzentrieren, leicht ablenkbar"],
  ["Sehen", "Eingeschränktes Sehvermögen, braucht große Schrift/Kontrast"],
  ["Hören", "Eingeschränktes Hörvermögen, braucht visuelle Anweisungen"],
  ["Sprache", "Schwierigkeiten beim mündlichen Ausdruck"],
];

export const MASSNAHMEN = [
  ["Zeitzuschlag", "Mehr Bearbeitungszeit, z. B. +25 %"],
  ["Abweichende Lernziele", "Wird an anderen Zielen gemessen als die Klasse"],
  ["Weniger Aufgaben", "Reduzierter Umfang bei gleicher Anforderung"],
  ["Vorlesen", "Aufgabenstellungen werden vorgelesen"],
  ["Größere Schrift", "Arbeitsblatt in größerer Schrift / mehr Kontrast"],
  ["Hilfsmittel", "Z. B. Taschenrechner, Wörterbuch, Formelsammlung"],
  ["Eigener Raum", "Arbeitet getrennt oder in einer Kleingruppe"],
  ["Zusätzliche Pausen", "Darf die Arbeit unterbrechen"],
  ["Assistenz", "Begleitung durch eine weitere Person"],
  ["Rechtschreibung nicht bewertet", "Rechtschreibleistung fließt nicht ein"],
  ["Mündlich statt schriftlich", "Leistung wird mündlich erbracht"],
  ["Sonstiges", "Freie Beschreibung im Feld daneben"],
];
