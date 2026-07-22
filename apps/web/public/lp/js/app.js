(function () {
    'use strict';

    // ─── Einbettung in Nuvora ───
    // Die App laeuft im iframe unter Nuvoras Navbar. Der Rahmen kann die Hoehe
    // des Inhalts nicht kennen, also meldet sie die App — sonst entstuende ein
    // zweiter Scrollbalken oder der Inhalt waere abgeschnitten.
    // inPage = nativ in die Shell gemountet (kein iframe, gleiches window).
    // embedded = Nuvora-Rahmen aktiv (iframe ODER in-page): eigene Navbar/Konto
    // ausblenden, Theme/Tab vom Rahmen uebernehmen.
    const inPage = !!window.__nuvoraInPage;
    const embedded = window.parent !== window || inPage;
    // Ziel fuer Rahmen-Klassen: in-page der Host (#lp-app), sonst <html>.
    const rootEl = () => (inPage ? document.getElementById('lp-app') : document.documentElement);
    if (embedded) {
        rootEl() && rootEl().classList.add('embedded');

        // Thema folgt dem Rahmen: Nuvora setzt .dark auf <html> und meldet
        // Wechsel. Ohne das leuchtet der Inhalt im dunklen Design weiss.
        window.addEventListener('message', (e) => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'nuvora:theme') {
                document.documentElement.classList.toggle('dark', !!e.data.dark);
            }
        });
        window.parent.postMessage({ type: 'lernpfad:ready' }, window.location.origin);

        // Hoehen-Meldung nur im iframe noetig; in-page waechst der Container von
        // selbst und ein MutationObserver auf die ganze Shell waere Verschwendung.
        if (!inPage) {
            const melde = () => {
                const h = Math.max(document.body.scrollHeight, document.body.offsetHeight);
                window.parent.postMessage({ type: 'lernpfad:height', height: h }, window.location.origin);
            };
            window.addEventListener('load', melde);
            window.addEventListener('resize', melde);
            new MutationObserver(melde).observe(document.documentElement, {
                childList: true, subtree: true, attributes: true,
            });
            setInterval(melde, 1000);
        }
    }

    // ─── Nuvora-Kern statt eigenem Backend ───
    // Die App laeuft auf Nuvoras API. Ihre Oberflaeche bleibt unveraendert;
    // uebersetzt wird nur an der Datengrenze (siehe zuKern/vonKern):
    //   thema/unterthema (Text)  <->  topic_id  (Kern-Taxonomie)
    //   klasse (Name)            <->  class_id  (Kern-Klassen)
    // Eigene Konten, eigene Schueler und eigene Klassen gibt es nicht mehr.
    const API = '/api';
    const LP = '/api/lernpfad';

    function authHeaders() {
        const token = localStorage.getItem('token');
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }
    function jsonHeaders() {
        return Object.assign({ 'Content-Type': 'application/json' }, authHeaders());
    }
    async function api(url, opts) {
        const o = Object.assign({}, opts || {});
        o.headers = Object.assign(o.body ? jsonHeaders() : authHeaders(), o.headers || {});
        // 429 (Rate-Limit) ist meist ein kurzer Engpass, kein echter Fehler —
        // bis zu 3 Versuche mit kleinem Backoff, bevor der Aufrufer den Status
        // sieht. So werden bei „Lernpfad generieren" (viele schnelle Requests)
        // nicht staendig Fehler gemeldet.
        let res;
        for (let attempt = 0; attempt < 3; attempt++) {
            res = await fetch(url, o);
            if (res.status !== 429) return res;
            await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
        }
        return res;
    }

    // localStorage ist nur noch Anzeige-Cache, nicht mehr Wahrheit: der Server
    // ist autoritativ. Frueher schrieb save() hierhin und spiegelte danach ans
    // Backend — deshalb hingen Daten am Browser statt an der Person.
    const STORAGE_KEYS = {
        aufgaben: 'll_aufgaben',
        schueler: 'll_schueler',
        klassen: 'll_klassen',
        idCounter: 'll_id_counter'
    };

    // Themen des Kerns, fuer die Uebersetzung Text <-> id.
    let topics = [];
    function topicPfad(id) {
        const t = topics.find(x => x.id === id);
        if (!t) return { thema: '', unterthema: '' };
        const p = t.parent_id ? topics.find(x => x.id === t.parent_id) : null;
        return p ? { thema: p.name, unterthema: t.name } : { thema: t.name, unterthema: '' };
    }
    async function topicId(thema, unterthema) {
        thema = (thema || '').trim();
        unterthema = (unterthema || '').trim();
        if (!thema) return null;
        let ober = topics.find(t => !t.parent_id && t.name === thema);
        if (!ober) {
            const r = await api(`${API}/topics`, { method: 'POST', body: JSON.stringify({ name: thema, parent_id: null }) });
            if (r.ok) { ober = await r.json(); topics.push(ober); }
            else {
                // 409: gibt es serverseitig schon (lokaler Cache war stale). Frisch
                // laden und wiederfinden — sonst waere topic_id null und die
                // Lernleiter landete OHNE Thema.
                topics = await api(`${API}/topics`).then(x => x.ok ? x.json() : topics);
                ober = topics.find(t => !t.parent_id && t.name === thema);
                if (!ober) return null;
            }
        }
        if (!unterthema) return ober.id;
        let unter = topics.find(t => t.parent_id === ober.id && t.name === unterthema);
        if (!unter) {
            const r = await api(`${API}/topics`, { method: 'POST', body: JSON.stringify({ name: unterthema, parent_id: ober.id }) });
            if (r.ok) { unter = await r.json(); topics.push(unter); }
            else {
                topics = await api(`${API}/topics`).then(x => x.ok ? x.json() : topics);
                unter = topics.find(t => t.parent_id === ober.id && t.name === unterthema);
                if (!unter) return ober.id;
            }
        }
        return unter.id;
    }

    // Kern-Aufgabe -> Form, die die Oberflaeche kennt.
    function vonKern(ex) {
        const tp = topicPfad(ex.topic_id);
        return {
            _id: String(ex.id),
            id: ex.id,
            code: ex.code || '',
            thema: tp.thema,
            unterthema: tp.unterthema,
            kategorie: ex.kategorie || '',
            quelleTyp: ex.quelle_typ || '',
            quelleDetail: ex.quelle_detail || '',
            quelle: ex.quelle_detail ? `${ex.quelle_typ === 'schulbuch' ? 'Schulbuch' : (ex.quelle_typ || '')} [${ex.quelle_detail}]`.trim() : '',
            operator: ex.operator || '',
            unteraufgaben: ex.unteraufgaben || 1,
            kompetenz: ex.kompetenz || '',
            methode: ex.methode || '',
            lrs: ex.lrs ? 1 : 0,
            lrsText: ex.lrs_text || '',
            loesung: ex.loesung || '',
            aufgabentext: ex.aufgabentext || '',
            foerderschwerpunkte: ex.foerderschwerpunkte || [],
            latex: ex.latex || ''
        };
    }

    // Oberflaechen-Form -> Kern-Aufgabe.
    async function zuKern(a) {
        return {
            topic_id: await topicId(a.thema, a.unterthema),
            code: a.code || '',
            kategorie: a.kategorie || '',
            aufgabentext: a.aufgabentext || '',
            loesung: a.loesung || '',
            operator: a.operator || '',
            kompetenz: a.kompetenz || '',
            methode: a.methode || '',
            unteraufgaben: parseInt(a.unteraufgaben) || 1,
            quelle_typ: a.quelleTyp || '',
            quelle_detail: a.quelleDetail || '',
            lrs: !!(a.lrs && a.lrs !== '0'),
            lrs_text: a.lrsText || '',
            foerderschwerpunkte: (a.foerderschwerpunkte && a.foerderschwerpunkte.length) ? a.foerderschwerpunkte : null,
            latex: a.latex || ''
        };
    }

    function load(key) {
        try { return JSON.parse(localStorage.getItem(key)) || []; }
        catch { return []; }
    }
    function loadNum(key) {
        return parseInt(localStorage.getItem(key)) || 0;
    }
    function save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
        if (key === STORAGE_KEYS.aufgaben) syncAufgaben(data);
        // schueler/klassen gehoeren dem Kern und werden unter /classes gepflegt —
        // von hier aus wird nichts zurueckgeschrieben.
    }

    // Signatur des zuletzt gespiegelten Standes je Aufgabe (id -> String). Nach
    // dem Laden mit dem Server-Stand befuellt; danach spiegelt syncAufgaben nur
    // noch WIRKLICH geaenderte Aufgaben, statt bei jedem Save alle ~1000 neu zu
    // PUTten (das war der 429-Sturm).
    let syncSigs = {};
    function aufgabeSig(a) {
        return JSON.stringify([a.thema, a.unterthema, a.kategorie, a.aufgabentext, a.loesung,
            a.operator, a.kompetenz, a.methode, a.unteraufgaben, a.quelleTyp, a.quelleDetail,
            a.lrs ? 1 : 0, a.lrsText, a.foerderschwerpunkte || [], a.latex, a.code]);
    }

    // Aufgaben zum Kern spiegeln: anlegen, aendern, geloeschte entfernen.
    async function syncAufgaben(data) {
        try {
            const serverIds = new Set((await api(`${LP}/exercises`).then(r => r.ok ? r.json() : [])).map(e => e.id));
            // Sicherung (CLAUDE.md: Live-Daten nie durch delete+recreate gefaehrden):
            // eine leere lokale Liste gegen mehrere Server-Aufgaben ist praktisch
            // immer ein nicht-geladener/stale Cache oder ein Ladefehler — KEIN echtes
            // „alles loeschen". Dann nichts spiegeln, sonst reisst es echte Daten weg.
            if (!data.length && serverIds.size > 1) {
                console.warn('syncAufgaben: leere Liste gegen', serverIds.size, 'Server-Aufgaben — uebersprungen (Schutz vor Datenverlust)');
                return;
            }
            for (const a of data) {
                const vorhanden = a.id && serverIds.has(a.id);
                serverIds.delete(a.id);
                // Unveraendert seit dem letzten Spiegeln? Nichts tun — sonst PUTtet
                // jeder Save die ganze Liste (429-Sturm) und loest Themen-POSTs (409) aus.
                if (vorhanden && syncSigs[a.id] === aufgabeSig(a)) continue;
                const body = JSON.stringify(await zuKern(a));
                const r = await api(vorhanden ? `${LP}/exercises/${a.id}` : `${LP}/exercises`,
                                    { method: vorhanden ? 'PUT' : 'POST', body });
                if (r.ok) {
                    if (!vorhanden) { const neu = await r.json(); a.id = neu.id; a._id = String(neu.id); }
                    syncSigs[a.id] = aufgabeSig(a);
                }
            }
            // Was der Server noch hat, die Oberflaeche aber nicht mehr: loeschen.
            for (const weg of serverIds) {
                await api(`${LP}/exercises/${weg}`, { method: 'DELETE' });
                delete syncSigs[weg];
            }
            localStorage.setItem(STORAGE_KEYS.aufgaben, JSON.stringify(data));
        } catch(e) { console.error('Sync-Fehler:', e); }
    }
    function toast(msg) {
        // Eingebettet (iframe ODER in-page): an Nuvora geben. In-page ist
        // window.parent === window, aber ein an document.body gehängter .toast
        // liegt ausserhalb #lp-app, wo das gescopete CSS nicht greift — er
        // erschiene als ungestylter Text. Darum immer per postMessage an die
        // Shell (fängt 'message' auf demselben Fenster ab).
        if (window.parent !== window || inPage) {
            window.parent.postMessage({ type: 'lernpfad:toast', msg: String(msg) }, window.location.origin);
            return;
        }
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }
    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    // Gestylter Bestätigungs-/Hinweis-Dialog statt des nativen confirm()/alert()
    // (die optisch nicht zum Rest passen). Wird unter #lp-app gehängt, damit die
    // gescopeten Stile greifen; Buttons nutzen die vorhandenen .btn-Klassen.
    // confirmDlg gibt ein Promise<boolean> zurück.
    function lpDialogHost() { return document.getElementById('lp-app') || document.body; }
    function confirmDlg(msg, { ok = 'OK', cancel = 'Abbrechen', danger = true } = {}) {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);padding:16px';
            const panel = document.createElement('div');
            panel.style.cssText = 'background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:14px;max-width:400px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,0.25)';
            const p = document.createElement('p');
            p.style.cssText = 'font-size:14px;line-height:1.5;margin:0 0 18px;white-space:pre-wrap';
            p.textContent = msg;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
            const bCancel = document.createElement('button');
            bCancel.className = 'btn'; bCancel.textContent = cancel;
            const bOk = document.createElement('button');
            bOk.className = 'btn' + (danger ? ' danger' : ''); bOk.textContent = ok;
            row.append(bCancel, bOk); panel.append(p, row); ov.append(panel);
            const close = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
            ov.addEventListener('click', e => { if (e.target === ov) close(false); });
            bCancel.addEventListener('click', () => close(false));
            bOk.addEventListener('click', () => close(true));
            const onKey = e => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); };
            document.addEventListener('keydown', onKey);
            lpDialogHost().appendChild(ov);
            bOk.focus();
        });
    }
    function alertDlg(msg) { return confirmDlg(msg, { ok: 'OK', cancel: 'Schließen', danger: false }); }

    // Eigenes Autocomplete statt <datalist>: Safari rendert das native
    // datalist-Popup unlesbar (weisser Text, per CSS nicht korrigierbar).
    // Datenquelle bleibt die versteckte <datalist> - wird an anderer Stelle
    // schon dynamisch/statisch befuellt. Freitext bleibt moeglich.
    function attachAutocomplete(inputId, datalistId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.removeAttribute('list');          // natives Popup abschalten
        input.setAttribute('autocomplete', 'off');

        const wrap = document.createElement('div');
        wrap.className = 'ac-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const list = document.createElement('div');
        list.className = 'ac-list';
        list.style.display = 'none';
        wrap.appendChild(list);

        let items = [], active = -1;

        const options = () => [...document.querySelectorAll('#' + datalistId + ' option')]
            .map(o => o.value).filter(Boolean);

        function render() {
            const q = input.value.trim().toLowerCase();
            items = [...new Set(options().filter(o =>
                o.toLowerCase().includes(q) && o.toLowerCase() !== q))];
            if (!items.length) return hide();
            active = -1;
            list.innerHTML = items.map((o, i) =>
                `<div class="ac-item" data-i="${i}">${esc(o)}</div>`).join('');
            list.style.display = '';
        }
        function hide() { list.style.display = 'none'; active = -1; }
        function choose(v) {
            input.value = v;
            hide();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        function highlight() {
            [...list.children].forEach((c, i) => c.classList.toggle('active', i === active));
            if (active >= 0) list.children[active].scrollIntoView({ block: 'nearest' });
        }

        input.addEventListener('focus', render);
        input.addEventListener('input', render);
        input.addEventListener('keydown', e => {
            if (list.style.display === 'none') return;
            if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
            else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
            else if (e.key === 'Escape') hide();
        });
        list.addEventListener('mousedown', e => {
            const it = e.target.closest('.ac-item');
            if (it) { e.preventDefault(); choose(items[+it.dataset.i]); }
        });
        document.addEventListener('click', e => { if (!wrap.contains(e.target)) hide(); });
    }

    [
        ['aufgabe-thema', 'themen-list'],
        ['aufgabe-unterthema', 'unterthemen-list'],
        ['aufgabe-operator', 'aufgabentyp-list'],
        ['aufgabe-methode', 'methode-list'],
        ['bulk-thema', 'themen-list'],
        ['bulk-unterthema', 'unterthemen-list']
    ].forEach(([i, d]) => attachAutocomplete(i, d));

    // Nächste ID = kleinste freie Nummer. So rutschen neue Aufgaben in Lücken,
    // die durch Löschen entstehen, statt dass der Zähler endlos hochläuft.
    function nextAufgabeId() {
        // Kleinste freie #-Nummer ueber die vergebenen Codes — beginnt bei 1 und
        // fuellt Luecken, unabhaengig von der fortlaufenden Server-DB-id.
        const used = new Set();
        aufgaben.forEach(a => {
            const m = String(a.code || '').match(/^#(\d+)$/);
            if (m) used.add(parseInt(m[1], 10));
        });
        let n = 1;
        while (used.has(n)) n++;
        return '#' + String(n).padStart(6, '0');
    }

    // Fehlende #-Codes werden serverseitig aufgefuellt (POST /exercises/backfill-codes,
    // siehe loadUserData) — EIN Request statt je Aufgabe ein PUT.

    // Anzeige-ID immer als #xxxxxx: nach dem Sync ist a.id die numerische
    // Server-ID; die Oberflaeche zeigt sie einheitlich im #-Format.
    function fmtId(id) {
        if (id === null || id === undefined || id === '') return '';
        const s = String(id);
        return s.startsWith('#') ? s : '#' + s.replace(/\D/g, '').padStart(6, '0');
    }
    // Numerischer Wert der ANGEZEIGTEN Aufgaben-Nummer (#000054 -> 54). Fuer die
    // Sortierung: die Anzeige zeigt den pro-User-Code, nicht die globale id — nach
    // dem sichtbaren Code sortieren, sonst wirkt die Reihenfolge falsch.
    function codeNum(a) { const m = String(a.code || a.id || '').match(/(\d+)/); return m ? parseInt(m[1], 10) : 0; }

    // ─── State ───
    let aufgaben = load(STORAGE_KEYS.aufgaben);
    let schueler = load(STORAGE_KEYS.schueler);
    let klassen = load(STORAGE_KEYS.klassen);
    let lernpfade = [];
    // Aktive Klassenfilterung der Übersicht (ersetzt das frühere Select).
    let overviewKlasse = '';
    // Render-Pagination der Aufgaben-Liste: nur die ersten N Zeilen ins DOM
    // (1000 Zeilen zu rendern ist der spuerbare Bremser). Suche/Filter arbeiten
    // weiter auf ALLEN Aufgaben im Speicher (der Generator braucht sie ohnehin
    // komplett) — nur die Anzeige ist gestueckelt, per „Mehr laden".
    const AUFGABEN_PAGE = 50;
    let aufgabenLimit = AUFGABEN_PAGE;
    let previewData = null;
    // gesetzt, wenn im Generator eine bestehende Lernleiter bearbeitet wird
    let editingLlId = null;

    // Karten-Modul ist optionaler Gast: nur wenn aktiv, bietet der PDF-Export
    // an, den QR-Zugang jedes Schuelers zum Karten-Ueben aufzudrucken. Der Cache
    // haelt die vorgerenderten QR-Bilder je Schueler-ID fuer einen Export.
    let kartenAktiv = false;
    let qrCache = {};

    async function checkKartenModul() {
        try {
            const r = await api(`${API}/modules`);
            kartenAktiv = r.ok && (await r.json()).some(m => m.key === 'karten' && m.active);
        } catch (e) { kartenAktiv = false; }
        const wrap = document.getElementById('gen-qr-wrap');
        if (wrap) wrap.style.display = kartenAktiv ? 'inline-flex' : 'none';
    }

    function blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
        });
    }

    // QR je Schueler vorab holen: erst Tokens pro Klasse (der Token ist der
    // login-freie Zugang), dann das QR-PNG aus dem Karten-Modul.
    async function prerenderQR(entries) {
        qrCache = {};
        const byClass = {};
        entries.forEach(e => {
            const c = e.student && e.student.class_id;
            if (c) (byClass[c] = byClass[c] || []).push(e.student.id);
        });
        const tokenByStudent = {};
        for (const cid of Object.keys(byClass)) {
            const r = await api(`${API}/karten/classes/${cid}/tokens`, { method: 'POST' });
            if (!r.ok) continue;
            (await r.json()).forEach(t => { tokenByStudent[t.student_id] = t.token; });
        }
        for (const e of entries) {
            const tok = tokenByStudent[e.student && e.student.id];
            if (!tok) continue;
            try {
                const res = await api(`${API}/karten/qr/${tok}.png?base=${encodeURIComponent(location.origin)}`);
                if (!res.ok) continue;
                qrCache[e.student.id] = await blobToDataURL(await res.blob());
            } catch (err) { /* ohne QR weiter */ }
        }
    }

    // Standard-Sortierung der Aufgabenliste: aufsteigend nach angezeigter ID.
    let sortState = { table: 'aufgaben-tabelle', column: 'id', asc: true };

    // ─── Authentifizierung ───
    // Mit Mehrbenutzer-Backend ist der Server pro Konto die Quelle der Wahrheit.
    // Bei Login/Erststart werden die Daten des Kontos geladen und der lokale
    // Cache damit ersetzt (verschiedene Konten am selben Browser dürfen sich
    // nicht vermischen). Während der Sitzung cached localStorage und synct hoch.
    // Login-Code entfernt: Nuvora meldet an, dieses Modul erbt den Token.
    // Was hier stand (authMode/setAuthMode/Formular), hatte kein Backend mehr.

    // Kein eigenes Login: fehlt der Token, zur Anmeldung des Rahmens (bricht
    // aus dem iframe aus, damit Nuvoras Seite im ganzen Fenster laedt).
    function showAuth() {
        (inPage ? rootEl() : document.body).classList.remove('authed');
        window.location.href = '/login';
    }
    function hideAuth() {
        (inPage ? rootEl() : document.body).classList.add('authed');
    }

    // Daten aus dem Nuvora-Kern laden und lokalen Anzeige-Cache ersetzen.
    async function loadUserData() {
        // Cache-First: die zuletzt gespeicherten Inhalte SOFORT zeigen, statt leer
        // auf den Server zu warten. Rein Anzeige — es wird nichts aus dem (evtl.
        // stalen) Cache zum Server gespiegelt (Init-Sync ist bewusst raus). Der
        // Server-Abgleich unten ersetzt die Daten gleich und rendert neu.
        if (aufgaben.length || schueler.length || klassen.length) {
            try { renderAufgaben(); renderKlassen(); renderSchueler(); updateFilters(); } catch (e) { /* Cache unvollstaendig — egal, Server folgt */ }
        }
        const [tRes, exRes, clRes, kuRes] = await Promise.all([
            api(`${API}/topics`), api(`${LP}/exercises`), api(`${API}/classes`), api(`${API}/kurse`)
        ]);
        // Nur ein echtes Auth-Problem (401) fuehrt zum Login. Ist z. B. nur das
        // Lernpfad-Modul nicht aktiv (403 auf /exercises), sollen Themen und
        // Klassen trotzdem erscheinen — sonst wirkt die ganze App leer.
        if (tRes.status === 401 || clRes.status === 401 || exRes.status === 401) { showAuth(); return false; }
        if (!exRes.ok) {
            await alertDlg('Aufgaben konnten nicht geladen werden — ist das Modul „Lernpfad" aktiviert? (Status ' + exRes.status + ')');
        }
        topics = tRes.ok ? await tRes.json() : [];
        aufgaben = exRes.ok ? (await exRes.json()).map(vonKern) : [];
        // Fehlende Codes serverseitig in EINEM Request auffuellen (statt je Aufgabe
        // ein PUT — das war der 429-Sturm). Nur wenn ueberhaupt welche leer sind.
        if (aufgaben.some(a => !/^#\d+$/.test(String(a.code || '')))) {
            try {
                const r = await api(`${LP}/exercises/backfill-codes`, { method: 'POST' });
                if (r.ok) { const { codes } = await r.json(); aufgaben.forEach(a => { if (codes && codes[a.id]) a.code = codes[a.id]; }); }
            } catch (e) { console.error('Code-Backfill:', e); }
        }
        // Signaturen setzen: Aufgaben sind jetzt mit dem Server in Sync, spaetere
        // Saves spiegeln nur noch wirklich Geaendertes (kein Voll-PUT mehr).
        syncSigs = {};
        aufgaben.forEach(a => { if (a.id) syncSigs[a.id] = aufgabeSig(a); });
        const klassenRaw = clRes.ok ? await clRes.json() : [];
        // Lernleitern hängen am KURS, nicht an der Fach-Klasse: Schüler nach Kurs
        // gruppieren (gleichnamige der Fach-Klassen eines Kurses = eine Person).
        const kurse = kuRes && kuRes.ok ? await kuRes.json() : [];
        const classKurs = {};
        kurse.forEach(k => (k.classes || []).forEach(c => { if (!(c.id in classKurs)) classKurs[c.id] = k.name; }));
        const kursOf = c => classKurs[c.id] || c.name;
        schueler = [];
        const gesehen = new Set();
        klassenRaw.forEach(c => (c.students || []).forEach(st => {
            const kn = kursOf(c);
            const key = kn + '||' + st.name;
            if (gesehen.has(key)) return;   // Duplikat aus Geschwister-Fachklasse
            gesehen.add(key);
            schueler.push({
                _id: String(st.id), id: st.id, name: st.name, klasse: kn, class_id: c.id,
                niveau: st.niveau || '', foerder: st.foerder || [], notizen: st.notizen || ''
            });
        }));
        klassen = [...new Set(klassenRaw.map(kursOf))];
        await checkKartenModul();
        lernpfade = [];
        localStorage.setItem(STORAGE_KEYS.aufgaben, JSON.stringify(aufgaben));
        localStorage.setItem(STORAGE_KEYS.schueler, JSON.stringify(schueler));
        localStorage.setItem(STORAGE_KEYS.klassen, JSON.stringify(klassen));
        overviewKlasse = '';
        renderAufgaben(); renderKlassen(); renderSchueler(); updateFilters();
        return true;
    }

    // Kein eigener Login: Nuvora authentifiziert, die App erbt den Token
    // (gleiche Origin, gleicher localStorage).
    async function checkAuth() {
        if (!localStorage.getItem('token')) { showAuth(); return; }
        try {
            const u = JSON.parse(localStorage.getItem('user') || 'null');
            const el = document.getElementById('nav-user');
            if (el) el.textContent = (u && u.email) || '';
        } catch (e) { /* Anzeige ist nebensaechlich */ }
        hideAuth();
        await loadUserData();
    }

    // Konto-Dropdown auf/zu
    const accountMenu = document.getElementById('account-menu');
    document.getElementById('btn-account').addEventListener('click', (e) => {
        e.stopPropagation();
        accountMenu.style.display = accountMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
        // Null-Guard: der Listener haengt am document und kann feuern, wenn die
        // in-page gemountete App (und damit #nav-account) schon wieder weg ist.
        const na = document.getElementById('nav-account');
        if (na && !na.contains(e.target)) accountMenu.style.display = 'none';
    });

    // Abmelden gehoert Nuvora: das Modul hat kein eigenes Konto mehr. Im Rahmen
    // meldet man sich oben rechts ab; der Knopf hier fuehrt nur dorthin.
    document.getElementById('btn-logout').addEventListener('click', () => {
        // Anzeige-Cache leeren, damit das naechste Konto nichts erbt.
        [STORAGE_KEYS.aufgaben, STORAGE_KEYS.schueler, STORAGE_KEYS.klassen, STORAGE_KEYS.idCounter]
            .forEach(k => localStorage.removeItem(k));
        aufgaben = []; schueler = []; klassen = []; lernpfade = [];
        const ziel = '/profile';
        if (window.parent !== window) window.parent.location.href = ziel;
        else window.location.href = ziel;
    });

    document.addEventListener('DOMContentLoaded', checkAuth);

    // Migrate old multi-category data to single kategorie
    aufgaben.forEach(a => {
        if (a.kategorien && !a.kategorie) {
            a.kategorie = a.kategorien[0] || 'Basis';
            delete a.kategorien;
        }
    });
    // NUR lokal sichern, NICHT ueber save() zum Server spiegeln: hier steht noch
    // der (evtl. leere/stale) localStorage-Cache, denn loadUserData hat die
    // autoritativen Server-Daten noch nicht geladen. Ein syncAufgaben hier
    // wuerde bei leerem Cache ALLE Server-Aufgaben loeschen und fuer jedes
    // (noch nicht gecachte) Thema ein 409 provozieren.
    localStorage.setItem(STORAGE_KEYS.aufgaben, JSON.stringify(aufgaben));

    if (aufgaben.length) {
        const maxNum = aufgaben.reduce((max, a) => {
            const m = String(a.id || '').match(/^#(\d+)$/);
            return m ? Math.max(max, parseInt(m[1])) : max;
        }, 0);
        const stored = loadNum(STORAGE_KEYS.idCounter);
        if (maxNum > stored) localStorage.setItem(STORAGE_KEYS.idCounter, maxNum);
    }

    // ─── Tabs ───
    function switchTab(tab) {
        const btn = document.querySelector('.tab[data-tab="' + tab + '"]');
        if (!btn) return;
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        const content = document.getElementById('tab-' + tab);
        if (content) content.classList.add('active');
        if (tab === 'generator') refreshGeneratorDropdowns();
        if (tab === 'aufgaben') setNextId();
        if (tab === 'lernpfade') loadLernpfade();
        const nav = document.getElementById('nav-links');
        if (nav) nav.classList.remove('open');
        // Eingebettet: Nuvora ueber den aktiven Tab informieren (Menue-Markierung).
        if (window.parent !== window || inPage) window.parent.postMessage({ type: 'lernpfad:tab', tab }, window.location.origin);
    }
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Eingebettet: Nuvoras Navbar steuert die Tabs.
    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data && e.data.type === 'nuvora:lernpfad-tab' && e.data.tab) switchTab(e.data.tab);
    });

    // Mobiles Navigations-Menü aufklappen
    const navToggle = document.getElementById('nav-toggle');
    if (navToggle) {
        navToggle.addEventListener('click', () => {
            const links = document.getElementById('nav-links');
            const open = links.classList.toggle('open');
            navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    // ─── Auto-ID ───
    function setNextId() {
        const field = document.getElementById('aufgabe-id');
        if (!document.getElementById('aufgabe-edit-id').value) {
            field.value = nextAufgabeId();   // kleinste freie Nummer
        }
    }

    // ─── Aufgaben ───
    const aufgabeForm = document.getElementById('aufgabe-form');
    const lrsCheckbox = document.getElementById('aufgabe-lrs');
    const lrsAltGroup = document.querySelector('.lrs-alt-group');

    lrsCheckbox.addEventListener('change', () => {
        lrsAltGroup.style.display = lrsCheckbox.checked ? '' : 'none';
    });

    // ─── Form Visibility ───
    function updateFormVisibility() {
        const thema = document.getElementById('aufgabe-thema').value.trim();
        const kat = getSelectedKategorie();
        const isErkl = kat === 'Erklärung';
        const aufgabentyp = document.getElementById('aufgabe-operator').value.trim();

        document.getElementById('unterthema-row').style.display = thema ? '' : 'none';
        document.getElementById('bilder-step').style.display = thema ? '' : 'none';
        document.getElementById('aufgabentyp-row').style.display = (kat && !isErkl) ? '' : 'none';

        const showDetails = isErkl || aufgabentyp;
        document.getElementById('aufgabe-details').style.display = showDetails ? '' : 'none';
        document.getElementById('kompetenz-row').style.display = isErkl ? 'none' : '';
        document.getElementById('loesung-group').style.display = isErkl ? 'none' : '';
        document.getElementById('loesungbild-group').style.display = isErkl ? 'none' : '';

        // LaTeX-Quelle: Code-Feld ein/aus, Seite/Nummer-Feld nur bei Buch/Blatt
        const isLatex = document.getElementById('aufgabe-quelle-typ').value === 'latex';
        document.getElementById('latex-group').style.display = isLatex ? '' : 'none';
        document.getElementById('aufgabe-quelle-detail').style.display = isLatex ? 'none' : '';

        // Speichern erst moeglich, wenn die Pflichtfelder (Thema + Kategorie) da sind.
        const submitBtn = document.getElementById('aufgabe-submit-btn');
        if (submitBtn) submitBtn.disabled = !(thema && kat);
    }

    // ─── "Neue Aufgabe" ein-/ausklappbar ───
    (function () {
        const title = document.getElementById('aufgaben-form-title');
        const form = document.getElementById('aufgabe-form');
        if (!title || !form) return;
        window.setAufgabeFormOpen = (open) => {
            form.style.display = open ? '' : 'none';
            title.dataset.collapsed = open ? '0' : '1';
        };
        title.addEventListener('click', () => window.setAufgabeFormOpen(title.dataset.collapsed === '1'));
        // Standard: eingeklappt, damit die Uebersicht oben steht.
        window.setAufgabeFormOpen(false);
    })();

    // KaTeX sicher rendern (gibt bei Fehler den Rohcode zurück)
    function renderLatex(el, code) {
        if (!el) return;
        if (!code || !code.trim()) { el.innerHTML = ''; return; }
        try {
            window.katex.render(code, el, { throwOnError: false, displayMode: false });
        } catch (e) {
            el.textContent = code;
        }
    }

    document.getElementById('aufgabe-quelle-typ').addEventListener('change', updateFormVisibility);
    document.getElementById('aufgabe-latex').addEventListener('input', (e) => {
        renderLatex(document.getElementById('aufgabe-latex-preview'), e.target.value);
    });

    // LaTeX-Toolbar: wichtigste Elemente, Klick fügt an Cursor ein.
    // `preview` = KaTeX-Beschriftung des Buttons, `snip` = eingefügter Code,
    // `|` darin markiert die Cursor-Position danach.
    const LATEX_TOOLS = [
        { preview: '\\frac{a}{b}', snip: '\\frac{|}{}', title: 'Bruch' },
        { preview: 'x^{2}',        snip: '^{|}',        title: 'Hochzahl' },
        { preview: 'x_{n}',        snip: '_{|}',        title: 'Index' },
        { preview: '\\sqrt{x}',    snip: '\\sqrt{|}',   title: 'Wurzel' },
        { preview: '\\cdot',       snip: ' \\cdot ',    title: 'Mal' },
        { preview: '\\div',        snip: ' \\div ',     title: 'Geteilt' },
        { preview: '\\times',      snip: ' \\times ',   title: 'Kreuz-Mal' },
        { preview: '\\pm',         snip: ' \\pm ',      title: 'Plusminus' },
        { preview: '\\le',         snip: ' \\le ',      title: 'Kleiner-gleich' },
        { preview: '\\ge',         snip: ' \\ge ',      title: 'Größer-gleich' },
        { preview: '\\ne',         snip: ' \\ne ',      title: 'Ungleich' },
        { preview: '\\square',     snip: '\\square',    title: 'Lückenkästchen' },
        { preview: '{}^{\\circ}',  snip: '^{\\circ}',   title: 'Grad' },
        { preview: '\\pi',         snip: '\\pi ',       title: 'Pi' },
        { preview: '(\\;)',        snip: '\\left( | \\right)', title: 'Klammern' },
    ];

    (function buildLatexToolbar() {
        const bar = document.getElementById('latex-toolbar');
        const ta = document.getElementById('aufgabe-latex');
        if (!bar || !ta) return;
        LATEX_TOOLS.forEach(tool => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'latex-tool';
            btn.title = tool.title;
            renderLatex(btn, tool.preview);
            btn.addEventListener('click', () => {
                const raw = tool.snip;
                const caret = raw.indexOf('|');
                const insert = raw.replace('|', '');
                const start = ta.selectionStart, end = ta.selectionEnd;
                ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
                // Cursor an Marker-Position (oder ans Ende des Snippets)
                const pos = start + (caret === -1 ? insert.length : caret);
                ta.focus();
                ta.setSelectionRange(pos, pos);
                renderLatex(document.getElementById('aufgabe-latex-preview'), ta.value);
            });
            bar.appendChild(btn);
        });
    })();

    document.getElementById('aufgabe-thema').addEventListener('input', () => {
        updateFormVisibility();
        updateFormUnterthemen();
    });
    document.getElementById('aufgabe-kategorie').addEventListener('change', updateFormVisibility);
    document.getElementById('aufgabe-operator').addEventListener('input', updateFormVisibility);

    function updateFormUnterthemen() {
        const thema = document.getElementById('aufgabe-thema').value.trim();
        const dl = document.getElementById('unterthemen-list');
        // Unterthemen aus Aufgaben UND aus den Kind-Themen des Kern-Themas.
        const ober = topics.find(t => !t.parent_id && t.name === thema);
        const kernKinder = ober ? topics.filter(t => t.parent_id === ober.id).map(t => t.name) : [];
        const matching = [...new Set([...aufgaben.filter(a => a.thema === thema).map(a => a.unterthema).filter(Boolean), ...kernKinder])].sort();
        dl.innerHTML = matching.map(t => `<option value="${esc(t)}">`).join('');
    }

    // ─── Bild-Upload ───
    let currentBild = null;
    let currentLoesungBild = null;

    function handleImageUpload(fileInput, callback) {
        const file = fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxW = 800;
                let w = img.width, h = img.height;
                if (w > maxW) { h = h * maxW / w; w = maxW; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                callback(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    const bildInput = document.getElementById('aufgabe-bild');
    const bildPreview = document.getElementById('aufgabe-bild-preview');
    const loesungBildInput = document.getElementById('aufgabe-loesungbild');
    const loesungBildPreview = document.getElementById('aufgabe-loesungbild-preview');

    bildInput.addEventListener('change', () => handleImageUpload(bildInput, data => { currentBild = data; renderBildPreview(); }));
    loesungBildInput.addEventListener('change', () => handleImageUpload(loesungBildInput, data => { currentLoesungBild = data; renderLoesungBildPreview(); }));

    function renderBildPreview() {
        if (currentBild) {
            bildPreview.innerHTML = `<img src="${currentBild}"><span class="bild-remove" id="bild-remove">entfernen</span>`;
            document.getElementById('bild-remove').addEventListener('click', () => { currentBild = null; bildInput.value = ''; bildPreview.innerHTML = ''; });
        } else { bildPreview.innerHTML = ''; }
    }

    function renderLoesungBildPreview() {
        if (currentLoesungBild) {
            loesungBildPreview.innerHTML = `<img src="${currentLoesungBild}"><span class="bild-remove" id="loesungbild-remove">entfernen</span>`;
            document.getElementById('loesungbild-remove').addEventListener('click', () => { currentLoesungBild = null; loesungBildInput.value = ''; loesungBildPreview.innerHTML = ''; });
        } else { loesungBildPreview.innerHTML = ''; }
    }

    function getSelectedKategorie() {
        return document.getElementById('aufgabe-kategorie').value;
    }

    aufgabeForm.addEventListener('submit', e => {
        e.preventDefault();
        const editId = document.getElementById('aufgabe-edit-id').value;
        const kategorie = getSelectedKategorie();

        if (!kategorie) { toast('Kategorie wählen'); return; }

        const quelleTyp = document.getElementById('aufgabe-quelle-typ').value;
        const quelleDetail = document.getElementById('aufgabe-quelle-detail').value.trim();
        const latexCode = document.getElementById('aufgabe-latex').value.trim();
        let quelle;
        if (quelleTyp === 'schulbuch') {
            quelle = 'Schulbuch' + (quelleDetail ? ' [' + quelleDetail + ']' : '');
        } else if (quelleTyp === 'latex') {
            quelle = 'LaTeX';   // auf dem Blatt wird die Formel gerendert
        } else {
            quelle = 'Aufgabenblätter' + (quelleDetail ? ' [' + quelleDetail + ']' : '');
        }

        const obj = {
            _id: editId || uid(),
            // Neu: keine id (der Server vergibt die DB-id beim Sync); der
            // Anzeige-Code wird lueckenfuellend ab 1 gesetzt.
            id: editId ? document.getElementById('aufgabe-id').value.trim() : undefined,
            code: editId ? (aufgaben.find(x => x._id === editId)?.code || '') : nextAufgabeId(),
            thema: document.getElementById('aufgabe-thema').value.trim(),
            unterthema: document.getElementById('aufgabe-unterthema').value.trim(),
            kategorie,
            quelle,
            quelleTyp,
            quelleDetail,
            operator: document.getElementById('aufgabe-operator').value.trim(),
            kompetenz: editId ? (aufgaben.find(x => x._id === editId)?.kompetenz || '') : '',
            methode: document.getElementById('aufgabe-methode').value.trim(),
            lrs: lrsCheckbox.checked,
            lrsText: document.getElementById('aufgabe-lrs-text').value.trim(),
            foerderschwerpunkte: [...document.querySelectorAll('.aufgabe-foerder:checked')].map(cb => cb.value),
            loesung: document.getElementById('aufgabe-loesung').value.trim(),
            aufgabentext: document.getElementById('aufgabe-aufgabentext').value.trim(),
            unteraufgaben: parseInt(document.getElementById('aufgabe-unteraufgaben').value) || 1,
            bild: currentBild || undefined,
            loesungBild: currentLoesungBild || undefined,
            latex: quelleTyp === 'latex' ? latexCode : ''
        };

        if (editId) {
            const idx = aufgaben.findIndex(a => a._id === editId);
            if (idx !== -1) aufgaben[idx] = obj;
        } else {
            aufgaben.push(obj);
        }

        save(STORAGE_KEYS.aufgaben, aufgaben);
        resetAufgabeForm();
        renderAufgaben();
        // Nach dem Speichern hoch scrollen: sonst bleibt man unten am Formular
        // und sieht die neue Aufgabe in der Liste nicht.
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast(editId ? 'Aufgabe aktualisiert' : 'Aufgabe gespeichert');
    });

    function resetAufgabeForm() {
        aufgabeForm.reset();
        document.getElementById('aufgabe-edit-id').value = '';
        document.getElementById('aufgaben-form-title').textContent = 'Neue Aufgabe';
        document.getElementById('aufgabe-cancel-btn').style.display = 'none';
        document.getElementById('aufgabe-submit-btn').textContent = 'Aufgabe speichern';
        document.getElementById('edit-id-display').style.display = 'none';
        lrsAltGroup.style.display = 'none';
        currentBild = null;
        currentLoesungBild = null;
        bildInput.value = '';
        bildPreview.innerHTML = '';
        loesungBildInput.value = '';
        loesungBildPreview.innerHTML = '';
        document.getElementById('aufgabe-unteraufgaben').value = '1';
        document.getElementById('aufgabe-latex').value = '';
        document.getElementById('aufgabe-latex-preview').innerHTML = '';
        updateFormVisibility();
        setNextId();
        if (window.setAufgabeFormOpen) window.setAufgabeFormOpen(false);
    }

    document.getElementById('aufgabe-cancel-btn').addEventListener('click', resetAufgabeForm);

    function editAufgabe(a) {
        document.getElementById('aufgabe-edit-id').value = a._id;
        document.getElementById('aufgabe-id').value = a.id;
        document.getElementById('aufgabe-thema').value = a.thema;
        document.getElementById('aufgabe-unterthema').value = a.unterthema || '';

        const kat = a.kategorie || (a.kategorien && a.kategorien[0]) || '';
        document.getElementById('aufgabe-kategorie').value = kat;

        document.getElementById('aufgabe-quelle-typ').value = a.quelleTyp || 'schulbuch';
        document.getElementById('aufgabe-quelle-detail').value = a.quelleDetail || '';
        document.getElementById('aufgabe-latex').value = a.latex || '';
        renderLatex(document.getElementById('aufgabe-latex-preview'), a.latex || '');
        document.getElementById('aufgabe-operator').value = a.operator || '';
        document.getElementById('aufgabe-unteraufgaben').value = a.unteraufgaben || 1;
        document.getElementById('aufgabe-methode').value = a.methode || '';
        document.getElementById('aufgabe-lrs').checked = a.lrs;
        lrsAltGroup.style.display = a.lrs ? '' : 'none';
        document.getElementById('aufgabe-lrs-text').value = a.lrsText || '';
        document.getElementById('aufgabe-loesung').value = a.loesung || '';
        document.getElementById('aufgabe-aufgabentext').value = a.aufgabentext || '';
        document.querySelectorAll('.aufgabe-foerder').forEach(cb => {
            cb.checked = (a.foerderschwerpunkte || []).includes(cb.value);
        });
        currentBild = a.bild || null;
        renderBildPreview();
        currentLoesungBild = a.loesungBild || null;
        if (currentLoesungBild) {
            loesungBildPreview.innerHTML = '<img src="' + currentLoesungBild + '" style="max-width:200px">';
        } else {
            loesungBildPreview.innerHTML = '';
        }
        document.getElementById('edit-id-display').style.display = '';
        document.getElementById('edit-id-label').textContent = fmtId(a.code || a.id);
        document.getElementById('aufgaben-form-title').textContent = 'Aufgabe bearbeiten';
        document.getElementById('aufgabe-cancel-btn').style.display = '';
        document.getElementById('aufgabe-submit-btn').textContent = 'Änderung speichern';
        if (window.setAufgabeFormOpen) window.setAufgabeFormOpen(true);
        updateFormVisibility();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function deleteAufgabe(_id) {
        if (!await confirmDlg('Aufgabe wirklich löschen?', { ok: 'Löschen' })) return;
        aufgaben = aufgaben.filter(a => a._id !== _id);
        save(STORAGE_KEYS.aufgaben, aufgaben);
        renderAufgaben();
        toast('Aufgabe gelöscht');
    }

    function getKategorie(a) {
        return a.kategorie || (a.kategorien && a.kategorien[0]) || '';
    }

    function katBadgeClass(kat) {
        if (kat === 'Basis') return 'basis';
        if (kat === 'G-Niveau') return 'g';
        if (kat === 'E-Niveau') return 'e';
        if (kat === 'Erklärung') return 'erklaerung';
        return 'tag';
    }

    const katOrder = {'Erklärung': 0, 'Basis': 1, 'G-Niveau': 2, 'E-Niveau': 3};
    // Natuerlicher Sortierschluessel aus der Quelle: erst Buchseite (S.70),
    // dann Aufgabennummer (Nr.1), dann Resttext. So folgt die Lernleiter dem
    // Buch (Nr.1, Nr.2, …) statt String-Reihenfolge (Nr.1, Nr.10, Nr.2).
    function quelleKey(q) {
        q = q || '';
        const seite = (q.match(/S\.?\s*(\d+)/i) || [])[1];
        const nr = (q.match(/Nr\.?\s*(\d+)/i) || [])[1];
        return [seite ? +seite : 9999, nr ? +nr : 9999, q.toLowerCase()];
    }
    function sortByKatThenQuelle(arr) {
        return arr.slice().sort((a, b) => {
            const ka = katOrder[getKategorie(a)] ?? 4;
            const kb = katOrder[getKategorie(b)] ?? 4;
            if (ka !== kb) return ka - kb;
            const [pa, na, ta] = quelleKey(a.quelle), [pb, nb, tb] = quelleKey(b.quelle);
            if (pa !== pb) return pa - pb;
            if (na !== nb) return na - nb;
            return ta.localeCompare(tb);
        });
    }

    function renderTags(a) {
        let html = '';
        if (a.operator) html += `<span class="badge badge-operator">${esc(a.operator)}</span> `;
        if (a.kompetenz) html += `<span class="badge badge-kompetenz">${esc(a.kompetenz)}</span> `;
        if (a.methode) html += `<span class="badge badge-methode">${esc(a.methode)}</span> `;
        if (a.foerderschwerpunkte && a.foerderschwerpunkte.length) {
            a.foerderschwerpunkte.forEach(f => {
                html += `<span class="badge badge-lrs">${esc(f)}</span> `;
            });
        }
        return html || '–';
    }

    function initTableSort(tableId, renderFn) {
        const table = document.getElementById(tableId);
        if (!table) return;
        table.querySelectorAll('th[data-sort]').forEach(th => {
            th.style.cursor = 'pointer';
            // Basis-Label einmal merken, damit der Pfeil beim Neuzeichnen nicht
            // an den Text angehaengt akkumuliert.
            if (th.dataset.label == null) th.dataset.label = th.textContent.trim();
            // Nur einmal binden - initTableSort laeuft bei jedem Render.
            if (!th.dataset.sortBound) {
                th.dataset.sortBound = '1';
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (sortState.table === tableId && sortState.column === col) {
                        sortState.asc = !sortState.asc;
                    } else {
                        sortState.table = tableId;
                        sortState.column = col;
                        sortState.asc = true;
                    }
                    // Scrollposition halten: renderFn baut die Tabelle neu auf,
                    // sonst springt die Seite nach oben.
                    const y = window.scrollY;
                    renderFn();
                    window.scrollTo(0, y);
                });
            }
        });
        updateSortIndicators(tableId);
    }

    // Nur eine Sortierung aktiv: alle th auf Basis-Label zuruecksetzen, aktive
    // Spalte mit Auf-/Ab-Pfeil markieren.
    function updateSortIndicators(tableId) {
        const table = document.getElementById(tableId);
        if (!table) return;
        table.querySelectorAll('th[data-sort]').forEach(th => {
            const active = sortState.table === tableId && sortState.column === th.dataset.sort;
            const arrow = active ? (sortState.asc ? ' ▲' : ' ▼') : '';
            th.textContent = (th.dataset.label || th.textContent.trim()) + arrow;
        });
    }

    function applySort(arr) {
        if (!sortState.table || !sortState.column) return arr;
        const col = sortState.column;
        const sorted = arr.slice().sort((a, b) => {
            let cmp;
            if (col === 'id') {
                cmp = codeNum(a) - codeNum(b);   // nach angezeigter Nummer, NUMERISCH
            } else {
                const av = a[col], bv = b[col];
                cmp = (av > bv) ? 1 : (av < bv) ? -1 : 0;
            }
            return sortState.asc ? cmp : -cmp;
        });
        return sorted;
    }

    function renderAufgaben() {
        const tbody = document.querySelector('#aufgaben-tabelle tbody');
        const filterThema = document.getElementById('filter-thema').value;
        const filterUnterthema = document.getElementById('filter-unterthema').value;
        const filterKat = document.getElementById('filter-kategorie').value;
        const search = document.getElementById('aufgaben-suche').value.trim().toLowerCase();

        let filtered = aufgaben;
        if (filterThema) filtered = filtered.filter(a => a.thema === filterThema);
        if (filterUnterthema) filtered = filtered.filter(a => a.unterthema === filterUnterthema);
        if (filterKat) filtered = filtered.filter(a => getKategorie(a) === filterKat);
        if (search) {
            // Auch nach der ANGEZEIGTEN ID (#000043) suchbar, nicht nur nach der
            // rohen Server-id — sonst findet die Suche nach dem sichtbaren Code
            // nichts. "#" wird zusaetzlich weggelassen, damit "43" ebenso trifft.
            const s2 = search.replace(/^#/, '');
            filtered = filtered.filter(a => {
                const code = fmtId(a.code || a.id);
                const haystack = [
                    code, code.replace('#', ''), a.code, a.id, a.thema, a.unterthema, getKategorie(a), a.quelle,
                    a.operator, a.kompetenz, a.methode, a.loesung
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(search) || haystack.includes(s2);
            });
        }

        filtered = sortByKatThenQuelle(filtered);
        if (sortState.table === 'aufgaben-tabelle' && sortState.column && sortState.column !== 'kat') {
            filtered = applySort(filtered);
        }

        const gesamt = filtered.length;
        const sichtbar = filtered.slice(0, aufgabenLimit);
        tbody.innerHTML = sichtbar.map(a => {
            const kat = getKategorie(a);
            const hasDetail = a.bild || a.aufgabentext;
            return `
            <tr class="${hasDetail ? 'task-row-clickable' : ''}" data-detail-id="${a._id}">
                <td><input type="checkbox" class="bulk-cb" data-id="${a._id}"></td>
                <td><strong>${esc(fmtId(a.code || a.id))}</strong>${hasDetail ? ' <span class="detail-hint" title="Details">' + ICON.chevron + '</span>' : ''}</td>
                <td>${esc(a.thema)}${a.unterthema ? '<br><small style="color:var(--text-muted)">' + esc(a.unterthema) + '</small>' : ''}</td>
                <td><span class="badge badge-${katBadgeClass(kat)}">${esc(kat)}</span></td>
                <td>${esc(a.quelle)}</td>
                <td>${renderTags(a)}</td>
                <td style="text-align:center">${a.lrs ? '<span class="lrs-check" title="LRS">✓</span>' : ''}</td>
                <td>${a.loesung ? '<span class="icon-success" title="Lösung vorhanden">' + ICON.check + '</span>' : '–'}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn icon" data-action="edit" data-id="${a._id}" title="Bearbeiten">${ICON.edit}</button>
                        <button class="btn icon danger" data-action="delete" data-id="${a._id}" title="Löschen">${ICON.delete}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('[data-action]').forEach(btn => {
            const a = aufgaben.find(x => x._id === btn.dataset.id);
            if (!a) return;
            if (btn.dataset.action === 'edit') btn.onclick = (e) => { e.stopPropagation(); editAufgabe(a); };
            else btn.onclick = (e) => { e.stopPropagation(); deleteAufgabe(a._id); };
        });

        tbody.querySelectorAll('.task-row-clickable').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                const a = aufgaben.find(x => x._id === row.dataset.detailId);
                if (a) showTaskDetail(a);
            });
        });

        initTableSort('aufgaben-tabelle', renderAufgaben);

        tbody.querySelectorAll('.bulk-cb').forEach(cb => {
            cb.addEventListener('change', updateBulkBar);
        });

        // „Mehr laden": weitere AUFGABEN_PAGE Zeilen ins DOM, ohne Server-Anfrage.
        if (gesamt > aufgabenLimit) {
            const tr = document.createElement('tr');
            tr.className = 'aufgaben-more-row';
            tr.innerHTML = `<td colspan="9" style="text-align:center;padding:10px">
                <button class="btn" id="btn-more-aufgaben">Mehr laden (${gesamt - aufgabenLimit} weitere)</button></td>`;
            tbody.appendChild(tr);
            tr.querySelector('#btn-more-aufgaben').addEventListener('click', () => { aufgabenLimit += AUFGABEN_PAGE; renderAufgaben(); });
        }

        updateFilters();
    }
    // Neue Abfrage (Filter/Suche geaendert): wieder bei den ersten 50 anfangen.
    function renderAufgabenReset() { aufgabenLimit = AUFGABEN_PAGE; renderAufgaben(); }

    function updateFilters() {
        // Themen: aus vorhandenen Aufgaben UND aus der Kern-Taxonomie (topics),
        // damit man Kern-Themen auch ohne bestehende Aufgabe auswaehlen kann.
        const kernOber = topics.filter(t => !t.parent_id).map(t => t.name);
        const themen = [...new Set([...aufgaben.map(a => a.thema).filter(Boolean), ...kernOber])].sort();
        const sel = document.getElementById('filter-thema');
        const cur = sel.value;
        sel.innerHTML = '<option value="">Alle Themen</option>' + themen.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
        sel.value = cur;

        const selectedThema = document.getElementById('filter-thema').value;
        const unterthemen = [...new Set(
            aufgaben
                .filter(a => !selectedThema || a.thema === selectedThema)
                .map(a => a.unterthema)
                .filter(Boolean)
        )].sort();
        const selU = document.getElementById('filter-unterthema');
        const curU = selU.value;
        selU.innerHTML = '<option value="">Alle Unterthemen</option>' + unterthemen.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
        selU.value = curU;

        const dl = document.getElementById('themen-list');
        dl.innerHTML = themen.map(t => `<option value="${esc(t)}">`).join('');

        const kernUnter = topics.filter(t => t.parent_id).map(t => t.name);
        const allUnterthemen = [...new Set([...aufgaben.map(a => a.unterthema).filter(Boolean), ...kernUnter])].sort();
        const dlU = document.getElementById('unterthemen-list');
        dlU.innerHTML = allUnterthemen.map(t => `<option value="${esc(t)}">`).join('');
    }

    document.getElementById('filter-thema').addEventListener('change', () => {
        document.getElementById('filter-unterthema').value = '';
        renderAufgabenReset();
    });
    document.getElementById('filter-unterthema').addEventListener('change', renderAufgabenReset);
    document.getElementById('filter-kategorie').addEventListener('change', renderAufgabenReset);
    document.getElementById('aufgaben-suche').addEventListener('input', renderAufgabenReset);

    // ─── JSON Import ───
    document.getElementById('btn-json-import').addEventListener('click', () => {
        document.getElementById('json-file-input').click();
    });

    document.getElementById('json-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                const items = Array.isArray(data) ? data : (data.aufgaben || []);
                if (!items.length) { toast('Keine Aufgaben in JSON gefunden'); return; }

                let imported = 0;
                items.forEach(item => {
                    const kat = item.kategorie || (item.kategorien && item.kategorien[0]) || '';
                    const obj = {
                        _id: uid(),
                        // Server vergibt die DB-id; Anzeige-Code lueckenfuellend.
                        code: item.code || nextAufgabeId(),
                        thema: item.thema || '',
                        unterthema: item.unterthema || '',
                        kategorie: kat,
                        quelle: item.quelle || '',
                        quelleTyp: item.quelleTyp || 'schulbuch',
                        quelleDetail: item.quelleDetail || '',
                        operator: item.operator || '',
                        unteraufgaben: parseInt(item.unteraufgaben) || 1,
                        kompetenz: item.kompetenz || '',
                        methode: item.methode || '',
                        lrs: !!item.lrs,
                        lrsText: item.lrsText || '',
                        foerderschwerpunkte: Array.isArray(item.foerderschwerpunkte) ? item.foerderschwerpunkte : [],
                        loesung: item.loesung || '',
                        aufgabentext: item.aufgabentext || '',
                        bild: item.bild || undefined,
                        loesungBild: item.loesungBild || undefined,
                        latex: item.latex || ''
                    };
                    if (obj.thema && obj.kategorie) {
                        aufgaben.push(obj);
                        imported++;
                    }
                });

                save(STORAGE_KEYS.aufgaben, aufgaben);
                renderAufgaben();
                setNextId();
                toast(imported + ' Aufgaben importiert');
            } catch (err) {
                toast('Fehler beim Lesen: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // ─── Export/Import All ───
    document.getElementById('btn-export-all').addEventListener('click', () => {
        const data = {
            aufgaben,
            schueler,
            klassen,
            idCounter: loadNum(STORAGE_KEYS.idCounter)
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'lernleiter_daten.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Daten exportiert');
    });

    document.getElementById('btn-import-all').addEventListener('click', () => {
        document.getElementById('all-data-file-input').click();
    });

    document.getElementById('all-data-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.aufgaben) { aufgaben = data.aufgaben; save(STORAGE_KEYS.aufgaben, aufgaben); }
                if (data.schueler) { schueler = data.schueler; save(STORAGE_KEYS.schueler, schueler); }
                if (data.klassen) { klassen = data.klassen; save(STORAGE_KEYS.klassen, klassen); }
                if (data.idCounter) { localStorage.setItem(STORAGE_KEYS.idCounter, data.idCounter); }
                renderAufgaben();
                renderKlassen();
                renderSchueler();
                setNextId();
                toast('Alle Daten importiert');
            } catch (err) {
                toast('Fehler: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // Aufgaben als Vorlage exportieren: NUR die Aufgaben, KEINE Schüler-/
    // Klassendaten (DSGVO-sauber, teilbar/wiederverwendbar). Server-IDs werden
    // beim Import ohnehin neu vergeben. `liste` = ganzer Pool oder eine Auswahl.
    function exportAufgabenListe(liste, filename) {
        if (!liste.length) { toast('Keine Aufgaben ausgewählt'); return; }
        const blob = new Blob([JSON.stringify({ type: 'lernleiter_aufgaben', version: 1, aufgaben: liste }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
        toast(liste.length + ' Aufgaben exportiert');
    }
    const exportPool = () => exportAufgabenListe(aufgaben, 'lernleiter_aufgaben_vorlage.json');

    document.getElementById('btn-export-aufgaben').addEventListener('click', exportPool);        // Konto-Menü
    document.getElementById('btn-export-aufgaben-tab').addEventListener('click', exportPool);     // Aufgaben-Tab
    // Vorlage IMPORTIEREN entfernt: der volle "Aufgaben importieren" (json-file-input)
    // deckt das Anhängen bereits ab; ein zweiter Weg war verwirrend.

    document.getElementById('btn-export-klasse').addEventListener('click', () => {
        const data = { schueler, klassen };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'lernleiter_klassen.json';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('Klassendaten exportiert');
    });

    document.getElementById('btn-import-klasse').addEventListener('click', () => {
        document.getElementById('klasse-file-input').click();
    });

    document.getElementById('klasse-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.klassen) {
                    data.klassen.forEach(k => { if (!klassen.includes(k)) klassen.push(k); });
                    save(STORAGE_KEYS.klassen, klassen);
                }
                if (data.schueler) {
                    const existingNames = new Set(schueler.map(s => s.name + '|' + s.klasse));
                    data.schueler.forEach(s => {
                        if (!existingNames.has(s.name + '|' + s.klasse)) schueler.push(s);
                    });
                    save(STORAGE_KEYS.schueler, schueler);
                }
                renderKlassen();
                renderSchueler();
                toast('Klassendaten importiert');
            } catch (err) {
                toast('Fehler: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });


    // ─── Klassen ───
    function renderKlassen() {
        const container = document.getElementById('klassen-chips');
        container.innerHTML = klassen.map(k => `
            <span class="chip klasse-chip" data-klasse="${esc(k)}">
                ${esc(k)}
                <button type="button" class="chip-delete" data-klasse="${esc(k)}">&times;</button>
            </span>
        `).join('');

        container.querySelectorAll('.klasse-chip').forEach(chip => {
            const klasseText = chip.dataset.klasse;
            chip.style.cursor = 'pointer';
            chip.addEventListener('click', (e) => {
                if (e.target.classList.contains('chip-delete')) return;
                document.getElementById('schueler-klasse').value = klasseText;
                document.getElementById('schueler-panel').style.display = '';
                document.getElementById('schueler-overview-panel').style.display = '';
                overviewKlasse = klasseText;
                renderSchueler();
                document.getElementById('schueler-name').focus();
            });
        });

        container.querySelectorAll('.chip-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteKlasse(btn.dataset.klasse);
            });
        });

        updateKlassenDropdowns();
    }

    // Klasse samt allem Zugehörigen löschen: Schüler, deren Lernwege in jedem
    // Lernpfad, und Lernpfade die dadurch leer werden. Nicht umkehrbar.
    async function deleteKlasse(name) {
        // Lernpfade müssen geladen sein, um Lernwege mitzuzählen/zu löschen.
        await loadLernpfade();

        const kSchueler = schueler.filter(s => s.klasse === name);
        let wegeCount = 0;
        lernpfade.forEach(p => {
            const wege = (p.lernleitern || []).filter(ll => ll.klasse === name).length;
            wegeCount += wege;
        });

        const msg = `Klasse "${name}" wirklich löschen?\n\n` +
            `Mitgelöscht: ${kSchueler.length} Schüler, ${wegeCount} Lernwege. ` +
            `Lernpfade, die dadurch leer werden, werden ebenfalls entfernt.\n\n` +
            `Das lässt sich nicht rückgängig machen.`;
        if (!await confirmDlg(msg, { ok: 'Löschen' })) return;

        // Schüler entfernen (Backend + lokal)
        // Schueler gehoeren dem Kern und werden unter /classes gepflegt —
        // dieses Modul loescht sie nicht.
        schueler = schueler.filter(s => s.klasse !== name);
        save(STORAGE_KEYS.schueler, schueler);

        // Lernwege dieser Klasse aus jedem Pfad tilgen; leere Pfade löschen
        for (const p of lernpfade) {
            if (!p.lernleitern || !p.lernleitern.length) continue;
            const kept = p.lernleitern.filter(ll => ll.klasse !== name);
            if (kept.length === p.lernleitern.length) continue;
            p.lernleitern = kept;
            if (kept.length === 0) {
                api(`${LP}/paths/` + p.id, { method: 'DELETE' }).catch(() => {});
            } else {
                await savePfad(p);
            }
        }
        lernpfade = lernpfade.filter(p => p.lernleitern && p.lernleitern.length);

        // Klasse selbst
        klassen = klassen.filter(k => k !== name);
        save(STORAGE_KEYS.klassen, klassen);

        if (overviewKlasse === name) overviewKlasse = '';
        renderKlassen();
        renderSchueler();
        toast('Klasse gelöscht');
    }

    function updateKlassenDropdowns() {
        const sorted = [...klassen].sort();

        const schuelerSel = document.getElementById('schueler-klasse');
        const cur = schuelerSel.value;
        schuelerSel.innerHTML = '<option value="">– wählen –</option>' + sorted.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
        schuelerSel.value = cur;
    }

    document.getElementById('btn-klasse-add').addEventListener('click', () => {
        const input = document.getElementById('klasse-name');
        const name = input.value.trim();
        if (!name) { toast('Klassenname eingeben'); return; }
        if (klassen.includes(name)) { toast('Klasse existiert bereits'); return; }
        klassen.push(name);
        klassen.sort();
        save(STORAGE_KEYS.klassen, klassen);
        input.value = '';
        renderKlassen();
        toast('Klasse angelegt');
    });

    // ─── Schüler ───
    const schuelerForm = document.getElementById('schueler-form');

    schuelerForm.addEventListener('submit', e => {
        e.preventDefault();
        const editIdx = document.getElementById('schueler-edit-idx').value;
        const foerder = [];
        schuelerForm.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(cb => {
            if (cb.checked) foerder.push(cb.value);
        });

        const obj = {
            _id: editIdx || uid(),
            name: document.getElementById('schueler-name').value.trim(),
            niveau: document.getElementById('schueler-niveau').value,
            klasse: document.getElementById('schueler-klasse').value,
            foerder,
            notizen: document.getElementById('schueler-notizen').value.trim()
        };

        if (editIdx) {
            const idx = schueler.findIndex(s => s._id === editIdx);
            if (idx !== -1) schueler[idx] = obj;
        } else {
            schueler.push(obj);
        }

        save(STORAGE_KEYS.schueler, schueler);
        schuelerForm.reset();
        document.getElementById('schueler-edit-idx').value = '';
        document.getElementById('schueler-form-title').textContent = 'Schüler hinzufügen';
        document.getElementById('schueler-cancel-btn').style.display = 'none';
        document.getElementById('schueler-submit-btn').textContent = 'Schüler speichern';
        renderSchueler();
        toast(editIdx ? 'Schüler aktualisiert' : 'Schüler gespeichert');
    });

    document.getElementById('schueler-cancel-btn').addEventListener('click', () => {
        schuelerForm.reset();
        document.getElementById('schueler-edit-idx').value = '';
        document.getElementById('schueler-form-title').textContent = 'Schüler hinzufügen';
        document.getElementById('schueler-cancel-btn').style.display = 'none';
        document.getElementById('schueler-submit-btn').textContent = 'Schüler speichern';
    });

    function editSchueler(s) {
        document.getElementById('schueler-edit-idx').value = s._id;
        document.getElementById('schueler-name').value = s.name;
        document.getElementById('schueler-niveau').value = s.niveau;
        document.getElementById('schueler-klasse').value = s.klasse;
        schuelerForm.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(cb => {
            cb.checked = s.foerder.includes(cb.value);
        });
        document.getElementById('schueler-notizen').value = s.notizen || '';
        document.getElementById('schueler-form-title').textContent = 'Schüler bearbeiten';
        document.getElementById('schueler-cancel-btn').style.display = '';
        document.getElementById('schueler-submit-btn').textContent = 'Änderung speichern';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function deleteSchueler(_id) {
        if (!await confirmDlg('Schüler wirklich löschen?', { ok: 'Löschen' })) return;
        schueler = schueler.filter(s => s._id !== _id);
        save(STORAGE_KEYS.schueler, schueler);
        renderSchueler();
        toast('Schüler gelöscht');
    }

    function renderSchueler() {
        const tbody = document.querySelector('#schueler-tabelle tbody');

        // Kopfzeile: aktive Klassenfilterung anzeigen + "Alle anzeigen"
        const label = document.getElementById('overview-klasse-label');
        const alleBtn = document.getElementById('btn-overview-alle');
        if (overviewKlasse) {
            label.textContent = 'Klasse: ' + overviewKlasse;
            label.style.display = '';
            alleBtn.style.display = '';
        } else {
            label.style.display = 'none';
            alleBtn.style.display = 'none';
        }

        let filtered = schueler;
        if (overviewKlasse) filtered = filtered.filter(s => s.klasse === overviewKlasse);

        tbody.innerHTML = filtered.map(s => `
            <tr>
                <td>${esc(s.name)}</td>
                <td>${esc(s.klasse)}</td>
                <td><span class="badge badge-${s.niveau === 'E' ? 'e' : 'g'}">${s.niveau}-Kurs</span></td>
                <td>${s.foerder.length ? s.foerder.map(f => `<span class="badge badge-lrs">${esc(f)}</span>`).join(' ') : '–'}</td>
                <td>${esc(s.notizen) || '–'}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn icon" data-action="edit" data-id="${s._id}" title="Bearbeiten">${ICON.edit}</button>
                        <button class="btn icon danger" data-action="delete" data-id="${s._id}" title="Löschen">${ICON.delete}</button>
                    </div>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('[data-action]').forEach(btn => {
            const s = schueler.find(x => x._id === btn.dataset.id);
            if (!s) return;
            if (btn.dataset.action === 'edit') btn.onclick = () => editSchueler(s);
            else btn.onclick = () => deleteSchueler(s._id);
        });
    }

    document.getElementById('btn-overview-alle').addEventListener('click', () => {
        overviewKlasse = '';
        renderSchueler();
    });

    // ─── Generator ───
    function refreshGeneratorDropdowns() {
        const themen = [...new Set(aufgaben.map(a => a.thema).filter(Boolean))].sort();
        const sorted = [...klassen].sort();

        const selT = document.getElementById('gen-thema');
        selT.innerHTML = '<option value="">– Thema wählen –</option>' + themen.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

        const selK = document.getElementById('gen-klasse');
        selK.innerHTML = '<option value="">– Kurs wählen –</option>' + sorted.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');

        refreshGenUnterthemen();
    }

    function refreshGenUnterthemen() {
        const thema = document.getElementById('gen-thema').value;
        const container = document.getElementById('gen-unterthema-container');
        if (!thema) { container.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Erst Thema wählen</span>'; return; }
        const unterthemen = [...new Set(aufgaben.filter(a => a.thema === thema).map(a => a.unterthema).filter(Boolean))].sort();
        if (!unterthemen.length) { container.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Keine Unterthemen</span>'; return; }
        container.innerHTML = unterthemen.map(u =>
            `<label class="chip"><input type="checkbox" class="gen-ut-cb" value="${esc(u)}"> ${esc(u)}</label>`
        ).join('');
        container.querySelectorAll('.gen-ut-cb').forEach(cb => {
            cb.addEventListener('change', updateGenConfig);
        });
    }

    // Zweiter Ausloeser im Konfig-Panel — teilt sich die Logik mit btn-generate.
    document.getElementById('btn-generate-config')?.addEventListener('click', () => document.getElementById('btn-generate').click());
    document.getElementById('btn-generate').addEventListener('click', () => {
        const thema = document.getElementById('gen-thema').value;
        const klasse = document.getElementById('gen-klasse').value;
        if (!thema || !klasse) { toast('Thema und Kurs wählen'); return; }

        // Beim erneuten Generieren (z.B. nach Verschieben der Balken) die zuvor
        // ABGEWAEHLTEN Aufgaben je Schueler merken, damit sie deaktiviert bleiben
        // und nicht wieder auftauchen (#49). Wird nach dem Neuaufbau reappliziert.
        const zuvorAus = {};
        if (previewData) previewData.forEach(e => {
            zuvorAus[e.student._id] = new Set(e.tasks.filter(t => !t.selected).map(t => String(t._id)));
        });

        const themaAufgaben = getGenAufgaben();
        const klasseSchueler = schueler.filter(s => s.klasse === klasse).sort((a, b) => a.name.localeCompare(b.name));
        const selectedUt = [...document.querySelectorAll('.gen-ut-cb:checked')].map(cb => cb.value);
        const unterthema = selectedUt.join(', ');

        if (!themaAufgaben.length) { toast('Keine Aufgaben für ' + (unterthema || 'dieses Thema')); return; }
        if (!klasseSchueler.length) { toast('Keine Schüler in dieser Klasse'); return; }

        // Ab der 2. Lernleiter im Pfad kommt vorne eine kleine Wiederholung der
        // Unterthemen davor dazu (max. 2 Aufgaben, auf dem Niveau des Schuelers).
        const pfadId = document.getElementById('gen-pfad').value;
        const pfad = pfadId ? lernpfade.find(p => p._id === pfadId) : null;
        const vorherigeLl = (pfad && pfad.lernleitern) || [];

        const basisAufgaben = themaAufgaben.filter(a => getKategorie(a) === 'Basis');
        const gAufgaben = themaAufgaben.filter(a => getKategorie(a) === 'G-Niveau');
        const eAufgaben = themaAufgaben.filter(a => getKategorie(a) === 'E-Niveau');

        const statsEl = document.getElementById('gen-stats');
        statsEl.style.display = '';
        statsEl.innerHTML = `
            <div class="gen-stat-item"><span class="gen-stat-num">${themaAufgaben.length}</span> Aufgaben gesamt</div>
            <div class="gen-stat-item"><span class="gen-stat-num badge-basis" style="background:#dbeafe;color:#1e40af;padding:0 6px;border-radius:4px">${basisAufgaben.length}</span> Basis</div>
            <div class="gen-stat-item"><span class="gen-stat-num" style="background:#fef3c7;color:#92400e;padding:0 6px;border-radius:4px">${gAufgaben.length}</span> G-Niveau</div>
            <div class="gen-stat-item"><span class="gen-stat-num" style="background:#d1fae5;color:#065f46;padding:0 6px;border-radius:4px">${eAufgaben.length}</span> E-Niveau</div>
            <div class="gen-stat-item"><span class="gen-stat-num">${klasseSchueler.length}</span> Schüler</div>
        `;

        const config = getGenConfig();
        const erklPool = aufgaben.filter(a => a.thema === thema && getKategorie(a) === 'Erklärung' && (!selectedUt.length || selectedUt.includes(a.unterthema)));

        const utList = selectedUt.length ? selectedUt.slice().sort() : [''];
        const utCount = utList.length;

        previewData = klasseSchueler.map(s => {
            seedRng(getStudentSeed(s.niveau, s.foerder));
            let totalBasis, totalG, totalE;
            if (s.niveau === 'E') {
                const pctTotal = config.eBasis + config.eG + config.eE;
                totalBasis = Math.round(config.max * config.eBasis / pctTotal);
                totalG = Math.round(config.max * config.eG / pctTotal);
                totalE = config.max - totalBasis - totalG;
            } else {
                const pctTotal = config.gBasis + config.gG;
                totalBasis = Math.round(config.max * config.gBasis / pctTotal);
                totalG = config.max - totalBasis;
                totalE = 0;
            }

            const tasks = [];
            const wdh = selectWiederholung(s, vorherigeLl);
            wdh.forEach(a => tasks.push({ ...a, section: 'Wiederholung', selected: true }));

            // Eine Aufgabe, die schon als Wiederholung oben steht, darf unten
            // nicht nochmal als reguläre Aufgabe auftauchen.
            const wdhIds = new Set(wdh.map(a => a._id));

            // Erklär-Seiten an den Anfang: GENAU so viele wie eingestellt (config.erkl),
            // aus dem gefilterten Pool — NICHT je Unterthema, sonst kaemen mehr heraus
            // als eingestellt (Bug: „1 eingestellt, 2 erzeugt").
            erklPool.filter(a => !wdhIds.has(a._id)).slice(0, config.erkl)
                .forEach(a => tasks.push({ ...a, section: 'Erklärung', selected: true }));

            utList.forEach((ut, ui) => {
                const utBasis = basisAufgaben.filter(a => (a.unterthema || '') === ut && !wdhIds.has(a._id));
                const utG = gAufgaben.filter(a => (a.unterthema || '') === ut && !wdhIds.has(a._id));
                const utE = eAufgaben.filter(a => (a.unterthema || '') === ut && !wdhIds.has(a._id));

                const bNum = ui < utCount - 1 ? Math.floor(totalBasis / utCount) : totalBasis - Math.floor(totalBasis / utCount) * (utCount - 1);
                const gNum = ui < utCount - 1 ? Math.floor(totalG / utCount) : totalG - Math.floor(totalG / utCount) * (utCount - 1);
                const eNum = ui < utCount - 1 ? Math.floor(totalE / utCount) : totalE - Math.floor(totalE / utCount) * (utCount - 1);

                const selBasis = selectForStudent(utBasis, Math.min(bNum, utBasis.length), s.foerder);
                selBasis.forEach(a => tasks.push({ ...a, section: 'Basis', selected: true }));

                if (s.niveau === 'E') {
                    const selE = selectForStudent(utE, Math.min(eNum, utE.length), s.foerder);
                    const selG = selectForStudent(utG, Math.min(gNum, utG.length), s.foerder);
                    const stufe = interleaveEG(selE, selG);
                    stufe.forEach(a => tasks.push({ ...a, selected: true }));
                } else {
                    const selG = selectForStudent(utG, Math.min(gNum, utG.length), s.foerder);
                    selG.forEach(a => tasks.push({ ...a, section: 'G-Niveau', selected: true }));
                }
            });

            // Auffüllen: reichte ein Pool nicht (z.B. wenig G-Aufgaben), fehlen
            // Aufgaben zur gewünschten Anzahl. Dann aus den erlaubten Kategorien
            // nachlegen, damit jede Lernleiter auf config.max kommt.
            const regularSections = ['Basis', 'G-Niveau', 'E-Niveau'];
            const usedIds = new Set(tasks.map(t => t._id));
            let fehlt = config.max - tasks.filter(t => regularSections.includes(t.section)).length;
            if (fehlt > 0) {
                const erlaubt = s.niveau === 'E'
                    ? [...basisAufgaben, ...gAufgaben, ...eAufgaben]
                    : [...basisAufgaben, ...gAufgaben];
                const rest = erlaubt.filter(a =>
                    !usedIds.has(a._id) && utList.includes(a.unterthema || ''));
                const nach = selectForStudent(rest, Math.min(fehlt, rest.length), s.foerder);
                nach.forEach(a => tasks.push({ ...a, section: getKategorie(a) === 'Basis' ? 'Basis' : (getKategorie(a) === 'E-Niveau' ? 'E-Niveau' : 'G-Niveau'), selected: true }));
            }

            // Reihenfolge im Ladder: NIE nach id. Sektion bleibt (Wiederholung,
            // Erklärung, Basis, G, E — die Lernleiter-Progression), INNERHALB einer
            // Sektion nach Quelle (Seite, dann Nummer, siehe quelleKey). Erst danach
            // der Pflicht/Zusatz-Split, damit der auf der sortierten Reihe basiert.
            const sektRang = { 'Wiederholung': 0, 'Erklärung': 1, 'Basis': 2, 'G-Niveau': 3, 'E-Niveau': 4 };
            tasks.sort((a, b) => {
                const ra = sektRang[a.section] ?? 5, rb = sektRang[b.section] ?? 5;
                if (ra !== rb) return ra - rb;
                const [pa, na, ta] = quelleKey(a.quelle), [pb, nb, tb] = quelleKey(b.quelle);
                return (pa - pb) || (na - nb) || ta.localeCompare(tb);
            });

            // Reguläre Aufgaben in Pflicht/Zusatz aufteilen: die ersten
            // pflichtCount bleiben Pflicht, der Rest wird als Zusatz markiert.
            // Wiederholung/Erklärung zählen nicht mit.
            const pflichtCount = config.pflicht;
            let regIdx = 0;
            tasks.forEach(t => {
                if (regularSections.includes(t.section)) {
                    t.zusatz = regIdx >= pflichtCount;
                    regIdx++;
                }
            });

            return { student: s, tasks, thema, unterthema: unterthema || '' };
        });

        // Zuvor abgewaehlte Aufgaben wieder deaktivieren (#49): bleiben nach dem
        // Neu-Generieren weiterhin abgewaehlt, statt erneut aufzutauchen.
        previewData.forEach(e => {
            const aus = zuvorAus[e.student._id];
            if (aus) e.tasks.forEach(t => { if (aus.has(String(t._id))) t.selected = false; });
        });

        renderPreview();
        document.getElementById('preview-area').style.display = '';
    });

    // Wiederholung fuer die 2. und jede weitere Lernleiter eines Pfads:
    // max. 2 Aufgaben aus den Unterthemen der vorherigen Lernleitern, auf dem
    // Niveau des Schuelers (E bzw. G). Bevorzugt Aufgaben, die dieser Schueler
    // noch nicht hatte; erst wenn es davon zu wenige gibt, werden schon
    // gestellte Aufgaben wiederholt.
    const WDH_MAX = 2;

    function selectWiederholung(student, vorherigeLl) {
        if (!vorherigeLl.length) return [];

        const vorherigeUt = new Set();
        const schonGehabt = new Set();
        vorherigeLl.forEach(ll => {
            vorherigeUt.add(ll.unterthema || '');
            const eintrag = (ll.schueler || []).find(x => x._id === student._id);
            (eintrag?.aufgabenIds || []).forEach(id => schonGehabt.add(id));
        });

        const niveau = student.niveau === 'E' ? 'E-Niveau' : 'G-Niveau';
        const pool = aufgaben.filter(a =>
            vorherigeUt.has(a.unterthema || '') && getKategorie(a) === niveau
        );
        if (!pool.length) return [];

        const neu = pool.filter(a => !schonGehabt.has(a._id));
        const rest = pool.filter(a => schonGehabt.has(a._id));

        const gewaehlt = selectForStudent(neu, Math.min(WDH_MAX, neu.length), student.foerder);
        if (gewaehlt.length < WDH_MAX && rest.length) {
            gewaehlt.push(...selectForStudent(rest, Math.min(WDH_MAX - gewaehlt.length, rest.length), student.foerder));
        }
        return gewaehlt;
    }

    function interleaveEG(eTasks, gTasks) {
        if (!gTasks.length) return eTasks.map(a => ({ ...a, section: 'E-Niveau' }));
        if (!eTasks.length) return gTasks.map(a => ({ ...a, section: 'G-Niveau' }));
        const result = [];
        const gPerE = Math.max(1, Math.round(gTasks.length / eTasks.length));
        let gi = 0;
        eTasks.forEach(e => {
            for (let i = 0; i < gPerE && gi < gTasks.length; i++, gi++) {
                result.push({ ...gTasks[gi], section: 'G-Niveau' });
            }
            result.push({ ...e, section: 'E-Niveau' });
        });
        while (gi < gTasks.length) {
            result.push({ ...gTasks[gi], section: 'G-Niveau' });
            gi++;
        }
        return result;
    }

    function sectionCssClass(section) {
        if (section === 'Basis') return 'basis';
        if (section === 'G-Niveau') return 'g';
        if (section === 'Erklärung') return 'erklaerung';
        if (section === 'Wiederholung') return 'wiederholung';
        return 'e';
    }

    // Gruppen-Bearbeitung: Schüler mit gleichem Niveau UND gleichen
    // Förderschwerpunkten bekommen ohnehin identische Aufgaben - Änderungen
    // sollen für die ganze Gruppe gelten, nicht nur einen Schüler.
    function groupKey(s) { return s.niveau + '|' + [...(s.foerder || [])].sort().join(','); }
    function groupEditOn() { const el = document.getElementById('gen-group-edit'); return !el || el.checked; }
    function groupEntries(entry) {
        if (!groupEditOn()) return [entry];
        const k = groupKey(entry.student);
        return previewData.filter(e => groupKey(e.student) === k);
    }

    function renderPreview() {
        const container = document.getElementById('preview-students');
        container.innerHTML = '';

        previewData.forEach((entry, si) => {
            const s = entry.student;
            const div = document.createElement('div');
            div.className = 'student-preview';

            const header = document.createElement('div');
            header.className = 'student-preview-header';
            header.innerHTML = `
                <h3>${esc(s.name)}</h3>
                <div>
                    <span class="badge badge-${s.niveau === 'E' ? 'e' : 'g'}">${s.niveau}-Kurs</span>
                    ${s.foerder.map(f => `<span class="badge badge-lrs">${esc(f)}</span>`).join(' ')}
                    <span style="font-size:0.8rem;color:var(--text-muted);margin-left:0.5rem">${entry.tasks.filter(t => t.selected && t.section !== 'Erklärung').length} Aufgaben</span>
                </div>
            `;
            header.addEventListener('click', () => {
                body.classList.toggle('collapsed');
            });

            const body = document.createElement('div');
            body.className = 'student-preview-body';

            const ladder = document.createElement('div');
            ladder.className = 'ladder';

            let stepNum = 0;
            let zusatzDivDone = false;

            entry.tasks.forEach((task, ti) => {
                stepNum++;

                if (task.zusatz && !zusatzDivDone) {
                    zusatzDivDone = true;
                    const divider = document.createElement('div');
                    divider.className = 'ladder-zusatz-divider';
                    divider.textContent = 'Zusatzaufgaben';
                    ladder.appendChild(divider);
                }

                const step = document.createElement('div');
                step.className = 'ladder-step step-' + sectionCssClass(task.section);
                if (!task.selected) step.classList.add('deselected');

                const tags = [];
                if (task.operator) tags.push(`<span class="badge badge-operator">${esc(task.operator)}</span>`);
                if (task.kompetenz) tags.push(`<span class="badge badge-kompetenz">${esc(task.kompetenz)}</span>`);
                if (task.methode) tags.push(`<span class="badge badge-methode">${esc(task.methode)}</span>`);

                const hasLRS = s.foerder.includes('LRS');

                step.innerHTML = `
                    <span class="step-number">${stepNum}</span>
                    <div class="step-content">
                        <span class="step-id step-id-link" title="Details anzeigen">${esc(fmtId(task.code || task.id))}</span>
                        <span class="step-source">${task.quelleTyp === 'latex' && task.latex ? '' : esc(task.quelle)}</span>
                        ${tags.length ? '<div class="step-tags">' + tags.join('') + '</div>' : ''}
                        ${hasLRS && task.lrs ? '<div class="lrs-hint">Sonderaufgabe – siehe separates Blatt</div>' : ''}
                    </div>
                    <div class="step-checkbox"></div>
                `;

                if (task.quelleTyp === 'latex' && task.latex && window.katex) {
                    renderLatex(step.querySelector('.step-source'), task.latex);
                }

                step.querySelector('.step-checkbox').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newState = !task.selected;
                    // auf ganze Gruppe (oder nur diesen Schüler) anwenden
                    groupEntries(entry).forEach(ge => {
                        const t = ge.tasks.find(x => x._id === task._id);
                        if (t) t.selected = newState;
                    });
                    renderPreview();
                });

                step.addEventListener('click', () => {
                    showTaskDetail(task);
                });

                ladder.appendChild(step);
            });

            const finish = document.createElement('div');
            finish.className = 'ladder-finish';
            finish.textContent = 'Ziel erreicht!';
            ladder.appendChild(finish);

            body.appendChild(ladder);

            const addBtn = document.createElement('button');
            addBtn.className = 'btn small';
            addBtn.style.marginTop = '0.5rem';
            addBtn.textContent = '+';
            addBtn.title = 'Aufgabe hinzufügen';
            addBtn.setAttribute('aria-label', 'Aufgabe hinzufügen');
            addBtn.addEventListener('click', () => showAddTaskPicker(entry));
            body.appendChild(addBtn);

            div.appendChild(header);
            div.appendChild(body);
            container.appendChild(div);
        });
    }

    function showAddTaskPicker(entry) {
        const usedIds = new Set(entry.tasks.map(t => t._id));
        const thema = entry.thema;
        const pool = sortByKatThenQuelle(aufgaben.filter(a => a.thema === thema && !usedIds.has(a._id)));
        const body = document.getElementById('task-detail-body');
        if (!pool.length) {
            body.innerHTML = '<p>Keine weiteren Aufgaben verfügbar.</p>';
            modal.style.display = '';
            return;
        }
        function renderPickerList(filter) {
            const q = (filter || '').toLowerCase();
            const filtered = q ? pool.filter(a => [a.id, a.quelle, a.operator, getKategorie(a), a.unterthema].filter(Boolean).join(' ').toLowerCase().includes(q)) : pool;
            const list = document.getElementById('add-task-list');
            list.innerHTML = filtered.length ? filtered.map(a => {
                const kat = getKategorie(a);
                return `<div class="add-task-item" data-id="${a._id}">
                    <span class="badge badge-${katBadgeClass(kat)}">${esc(kat)}</span>
                    <strong>${esc(fmtId(a.code || a.id))}</strong> ${esc(a.quelle)}
                    ${a.operator ? ' <span class="badge badge-operator">' + esc(a.operator) + '</span>' : ''}
                </div>`;
            }).join('') : '<p style="color:var(--text-muted)">Keine Treffer</p>';
            list.querySelectorAll('.add-task-item').forEach(item => {
                item.addEventListener('click', () => {
                    const a = aufgaben.find(x => x._id === item.dataset.id);
                    if (!a) return;
                    const kat = getKategorie(a);
                    const section = kat === 'Basis' ? 'Basis' : kat === 'G-Niveau' ? 'G-Niveau' : kat === 'Erklärung' ? 'Erklärung' : 'E-Niveau';
                    // in ganze Gruppe (oder nur diesen Schüler) einfügen
                    groupEntries(entry).forEach(ge => {
                        if (!ge.tasks.some(t => t._id === a._id)) ge.tasks.push({ ...a, section, selected: true });
                    });
                    modal.style.display = 'none';
                    renderPreview();
                });
            });
        }
        body.innerHTML = `<h3 style="margin-bottom:1rem">Aufgabe hinzufügen für ${esc(entry.student.name)}</h3>
            <input type="text" id="picker-search" placeholder="Suche (ID, Quelle, Typ...)" class="search-input" style="margin-bottom:0.75rem">
            <div id="add-task-list"></div>`;
        renderPickerList('');
        document.getElementById('picker-search').addEventListener('input', e => renderPickerList(e.target.value));
        modal.style.display = '';
    }

    // ─── PDF Generation ───
    document.getElementById('btn-pdf-all').addEventListener('click', () => generatePDF('all'));
    document.getElementById('btn-pdf-lrs').addEventListener('click', () => generatePDF('lrs'));
    document.getElementById('btn-pdf-loesung').addEventListener('click', () => generatePDF('loesung'));
    document.getElementById('btn-save-to-pfad').addEventListener('click', () => saveToPfad());

    async function saveToPfad() {
        if (!previewData || !previewData.length) { toast('Erst Vorschau generieren'); return; }
        // Nicht leer speichern: klar melden statt still eine leere Lernleiter anzulegen.
        if (!previewData.some(p => p.tasks.some(t => t.selected))) { toast('Keine Aufgaben ausgewählt — nichts zu speichern'); return; }
        if (!previewData[0].thema) { toast('Kein Thema gesetzt — nicht gespeichert'); return; }
        // Bestehende Pfade kennen, BEVOR wir „Einzeln" suchen/anlegen — sonst
        // ueberschreibt ein Save den vorhandenen „Einzeln"-Pfad (savePfad loescht
        // dessen Lernleitern und legt nur die neue an).
        if (!lernpfade.length) { try { await loadLernpfade(); } catch (e) { /* offline: mit lokalem Stand weiter */ } }
        const pfadId = document.getElementById('gen-pfad').value;

        let pfad;
        if (!pfadId) {
            // "Einzeln": ohne gewählten Pfad in einen Sammel-Pfad "Einzeln"
            // speichern (anlegen, falls noch nicht vorhanden).
            pfad = lernpfade.find(p => p.name === 'Einzeln');
            if (!pfad) {
                pfad = { _id: `pfad_${Date.now()}`, name: 'Einzeln', aufgaben_order: [], lernleitern: [] };
                lernpfade.push(pfad);
            }
        } else {
            pfad = lernpfade.find(p => p._id === pfadId);
            if (!pfad) { toast('Lernpfad nicht gefunden'); return; }
        }

        if (!pfad.lernleitern) pfad.lernleitern = [];

        // Nur die ausgewählten Aufgaben-IDs pro Schüler sichern - die vollen
        // Aufgaben stehen in `aufgaben` und wuerden den Pfad sonst aufblaehen.
        const ll = {
            _id: editingLlId || `ll_${Date.now()}`,
            thema: previewData[0].thema,
            unterthema: previewData[0].unterthema || '',
            klasse: document.getElementById('gen-klasse').value,
            // class_id direkt vom Schueler mitspeichern — die Namenssuche
            // (classIdVon) scheiterte, wenn der Kurs-Name leer war (#59: „ohne kurs").
            class_id: (previewData[0].student && previewData[0].student.class_id) || null,
            schueler: previewData.map(p => ({
                _id: p.student._id,
                name: p.student.name,
                aufgabenIds: p.tasks.filter(t => t.selected).map(t => t._id)
            }))
        };

        // Beim Bearbeiten bestehenden Eintrag ersetzen, sonst anhängen.
        const editIdx = editingLlId ? pfad.lernleitern.findIndex(x => x._id === editingLlId) : -1;
        const backup = editIdx >= 0 ? pfad.lernleitern[editIdx] : null;
        // Stabile Server-id des bearbeiteten Eintrags uebernehmen, damit savePfad
        // ihn per PUT aktualisiert statt neu anzulegen (sonst Duplikat + Alte in Papierkorb).
        if (backup && backup.id) ll.id = backup.id;
        // Bestehende Thema-id mitnehmen: loest der Name nicht auf (stale topics),
        // faellt savePfad darauf zurueck statt das Thema zu nullen.
        if (backup && backup.topic_id != null) ll.topic_id = backup.topic_id;
        if (editIdx >= 0) pfad.lernleitern[editIdx] = ll;
        else pfad.lernleitern.push(ll);

        const ok = await savePfad(pfad);
        if (!ok) {
            if (editIdx >= 0) pfad.lernleitern[editIdx] = backup;
            else pfad.lernleitern.pop();
            return;
        }
        toast(editIdx >= 0 ? 'Lernleiter aktualisiert' : (pfadId ? 'Lernleiter in Pfad gespeichert' : 'Lernleiter unter „Einzeln" gespeichert'));
        // WICHTIG gegen Duplikate: die gerade gespeicherte Lernleiter weiter als
        // „in Bearbeitung" halten. Ein zweiter Klick auf „Speichern" aktualisiert
        // sie dann (PUT), statt eine NEUE anzulegen (POST). Erst beim Wechsel von
        // Thema/Kurs/Pfad wird editingLlId zurueckgesetzt (dort schon verdrahtet).
        editingLlId = ll._id;
        renderGenPfade();
        // renderGenPfade baut den Dropdown neu - Auswahl erhalten, damit ein
        // Folge-Save nicht an "Lernpfad auswählen" scheitert.
        document.getElementById('gen-pfad').value = pfad._id;
    }

    // Zentral speichern, damit ein fehlgeschlagener Request nicht still
    // verschluckt wird - sonst sieht der Nutzer Daten, die es nicht mehr gibt.
    async function savePfad(pfad) {
        try {
            // Bestehende Pfade EINMAL holen (fuer Find-or-create per Name und um die
            // aktuellen Ladder-IDs zu kennen — fuer den Upsert).
            const alle = await api(`${LP}/paths`).then(x => x.ok ? x.json() : []);
            if (!pfad.id) {
                // Existiert der Name schon (z.B. Sammel-Pfad „Einzeln")? Dann
                // wiederverwenden, statt blind zu POSTen (409). Ladders NICHT loeschen.
                const da = alle.find(x => x.name === pfad.name);
                if (da) pfad.id = da.id;
                else {
                    const r = await api(`${LP}/paths`, { method: 'POST', body: JSON.stringify({ name: pfad.name }) });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    pfad.id = (await r.json()).id;
                }
            }
            // Upsert statt Delete-Recreate: bestehende Lernleitern per PUT aendern
            // (IDs bleiben stabil — kein Churn, kein Papierkorb-Muell), neue per POST.
            // Was der Server noch hat, wir aber nicht mehr, wandert in den Papierkorb.
            const da = alle.find(x => x.id === pfad.id);
            const uebrig = new Set(((da && da.ladders) || []).map(l => l.id));

            // Defensive: dieselbe Lernleiter nicht doppelt speichern (gleiche id).
            const gesehen = new Set();
            pfad.lernleitern = (pfad.lernleitern || []).filter(ll => {
                if (ll.id == null) return true;
                if (gesehen.has(ll.id)) return false;
                gesehen.add(ll.id); return true;
            });

            // ll.klasse ist ein KURS-Name; Kern-Referenz ueber einen Schueler des Kurses.
            const classIdVon = kurs => (schueler.find(s => s.klasse === kurs) || {}).class_id || null;

            let pos = 0;
            for (const ll of (pfad.lernleitern || [])) {
                const assignments = (ll.schueler || []).map(sch => ({
                    student_id: parseInt(sch.id || sch._id) || null,
                    exercise_ids: (sch.aufgabenIds || []).map(x => parseInt(x)).filter(Boolean)
                })).filter(a => a.student_id);
                // Thema aus dem Namen aufloesen; scheitert das (leer/stale topics),
                // NICHT nullen, sondern die mitgefuehrte Roh-topic_id behalten —
                // sonst verliert eine Lernleiter beim Re-Save ihr Thema.
                let topic_id = await topicId(ll.thema, ll.unterthema);
                if (!topic_id && ll.topic_id != null) topic_id = ll.topic_id;
                // Bevorzugt die am Ladder gespeicherte class_id; Fallback ueber den
                // Kurs-Namen (kann leer sein) oder einen zugewiesenen Schueler.
                const class_id = (ll.class_id ?? null)
                    || classIdVon(ll.klasse)
                    || (schueler.find(s => (ll.schueler || []).some(x => (x.id || parseInt(x._id)) === s.id)) || {}).class_id
                    || null;
                // Diagnose (#59): weist eine Lernleiter leer aus, steht in der Konsole WAS fehlte.
                if (!topic_id || !class_id || !assignments.length) {
                    console.warn('Lernleiter unvollstaendig gespeichert:', {
                        thema: ll.thema, topic_id, klasse: ll.klasse, class_id,
                        schueler: (ll.schueler || []).length, zuweisungen: assignments.length
                    });
                }
                const body = JSON.stringify({
                    class_id, topic_id, position: pos++,
                    notizen: ll.notizen || '',
                    assignments: assignments.length ? assignments : null,
                    config: ll.config || null
                });
                let r;
                if (ll.id && uebrig.has(ll.id)) {
                    r = await api(`${LP}/ladders/${ll.id}`, { method: 'PUT', body });
                    uebrig.delete(ll.id);   // bleibt bestehen, nicht in den Papierkorb
                } else {
                    r = await api(`${LP}/paths/${pfad.id}/ladders`, { method: 'POST', body });
                    if (r.ok) { const neu = await r.json(); ll.id = neu.id; ll._id = String(neu.id); }
                }
                if (!r.ok) throw new Error('HTTP ' + r.status);
            }
            // Entfernte Lernleitern (nicht mehr in der Liste) in den Papierkorb.
            for (const weg of uebrig) await api(`${LP}/ladders/${weg}`, { method: 'DELETE' });
            return true;
        } catch (e) {
            toast('Speichern fehlgeschlagen: ' + e.message);
            return false;
        }
    }

    // Die ERSTE Lernleiter eines Pfads darf keine Wiederholungs-Aufgaben (aus
    // vorherigen Themen) enthalten — davor liegt nichts. Nach Loeschen/Umsortieren
    // die neue erste bereinigen: nur Aufgaben ihres eigenen Themas behalten.
    // Unbekannte IDs bleiben (nichts versehentlich verlieren). Gibt zurueck, ob
    // etwas entfernt wurde.
    function bereinigeErsteWiederholung(pfad) {
        const ll = (pfad.lernleitern || [])[0];
        if (!ll || !ll.thema) return false;
        let changed = false;
        (ll.schueler || []).forEach(sch => {
            const vor = (sch.aufgabenIds || []).length;
            sch.aufgabenIds = (sch.aufgabenIds || []).filter(id => {
                const a = aufgaben.find(x => String(x.id) === String(id) || String(x._id) === String(id));
                return !a || a.thema === ll.thema;   // fremd-thema (= Wiederholung) raus
            });
            if (sch.aufgabenIds.length !== vor) changed = true;
        });
        return changed;
    }

    // LaTeX-Formel -> PNG-DataURL (für jsPDF). Nutzt KaTeX + SVG-foreignObject
    // -> Canvas. Cache pro Code. Gibt {url,w,h} oder null bei Fehler.
    const latexImgCache = {};
    async function latexToImage(code) {
        if (latexImgCache[code]) return latexImgCache[code];
        try {
            await (document.fonts ? document.fonts.ready : Promise.resolve());
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:20px;color:#000';
            document.body.appendChild(box);
            window.katex.render(code, box, { throwOnError: false, displayMode: true });
            const el = box.querySelector('.katex') || box;
            const r = el.getBoundingClientRect();
            const w = Math.ceil(r.width) || 120, h = Math.ceil(r.height) || 30;
            const xml = new XMLSerializer().serializeToString(el);
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
                `<foreignObject width="100%" height="100%">` +
                `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:20px;color:#000">${xml}</div>` +
                `</foreignObject></svg>`;
            document.body.removeChild(box);
            const url = await new Promise((res, rej) => {
                const img = new Image();
                img.onload = () => {
                    const sc = 3; // höhere Auflösung fürs PDF
                    const c = document.createElement('canvas');
                    c.width = w * sc; c.height = h * sc;
                    const ctx = c.getContext('2d');
                    ctx.scale(sc, sc);
                    ctx.drawImage(img, 0, 0);
                    res(c.toDataURL('image/png'));
                };
                img.onerror = rej;
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            });
            const out = { url, w, h };
            latexImgCache[code] = out;
            return out;
        } catch (e) {
            console.warn('LaTeX-Rendering fehlgeschlagen:', e);
            return null;
        }
    }

    // Alle LaTeX-Aufgaben der Vorschau vorab rendern (async, vor dem PDF-Bau)
    async function prerenderLatex() {
        const codes = new Set();
        (previewData || []).forEach(e => e.tasks.forEach(t => {
            if (t.selected && t.quelleTyp === 'latex' && t.latex) codes.add(t.latex);
        }));
        for (const c of codes) await latexToImage(c);
    }

    async function generatePDF(mode) {
        if (!previewData || !previewData.length) { toast('Erst Vorschau generieren'); return; }
        if (window.katex) await prerenderLatex();

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const marginL = 15;
        const contentW = 210 - marginL - 15;
        const lineH = 6;
        const checkboxSize = 4;

        // QR nur beim Schueler-PDF und nur, wenn das Karten-Modul aktiv und die
        // Option angehakt ist.
        const withQR = mode === 'all' && kartenAktiv && !!document.getElementById('gen-qr')?.checked;
        if (withQR) await prerenderQR(previewData);

        if (mode === 'lrs') {
            generateLRSPdf(doc, marginL, contentW, lineH);
        } else if (mode === 'loesung') {
            generateLoesungPdf(doc, marginL, contentW, lineH);
        } else {
            previewData.forEach((entry, idx) => {
                if (idx > 0) doc.addPage();
                renderStudentPage(doc, entry, marginL, contentW, lineH, checkboxSize, withQR);
            });
        }

        const thema = previewData[0]?.thema || 'Lernleiter';
        const ut = previewData[0]?.unterthema;
        const fileLabel = ut ? thema + '_' + ut : thema;
        const filenames = {
            all: `Lernleiter_${fileLabel}.pdf`,
            lrs: `Sonderaufgaben_LRS_${fileLabel}.pdf`,
            loesung: `Loesungsblatt_${fileLabel}.pdf`
        };
        doc.save(filenames[mode]);
        toast('PDF heruntergeladen');
    }


    function renderStudentPage(doc, entry, marginL, contentW, lineH, checkboxSize, withQR) {
        const s = entry.student;
        const selectedTasks = entry.tasks.filter(t => t.selected);
        let y = 15;
        // QR unten rechts auf dem Blatt, falls vorhanden. Datum bleibt oben
        // rechts (keine Kollision mehr).
        const qrImg = withQR ? qrCache[s.id] : null;
        const qrSize = 20;
        const dateRight = marginL + contentW;
        if (qrImg) {
            const pageH = doc.internal.pageSize.getHeight();
            const qrY = pageH - qrSize - 12;
            doc.addImage(qrImg, 'PNG', marginL + contentW - qrSize, qrY, qrSize, qrSize);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6);
            doc.setTextColor(120);
            doc.text('Karten-App', marginL + contentW - qrSize / 2, qrY + qrSize + 2.5, { align: 'center' });
            doc.setTextColor(0);
        }
        const cbSize = 5;
        const cbX = marginL;
        const numX = marginL + cbSize + 3;
        const textX = numX + 10;
        // Die Selbsteinschätzung per Smiley ist entfallen: sie wurde nie
        // ausgewertet (Papier), und was die Lernenden können, zeigt der Test.
        // Die beiden Ankreuzspalten ruecken dafuer an den rechten Rand.
        const korrX = marginL + contentW - 24;
        const pruefX = korrX - 32;
        const rowH = 12;

        const pdfTitle = entry.unterthema ? entry.thema + ' – ' + entry.unterthema : entry.thema;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text('Lernleiter: ' + pdfTitle, marginL, y);
        y += 9;

        // Name links, Datum rechts auf derselben Zeile - so kollidiert das
        // Datum nicht mehr mit langen Titeln.
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(s.name, marginL, y);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text('Datum: _______________', dateRight, y, { align: 'right' });
        y += 3;
        doc.setLineWidth(0.6);
        doc.line(marginL, y, marginL + contentW, y);
        y += 7;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(120);
        doc.text('erledigt', cbX, y);
        doc.text('Lösung geprüft', pruefX, y);
        doc.text('korrigiert', korrX, y);
        doc.setTextColor(0);
        y += 2;
        doc.setLineWidth(0.2);
        doc.setDrawColor(200);
        doc.line(marginL, y, marginL + contentW, y);
        doc.setDrawColor(0);
        y += 5;

        let zusatzHeadingDone = false;
        selectedTasks.forEach((task, idx) => {
            if (y > 272) { doc.addPage(); y = 15; }

            // Zwischenüberschrift vor der ersten Zusatzaufgabe
            if (task.zusatz && !zusatzHeadingDone) {
                zusatzHeadingDone = true;
                y += 2;
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.text('Zusatzaufgaben', marginL, y);
                y += 3;
                doc.setDrawColor(200);
                doc.setLineWidth(0.2);
                doc.line(marginL, y, marginL + contentW, y);
                doc.setDrawColor(0);
                y += 6;
            }

            doc.setDrawColor(0);
            doc.setLineWidth(0.4);
            doc.rect(cbX, y - cbSize / 2, cbSize, cbSize);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(String(idx + 1), numX, y + 1.5);
            doc.setTextColor(0);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(11);
            const latexImg = (task.quelleTyp === 'latex' && task.latex) ? latexImgCache[task.latex] : null;
            if (latexImg) {
                // Formel als Bild, auf ~7 mm Höhe skaliert, vertikal zentriert
                const hmm = 7, wmm = hmm * (latexImg.w / latexImg.h);
                doc.addImage(latexImg.url, 'PNG', textX, y - hmm / 2, wmm, hmm);
            } else {
                doc.text(task.quelle, textX, y + 1.5);
            }

            // Ankreuzfelder: Lösung geprüft + korrigiert
            // Bei Erklärungen weglassen (nichts zu prüfen/korrigieren)
            const istErkl = task.section === 'Erklärung' || getKategorie(task) === 'Erklärung';
            if (!istErkl) {
                doc.setDrawColor(0);
                doc.setLineWidth(0.4);
                doc.rect(pruefX + 4, y - cbSize / 2, cbSize, cbSize);
                doc.rect(korrX + 2, y - cbSize / 2, cbSize, cbSize);
            }

            y += rowH;

            if (idx < selectedTasks.length - 1) {
                doc.setDrawColor(220);
                doc.setLineWidth(0.15);
                doc.line(marginL, y - rowH / 2 + 3, marginL + contentW, y - rowH / 2 + 3);
                doc.setDrawColor(0);
            }
        });

        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(22, 163, 74);
        doc.text('Ziel erreicht!', marginL + contentW / 2 - 15, y);
        doc.setTextColor(0);
    }

    function generateLoesungPdf(doc, marginL, contentW, lineH) {
        const thema = previewData[0]?.thema || '';
        let y = 15;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Lösungsblatt: ' + thema, marginL, y);
        y += 10;

        const allTaskIds = new Set();
        previewData.forEach(e => e.tasks.filter(t => t.selected).forEach(t => allTaskIds.add(t._id)));

        const relevantTasks = aufgaben.filter(a => allTaskIds.has(a._id) && a.loesung);

        if (!relevantTasks.length) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(11);
            doc.text('Keine Lösungen hinterlegt.', marginL, y);
            return;
        }

        const sections = [
            { label: 'BASIS', tasks: relevantTasks.filter(t => getKategorie(t) === 'Basis') },
            { label: 'G-NIVEAU', tasks: relevantTasks.filter(t => getKategorie(t) === 'G-Niveau') },
            { label: 'E-NIVEAU', tasks: relevantTasks.filter(t => getKategorie(t) === 'E-Niveau') }
        ];

        sections.forEach(sec => {
            if (!sec.tasks.length) return;
            if (y > 260) { doc.addPage(); y = 15; }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.text(sec.label, marginL, y);
            y += 2;
            doc.setLineWidth(0.3);
            doc.line(marginL, y, marginL + contentW, y);
            y += 5;
            doc.setTextColor(0);

            sec.tasks.forEach(task => {
                if (y > 270) { doc.addPage(); y = 15; }

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.text(task.id, marginL, y);
                const idW = doc.getTextWidth(task.id + '  ');

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(80);
                doc.text(task.quelle, marginL + idW, y);
                doc.setTextColor(0);
                y += lineH;

                doc.setFontSize(9);
                const lines = doc.splitTextToSize(task.loesung, contentW - 5);
                lines.forEach(line => {
                    if (y > 275) { doc.addPage(); y = 15; }
                    doc.text(line, marginL + 5, y);
                    y += lineH - 1;
                });
                y += 3;
            });
        });
    }

    function generateLRSPdf(doc, marginL, contentW, lineH) {
        let y = 15;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('Sonderaufgaben (LRS/Förderung)', marginL, y);
        y += 10;

        const lrsStudents = previewData.filter(e => e.student.foerder.includes('LRS'));
        if (!lrsStudents.length) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(11);
            doc.text('Keine LRS-Schüler in dieser Klasse.', marginL, y);
            return;
        }

        const lrsTasks = aufgaben.filter(a => a.lrs && a.thema === previewData[0].thema);

        lrsStudents.forEach((entry, idx) => {
            if (idx > 0) { y += 6; }
            if (y > 260) { doc.addPage(); y = 15; }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.text(entry.student.name, marginL, y);
            y += 6;

            lrsTasks.forEach(task => {
                if (y > 270) { doc.addPage(); y = 15; }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.text(task.id + ':', marginL + 3, y);
                y += lineH;

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(10);
                const text = task.lrsText || '';
                if (text) {
                    const lines = doc.splitTextToSize(text, contentW - 6);
                    lines.forEach(line => {
                        if (y > 275) { doc.addPage(); y = 15; }
                        doc.text(line, marginL + 6, y);
                        y += lineH - 1;
                    });
                }
                y += 3;
            });

            doc.setLineWidth(0.3);
            doc.line(marginL, y, marginL + contentW, y);
            y += 3;
        });
    }

    // ─── Task Detail Modal ───
    const modal = document.getElementById('task-detail-modal');
    document.getElementById('modal-close-btn').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

    function showTaskDetail(a) {
        // Inline-Styles, damit das Modal auch auf Nuvora-Ebene (ohne die
        // lernpfad-CSS) korrekt aussieht.
        const kat = getKategorie(a);
        const tags = [a.operator, a.kompetenz, a.methode].filter(Boolean).map(esc).join(' · ');
        const sec = (h, inner) => `<div style="margin-bottom:16px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#8a8a8a;margin-bottom:4px">${h}</div>${inner}</div>`;
        const chip = (txt, bg) => `<span style="font-size:12px;font-weight:600;padding:2px 9px;border-radius:980px;background:${bg};color:#fff">${esc(txt)}</span>`;
        const html = `
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
                <strong style="font-size:18px">${esc(fmtId(a.code || a.id))}</strong>
                ${chip(kat, '#2563eb')}
                ${a.lrs ? chip('LRS', '#b8860b') : ''}
            </div>
            ${sec('Thema', `<div>${esc(a.thema)}${a.unterthema ? ' – ' + esc(a.unterthema) : ''}</div>`)}
            ${a.quelle ? sec('Quelle', `<div>${esc(a.quelle)}</div>`) : ''}
            ${tags ? sec('Tags', `<div style="color:#555">${tags}</div>`) : ''}
            ${a.aufgabentext ? sec('Aufgabentext', `<div style="white-space:pre-wrap;line-height:1.5">${esc(a.aufgabentext)}</div>`) : ''}
            ${a.loesung ? sec('Lösung', `<div style="white-space:pre-wrap;line-height:1.5">${esc(a.loesung)}</div>`) : ''}
            ${a.bild ? sec('Bild', `<img src="${a.bild}" style="max-width:100%;border-radius:8px;display:block">`) : ''}
            ${a.loesungBild ? sec('Lösungsbild', `<img src="${a.loesungBild}" style="max-width:100%;border-radius:8px;display:block">`) : ''}
        `;
        // Eingebettet: Nuvora rendert das Overlay ueber der ganzen Seite —
        // zentriert und ohne sichtbare iframe-Grenze. Sonst lokales Modal.
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'lernpfad:modal', title: 'Aufgabe ' + fmtId(a.code || a.id), html }, window.location.origin);
            return;
        }
        document.getElementById('task-detail-body').innerHTML = html;
        modal.style.display = '';
    }

    // ─── Bulk Actions ───
    const bulkBar = document.getElementById('bulk-bar');
    const bulkSelectAll = document.getElementById('bulk-select-all');

    bulkSelectAll.addEventListener('change', () => {
        document.querySelectorAll('.bulk-cb').forEach(cb => { cb.checked = bulkSelectAll.checked; });
        updateBulkBar();
    });

    function getSelectedBulkIds() {
        return [...document.querySelectorAll('.bulk-cb:checked')].map(cb => cb.dataset.id);
    }

    function updateBulkBar() {
        const ids = getSelectedBulkIds();
        if (ids.length) {
            bulkBar.style.display = '';
            document.getElementById('bulk-count').textContent = ids.length + ' ausgewählt';
        } else {
            bulkBar.style.display = 'none';
        }
    }

    document.getElementById('btn-bulk-assign').addEventListener('click', () => {
        const ids = getSelectedBulkIds();
        const thema = document.getElementById('bulk-thema').value.trim();
        const unterthema = document.getElementById('bulk-unterthema').value.trim();
        if (!thema && !unterthema) { toast('Thema oder Unterthema eingeben'); return; }
        let count = 0;
        ids.forEach(id => {
            const a = aufgaben.find(x => x._id === id);
            if (a) {
                if (thema) a.thema = thema;
                if (unterthema) a.unterthema = unterthema;
                count++;
            }
        });
        save(STORAGE_KEYS.aufgaben, aufgaben);
        renderAufgaben();
        document.getElementById('bulk-thema').value = '';
        document.getElementById('bulk-unterthema').value = '';
        bulkSelectAll.checked = false;
        toast(count + ' Aufgaben aktualisiert');
    });

    document.getElementById('btn-bulk-delete').addEventListener('click', async () => {
        const ids = getSelectedBulkIds();
        if (!ids.length) return;
        if (!await confirmDlg(ids.length + ' ausgewählte Aufgabe(n) wirklich löschen?', { ok: 'Löschen' })) return;
        const idSet = new Set(ids);
        // Backend + lokal löschen
        ids.forEach(id => api(`${LP}/exercises/` + id, { method: 'DELETE' }).catch(() => {}));
        aufgaben = aufgaben.filter(a => !idSet.has(a._id));
        save(STORAGE_KEYS.aufgaben, aufgaben);
        bulkSelectAll.checked = false;
        renderAufgaben();
        updateFilters();
        updateBulkBar();
        toast(ids.length + ' Aufgaben gelöscht');
    });

    document.getElementById('btn-bulk-export').addEventListener('click', () => {
        const idSet = new Set(getSelectedBulkIds());
        exportAufgabenListe(aufgaben.filter(a => idSet.has(a._id)), 'aufgaben_auswahl.json');
    });

    document.getElementById('btn-bulk-cancel').addEventListener('click', () => {
        document.querySelectorAll('.bulk-cb').forEach(cb => { cb.checked = false; });
        bulkSelectAll.checked = false;
        updateBulkBar();
    });

    function renderGenPfade() {
        const sel = document.getElementById('gen-pfad');
        // Der Sammel-Pfad "Einzeln" ist bereits der leere Platzhalter oben —
        // ihn zusaetzlich zu listen ergab denselben Namen doppelt.
        sel.innerHTML = '<option value="">– Einzeln –</option>' + lernpfade
            .filter(p => p.name !== 'Einzeln')
            .map(p => `<option value="${p._id}">${esc(p.name)}</option>`)
            .join('');
    }

    document.getElementById('gen-pfad').addEventListener('change', () => {
        // Manueller Pfadwechsel = keine Bearbeitung mehr, nächster Save hängt an.
        editingLlId = null;
        document.getElementById('gen-thema').disabled = false;
    });

    // ─── Generator Config ───
    document.getElementById('gen-thema').addEventListener('change', () => {
        editingLlId = null;
        refreshGenUnterthemen();
        updateGenConfig();
    });

    function updateGenConfig() {
        const thema = document.getElementById('gen-thema').value;
        if (!thema) {
            document.getElementById('gen-config').style.display = 'none';
            return;
        }
        renderGenConfig(thema);
    }

    function getGenAufgaben() {
        const thema = document.getElementById('gen-thema').value;
        const selected = [...document.querySelectorAll('.gen-ut-cb:checked')].map(cb => cb.value);
        let pool = aufgaben.filter(a => a.thema === thema && getKategorie(a) !== 'Erklärung');
        if (selected.length) pool = pool.filter(a => selected.includes(a.unterthema));
        return pool;
    }

    function renderGenConfig(thema) {
        const themaAufgaben = getGenAufgaben();
        const basisCount = themaAufgaben.filter(a => getKategorie(a) === 'Basis').length;
        const gCount = themaAufgaben.filter(a => getKategorie(a) === 'G-Niveau').length;
        const eCount = themaAufgaben.filter(a => getKategorie(a) === 'E-Niveau').length;
        // Erklärungen wie die anderen Zaehler nach gewaehltem Unterthema filtern
        // (sonst zeigt „verfügbar" alle des Themas, obwohl das Unterthema nur 1 hat).
        const selUt = [...document.querySelectorAll('.gen-ut-cb:checked')].map(cb => cb.value);
        const erklCount = aufgaben.filter(a => a.thema === thema && getKategorie(a) === 'Erklärung' && (!selUt.length || selUt.includes(a.unterthema))).length;
        const operators = [...new Set(themaAufgaben.map(a => a.operator).filter(Boolean))].sort();
        const total = basisCount + Math.max(gCount, eCount);
        const defaultMax = Math.min(8, total);

        const configBody = document.getElementById('gen-config-body');

        const info = tip => `<span class="info" tabindex="0" aria-label="Info">${ICON.info}<span class="info-tip">${esc(tip)}</span></span>`;

        let html = '<div class="cfg-grid">';

        // 1. Anzahl
        html += `
            <div class="cfg-block">
                <div class="cfg-label">Aufgaben pro Schüler</div>
                <div class="cfg-controls">
                    <span class="cfg-slider-row">
                        <input type="range" min="1" max="${Math.max(1, total)}" step="1" value="${defaultMax}" id="cfg-max" class="cfg-range">
                    </span>
                    <output class="cfg-range-val" id="cfg-max-val"></output>
                </div>
                <div class="cfg-warn" id="cfg-max-warn" style="display:none">Recht viele Aufgaben – eine Lernleiter mit mehr als 10 wird schnell unübersichtlich.</div>
            </div>`;

        // 2. Pflicht / Zusatz
        html += `
            <div class="cfg-block">
                <div class="cfg-label">Pflicht &amp; Zusatz ${info('Wie viele der Aufgaben Pflicht sind. Der Rest steht als Zusatzaufgaben unten.')}</div>
                <div class="cfg-controls">
                    <span class="cfg-slider-row">
                        <input type="range" min="0" max="${defaultMax}" step="1" value="${Math.round(defaultMax * 0.75)}" id="cfg-pflicht" class="cfg-range">
                    </span>
                    <span class="cfg-hint" id="cfg-pflicht-hint"></span>
                </div>
            </div>`;

        // 3. G-Kurs Mischung
        html += `
            <div class="cfg-block">
                <div class="cfg-label">Mischung für G-Kurs ${info('Anteile aus leichteren Basis- und mittleren G-Aufgaben.')}</div>
                <div class="cfg-controls">
                    <label class="cfg-slider-row">
                        <span class="cfg-sl-name">Basis ↔ G</span>
                        <input type="range" min="0" max="100" step="10" value="40" id="cfg-g-basis" class="cfg-range">
                    </label>
                    <input type="hidden" id="cfg-g-g" value="60">
                    <span class="cfg-hint" id="cfg-g-hint"></span>
                </div>
            </div>`;

        // 4. E-Kurs Mischung
        html += `
            <div class="cfg-block">
                <div class="cfg-label">Mischung für E-Kurs ${info('Anteile aus Basis-, G- und E-Niveau. Summe immer 100%.')}</div>
                <div class="cfg-controls cfg-controls-col">
                    <label class="cfg-slider-row">
                        <span class="cfg-sl-name">Basis</span>
                        <input type="range" min="0" max="100" step="10" value="30" id="cfg-e-basis" class="cfg-range">
                    </label>
                    <label class="cfg-slider-row">
                        <span class="cfg-sl-name">G-Niveau</span>
                        <input type="range" min="0" max="100" step="10" value="30" id="cfg-e-g" class="cfg-range">
                    </label>
                    <label class="cfg-slider-row">
                        <span class="cfg-sl-name">E-Niveau</span>
                        <input type="range" min="0" max="100" step="10" value="40" id="cfg-e-e" class="cfg-range">
                    </label>
                    <span class="cfg-hint" id="cfg-e-hint"></span>
                </div>
            </div>`;

        // 4. Erklärungen (optional)
        if (erklCount) {
            html += `
            <div class="cfg-block">
                <div class="cfg-label">Erklärungen voranstellen ${info('Erklär-Seiten kommen an den Anfang der Lernleiter.')}</div>
                <div class="cfg-controls">
                    <input type="number" min="0" max="${erklCount}" value="${Math.min(1, erklCount)}" id="cfg-erkl" class="cfg-num">
                    <span class="cfg-hint">von ${erklCount} verfügbar</span>
                </div>
            </div>`;
        }

        html += '</div>';

        if (operators.length) {
            html += '<div class="cfg-types">Vorkommende Aufgabentypen ' + info('Beim Auswählen wird auf möglichst unterschiedliche Aufgabentypen geachtet.') + ': ' + operators.map(o => '<span class="badge badge-operator">' + esc(o) + '</span>').join(' ') + '</div>';
        }
        configBody.innerHTML = html;
        document.getElementById('gen-config').style.display = '';

        // G-Kurs: ein Regler (Basis-Anteil), G-Niveau = Rest auf 100.
        const gBasisInput = document.getElementById('cfg-g-basis');
        const gGHidden = document.getElementById('cfg-g-g');
        const gHint = document.getElementById('cfg-g-hint');
        const updateGMix = () => {
            const basis = Math.min(100, Math.max(0, parseInt(gBasisInput.value) || 0));
            gGHidden.value = 100 - basis;
            gHint.textContent = `Basis ${basis}% / G-Niveau ${100 - basis}%`;
        };
        gBasisInput.addEventListener('input', updateGMix);
        updateGMix();

        // E-Kurs: drei Regler (Basis/G/E), Summe immer 100. Der bewegte Regler
        // behält seinen Wert; der Rest wird auf die beiden anderen verteilt –
        // im Verhältnis ihrer bisherigen Werte (sind beide 0, hälftig).
        const eInputs = { basis: document.getElementById('cfg-e-basis'), g: document.getElementById('cfg-e-g'), e: document.getElementById('cfg-e-e') };
        const eHint = document.getElementById('cfg-e-hint');
        const roundTo10 = n => Math.round(n / 10) * 10;
        const updateEMix = (moved) => {
            const val = k => Math.min(100, Math.max(0, parseInt(eInputs[k].value) || 0));
            if (moved) {
                const keep = val(moved);
                const others = ['basis', 'g', 'e'].filter(k => k !== moved);
                const rest = 100 - keep;
                let a = val(others[0]), b = val(others[1]);
                const sum = a + b;
                if (sum === 0) { a = roundTo10(rest / 2); b = rest - a; }
                else { a = roundTo10(rest * a / sum); b = rest - a; }
                eInputs[others[0]].value = a;
                eInputs[others[1]].value = b;
            }
            const basis = val('basis'), g = val('g'), e = val('e');
            eHint.textContent = `Basis ${basis}% / G-Niveau ${g}% / E-Niveau ${e}%`;
        };
        eInputs.basis.addEventListener('input', () => updateEMix('basis'));
        eInputs.g.addEventListener('input', () => updateEMix('g'));
        eInputs.e.addEventListener('input', () => updateEMix('e'));
        updateEMix();

        // Hinweis nur bei >10 Aufgaben pro Schüler
        const maxInput = document.getElementById('cfg-max');
        const maxWarn = document.getElementById('cfg-max-warn');
        const pflichtInput = document.getElementById('cfg-pflicht');
        const pflichtHint = document.getElementById('cfg-pflicht-hint');
        const maxVal = document.getElementById('cfg-max-val');
        const checkMax = () => {
            const max = parseInt(maxInput.value) || 0;
            maxVal.textContent = max + ' Aufgaben';
            maxWarn.style.display = max > 10 ? '' : 'none';
            // Pflicht-Regler an Gesamtzahl koppeln: Bereich 0..max, ganze Aufgaben.
            pflichtInput.max = max;
            let pflicht = Math.min(max, Math.max(0, parseInt(pflichtInput.value) || 0));
            pflichtInput.value = pflicht;
            pflichtHint.textContent = `${pflicht} Pflicht / ${max - pflicht} Zusatz`;
        };
        maxInput.addEventListener('input', checkMax);
        pflichtInput.addEventListener('input', checkMax);
        checkMax();
    }

    function getGenConfig() {
        const max = parseInt(document.getElementById('cfg-max')?.value) || 8;
        const pflicht = Math.min(max, Math.max(0, parseInt(document.getElementById('cfg-pflicht')?.value) || 0));
        return {
            max,
            pflicht,
            gBasis: parseInt(document.getElementById('cfg-g-basis')?.value) || 40,
            gG: parseInt(document.getElementById('cfg-g-g')?.value) || 60,
            eBasis: parseInt(document.getElementById('cfg-e-basis')?.value) || 30,
            eG: parseInt(document.getElementById('cfg-e-g')?.value) || 30,
            eE: parseInt(document.getElementById('cfg-e-e')?.value) || 40,
            erkl: parseInt(document.getElementById('cfg-erkl')?.value) || 0
        };
    }

    // Seeded RNG für deterministic Auswahl
    let rngState = 0;
    function seedRng(seed) {
        rngState = seed >>> 0;
    }
    function rng() {
        rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
        return rngState / 0x7fffffff;
    }

    function getStudentSeed(niveau, foerder) {
        const str = niveau + '|' + (foerder || []).sort().join(',');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    function selectDiverse(pool, count) {
        if (count <= 0 || !pool.length) return [];
        const byOp = {};
        pool.forEach(t => {
            const op = t.operator || '';
            (byOp[op] = byOp[op] || []).push(t);
        });
        Object.values(byOp).forEach(arr => arr.sort(() => rng() - 0.5));
        const ops = Object.keys(byOp);
        const result = [];
        let round = 0;
        while (result.length < count) {
            let picked = false;
            for (const op of ops) {
                if (result.length >= count) break;
                if (byOp[op].length > round) {
                    result.push(byOp[op][round]);
                    picked = true;
                }
            }
            if (!picked) break;
            round++;
        }
        return result;
    }

    function selectForStudent(pool, count, studentFoerder) {
        if (!studentFoerder || !studentFoerder.length) return selectDiverse(pool, count);
        const matching = pool.filter(t => t.foerderschwerpunkte && t.foerderschwerpunkte.some(f => studentFoerder.includes(f)));
        const plain = pool.filter(t => !t.foerderschwerpunkte || !t.foerderschwerpunkte.length || !t.foerderschwerpunkte.some(f => studentFoerder.includes(f)));
        const result = [];
        if (plain.length) result.push(plain[Math.floor(rng() * plain.length)]);
        const remaining = count - result.length;
        const matchPicked = selectDiverse(matching, remaining);
        result.push(...matchPicked);
        if (result.length < count) {
            const usedIds = new Set(result.map(t => t._id));
            const leftover = plain.filter(t => !usedIds.has(t._id));
            result.push(...selectDiverse(leftover, count - result.length));
        }
        return result;
    }

    // ─── Helpers ───
    function esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // Inline-SVG-Icons (keine Emoji). currentColor erbt Button-Textfarbe.
    const ICON = {
        edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        delete: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
        up: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
        down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
        chevron: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
        check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
        info: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
        download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
        // Gleiches Export/Import-Paar wie im Rahmen (components/Icons.jsx): gleiche
        // Box + Schaft, nur die Pfeilspitze wechselt die Seite (raus/rein).
        export: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>',
        import: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 7v6h6"/><path d="M20 4l-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg>'
    };

    // ─── Lernpfade ───
    let currentPfad = null;

    async function loadLernpfade() {
        try {
            // Themen sicherstellen, bevor wir Ladder-topic_ids in Namen aufloesen —
            // sonst blieben alle Themen leer (topicPfad findet nichts).
            if (!topics.length) { try { topics = await api(`${API}/topics`).then(r => r.ok ? r.json() : topics); } catch (e) { /* Netz — mit vorhandenem Stand weiter */ } }
            const paths = await api(`${LP}/paths`).then(r => r.ok ? r.json() : []);
            const byId = new Map(schueler.map(s => [s.id, s]));
            lernpfade = paths.map(p => ({
                _id: String(p.id),
                id: p.id,
                name: p.name,
                aufgaben_order: [],
                lernleitern: (p.ladders || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)).map(l => {
                    const tp = topicPfad(l.topic_id);
                    // Kurs-Name aus der class_id ableiten, wenn die Schuelersuche
                    // scheitert (z.B. Schueler noch nicht geladen) — sonst waere
                    // klasse leer und ein Re-Save schriebe class_id=null (#59).
                    const klasseVonStud = (schueler.find(s => s.id === ((l.assignments || [])[0] || {}).student_id) || {}).klasse;
                    const klasseVonCls = (schueler.find(s => s.class_id === l.class_id) || {}).klasse;
                    return {
                        _id: String(l.id),
                        id: l.id,                        // stabile Server-id fuer Upsert (savePfad PUTtet statt neu anzulegen)
                        topic_id: l.topic_id ?? null,    // Roh-Thema-id mitfuehren: falls topicPfad den Namen nicht aufloest, NICHT mit null ueberschreiben
                        thema: tp.thema,
                        unterthema: tp.unterthema,
                        klasse: klasseVonStud || klasseVonCls || '',
                        class_id: l.class_id ?? null,   // autoritativ vom Ladder — nicht ueber den Namen raten
                        notizen: l.notizen || '',
                        config: l.config || null,
                        schueler: (l.assignments || []).map(a => {
                            const st = byId.get(a.student_id);
                            return {
                                _id: String(a.student_id),
                                id: a.student_id,
                                name: st ? st.name : '?',
                                aufgabenIds: a.exercise_ids || []
                            };
                        })
                    };
                })
            }));
        } catch(e) { lernpfade = []; }
        renderLernpfade();
        renderGenPfade();
    }

    // Referenzierte Aufgaben einer Lernleiter (distinct über alle Schüler).
    function ladderAufgaben(ll) {
        const ids = new Set((ll.schueler || []).flatMap(s => (s.aufgabenIds || []).map(String)));
        return aufgaben.filter(a => ids.has(String(a.id)) || ids.has(String(a._id)));
    }
    function dlJson(obj, name) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = name; a.click(); URL.revokeObjectURL(a.href);
    }
    // Struktur OHNE Schülerdaten: Thema/Config/Notizen je Lernleiter + die
    // referenzierten Aufgaben. Beim Import legt der Server neue IDs an.
    function llSnapshot(ll) {
        return { thema: ll.thema, unterthema: ll.unterthema || '', notizen: ll.notizen || '', config: ll.config || null };
    }
    // full=true: mit Schülerzuweisungen (Name + Aufgaben-IDs) — vollständig, für
    // eigenes Backup/Transfer. full=false: Vorlage ohne Schülerdaten (teilbar).
    function llFull(ll, full) {
        const snap = llSnapshot(ll);
        if (full) snap.schueler = (ll.schueler || []).map(s => ({ name: s.name, aufgabenIds: (s.aufgabenIds || []).map(String) }));
        return snap;
    }
    function exportPfad(pfad, full) {
        const used = new Set();
        (pfad.lernleitern || []).forEach(ll => ladderAufgaben(ll).forEach(a => used.add(a)));
        dlJson({ type: 'lernpfad', version: 1, name: pfad.name, lernleitern: (pfad.lernleitern || []).map(ll => llFull(ll, full)), aufgaben: [...used] },
               `lernpfad_${(pfad.name || 'pfad').replace(/[^\w-]+/g, '_')}${full ? '' : '_vorlage'}.json`);
        toast(full ? 'Lernpfad exportiert' : 'Lernpfad als Vorlage exportiert');
    }
    function exportLernleiter(pfad, ll, full) {
        dlJson({ type: 'lernleiter', version: 1, ...llFull(ll, full), aufgaben: ladderAufgaben(ll) },
               `lernleiter_${((ll.thema || 'lernleiter')).replace(/[^\w-]+/g, '_')}${full ? '' : '_vorlage'}.json`);
        toast(full ? 'Lernleiter exportiert' : 'Lernleiter als Vorlage exportiert');
    }
    async function importPfadDatei(data) {
        // Eine Lernleiter-Datei als 1-Leiter-Pfad wrappen.
        if (data.type === 'lernleiter') data = { type: 'lernpfad', name: data.thema || 'Importierte Lernleiter', lernleitern: [{ thema: data.thema, unterthema: data.unterthema, notizen: data.notizen, config: data.config, schueler: data.schueler }], aufgaben: data.aufgaben };
        if (!Array.isArray(data.lernleitern)) { toast('Keine Lernpfad-Datei'); return; }
        // 1. Aufgaben anlegen (id-los → neu). Alte IDs merken fürs Umhängen.
        const neu = (data.aufgaben || []).map(a => { const c = { ...a }; c.__old = String(a.id != null ? a.id : (a._id != null ? a._id : '')); delete c.id; delete c._id; return c; });
        if (neu.length) { aufgaben = [...aufgaben, ...neu]; await syncAufgaben(aufgaben); }
        const map = {}; neu.forEach(a => { if (a.__old) map[a.__old] = a.id; delete a.__old; });
        // 2. Schüler per NAMEN aufs eigene Roster mappen (nur bei Voll-Export vorhanden).
        const byName = {}; schueler.forEach(s => { byName[(s.name || '').trim()] = s; });
        let name = data.name || 'Importierter Pfad';
        const namen = new Set(lernpfade.map(p => p.name));
        if (namen.has(name)) { let i = 2; while (namen.has(`${name} (${i})`)) i++; name = `${name} (${i})`; }
        const pfad = { _id: `pfad_${Date.now()}`, name, lernleitern: data.lernleitern.map((ll, i) => ({
            _id: `ll_${Date.now()}_${i}`, thema: ll.thema || '', unterthema: ll.unterthema || '', klasse: '', notizen: ll.notizen || '', config: ll.config || null,
            schueler: (ll.schueler || []).map(s => { const st = byName[(s.name || '').trim()]; return st ? { _id: String(st.id), id: st.id, name: st.name, aufgabenIds: (s.aufgabenIds || []).map(x => map[String(x)]).filter(Boolean) } : null; }).filter(Boolean),
        })) };
        const mitZuw = pfad.lernleitern.some(ll => ll.schueler.length);
        if (await savePfad(pfad)) { toast(`Lernpfad „${name}" importiert${neu.length ? ` (${neu.length} Aufgaben${mitZuw ? ', mit Zuweisungen' : ''})` : ''}`); loadLernpfade(); }
    }
    function importPfadPicker() {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
        inp.onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { importPfadDatei(JSON.parse(ev.target.result)); } catch (err) { toast('Fehler: ' + err.message); } }; r.readAsText(f); };
        inp.click();
    }

    function renderLernpfade() {
        const list = document.getElementById('pfade-list');
        list.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button class="btn small" id="btn-import-pfad">${ICON.import} Lernpfad/Lernleiter importieren</button></div>` + lernpfade.map(p => `
            <div class="list-row" data-action="edit" data-id="${p._id}">
                <div>
                    <strong>${esc(p.name)}</strong>
                    <span style="color:var(--text-muted)">– ${(p.lernleitern || []).length} Lernleitern</span>
                </div>
                <div class="btn-group">
                    <button class="btn" data-action="export-full" data-id="${p._id}" style="font-size:11px;padding:3px 8px" title="Vollständig, mit Schülerzuweisungen">${ICON.export} Export</button>
                    <button class="btn" data-action="export-vorlage" data-id="${p._id}" style="font-size:11px;padding:3px 8px" title="Ohne Schülerdaten (teilbar)">${ICON.export} Vorlage</button>
                    <button class="btn icon" data-action="edit" data-id="${p._id}" title="Bearbeiten">${ICON.edit}</button>
                    <button class="btn icon danger" data-action="delete" data-id="${p._id}" title="Löschen">${ICON.delete}</button>
                </div>
            </div>
        `).join('');
        const impBtn = document.getElementById('btn-import-pfad');
        if (impBtn) impBtn.addEventListener('click', importPfadPicker);

        const openPfad = id => editPfad(lernpfade.find(p => p._id === id));
        const deletePfad = async id => {
            // Soft-Delete: 30 Tage im Papierkorb wiederherstellbar.
            if (!await confirmDlg('Pfad in den Papierkorb verschieben? 30 Tage wiederherstellbar.', { ok: 'In den Papierkorb' })) return;
            lernpfade = lernpfade.filter(p => p._id !== id);
            // Erst löschen, dann neu laden — sonst holt loadLernpfade den Pfad
            // noch aus dem Backend zurück (Race), er erscheint wieder.
            await api(`${LP}/paths/` + id, { method: 'DELETE' }).catch(() => {});
            loadLernpfade();
        };
        // Klick auf Balken öffnet; Icon-Buttons haben Vorrang via stopPropagation
        list.querySelectorAll('.list-row').forEach(row => {
            row.addEventListener('click', () => openPfad(row.dataset.id));
        });
        list.querySelectorAll('.btn[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const act = btn.dataset.action;
                if (act === 'edit') openPfad(btn.dataset.id);
                else if (act === 'export-full') exportPfad(lernpfade.find(p => p._id === btn.dataset.id), true);
                else if (act === 'export-vorlage') exportPfad(lernpfade.find(p => p._id === btn.dataset.id), false);
                else if (act === 'delete') deletePfad(btn.dataset.id);
            });
        });
        renderPfadTrash(list);
    }

    // Papierkorb: gelöschte Lernpfade UND einzelne gelöschte Lernleitern, mit
    // Wiederherstellen / endgültig löschen. Wird unter die Liste gehängt.
    async function renderPfadTrash(list) {
        let pTrash = [], lTrash = [];
        try { pTrash = await api(`${LP}/paths/trash`).then(r => r.ok ? r.json() : []); } catch (e) { pTrash = []; }
        try { lTrash = await api(`${LP}/ladders/trash`).then(r => r.ok ? r.json() : []); } catch (e) { lTrash = []; }
        const old = document.getElementById('pfade-trash');
        if (old) old.remove();
        if (!pTrash.length && !lTrash.length) return;
        const box = document.createElement('div');
        box.id = 'pfade-trash';
        box.style.marginTop = '12px';
        const pfadRows = pTrash.map(p => `
            <div class="list-row" style="opacity:.85">
                <div style="flex:1;min-width:0"><strong>${esc(p.name)}</strong> <span style="color:var(--text-muted)">– Lernpfad · ${(p.lernleitern || []).length} Lernleitern</span></div>
                <div class="btn-group" style="flex-shrink:0;flex-wrap:nowrap">
                    <button class="btn" data-restore-path="${p.id}">Wiederherstellen</button>
                    <button class="btn icon danger" data-purge-path="${p.id}" title="Endgültig löschen">${ICON.delete}</button>
                </div>
            </div>`).join('');
        const ladderRows = lTrash.map(l => {
            const tp = topicPfad(l.topic_id);
            const name = [tp.thema, tp.unterthema].filter(Boolean).join(' / ') || 'Lernleiter';
            const n = (l.assignments || []).length;
            return `
            <div class="list-row" style="opacity:.85">
                <div style="flex:1;min-width:0"><strong>${esc(name)}</strong> <span style="color:var(--text-muted)">– Lernleiter aus „${esc(l.path_name)}"${n ? ` · ${n} Schüler` : ''}</span></div>
                <div class="btn-group" style="flex-shrink:0;flex-wrap:nowrap">
                    <button class="btn" data-restore-ladder="${l.id}">Wiederherstellen</button>
                    <button class="btn icon danger" data-purge-ladder="${l.id}" title="Endgültig löschen">${ICON.delete}</button>
                </div>
            </div>`;
        }).join('');
        box.innerHTML = `
            <details>
                <summary style="cursor:pointer;color:var(--text-muted);font-size:13px">Papierkorb (${pTrash.length + lTrash.length})</summary>
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px">${pfadRows}${ladderRows}</div>
            </details>`;
        list.parentNode.insertBefore(box, list.nextSibling);
        box.querySelectorAll('[data-restore-path]').forEach(b => b.addEventListener('click', async () => {
            await api(`${LP}/paths/${b.dataset.restorePath}/restore`, { method: 'POST' }).catch(() => {});
            loadLernpfade();
        }));
        box.querySelectorAll('[data-purge-path]').forEach(b => b.addEventListener('click', async () => {
            if (!await confirmDlg('Lernpfad endgültig löschen? Die Lernleitern gehen verloren.', { ok: 'Endgültig löschen' })) return;
            await api(`${LP}/paths/${b.dataset.purgePath}/purge`, { method: 'DELETE' }).catch(() => {});
            renderPfadTrash(list);
        }));
        box.querySelectorAll('[data-restore-ladder]').forEach(b => b.addEventListener('click', async () => {
            const r = await api(`${LP}/ladders/${b.dataset.restoreLadder}/restore`, { method: 'POST' }).catch(() => null);
            if (r && !r.ok) { const e = await r.json().catch(() => ({})); toast(e.detail || 'Wiederherstellen fehlgeschlagen'); return; }
            loadLernpfade();
        }));
        box.querySelectorAll('[data-purge-ladder]').forEach(b => b.addEventListener('click', async () => {
            if (!await confirmDlg('Lernleiter endgültig löschen?', { ok: 'Endgültig löschen' })) return;
            await api(`${LP}/ladders/${b.dataset.purgeLadder}/purge`, { method: 'DELETE' }).catch(() => {});
            renderPfadTrash(list);
        }));
    }

    document.getElementById('pfad-create-btn').addEventListener('click', async () => {
        const name = document.getElementById('pfad-name').value.trim();
        if (!name) { toast('Name eingeben'); return; }

        const pfad = { _id: `pfad_${Date.now()}`, name, aufgaben_order: [], lernleitern: [] };
        if (!await savePfad(pfad)) return;

        lernpfade.push(pfad);
        document.getElementById('pfad-name').value = '';
        renderLernpfade();
        renderGenPfade();
        editPfad(pfad);
    });

    function editPfad(pfad) {
        currentPfad = pfad;
        document.getElementById('pfad-edit-panel').style.display = '';
        document.getElementById('pfad-edit-title').textContent = 'Lernpfad: ' + esc(pfad.name);
        renderPfadLernleitern();
    }

    function renderPfadLernleitern() {
        const container = document.getElementById('pfad-lernleitern-list');
        const list = currentPfad.lernleitern || [];
        if (!list.length) {
            container.innerHTML = '<p class="hint">Noch keine Lernleitern in diesem Pfad.</p>';
            return;
        }
        container.innerHTML = list.map((ll, i) => `
            <div class="list-row">
                <div data-ll-id="${ll._id}" data-action="open" title="Zum Bearbeiten öffnen" style="cursor:pointer;flex:1">
                    ${esc(ll.thema || '(ohne Thema)')}${ll.unterthema ? ' <span style="color:var(--text-muted)">&gt; ' + esc(ll.unterthema) + '</span>' : ''}
                    <span style="color:var(--text-muted)">– ${ll.schueler.length} Schüler</span>
                </div>
                <div class="btn-group">
                    <button class="btn icon" data-ll-id="${ll._id}" data-action="rename" title="Umbenennen">${ICON.edit}</button>
                    <button class="btn" data-ll-id="${ll._id}" data-action="export-full" style="font-size:11px;padding:3px 8px" title="Vollständig, mit Schülerzuweisungen">${ICON.export} Export</button>
                    <button class="btn" data-ll-id="${ll._id}" data-action="export-vorlage" style="font-size:11px;padding:3px 8px" title="Ohne Schülerdaten (teilbar)">${ICON.export} Vorlage</button>
                    <button class="btn icon" data-ll-id="${ll._id}" data-action="share" title="Im Marktplatz teilen">${ICON.share}</button>
                    ${i > 0 ? `<button class="btn icon" data-ll-id="${ll._id}" data-action="up" title="Nach oben">${ICON.up}</button>` : ''}
                    ${i < list.length - 1 ? `<button class="btn icon" data-ll-id="${ll._id}" data-action="down" title="Nach unten">${ICON.down}</button>` : ''}
                    <button class="btn icon danger" data-ll-id="${ll._id}" data-action="delete" title="Entfernen">${ICON.delete}</button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('[data-ll-id]').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                const llId = e.currentTarget.dataset.llId;
                const action = e.currentTarget.dataset.action;
                const idx = currentPfad.lernleitern.findIndex(ll => ll._id === llId);
                if (action === 'open') {
                    openLernleiter(currentPfad, currentPfad.lernleitern[idx]);
                    return;
                }
                if (action === 'export-full') {
                    exportLernleiter(currentPfad, currentPfad.lernleitern[idx], true);
                    return;
                }
                if (action === 'export-vorlage') {
                    exportLernleiter(currentPfad, currentPfad.lernleitern[idx], false);
                    return;
                }
                if (action === 'share') {
                    // ll._id ist die Server-Ladder-id (siehe loadLernpfade). Der
                    // Marktplatz nimmt daraus den Aufgabenpool (ohne Schülerbezug).
                    const ll = currentPfad.lernleitern[idx];
                    if (!ll.schueler.some(s => (s.aufgabenIds || []).length)) {
                        toast('Diese Lernleiter hat noch keine zugewiesenen Aufgaben.');
                        return;
                    }
                    const desc = prompt('Kurze Beschreibung für den Marktplatz (optional):', '');
                    if (desc === null) return;  // abgebrochen
                    const r = await api(`/api/marketplace/publish/ladder`, {
                        method: 'POST',
                        body: JSON.stringify({ ladder_id: Number(ll._id), description: desc.trim() })
                    }).catch(() => null);
                    if (r && r.ok) toast('Im Marktplatz veröffentlicht.');
                    else { const b = r ? await r.json().catch(() => ({})) : {}; toast(typeof b.detail === 'string' ? b.detail : 'Hat nicht geklappt.'); }
                    return;
                }
                if (action === 'rename') {
                    const ll = currentPfad.lernleitern[idx];
                    const neuThema = prompt('Thema der Lernleiter:', ll.thema || '');
                    if (neuThema === null) return;  // abgebrochen
                    const neuUnter = prompt('Unterthema (leer lassen für keins):', ll.unterthema || '');
                    if (neuUnter === null) return;
                    ll.thema = neuThema.trim();
                    ll.unterthema = neuUnter.trim();
                } else if (action === 'up' && idx > 0) {
                    [currentPfad.lernleitern[idx - 1], currentPfad.lernleitern[idx]] = [currentPfad.lernleitern[idx], currentPfad.lernleitern[idx - 1]];
                } else if (action === 'down' && idx < currentPfad.lernleitern.length - 1) {
                    [currentPfad.lernleitern[idx + 1], currentPfad.lernleitern[idx]] = [currentPfad.lernleitern[idx], currentPfad.lernleitern[idx + 1]];
                } else if (action === 'delete') {
                    if (!await confirmDlg('Lernleiter aus Pfad entfernen?', { ok: 'Entfernen' })) return;
                    currentPfad.lernleitern.splice(idx, 1);
                }
                // Ordnung geaendert? Dann die (evtl. neue) erste Lernleiter von
                // ihren Wiederholungs-Aufgaben befreien — davor gibt es kein Thema.
                if (action === 'up' || action === 'down' || action === 'delete') {
                    if (bereinigeErsteWiederholung(currentPfad)) toast('Wiederholungs-Aufgaben der ersten Lernleiter entfernt (kein Thema davor).');
                }
                await savePfad(currentPfad);
                // Frisch vom Server laden, damit die Lernleiter-Zahl am Pfad sofort
                // stimmt (nicht erst nach Neuladen) — und currentPfad neu zeigen.
                await loadLernpfade();
                currentPfad = lernpfade.find(p => p.id === currentPfad.id) || currentPfad;
                renderPfadLernleitern();
            });
        });
    }

    // Gespeicherte Lernleiter im Generator oeffnen: die GESICHERTEN Zuweisungen
    // exakt darstellen — NICHT neu generieren (bei geaendertem Aufgabenpool kaeme
    // sonst eine andere Auswahl heraus, „neue statt alte Lernleiter"). Beim
    // Speichern ersetzt editingLlId den bestehenden Eintrag statt anzuhaengen.
    function openLernleiter(pfad, ll) {
        editingLlId = ll._id;
        document.querySelector('.tab[data-tab="generator"]').click();

        const pfadSel = document.getElementById('gen-pfad');
        pfadSel.value = pfad._id;

        const themaSel = document.getElementById('gen-thema');
        themaSel.disabled = false;
        themaSel.value = ll.thema || '';
        refreshGenUnterthemen();

        // Unterthemen der Lernleiter wieder ankreuzen
        const uts = (ll.unterthema || '').split(',').map(s => s.trim()).filter(Boolean);
        document.querySelectorAll('.gen-ut-cb').forEach(cb => { cb.checked = uts.includes(cb.value); });

        document.getElementById('gen-klasse').value = ll.klasse || '';
        updateGenConfig();

        // Vorschau aus den gespeicherten Aufgaben-IDs je Schueler rekonstruieren.
        const sektVon = a => { const k = getKategorie(a); return k === 'Erklärung' ? 'Erklärung' : k === 'E-Niveau' ? 'E-Niveau' : k === 'G-Niveau' ? 'G-Niveau' : 'Basis'; };
        const rang = { 'Erklärung': 1, 'Basis': 2, 'G-Niveau': 3, 'E-Niveau': 4 };
        previewData = (ll.schueler || []).map(sch => {
            const student = schueler.find(s => s.id === (sch.id || parseInt(sch._id)))
                || { _id: String(sch._id), id: sch.id, name: sch.name, niveau: '', foerder: [] };
            const tasks = (sch.aufgabenIds || [])
                .map(id => aufgaben.find(x => String(x.id) === String(id) || String(x._id) === String(id)))
                .filter(Boolean)
                .map(a => ({ ...a, section: sektVon(a), selected: true }));
            tasks.sort((a, b) => {
                const ra = rang[a.section] ?? 5, rb = rang[b.section] ?? 5;
                if (ra !== rb) return ra - rb;
                const [pa, na] = quelleKey(a.quelle), [pb, nb] = quelleKey(b.quelle);
                return (pa - pb) || (na - nb);
            });
            return { student, tasks, thema: ll.thema, unterthema: ll.unterthema || '' };
        });
        if (previewData.some(e => e.tasks.length)) {
            renderPreview();
            document.getElementById('preview-area').style.display = '';
        } else {
            // Keine (aufloesbaren) Zuweisungen gespeichert -> als Fallback generieren.
            document.getElementById('btn-generate').click();
        }
        toast('Lernleiter geöffnet – Änderungen mit „In Lernpfad speichern“ übernehmen');
    }

    // Vom Pfad aus eine neue Lernleiter anlegen: zum Generator wechseln und
    // den Pfad schon vorauswählen (Formular vorgefüllt nach dem "Redirect").
    document.getElementById('pfad-add-ll-btn').addEventListener('click', () => {
        const pfad = currentPfad;
        if (!pfad) return;
        editingLlId = null;
        document.querySelector('.nav-link[data-tab="generator"]').click();
        const pfadSel = document.getElementById('gen-pfad');
        pfadSel.value = pfad._id;
        document.getElementById('gen-thema').disabled = false;
        toast('Pfad „' + pfad.name + '“ vorausgewählt – Thema und Kurs wählen');
    });

    document.getElementById('pfad-cancel-btn').addEventListener('click', () => {
        document.getElementById('pfad-edit-panel').style.display = 'none';
        currentPfad = null;
    });

    // Impressum/Datenschutz/Kontakt kommen aus Nuvora (Footer-Links mit
    // target=_top) — damit sie ueberall gleich sind. Keine eigenen Seiten mehr.

    // ─── Init ───
    setNextId();
    renderKlassen();
    renderAufgaben();
    renderSchueler();
    loadLernpfade();
})();
