/* ============================================================
   search.js — Search, the Apple TV way.

   A row of letters at the top, the matching apps below, updated at every
   letter. OK on a letter types it, OK on an app opens it. The remote's
   digits and a keyboard (PC preview) type too. Opened with ▲ from the full
   screen Top Shelf (▲ from the dock, then ▲ again), or from the Control
   Center. Apps only for now: those in folders too, and the hidden ones
   with Settings › Home Screen › Search Hidden Apps.
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL, K = APL.KEY;
    var LETTERS = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
    var root, fieldEl, keysEl, resultsEl, emptyEl, nav;
    var isOpen = false, query = "", keys = [], found = [];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }
    /* Lowercase, without accents: "é" finds "e", "Arte" finds "arte". */
    function norm(s) {
        s = String(s || "").toLowerCase();
        return s.normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s;
    }

    function candidates() {
        var hidden = APL.sys.pref("searchHidden") ? [] : APL.sys.pref("hiddenApps") || [];
        return ((APL.allApps && APL.allApps()) || []).filter(function (a) {
            return !a.folder && hidden.indexOf(a.id) === -1;
        });
    }
    /* The name's start first, then the start of a word in it, then anywhere. Nothing typed: the recent apps. */
    function match(q) {
        var all = candidates();
        if (!q) {
            var recent = APL.sys.pref("recentApps") || [];
            return recent.map(function (id) { return all.filter(function (a) { return a.id === id; })[0]; }).filter(Boolean);
        }
        var start = [], word = [], inside = [];
        all.forEach(function (a) {
            var n = norm(a.name), at = n.indexOf(q);
            if (at === 0) start.push(a);
            else if (at > 0 && (" " + n).indexOf(" " + q) !== -1) word.push(a);
            else if (at > 0) inside.push(a);
        });
        return start.concat(word, inside);
    }

    function buildDom() {
        root = el("section", "search");
        root.appendChild(el("div", "search__dim"));
        fieldEl = el("div", "search__field");
        keysEl = el("div", "search__keys");
        resultsEl = el("div", "search__results");
        emptyEl = el("p", "search__empty");
        root.appendChild(fieldEl); root.appendChild(keysEl); root.appendChild(resultsEl); root.appendChild(emptyEl);
        document.body.appendChild(root);

        LETTERS.forEach(function (c) { keys.push({ type: c, label: c }); });
        keys.push({ type: " ", label: APL.t("Space"), wide: true });
        keys.push({ del: true, label: APL.t("Delete"), wide: true });
        keys.forEach(function (k) {
            var t = el("div", "search__key" + (k.wide ? " search__key--wide" : ""), k.label);
            k.el = t;
            keysEl.appendChild(t);
        });

        nav = new APL.Nav({
            onSelect: function (i) {
                var t = nav.tiles[i];
                if (t._key) { press(t._key); return; }
                if (t._app) { var app = t._app; close(); APL.openApp(app); }
            },
            onBack: close,
            onKey: function (code, e) {
                if (code >= 48 && code <= 57) { type(String(code - 48)); return true; }             // the remote's digits
                if (code === K.BACKSPACE && e.key === "Backspace") { erase(); return true; }        // a keyboard's ⌫
                if (e.key && e.key.length === 1 && /[\w ]/.test(e.key)) { type(norm(e.key)); return true; }
                return false;
            }
        });
    }

    function press(k) { if (k.del) erase(); else type(k.type); }
    function type(c) { if (query.length < 30) { query += c; refresh(); } }
    function erase() { if (query) { query = query.slice(0, -1); refresh(); } }

    /* Field and results again; the focus stays where it is (on the letter just typed). */
    function refresh() {
        var q = norm(query).replace(/\s+/g, " ").replace(/^ /, "");
        fieldEl.textContent = query || APL.t("Search");
        fieldEl.classList.toggle("is-empty", !query);
        found = match(q);
        resultsEl.innerHTML = "";
        var tiles = found.map(function (app) {
            var t = APL.makeTile(app, 1);
            t._app = app;
            resultsEl.appendChild(t);
            return t;
        });
        emptyEl.textContent = !q ? (found.length ? APL.t("Recently Used") : "") :
            found.length ? "" : APL.t("No apps found for “{q}”", { q: query.trim() });
        root.classList.toggle("has-recent", !q && found.length > 0);
        var keyEls = keys.map(function (k) { k.el._key = k; return k.el; });
        var cur = nav.current && nav.current(), at = Math.max(0, keyEls.indexOf(cur));
        nav.setTiles(keyEls.concat(tiles));
        nav.focus(cur && cur._app ? Math.min(nav.tiles.length - 1, keyEls.length) : at);
    }

    function open() {
        if (!root) buildDom();
        query = "";
        nav.setTiles([]);
        refresh();
        nav.focus(0);
        root.classList.add("is-open");
        document.body.classList.add("has-search");          // the Home Screen steps back (launcher.css)
        APL.pushNav(nav);
        isOpen = true;
    }
    function close() {
        if (!isOpen) return;
        root.classList.remove("is-open");
        document.body.classList.remove("has-search");
        APL.popNav(nav);
        isOpen = false;
    }

    /* No magnifier on the Home Screen: Search opens from the Control Center, and
       with ▲ in full screen (launcher.js). */

    APL.search = { open: open, close: close, isOpen: function () { return isOpen; } };
})(window);
