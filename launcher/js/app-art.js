/* ============================================================
   app-art.js — a real poster behind every app.

   The same catalogue Universal Search reads: JustWatch's trending list
   for the viewer's storefront, kept per service so the row shows
   different titles rather than the same poster four times. One pick per
   app, cached for six hours in localStorage: nothing is fetched while
   the row moves, and the frame is a plain background image, never a
   live blur.

   APL.appArt.pick(app)  -> { url, title, year } or null
   APL.appArt.start(cb)  load the list once (cache first)
   APL.appArt.status()   counts, for browser checks
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL = global.APL || {};

    var STORE = "apl.appart.v13";  // v13: each service is asked in its own country
    var FRESH = 6 * 60 * 60 * 1000;          /* the list is rebuilt every six hours */
    var WATCH = "https://apis.justwatch.com/graphql";
    var IMAGE = "https://images.justwatch.com";
    var MAX = 6;                              /* titles kept per service */

    var QUERY = "query AplArt($country: Country!, $language: Language!, $first: Int!) {" +
        " popularTitles(country: $country, language: $language, first: $first, sortBy: TRENDING) {" +
        " edges { node { content(country: $country, language: $language) {" +
        " title originalReleaseYear posterUrl scoring { imdbScore } backdrops { backdropUrl } }" +
        " offers(country: $country, platform: WEB) { monetizationType package { technicalName } } } } } }";

    /* Which list an app draws from, by its name: the package ids differ
       between storefronts, the names do not. Nuvio runs Netflix's catalogue. */
    var NAMES = [
        { re: /netflix/i, key: "netflix" },
        { re: /prime ?video|amazon ?prime/i, key: "primevideo" },
        { re: /(jio ?)?hotstar/i, key: "hotstar" },
        { re: /apple ?tv/i, key: "appletv" },
        { re: /sony ?liv/i, key: "sonyliv" },
        { re: /disney/i, key: "disneyplus" },
        { re: /hbo ?max|(^|\W)max(\W|$)/i, key: "hbomax" },
        { re: /samsung ?tv ?plus/i, key: "samsungplus" },
        { re: /\barte\b/i, key: "arte" },
        /* Apps with no storefront of their own (Nuvio, Stremio, a file player)
           draw from the trending list, and the slate says which title it is. */
        { re: /stremio|nuvio|player/i, key: "general" }
    ];
    /* JustWatch's package technical names, as Search reads them. */
    var PACKAGES = {
        netflix: ["netflix", "netflixbasicwithads"],
        primevideo: ["amazonprimevideo", "amazonprimevideowithads"],
        hotstar: ["jiohotstar", "hotstar"],
        /* Apple TV+ only. "itunes"/"appletv" is the store, which sells nearly
           every film, so the whole trending list used to end up under Apple
           TV and the wall named other services' shows. */
        appletv: ["appletvplus"],
        sonyliv: ["sonyliv"],
        disneyplus: ["disneyplus"],
        hbomax: ["max", "hbomax", "hboumax", "hbo"],
        samsungplus: ["samsungtvplus"],
        arte: ["arte"]
    };

    var cache = null;
    var loading = false;
    var waiting = [];
    var seq = 0;

    function now() { return Date.now(); }
    function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

    function read() {
        try { return JSON.parse(global.localStorage.getItem(STORE) || "null"); }
        catch (e) { return null; }
    }
    function write(value) {
        try { global.localStorage.setItem(STORE, JSON.stringify(value)); } catch (e) {}
    }

    function country() {
        if (APL.sys && APL.sys.region) {
            var c = APL.sys.region();
            if (c && /^[A-Za-z]{2}$/.test(c)) return String(c).toUpperCase();
        }
        var lang = global.navigator.language || "";
        var m = /[-_]([A-Za-z]{2})$/.exec(lang);
        if (m) return m[1].toUpperCase();
        try {
            var tz = global.Intl.DateTimeFormat().resolvedOptions().timeZone || "";
            if (tz.indexOf("Kolkata") >= 0 || tz.indexOf("Calcutta") >= 0) return "IN";
            if (tz.indexOf("London") >= 0) return "GB";
            if (tz.indexOf("Sydney") >= 0) return "AU";
        } catch (e) {}
        return "US";
    }

    /* JustWatch spells these differently between storefronts: Normalise the
       technical name into a key once, here, rather than at every pick. */
    function keyOf(name) {
        var n = String(name || "").toLowerCase(), k;
        for (k in PACKAGES) {
            if (!has(PACKAGES, k)) continue;
            for (var i = 0; i < PACKAGES[k].length; i++) if (n === PACKAGES[k][i]) return k;
        }
        return "";
    }

    /* JustWatch hands out templates ("…/{profile}/name.{format}"); a browser
       cannot fetch those, so the placeholder is filled in here. */
    function absolute(url) {
        if (!url) return "";
        var full = /^https?:/i.test(url) ? url : IMAGE + (url.charAt(0) === "/" ? "" : "/") + url;
        return full.replace(/\{profile\}/g, "s1920").replace(/\{format\}/g, "jpg");
    }

    function build(data) {
        var out = { at: now(), country: country(), by: {}, general: [] };
        var edges = data && data.data && data.data.popularTitles && data.data.popularTitles.edges;
        var i, j, node, content, url, keys, seen;
        if (!edges) return out;
        for (i = 0; i < edges.length; i++) {
            node = edges[i] && edges[i].node;
            content = node && node.content;
            if (!content || !content.title) continue;
            var shot = content.backdrops && content.backdrops[0] && content.backdrops[0].backdropUrl;
            url = absolute(shot || content.posterUrl);
            if (!url) continue;
            var score = content.scoring && content.scoring.imdbScore;
            keys = {};
            var offers = node.offers || [];
            for (j = 0; j < offers.length; j++) {
                var o = offers[j] || {};
                /* A title is "on" a service only when it is included there. A
                   rent/buy listing (the Apple TV store, Prime's store) says
                   nothing about what the service actually streams. */
                var how = String(o.monetizationType || "").toUpperCase();
                if (how === "RENT" || how === "BUY") continue;
                var k = keyOf(o.package && o.package.technicalName);
                if (k) keys[k] = true;
            }
            var svc = Object.keys(keys);
            var item = { url: url, title: content.title, year: content.originalReleaseYear || "",
                         rating: typeof score === "number" ? score.toFixed(1) : (score || ""),
                         svc: svc };
            if (out.general.length < MAX * 2) out.general.push(item);
            for (k in keys) {
                if (!has(keys, k)) continue;
                if (!out.by[k]) out.by[k] = [];
                if (out.by[k].length < MAX) out.by[k].push(item);
            }
        }
        return out;
    }

    /* Trending is one worldwide page: a service that never reaches it (SonyLIV,
       JioHotstar) would have no titles at all, and the wall would fall back to
       somebody else's show. Those services are asked for directly, by package,
       so each app stands on a title it actually carries. */
    var QUERY_SVC = "query AplSvc($country: Country!, $language: Language!, $first: Int!, $packages: [String!]) {" +
        " popularTitles(country: $country, language: $language, first: $first, sortBy: TRENDING," +
        " filter: { packages: $packages }) {" +
        " edges { node { content(country: $country, language: $language) {" +
        " title originalReleaseYear posterUrl scoring { imdbScore } backdrops { backdropUrl } }" +
        " offers(country: $country, platform: WEB) { monetizationType package { technicalName } } } } } }";

    /* A service is asked where its catalogue lives, whatever the screen's own
       storefront is: SonyLIV and JioHotstar in India, ARTE in France, Samsung
       TV Plus in the US. */
    var SERVICE_COUNTRY = { sonyliv: "IN", hotstar: "IN", arte: "FR", samsungplus: "US" };

    /* key: keep only the titles this service actually carries. JustWatch
       ignores a package filter it cannot serve and answers with the whole
       trending page, which is how another service's shows used to arrive. */
    function itemsOf(edges, key) {
        var out = [], i, c, url, shot, sc, o, j, hit, node;
        for (i = 0; i < (edges || []).length; i++) {
            node = edges[i] && edges[i].node;
            c = node && node.content;
            if (!c || !c.title) continue;
            if (key) {
                hit = false;
                var offers = node.offers || [];
                for (j = 0; j < offers.length; j++) {
                    o = offers[j] || {};
                    var how = String(o.monetizationType || "").toUpperCase();
                    if (how === "RENT" || how === "BUY") continue;
                    if (keyOf(o.package && o.package.technicalName) === key) { hit = true; break; }
                }
                if (!hit) continue;
            }
            shot = c.backdrops && c.backdrops[0] && c.backdrops[0].backdropUrl;
            url = absolute(shot || c.posterUrl);
            if (!url) continue;
            sc = c.scoring && c.scoring.imdbScore;
            out.push({ url: url, title: c.title, year: c.originalReleaseYear || "",
                       rating: typeof sc === "number" ? sc.toFixed(1) : (sc || ""), svc: [] });
        }
        return out;
    }

    function fillOne(out, key, todo, once) {
        var where = todo.shift();
        if (!where) { once(); return; }
        try {
            var xhr = new global.XMLHttpRequest();
            xhr.open("POST", WATCH, true);
            xhr.timeout = 6000;
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                var items = [];
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { items = itemsOf(JSON.parse(xhr.responseText).data.popularTitles.edges, key); }
                    catch (e) { items = []; }
                }
                if (!items.length) { if (todo.length) { fillOne(out, key, todo, once); return; } once(); return; }
                var j;
                for (j = 0; j < items.length; j++) items[j].svc = [key];
                out.by[key] = items.slice(0, MAX);
                write(out);          // kept even if the waiting time ran out first
                once();
            };
            xhr.ontimeout = xhr.onerror = function () { once(); };
            xhr.send(JSON.stringify({
                operationName: "AplSvc",
                query: QUERY_SVC,
                variables: { country: where, language: "en", first: 20, packages: PACKAGES[key] }
            }));
        } catch (e) { once(); }
    }

    function fillMissing(out, done) {
        var need = [], k;
        for (k in PACKAGES) {
            if (!has(PACKAGES, k)) continue;
            if (out.by[k] && out.by[k].length) continue;
            need.push(k);
        }
        need = need.slice(0, 5);
        if (!need.length) { done(); return; }
        var left = need.length, fired = false;
        function finish() { if (fired) return; fired = true; done(); }
        global.setTimeout(finish, 15000);
        need.forEach(function (key) {
            var where = out.country || country(), home = SERVICE_COUNTRY[key];
            fillOne(out, key, (home && home !== where) ? [home, where] : [where], function () {
                if (!--left) finish();
            });
        });
    }

    function fetchList(cb) {
        loading = true;
        var id = ++seq;
        try {
            var xhr = new global.XMLHttpRequest();
            xhr.open("POST", WATCH, true);
            xhr.timeout = 15000;
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                loading = false;
                if (id === seq && xhr.status >= 200 && xhr.status < 300) {
                    try {
                        cache = build(JSON.parse(xhr.responseText));
                        write(cache);
                        fillMissing(cache, function () {
                            write(cache);
                            var ls = waiting;
                            waiting = [];
                            for (var k = 0; k < ls.length; k++) ls[k]();
                            if (cb) cb();
                        });
                        return;
                    } catch (e) {}
                }
                var list = waiting;
                waiting = [];
                for (var i = 0; i < list.length; i++) list[i]();
                if (cb) cb();
            };
            xhr.ontimeout = function () { loading = false; };
            xhr.onerror = function () { loading = false; };
            xhr.send(JSON.stringify({
                operationName: "AplArt",
                query: QUERY,
                variables: { country: country(), language: "en", first: 100 }
            }));
        } catch (e) {
            loading = false;
            if (cb) cb();
        }
    }

    function start(cb) {
        if (!cache) cache = read();
        if (cache && cache.at && (now() - cache.at) < FRESH && cache.by) { if (cb) cb(); return; }
        if (cb) waiting.push(cb);
        if (loading) return;
        fetchList(null);
    }

    /* True when this app's own service has titles here. */
    function ownList(app) {
        if (!cache) cache = read();
        if (!cache || !cache.by) return false;
        var name = String((app && app.name) || "");
        for (var i = 0; i < NAMES.length; i++) {
            if (!NAMES[i].re.test(name)) continue;
            var key = NAMES[i].key;
            if (key === "general") return true;
            return !!(cache.by[key] && cache.by[key].length);
        }
        return false;
    }

    function listFor(app) {
        if (!cache) cache = read();
        if (!cache) return null;
        var name = String((app && app.name) || "");
        for (var i = 0; i < NAMES.length; i++) {
            if (!NAMES[i].re.test(name)) continue;
            var key = NAMES[i].key;
            if (key === "general") return cache.general || null;
            var own = cache.by && cache.by[key];
            if (own && own.length) return own;
            /* The titles the service itself carries first. When the storefront
               lists none of them here (a service that is not sold in this
               country, or a channel with no catalogue of its own), the wall
               still needs a picture: the storefront's trending list stands in,
               and pick() hands out distinct titles so two tiles never share a
               poster. */
            var mine = (cache.general || []).filter(function (it) {
                return it.svc && it.svc.indexOf(key) >= 0;
            });
            if (mine.length) return mine;
            return cache.general && cache.general.length ? cache.general : null;
        }
        return null;
    }

    /* One title per app, and the same one until the list is rebuilt: a poster
       that changed on every move would read as a flicker. */
    /* Titles already handed out, by app: two tiles on the wall must never show the
       same poster, which reads as a backdrop that failed to change (Disney+ was
       showing Prime Video's film). */
    var handed = {};
    function usedByOther(url, id) {
        for (var k in handed) {
            if (k !== id && handed[k] === url) return true;
        }
        return false;
    }

    function pick(app) {
        var list = listFor(app);
        if (!list || !list.length) return null;
        var id = String((app && app.id) || (app && app.name) || "");
        var h = 0, i, start, cand;
        for (i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
        start = h % list.length;
        for (i = 0; i < list.length; i++) {
            cand = list[(start + i) % list.length];
            if (!cand || !cand.url) continue;
            if (!usedByOther(cand.url, id)) { handed[id] = cand.url; return cand; }
        }
        return list[start];
    }

    /* The title after this one, for the slide that runs while an app stays in
       focus. Shares the hash with pick(), so n = 0 is the poster on screen. */
    function next(app, n) {
        var list = listFor(app);
        if (!list || !list.length) return null;
        /* Only a service's own catalogue may advance. When the storefront lists
           nothing for it, the title on screen stays put rather than sliding on
           to somebody else's show. */
        if (n && !ownList(app)) return null;
        var id = String((app && app.id) || (app && app.name) || "");
        var h = 0;
        for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
        return list[(h + (n || 0)) % list.length];
    }

    /* True when this app's name is a service the catalogue knows: the caller
       can then let the poster through instead of a fixed brand image. */
    function known(app) {
        var name = String((app && app.name) || "");
        for (var i = 0; i < NAMES.length; i++) if (NAMES[i].re.test(name)) return true;
        return false;
    }

    APL.appArt = {
        known: known,
        pick: pick,
        next: next,
        list: listFor,
        start: start,
        status: function () {
            return {
                at: cache && cache.at || 0,
                country: cache && cache.country || "",
                keys: cache && cache.by ? Object.keys(cache.by) : [],
                general: cache && cache.general ? cache.general.length : 0,
                loading: loading
            };
        }
    };
})(window);
