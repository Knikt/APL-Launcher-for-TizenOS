/* ============================================================
   homeassistant.js — the Home tile: Home Assistant's dashboard,
   on the TV.

   The launcher only needs the address of the dashboard. It is a
   private one (it names the house, sometimes carries a token), so
   it lives in js/keys.local.js, next to the other settings of this
   installation, and is never committed:

       window.APL_KEYS = {
           ha: { url: "http://homeassistant.local:8123/tv", name: "Home" }
       };

   Without it there is no tile at all: nothing to configure, nothing
   left over for the people who don't run Home Assistant.

   APL.ha.available()   the address is set
   APL.ha.name()        the tile's name ("Home" unless set)
   APL.ha.open()        our own Home app when the build carries it
                        (window.CleanFrameHomeApp), otherwise the
                        dashboard in Internet
   ============================================================ */
(function (global) {
    "use strict";

    var APL = global.APL;

    function conf() {
        var k = global.APL_KEYS || {};
        return k.ha && typeof k.ha === "object" ? k.ha : null;
    }

    /* http(s) only: a Tizen app control won't take anything else, and a
       mistyped address is better refused than launched into a blank screen. */
    function url() {
        var c = conf(), u = c && String(c.url || "");
        /* A screen that signed in keeps its address on the device: the tile
           has to stay even when this build ships no keys file. */
        if (!/^https?:\/\/\S+$/i.test(u) && global.CleanFrameHA && global.CleanFrameHA.dashboardUrl) {
            u = String(global.CleanFrameHA.dashboardUrl() || "");
        }
        return /^https?:\/\/\S+$/i.test(u) ? u : "";
    }

    function name() {
        var c = conf(), n = c && String(c.name || "").trim();
        return n || APL.t("Home");
    }

    function open() {
        /* Our own Home app first, when this build carries it: the tile opens the
           screen we made, with the launcher's focus handling and no page load.
           A build without it keeps the dashboard hand-off, so the tile is never
           dead on someone else's installation. */
        if (global.CleanFrameHomeApp && global.CleanFrameHomeApp.open) {
            global.CleanFrameHomeApp.open();
            return;
        }
        var u = url();
        if (!u) {
            APL.toast(APL.t("Home Assistant is not set up"));
            return;
        }
        if (APL.sys.PREVIEW) {
            /* Same wording as a web app (launcher.js): what would happen on the screen. */
            APL.toast(APL.t("Preview: on your TV, “{name}” would open in Internet ({url})",
                            { name: name(), url: u.replace(/^https?:\/\//, "").replace(/\/$/, "") }));
            return;
        }
        /* The browser takes a few seconds to come up: the launcher stays dark
           until then instead of flashing back over a black screen. */
        if (APL.holdVeil) APL.holdVeil(6000);
        APL.openUrl(u).catch(function (e) {
            if (APL.hideVeil) APL.hideVeil();
            APL.toast(e.message || APL.t("Can't open Internet"));
        });
    }

    APL.ha = {
        /* The tile exists when the app can either open a dashboard or ask for
           a sign-in: a build carrying the Home app always has somewhere to go,
           and a build without it still needs an address in the keys. */
        available: function () {
            if (global.CleanFrameHomeApp && global.CleanFrameHomeApp.open) return true;
            return !!url();
        },
        url: url,
        name: name,
        open: open
    };
})(window);
