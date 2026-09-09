#!/usr/bin/env python3
"""opencv.js CSP-tauglich machen — fünf Eingriffe an der Fremddatei.

Warum es das gibt: `nginx.conf` setzt `script-src 'self'`. Die fertigen
opencv.js-Builds (geprüft: 4.8.0 von docs.opencv.org, @techstark 4.12.0 und
5.0.0) bauen an zwei Stellen Funktionen aus einer Zeichenkette — das ist
`new Function`, fällt unter dieselbe CSP-Direktive wie `eval` und wird von
Chrome und Firefox abgelehnt. Der Fehler kommt beim Laden, `window.cv` bleibt
undefiniert, und der Scanner fällt stumm auf den Server zurück. Gemessen wurde
im Spike OHNE CSP, deshalb ist es dort nicht aufgefallen.

Die Alternative wäre `'unsafe-eval'` in der CSP. Das ist genau die Erlaubnis,
die der Pentest herausgeworfen hat und die `scripts/selftest.py` seither
festhält — sie gilt für die GANZE Anwendung, nicht nur für die Scan-Seite. Für
eine Namensgebung in Stapelspuren ist das ein schlechter Tausch.

Die dritte Möglichkeit wäre ein eigener Emscripten-Build mit
`-sDYNAMIC_EXECUTION=0` (der hätte die Stellen gar nicht erst). Das ist ein bis
zwei Arbeitstage und muss bei jedem OpenCV-Update wiederholt werden — der Spike
hat es bewusst zurückgestellt. Diese zwei Ersetzungen sind das Gleiche in klein.

Was ersetzt wird:

  1. `createNamedFunction(name, body)` — baut einen Mantel, dessen einziger
     Zweck ein lesbarer Funktionsname in der Stapelspur ist. Ersatz: derselbe
     Mantel, der Name über `Object.defineProperty`.
  2. `makeDynCaller(dynCall)` — baut einen Aufrufer, der `rawFunction` vorne an
     die Argumente hängt. Ersatz: dasselbe mit `apply`.
  3. `craftInvokerFunction(...)` — baut den Aufrufer JEDER gebundenen Funktion
     als Quelltext zusammen. Das ist die Stelle, die den Start wirklich
     abbricht: sie läuft in den statischen Konstruktoren, also bevor auch nur
     eine OpenCV-Funktion registriert ist. Ersatz: derselbe Ablauf als
     Abschluss (Argumente aus `arguments`, verdrahtete Werte in einem Feld).
  4. `__emval_get_method_caller(...)` — dasselbe für den Weg zurück (C++ ruft
     eine JS-Methode). Ersatz ebenso.
  5. Das eingebettete WebAssembly wird herausgelöst (eigener Abschnitt unten).

Die ersten vier ändern kein Verhalten, nur `Function.prototype.name` und
`.length`; embind reicht die Stelligkeit überall ausdrücklich weiter
(`exposePublicSymbol(name, fn, numArguments)`), statt sie aus `.length` zu
lesen.

Das WebAssembly aus dem JS herausziehen — die eigentliche Ursache
-----------------------------------------------------------------

Der Build ist `SINGLE_FILE`: das 8-MB-WebAssembly steckt als
`data:application/octet-stream;base64,…` mitten im Skript, und Emscripten holt
es beim Start mit `fetch(wasmBinaryFile)`. Ein `fetch` auf eine `data:`-URL
zählt für die CSP als Verbindung — unser `connect-src 'self' wss: ws:` kennt
kein `data:`, also blockt Chrome ihn ab. Was danach passiert, sieht aus wie ein
ganz anderer Fehler: `window.cv` entsteht, `cv.calledRun` ist `true`, `cv.Mat`
ist eine Funktion — aber von den 374 Schlüsseln stammt kein einziger aus der
OpenCV-API. Die embind-Registrierungen kommen nämlich erst aus dem
WebAssembly, das nie geladen wurde. Ein Modul, das fertig aussieht und leer
ist.

`data:` in den `connect-src` aufzunehmen wäre die falsche Antwort: die Direktive
gilt für die ganze Anwendung, und `data:` in `connect-src` ist ein bekannter
Weg, Daten an einer CSP vorbeizuschleusen. Also andersherum — das WebAssembly
kommt aus dem JS heraus und liegt als eigene Datei `opencv.wasm` daneben. Dann
holt Emscripten sie über `locateFile()` von der eigenen Herkunft, und
`connect-src 'self'` deckt sie. Nebenbei: das JS schrumpft von 10,4 MB auf
0,2 MB, der base64-Umweg (ein Drittel Aufschlag) entfällt, und
`WebAssembly.instantiateStreaming` kann übernehmen, statt erst einen
ArrayBuffer zusammenzubauen.

Damit nginx den richtigen Typ schickt, steht in `apps/web/nginx.conf` ein
`types`-Eintrag für `.wasm`; ohne `application/wasm` fällt der Browser still
auf den langsameren Weg zurück.

Lauf (nach jedem Austausch der Datei):
    python3 scripts/opencv_ohne_eval.py apps/web/public/vendor/opencv/opencv.js

Idempotent: ein zweiter Lauf meldet „schon gepatcht" und ändert nichts.
"""
import base64
import re
import sys
from pathlib import Path

