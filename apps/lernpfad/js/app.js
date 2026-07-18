(function () {
    'use strict';

    // ─── Einbettung in Nuvora ───
    // Die App laeuft im iframe unter Nuvoras Navbar. Der Rahmen kann die Hoehe
    // des Inhalts nicht kennen, also meldet sie die App — sonst entstuende ein
    // zweiter Scrollbalken oder der Inhalt waere abgeschnitten.
    const embedded = window.parent !== window;
    if (embedded) {
        // Nuvoras Navbar steht schon darueber: eigene Marke und eigenes
        // Konto-Menue wuerden doppelt erscheinen. Die Tabs bleiben — sie sind
        // die Struktur dieses Moduls.
        document.documentElement.classList.add('embedded');

        // Thema folgt dem Rahmen: Nuvora setzt .dark auf <html> und meldet
        // Wechsel. Ohne das leuchtet das iframe im dunklen Design weiss.
        window.addEventListener('message', (e) => {
            if (e.origin !== window.location.origin) return;
            if (e.data && e.data.type === 'nuvora:theme') {
                document.documentElement.classList.toggle('dark', !!e.data.dark);
            }
        });
        window.parent.postMessage({ type: 'lernpfad:ready' }, window.location.origin);

        const melde = () => {
            const h = Math.max(
                document.body.scrollHeight, document.documentElement.scrollHeight,
                document.body.offsetHeight, document.documentElement.offsetHeight
            );
            window.parent.postMessage({ type: 'lernpfad:height', height: h }, window.location.origin);
        };
        window.addEventListener('load', melde);
        window.addEventListener('resize', melde);
        // Die App rendert clientseitig nach: auf jede DOM-Aenderung reagieren.
        new MutationObserver(melde).observe(document.documentElement, {
            childList: true, subtree: true, attributes: true,
        });
        setInterval(melde, 1000);
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
        return fetch(url, o);
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
            if (!r.ok) return null;
            ober = await r.json();
            topics.push(ober);
        }
        if (!unterthema) return ober.id;
        let unter = topics.find(t => t.parent_id === ober.id && t.name === unterthema);
        if (!unter) {
            const r = await api(`${API}/topics`, { method: 'POST', body: JSON.stringify({ name: unterthema, parent_id: ober.id }) });
            if (!r.ok) return ober.id;
            unter = await r.json();
            topics.push(unter);
        }
        return unter.id;
    }

    // Kern-Aufgabe -> Form, die die Oberflaeche kennt.
    function vonKern(ex) {
        const tp = topicPfad(ex.topic_id);
        return {
            _id: String(ex.id),
            id: ex.id,
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

    // Aufgaben zum Kern spiegeln: anlegen, aendern, geloeschte entfernen.
    async function syncAufgaben(data) {
        try {
            const serverIds = new Set((await api(`${LP}/exercises`).then(r => r.ok ? r.json() : [])).map(e => e.id));
            for (const a of data) {
                const body = JSON.stringify(await zuKern(a));
                const vorhanden = a.id && serverIds.has(a.id);
                const r = await api(vorhanden ? `${LP}/exercises/${a.id}` : `${LP}/exercises`,
                                    { method: vorhanden ? 'PUT' : 'POST', body });
                if (r.ok && !vorhanden) {
                    const neu = await r.json();
                    a.id = neu.id; a._id = String(neu.id);
                }
                serverIds.delete(a.id);
            }
            // Was der Server noch hat, die Oberflaeche aber nicht mehr: loeschen.
            for (const weg of serverIds) {
                await api(`${LP}/exercises/${weg}`, { method: 'DELETE' });
            }
            localStorage.setItem(STORAGE_KEYS.aufgaben, JSON.stringify(data));
        } catch(e) { console.error('Sync-Fehler:', e); }
    }
    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2500);
    }
    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

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
        const used = new Set();
        aufgaben.forEach(a => {
            const m = (a.id || '').match(/^#(\d+)$/);
            if (m) used.add(parseInt(m[1], 10));
        });
        let n = 1;
        while (used.has(n)) n++;
        return '#' + String(n).padStart(6, '0');
    }

    // ─── State ───
    let aufgaben = load(STORAGE_KEYS.aufgaben);
    let schueler = load(STORAGE_KEYS.schueler);
    let klassen = load(STORAGE_KEYS.klassen);
    let lernpfade = [];
    // Aktive Klassenfilterung der Übersicht (ersetzt das frühere Select).
    let overviewKlasse = '';
    let previewData = null;
    // gesetzt, wenn im Generator eine bestehende Lernleiter bearbeitet wird
    let editingLlId = null;

    let sortState = { table: null, column: null, asc: true };

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
        document.body.classList.remove('authed');
        const ziel = '/login';
        if (window.parent !== window) window.parent.location.href = ziel;
        else window.location.href = ziel;
    }
    function hideAuth() {
        document.body.classList.add('authed');
    }

    // Daten aus dem Nuvora-Kern laden und lokalen Anzeige-Cache ersetzen.
    async function loadUserData() {
        const [tRes, exRes, clRes] = await Promise.all([
            api(`${API}/topics`), api(`${LP}/exercises`), api(`${API}/classes`)
        ]);
        // Nur ein echtes Auth-Problem (401) fuehrt zum Login. Ist z. B. nur das
        // Lernpfad-Modul nicht aktiv (403 auf /exercises), sollen Themen und
        // Klassen trotzdem erscheinen — sonst wirkt die ganze App leer.
        if (tRes.status === 401 || clRes.status === 401 || exRes.status === 401) { showAuth(); return false; }
        if (!exRes.ok) {
            alert('Aufgaben konnten nicht geladen werden — ist das Modul „Lernpfad" aktiviert? (Status ' + exRes.status + ')');
        }
        topics = tRes.ok ? await tRes.json() : [];
        aufgaben = exRes.ok ? (await exRes.json()).map(vonKern) : [];
        const klassenRaw = clRes.ok ? await clRes.json() : [];
        klassen = klassenRaw.map(c => c.name);
        schueler = [];
        klassenRaw.forEach(c => (c.students || []).forEach(st => schueler.push({
            _id: String(st.id), id: st.id, name: st.name, klasse: c.name,
            niveau: st.niveau || '', foerder: st.foerder || [], notizen: st.notizen || ''
        })));
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
        if (!document.getElementById('nav-account').contains(e.target)) accountMenu.style.display = 'none';
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
    save(STORAGE_KEYS.aufgaben, aufgaben);

    if (aufgaben.length) {
        const maxNum = aufgaben.reduce((max, a) => {
            const m = a.id.match(/^#(\d+)$/);
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
        if (window.parent !== window) window.parent.postMessage({ type: 'lernpfad:tab', tab }, window.location.origin);
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
    }

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
        const matching = [...new Set(aufgaben.filter(a => a.thema === thema).map(a => a.unterthema).filter(Boolean))].sort();
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
            id: editId ? document.getElementById('aufgabe-id').value.trim() : nextAufgabeId(),
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
        document.getElementById('edit-id-label').textContent = a.id;
        document.getElementById('aufgaben-form-title').textContent = 'Aufgabe bearbeiten';
        document.getElementById('aufgabe-cancel-btn').style.display = '';
        document.getElementById('aufgabe-submit-btn').textContent = 'Änderung speichern';
        updateFormVisibility();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function deleteAufgabe(_id) {
        if (!confirm('Aufgabe wirklich löschen?')) return;
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
    function sortByKatThenQuelle(arr) {
        return arr.slice().sort((a, b) => {
            const ka = katOrder[getKategorie(a)] ?? 4;
            const kb = katOrder[getKategorie(b)] ?? 4;
            if (ka !== kb) return ka - kb;
            return (a.quelle || '').localeCompare(b.quelle || '');
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
        const sorted = arr.slice().sort((a, b) => {
            const av = a[sortState.column];
            const bv = b[sortState.column];
            let cmp = (av > bv) ? 1 : (av < bv) ? -1 : 0;
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
            filtered = filtered.filter(a => {
                const haystack = [
                    a.id, a.thema, a.unterthema, getKategorie(a), a.quelle,
                    a.operator, a.kompetenz, a.methode, a.loesung
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(search);
            });
        }

        filtered = sortByKatThenQuelle(filtered);
        if (sortState.table === 'aufgaben-tabelle' && sortState.column && sortState.column !== 'kat') {
            filtered = applySort(filtered);
        }

        tbody.innerHTML = filtered.map(a => {
            const kat = getKategorie(a);
            const hasDetail = a.bild || a.aufgabentext;
            return `
            <tr class="${hasDetail ? 'task-row-clickable' : ''}" data-detail-id="${a._id}">
                <td><input type="checkbox" class="bulk-cb" data-id="${a._id}"></td>
                <td><strong>${esc(a.id)}</strong>${hasDetail ? ' <span class="detail-hint" title="Details">' + ICON.chevron + '</span>' : ''}</td>
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

        updateFilters();
    }

    function updateFilters() {
        const themen = [...new Set(aufgaben.map(a => a.thema).filter(Boolean))].sort();
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

        const allUnterthemen = [...new Set(aufgaben.map(a => a.unterthema).filter(Boolean))].sort();
        const dlU = document.getElementById('unterthemen-list');
        dlU.innerHTML = allUnterthemen.map(t => `<option value="${esc(t)}">`).join('');
    }

    document.getElementById('filter-thema').addEventListener('change', () => {
        document.getElementById('filter-unterthema').value = '';
        renderAufgaben();
    });
    document.getElementById('filter-unterthema').addEventListener('change', renderAufgaben);
    document.getElementById('filter-kategorie').addEventListener('change', renderAufgaben);
    document.getElementById('aufgaben-suche').addEventListener('input', renderAufgaben);

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
                        id: item.id || nextAufgabeId(),
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
        if (!confirm(msg)) return;

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

    function deleteSchueler(_id) {
        if (!confirm('Schüler wirklich löschen?')) return;
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
        selK.innerHTML = '<option value="">– Klasse wählen –</option>' + sorted.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');

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

    document.getElementById('btn-generate').addEventListener('click', () => {
        const thema = document.getElementById('gen-thema').value;
        const klasse = document.getElementById('gen-klasse').value;
        if (!thema || !klasse) { toast('Thema und Klasse wählen'); return; }

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

            utList.forEach((ut, ui) => {
                const utBasis = basisAufgaben.filter(a => (a.unterthema || '') === ut && !wdhIds.has(a._id));
                const utG = gAufgaben.filter(a => (a.unterthema || '') === ut && !wdhIds.has(a._id));
                const utE = eAufgaben.filter(a => (a.unterthema || '') === ut && !wdhIds.has(a._id));

                const bNum = ui < utCount - 1 ? Math.floor(totalBasis / utCount) : totalBasis - Math.floor(totalBasis / utCount) * (utCount - 1);
                const gNum = ui < utCount - 1 ? Math.floor(totalG / utCount) : totalG - Math.floor(totalG / utCount) * (utCount - 1);
                const eNum = ui < utCount - 1 ? Math.floor(totalE / utCount) : totalE - Math.floor(totalE / utCount) * (utCount - 1);

                const erkl = erklPool.filter(a => (a.unterthema || '') === ut);
                erkl.forEach(a => tasks.push({ ...a, section: 'Erklärung', selected: true }));

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
                    <span style="font-size:0.8rem;color:var(--text-muted);margin-left:0.5rem">${entry.tasks.length} Stufen</span>
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
                        <span class="step-id step-id-link" title="Details anzeigen">${esc(task.id)}</span>
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
            addBtn.textContent = '+ Aufgabe hinzufügen';
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
                    <strong>${esc(a.id)}</strong> ${esc(a.quelle)}
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
            schueler: previewData.map(p => ({
                _id: p.student._id,
                name: p.student.name,
                aufgabenIds: p.tasks.filter(t => t.selected).map(t => t._id)
            }))
        };

        // Beim Bearbeiten bestehenden Eintrag ersetzen, sonst anhängen.
        const editIdx = editingLlId ? pfad.lernleitern.findIndex(x => x._id === editingLlId) : -1;
        const backup = editIdx >= 0 ? pfad.lernleitern[editIdx] : null;
        if (editIdx >= 0) pfad.lernleitern[editIdx] = ll;
        else pfad.lernleitern.push(ll);

        const ok = await savePfad(pfad);
        if (!ok) {
            if (editIdx >= 0) pfad.lernleitern[editIdx] = backup;
            else pfad.lernleitern.pop();
            return;
        }
        toast(editIdx >= 0 ? 'Lernleiter aktualisiert' : (pfadId ? 'Lernleiter in Pfad gespeichert' : 'Lernleiter unter „Einzeln" gespeichert'));
        editingLlId = null;
        renderGenPfade();
        // renderGenPfade baut den Dropdown neu - Auswahl erhalten, damit ein
        // Folge-Save nicht an "Lernpfad auswählen" scheitert.
        document.getElementById('gen-pfad').value = pfad._id;
    }

    // Zentral speichern, damit ein fehlgeschlagener Request nicht still
    // verschluckt wird - sonst sieht der Nutzer Daten, die es nicht mehr gibt.
    async function savePfad(pfad) {
        try {
            // Pfad anlegen, falls neu. Der Kern kennt Namen als eindeutig je Konto.
            if (!pfad.id) {
                const r = await api(`${LP}/paths`, { method: 'POST', body: JSON.stringify({ name: pfad.name }) });
                if (r.status === 409) {
                    // Existiert schon: seine id holen statt zu scheitern.
                    const alle = await api(`${LP}/paths`).then(x => x.ok ? x.json() : []);
                    const da = alle.find(x => x.name === pfad.name);
                    if (!da) throw new Error('HTTP 409');
                    pfad.id = da.id;
                    for (const ll of (da.ladders || [])) await api(`${LP}/ladders/${ll.id}`, { method: 'DELETE' });
                } else if (!r.ok) {
                    throw new Error('HTTP ' + r.status);
                } else {
                    pfad.id = (await r.json()).id;
                }
            } else {
                // Bestehender Pfad: Lernleitern ersetzen, statt zu duplizieren.
                const alle = await api(`${LP}/paths`).then(x => x.ok ? x.json() : []);
                const da = alle.find(x => x.id === pfad.id);
                for (const ll of ((da && da.ladders) || [])) await api(`${LP}/ladders/${ll.id}`, { method: 'DELETE' });
            }

            const klassenRaw = await api(`${API}/classes`).then(x => x.ok ? x.json() : []);
            const classIdVon = name => (klassenRaw.find(c => c.name === name) || {}).id || null;

            let pos = 0;
            for (const ll of (pfad.lernleitern || [])) {
                const assignments = (ll.schueler || []).map(sch => ({
                    student_id: parseInt(sch.id || sch._id) || null,
                    exercise_ids: (sch.aufgabenIds || []).map(x => parseInt(x)).filter(Boolean)
                })).filter(a => a.student_id);
                const r = await api(`${LP}/paths/${pfad.id}/ladders`, {
                    method: 'POST',
                    body: JSON.stringify({
                        class_id: classIdVon(ll.klasse),
                        topic_id: await topicId(ll.thema, ll.unterthema),
                        position: pos++,
                        notizen: ll.notizen || '',
                        assignments: assignments.length ? assignments : null,
                        config: ll.config || null
                    })
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
            }
            return true;
        } catch (e) {
            toast('Speichern fehlgeschlagen: ' + e.message);
            return false;
        }
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

        if (mode === 'lrs') {
            generateLRSPdf(doc, marginL, contentW, lineH);
        } else if (mode === 'loesung') {
            generateLoesungPdf(doc, marginL, contentW, lineH);
        } else {
            previewData.forEach((entry, idx) => {
                if (idx > 0) doc.addPage();
                renderStudentPage(doc, entry, marginL, contentW, lineH, checkboxSize);
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


    function renderStudentPage(doc, entry, marginL, contentW, lineH, checkboxSize) {
        const s = entry.student;
        const selectedTasks = entry.tasks.filter(t => t.selected);
        let y = 15;
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
        doc.text('Datum: _______________', marginL + contentW, y, { align: 'right' });
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
        const kat = getKategorie(a);
        const body = document.getElementById('task-detail-body');
        body.innerHTML = `
            <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap">
                <strong style="font-size:1.1rem;color:var(--primary)">${esc(a.id)}</strong>
                <span class="badge badge-${katBadgeClass(kat)}">${esc(kat)}</span>
                ${a.lrs ? '<span class="badge badge-lrs">LRS</span>' : ''}
            </div>
            <div class="task-detail-section">
                <h3>Thema</h3>
                <p>${esc(a.thema)}${a.unterthema ? ' – ' + esc(a.unterthema) : ''}</p>
            </div>
            <div class="task-detail-section">
                <h3>Quelle</h3>
                <p>${esc(a.quelle)}</p>
            </div>
            ${a.operator || a.kompetenz || a.methode ? `
            <div class="task-detail-section">
                <h3>Tags</h3>
                <div>${renderTags(a)}</div>
            </div>` : ''}
            ${a.aufgabentext ? `
            <div class="task-detail-section">
                <h3>Aufgabentext</h3>
                <div class="task-detail-text">${esc(a.aufgabentext)}</div>
            </div>` : ''}
            ${a.loesung ? `
            <div class="task-detail-section">
                <h3>Lösung</h3>
                <div class="task-detail-text">${esc(a.loesung)}</div>
            </div>` : ''}
            ${a.bild ? `
            <div class="task-detail-section">
                <h3>Bild</h3>
                <img src="${a.bild}" class="task-detail-img">
            </div>` : ''}
            ${a.loesungBild ? `
            <div class="task-detail-section">
                <h3>Lösungsbild</h3>
                <img src="${a.loesungBild}" class="task-detail-img">
            </div>` : ''}
        `;
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

    document.getElementById('btn-bulk-delete').addEventListener('click', () => {
        const ids = getSelectedBulkIds();
        if (!ids.length) return;
        if (!confirm(ids.length + ' ausgewählte Aufgabe(n) wirklich löschen?')) return;
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

    document.getElementById('btn-bulk-cancel').addEventListener('click', () => {
        document.querySelectorAll('.bulk-cb').forEach(cb => { cb.checked = false; });
        bulkSelectAll.checked = false;
        updateBulkBar();
    });

    function renderGenPfade() {
        const sel = document.getElementById('gen-pfad');
        sel.innerHTML = '<option value="">– Einzeln –</option>' + lernpfade.map(p =>
            `<option value="${p._id}">${esc(p.name)}</option>`
        ).join('');
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
        const erklCount = aufgaben.filter(a => a.thema === thema && getKategorie(a) === 'Erklärung').length;
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
        info: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
    };

    // ─── Lernpfade ───
    let currentPfad = null;

    async function loadLernpfade() {
        try {
            const paths = await api(`${LP}/paths`).then(r => r.ok ? r.json() : []);
            const byId = new Map(schueler.map(s => [s.id, s]));
            lernpfade = paths.map(p => ({
                _id: String(p.id),
                id: p.id,
                name: p.name,
                aufgaben_order: [],
                lernleitern: (p.ladders || []).map(l => {
                    const tp = topicPfad(l.topic_id);
                    return {
                        _id: String(l.id),
                        thema: tp.thema,
                        unterthema: tp.unterthema,
                        klasse: (schueler.find(s => s.id === ((l.assignments || [])[0] || {}).student_id) || {}).klasse || '',
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

    function renderLernpfade() {
        const list = document.getElementById('pfade-list');
        list.innerHTML = lernpfade.map(p => `
            <div class="list-row" data-action="edit" data-id="${p._id}">
                <div>
                    <strong>${esc(p.name)}</strong>
                    <span style="color:var(--text-muted)">– ${(p.lernleitern || []).length} Lernleitern</span>
                </div>
                <div class="btn-group">
                    <button class="btn icon" data-action="edit" data-id="${p._id}" title="Bearbeiten">${ICON.edit}</button>
                    <button class="btn icon danger" data-action="delete" data-id="${p._id}" title="Löschen">${ICON.delete}</button>
                </div>
            </div>
        `).join('');

        const openPfad = id => editPfad(lernpfade.find(p => p._id === id));
        const deletePfad = id => {
            if (!confirm('Pfad wirklich löschen?')) return;
            lernpfade = lernpfade.filter(p => p._id !== id);
            api(`${LP}/paths/` + id, { method: 'DELETE' }).catch(() => {});
            loadLernpfade();
        };
        // Klick auf Balken öffnet; Icon-Buttons haben Vorrang via stopPropagation
        list.querySelectorAll('.list-row').forEach(row => {
            row.addEventListener('click', () => openPfad(row.dataset.id));
        });
        list.querySelectorAll('.btn[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (btn.dataset.action === 'edit') openPfad(btn.dataset.id);
                else deletePfad(btn.dataset.id);
            });
        });
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
            <div class="list-row" data-ll-id="${ll._id}" data-action="open" title="Öffnen zum Bearbeiten">
                <div>
                    ${esc(ll.thema || '(ohne Thema)')}${ll.unterthema ? ' <span style="color:var(--text-muted)">&gt; ' + esc(ll.unterthema) + '</span>' : ''}
                    <span style="color:var(--text-muted)">– ${ll.schueler.length} Schüler</span>
                </div>
                <div class="btn-group">
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
                if (action === 'up' && idx > 0) {
                    [currentPfad.lernleitern[idx - 1], currentPfad.lernleitern[idx]] = [currentPfad.lernleitern[idx], currentPfad.lernleitern[idx - 1]];
                } else if (action === 'down' && idx < currentPfad.lernleitern.length - 1) {
                    [currentPfad.lernleitern[idx + 1], currentPfad.lernleitern[idx]] = [currentPfad.lernleitern[idx], currentPfad.lernleitern[idx + 1]];
                } else if (action === 'delete') {
                    if (!confirm('Lernleiter aus Pfad entfernen?')) return;
                    currentPfad.lernleitern.splice(idx, 1);
                }
                await savePfad(currentPfad);
                renderPfadLernleitern();
                renderLernpfade();
            });
        });
    }

    // Gespeicherte Lernleiter im Generator oeffnen. Dank deterministischem Seed
    // ergibt dieselbe Thema/Klasse-Kombination wieder dieselbe Auswahl. Beim
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
        document.getElementById('btn-generate').click();
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
        toast('Pfad „' + pfad.name + '“ vorausgewählt – Thema und Klasse wählen');
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
