# Sicherheit

Nuvora verwaltet Namen, Noten, Förderschwerpunkte und Notizen von Kindern. Eine
Lücke hier trifft Menschen, die sich nicht wehren können — deshalb ist mir eine
Meldung willkommen, auch eine unsichere.

## Lücke melden

**Bitte nicht als öffentliches Issue.** Zwei Wege:

- [Private Meldung über GitHub](https://github.com/norbert-me/Nuvora/security/advisories/new) — bevorzugt
- Über das Kontaktformular der Instanz, auf der du die Lücke gefunden hast

Hilfreich: was passiert ist, wie du es ausgelöst hast, die Version (steht im
Profil unter „Über Nuvora"), und ob echte Daten betroffen waren.

## Was du erwarten kannst

| | |
| --- | --- |
| Eingangsbestätigung | innerhalb von 72 Stunden |
| Erste Einschätzung | innerhalb von 7 Tagen |
| Behebung | je nach Schwere; kritische Lücken vorrangig, sonst mit dem nächsten Release |
| Nennung | auf Wunsch in den Release-Notes |

Bezahlung gibt es keine — das ist ein Ein-Personen-Projekt ohne Einnahmen.

## Welche Versionen gepflegt werden

Nur die **jeweils neueste Version**. Nuvora hat keine Wartungszweige: Fixes
gehen in den nächsten Release, und wer eine ältere Fassung betreibt, aktualisiert
mit `./deploy.sh`. Der Update-Kanal steht im Profil (Stable oder Beta).

## Was in den Rahmen fällt

Alles im Code dieses Repositorys: API, Shell, die eingebettete Lernpfad-App,
Proxy-Konfiguration, Deploy-Skripte.

**Nicht** im Rahmen, weil es Sache der Betreiberin oder des Betreibers ist:

- fehlendes TLS oder fehlendes HSTS — Nuvora lauscht auf Port 80, die
  Verschlüsselung terminiert ein vorgelagerter Proxy
- Konfigurationsfehler einer einzelnen Instanz (offene Datenbank, schwache
  Passwörter, fehlende Backups)
- Angriffe, die einen bereits übernommenen Server oder Zugang voraussetzen

## Bekannte Grenzen

Das ist kein Geständnis, sondern der ehrliche Stand — damit niemand Zeit mit
Bekanntem verliert:

- **Der Anmelde-Token liegt im `localStorage`**, nicht in einem `HttpOnly`-Cookie.
  Bewusst, weil die eingebettete Lernpfad-App denselben Token braucht. Folge: ein
  XSS wäre gleichbedeutend mit Kontoübernahme. Gegenmaßnahmen: strenge CSP am
  Proxy, konsequentes Escaping, 30-Tage-Ablauf, Widerruf über `token_version`.
- **Passwörter mit PBKDF2-HMAC-SHA256, 100 000 Iterationen.** Unter der aktuellen
  OWASP-Empfehlung; die Umstellung auf Argon2id mit Migration beim nächsten
  Login ist vorgemerkt.
- **Rate-Limits leben im Prozessspeicher.** Bei mehreren Arbeitsprozessen oder
  Repliken vervielfachen sie sich entsprechend. Für eine Ein-Container-Installation
  — der vorgesehene Betrieb — ist das dicht genug.
- **Schüler-Zugänge tragen ihren Token in der Adresse** (`/lernen/<token>`,
  `/cd/<code>`). Wer den Link weitergibt, gibt den Zugang weiter; die Lehrkraft
  kann ihn unter Karten → QR-Codes neu vergeben.
- **Administration ist Konto 1.** Kein Rollenmodell.

## Was Nuvora bewusst nicht tut

Lernende bekommen keine Konten. Es gibt keine Telemetrie, keine externen
Skripte, keine CDN-Aufrufe: Schriften und Formelsatz sind mitgeliefert. Was
Nuvora nach außen spricht, ist der Update-Check gegen die GitHub-API, der
E-Mail-Versand über den eingetragenen SMTP-Server und — falls eingerichtet — ein
abonnierter externer Kalender.