# Der Dateiname, unter dem das herausgelöste WebAssembly neben dem Skript liegt.
# Emscripten hängt ihn über `locateFile()` an das Verzeichnis des Skripts —
# deshalb ein reiner Name ohne Pfad.
WASM_NAME = "opencv.wasm"

# `var wasmBinaryFile="data:application/octet-stream;base64,AGFzbQ…";`
DATA_URI = re.compile(
    r'var wasmBinaryFile="data:application/octet-stream;base64,([A-Za-z0-9+/=]+)";'
)

# (Suchtext, Ersatz, Bezeichnung) — wortgenau, damit ein geänderter Build
# auffällt, statt still halb gepatcht zu werden.
ERSETZUNGEN = [
    (
        'function createNamedFunction(name,body){name=makeLegalFunctionName(name);'
        'return new Function("body","return function "+name+"() {\\n"+\'    "use strict";\'+'
        '"    return body.apply(this, arguments);\\n"+"};\\n")(body)}',
        'function createNamedFunction(name,body){name=makeLegalFunctionName(name);'
        'var f=function(){"use strict";return body.apply(this,arguments)};'
        'try{Object.defineProperty(f,"name",{value:name,configurable:true})}catch(e){}'
        'return f}',
        "createNamedFunction (Name fuer die Stapelspur)",
    ),
    (
        'function makeDynCaller(dynCall){var args=[];for(var i=1;i<signature.length;++i)'
        '{args.push("a"+i)}var name="dynCall_"+signature+"_"+rawFunction;'
        'var body="return function "+name+"("+args.join(", ")+") {\\n";'
        'body+="    return dynCall(rawFunction"+(args.length?", ":"")+args.join(", ")+");\\n";'
        'body+="};\\n";return new Function("dynCall","rawFunction",body)(dynCall,rawFunction)}',
        'function makeDynCaller(dynCall){return function(){'
        'return dynCall.apply(null,[rawFunction].concat(Array.prototype.slice.call(arguments)))}}',
        "makeDynCaller (rawFunction vorne anhaengen)",
    ),
    (
        # embind baut den Aufrufer JEDER gebundenen Funktion als Quelltext
        # zusammen und laesst ihn von `new_(Function, …)` uebersetzen — embinds
        # eigener Weg an `new Function` vorbei, deshalb faellt er beim Suchen
        # nach `new Function` nicht auf. Das ist die Stelle, an der die
        # Bibliothek unter unserer CSP wirklich stirbt: der Fehler faellt in den
        # statischen Konstruktoren an, also BEVOR eine einzige OpenCV-Funktion
        # registriert ist. `window.cv` entsteht trotzdem, `calledRun` steht auf
        # true, `cv.Mat` ist eine Funktion — das Modul sieht fertig aus und ist
        # leer. Ersatz: derselbe Ablauf als Abschluss, Argumente aus
        # `arguments`, verdrahtete Werte in einem Feld (damit die Destruktoren
        # dieselben Werte treffen wie vorher die benannten Variablen).
        'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var argsList="";var argsListWired="";for(var i=0;i<argCount-2;++i){argsList+=(i!==0?", ":"")+"arg"+i;argsListWired+=(i!==0?", ":"")+"arg"+i+"Wired"}var invokerFnBody="return function "+makeLegalFunctionName(humanName)+"("+argsList+") {\\n"+"if (arguments.length !== "+(argCount-2)+") {\\n"+"throwBindingError(\'function "+humanName+" called with \' + arguments.length + \' arguments, expected "+(argCount-2)+" args!\');\\n"+"}\\n";if(needsDestructorStack){invokerFnBody+="var destructors = [];\\n"}var dtorStack=needsDestructorStack?"destructors":"null";var args1=["throwBindingError","invoker","fn","runDestructors","retType","classParam"];var args2=[throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes[0],argTypes[1]];if(isClassMethodFunc){invokerFnBody+="var thisWired = classParam.toWireType("+dtorStack+", this);\\n"}for(var i=0;i<argCount-2;++i){invokerFnBody+="var arg"+i+"Wired = argType"+i+".toWireType("+dtorStack+", arg"+i+"); // "+argTypes[i+2].name+"\\n";args1.push("argType"+i);args2.push(argTypes[i+2])}if(isClassMethodFunc){argsListWired="thisWired"+(argsListWired.length>0?", ":"")+argsListWired}invokerFnBody+=(returns?"var rv = ":"")+"invoker(fn"+(argsListWired.length>0?", ":"")+argsListWired+");\\n";if(needsDestructorStack){invokerFnBody+="runDestructors(destructors);\\n"}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){var paramName=i===1?"thisWired":"arg"+(i-2)+"Wired";if(argTypes[i].destructorFunction!==null){invokerFnBody+=paramName+"_dtor("+paramName+"); // "+argTypes[i].name+"\\n";args1.push(paramName+"_dtor");args2.push(argTypes[i].destructorFunction)}}}if(returns){invokerFnBody+="var ret = retType.fromWireType(rv);\\n"+"return ret;\\n"}else{}invokerFnBody+="}\\n";args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction}',
        'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var f=function(){if(arguments.length!==argCount-2){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+(argCount-2)+" args!")}var destructors=needsDestructorStack?[]:null;var wired=new Array(argTypes.length);var call=[cppTargetFunc];if(isClassMethodFunc){wired[1]=argTypes[1].toWireType(destructors,this);call.push(wired[1])}for(var i=0;i<argCount-2;++i){wired[i+2]=argTypes[i+2].toWireType(destructors,arguments[i]);call.push(wired[i+2])}var rv=cppInvokerFunc.apply(null,call);if(needsDestructorStack){runDestructors(destructors)}else{for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(wired[i])}}}if(returns){return argTypes[0].fromWireType(rv)}};try{Object.defineProperty(f,"name",{value:makeLegalFunctionName(humanName),configurable:true})}catch(e){}return f}',
        "craftInvokerFunction (Aufrufer jeder gebundenen Funktion)",
    ),
    (
        # Dasselbe fuer den Weg zurueck: den Aufrufer, mit dem C++ eine
        # JS-Methode ruft. OpenCV braucht ihn beim Start nicht — er faellt sonst
        # erst im Gebrauch um, und dann an einer Stelle, die nach etwas ganz
        # anderem aussieht.
        'function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];var signatureName=retType.name+"_$"+types.slice(1).map(function(t){return t.name}).join("_")+"$";var params=["retType"];var args=[retType];var argsList="";for(var i=0;i<argCount-1;++i){argsList+=(i!==0?", ":"")+"arg"+i;params.push("argType"+i);args.push(types[1+i])}var functionName=makeLegalFunctionName("methodCaller_"+signatureName);var functionBody="return function "+functionName+"(handle, name, destructors, args) {\\n";var offset=0;for(var i=0;i<argCount-1;++i){functionBody+="    var arg"+i+" = argType"+i+".readValueFromPointer(args"+(offset?"+"+offset:"")+");\\n";offset+=types[i+1]["argPackAdvance"]}functionBody+="    var rv = handle[name]("+argsList+");\\n";for(var i=0;i<argCount-1;++i){if(types[i+1]["deleteObject"]){functionBody+="    argType"+i+".deleteObject(arg"+i+");\\n"}}if(!retType.isVoid){functionBody+="    return retType.toWireType(destructors, rv);\\n"}functionBody+="};\\n";params.push(functionBody);var invokerFunction=new_(Function,params).apply(null,args);return __emval_addMethodCaller(invokerFunction)}',
        'function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];var invokerFunction=function(handle,name,destructors,args){var offset=0;var werte=[];for(var i=0;i<argCount-1;++i){werte.push(types[i+1].readValueFromPointer(args+offset));offset+=types[i+1]["argPackAdvance"]}var rv=handle[name].apply(handle,werte);for(var i=0;i<argCount-1;++i){if(types[i+1]["deleteObject"]){types[i+1].deleteObject(werte[i])}}if(!retType.isVoid){return retType.toWireType(destructors,rv)}};return __emval_addMethodCaller(invokerFunction)}',
        "__emval_get_method_caller (C++ ruft eine JS-Methode)",
    ),
]


