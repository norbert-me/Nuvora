#!/usr/bin/env bash
# Baut die iPhone-/iPad-Huelle zu einer unsignierten .ipa — ein Befehl, keine
# Xcode-Oberflaeche. Xcode braucht man nur noch zum Debuggen auf dem Geraet.
#
# Was hier passiert, ist genau das, was auch der Job `ios` in
# .github/workflows/release.yml tut. Zwei Fassungen derselben Schritte waeren
# eine Stelle, an der der Build auf dem Rechner gelingt und in der Pipeline
# nicht — deshalb liegen die Befehle hier und dort bewusst gleich.
set -euo pipefail

WURZEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS="$WURZEL/apps/ios"

# Fehlende Werkbank ist kein Baufehler: sagen, WAS fehlt und wie man es holt.
abbruch() { echo "❌ $1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || abbruch "Eine iOS-App laesst sich nur auf macOS bauen (xcodebuild gibt es nur dort)."
command -v xcodebuild >/dev/null || abbruch "Xcode fehlt. Aus dem App Store laden, danach einmal 'sudo xcode-select --switch /Applications/Xcode.app' und 'sudo xcodebuild -license accept'."
xcodebuild -version >/dev/null 2>&1 || abbruch "xcodebuild laeuft nicht. Vermutlich zeigen die Kommandozeilenwerkzeuge noch auf die CLT statt auf Xcode: 'sudo xcode-select --switch /Applications/Xcode.app'."
command -v node >/dev/null || abbruch "Node fehlt (brew install node)."
command -v pod   >/dev/null || abbruch "CocoaPods fehlt (brew install cocoapods) — 'npx cap add ios' braucht es."

cd "$IOS"

echo "▸ Abhaengigkeiten"
npm install --silent

# `cap add ios` legt das Xcode-Projekt an; es ist nicht eingecheckt und
# entsteht beim ersten Lauf. Ist es schon da, wird nur abgeglichen — ein
# zweites `add` wuerde ein vorhandenes Projekt anmeckern.
if [ -d "$IOS/ios" ]; then
  echo "▸ Xcode-Projekt abgleichen"
  npx cap sync ios
else
  echo "▸ Xcode-Projekt anlegen (dauert beim ersten Mal, CocoaPods laedt)"
  npx cap add ios
  npx cap sync ios
fi

# Ohne Signierung: hier liegt kein Apple-Entwicklerzertifikat, und ein Build,
# der eins sucht, scheitert. Was die unsignierte Datei bedeutet, steht in
# apps/ios/README.md.
echo "▸ Archivieren (unsigniert)"
rm -rf "$IOS/build" "$IOS/dist"
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -archivePath "$IOS/build/App.xcarchive" \
  -destination "generic/platform=iOS" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CODE_SIGN_ENTITLEMENTS="" \
  DEVELOPMENT_TEAM="" \
  | (command -v xcpretty >/dev/null && xcpretty || cat)

# Eine .ipa ist ein Zip mit einem Ordner `Payload/`, darin die .app — mehr
# nicht. `xcodebuild -exportArchive` waere der uebliche Weg, will aber ein
# Signierprofil; von Hand gepackt kommt dieselbe Datei heraus.
# Fassung: Argument, sonst die des Servers (apps/api/VERSION) — damit die
# Datei genauso heisst wie die aus der Pipeline.
FASSUNG="${1:-$(cat "$WURZEL/apps/api/VERSION" 2>/dev/null || echo dev)}"
echo "▸ IPA packen (Fassung $FASSUNG)"
mkdir -p "$IOS/dist/Payload"
cp -R "$IOS/build/App.xcarchive/Products/Applications/App.app" "$IOS/dist/Payload/"
(cd "$IOS/dist" && zip -qry "Nuvora-${FASSUNG}.ipa" Payload && rm -rf Payload)

echo "✅ apps/ios/dist/Nuvora-${FASSUNG}.ipa"
echo "   Unsigniert — Installation per AltStore/Sideloadly oder eigenem"
echo "   Entwicklerkonto (apps/ios/README.md)."