def wasm_herausloesen(pfad: Path) -> int:
    """Das eingebettete WebAssembly in `opencv.wasm` daneben legen.

    Rückgabe: 0 in Ordnung, 1 Abbruch. Idempotent — steht der Verweis schon in
    der Datei, wird nur geprüft, dass die Datei auch wirklich daneben liegt.
    """
    ziel = pfad.with_name(WASM_NAME)
    text = pfad.read_text(encoding="utf-8", errors="strict")

    if f'var wasmBinaryFile="{WASM_NAME}";' in text:
        if not ziel.exists():
            print(f"FEHLER: das Skript verweist auf {WASM_NAME}, die Datei fehlt aber.\n"
                  f"Aus dem gekürzten Skript lässt sie sich nicht zurückholen — bitte die "
                  f"Originaldatei neu holen und dieses Skript erneut laufen lassen.",
                  file=sys.stderr)
            return 1
        print(f"schon herausgelöst: {WASM_NAME} ({ziel.stat().st_size} Bytes)")
        return 0

    treffer = DATA_URI.search(text)
    if not treffer:
        print("FEHLER: kein eingebettetes WebAssembly gefunden "
              "(`var wasmBinaryFile=\"data:…base64,…\";`).\n"
              "Entweder ist der Build nicht mehr SINGLE_FILE — dann liegt die .wasm "
              "ohnehin daneben und diese Stelle kann entfallen — oder er sieht anders "
              "aus als erwartet. Bitte nachsehen, statt blind auszuliefern.",
              file=sys.stderr)
        return 1

    roh = base64.b64decode(treffer.group(1))
    if roh[:4] != b"\x00asm":
        print("FEHLER: die eingebetteten Daten fangen nicht mit der WebAssembly-Marke an.",
              file=sys.stderr)
        return 1

    ziel.write_bytes(roh)
    text = text[:treffer.start()] + f'var wasmBinaryFile="{WASM_NAME}";' + text[treffer.end():]
    pfad.write_text(text, encoding="utf-8")
    print(f"herausgelöst: {WASM_NAME} ({len(roh)} Bytes), Skript jetzt {len(text)} Bytes")
    return 0


def main(pfad: Path) -> int:
    text = pfad.read_text(encoding="utf-8", errors="strict")
    getan, schon = [], []
    for such, ersatz, name in ERSETZUNGEN:
        if such in text:
            text = text.replace(such, ersatz)
            getan.append(name)
        elif ersatz in text:
            schon.append(name)
        else:
            print(f"FEHLER: '{name}' weder im Original noch als Ersatz gefunden.\n"
                  f"Der Build sieht anders aus als erwartet — bitte die Stelle von Hand "
                  f"ansehen, statt eine ungepatchte Datei auszuliefern.", file=sys.stderr)
            return 1

    # Gegenprobe: danach darf keine Form der Uebersetzung-zur-Laufzeit mehr
    # drinstehen, sonst haelt die CSP die Bibliothek weiter an. `new_(Function`
    # gehoert ausdruecklich dazu — embinds eigener Ersatz fuer `new`, und genau
    # der Weg, auf dem craftInvokerFunction jahrelang unbemerkt evaluiert hat.
    for marke in ("new Function", "new_(Function", "eval("):
        rest = text.count(marke)
        if rest:
            print(f"FEHLER: noch {rest}× '{marke}' in der Datei — die CSP lehnt sie ab.",
                  file=sys.stderr)
            return 1

    if getan:
        pfad.write_text(text, encoding="utf-8")
        for n in getan:
            print(f"ersetzt: {n}")
    for n in schon:
        print(f"schon gepatcht: {n}")

    if wasm_herausloesen(pfad):
        return 1

    print(f"{pfad}: kein 'new Function', kein eingebettetes WebAssembly — CSP-tauglich.")
    return 0


if __name__ == "__main__":
    ziel = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("apps/web/public/vendor/opencv/opencv.js")
    if not ziel.exists():
        print(f"nicht gefunden: {ziel}", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(ziel))
