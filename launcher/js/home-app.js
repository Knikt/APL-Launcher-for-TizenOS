/* CleanFrame Home — the house, drawn as an app.

   This is part of the launcher, not a package: the drawer's Home tile opens it
   in place of a browser tab, so a control is one press away instead of a page
   load. It is deliberately its own module so main.js stays about the stage.

   The screen follows the Home app on an iPad: the home's own photograph behind
   everything, a sidebar of categories and rooms, a row of status capsules, and
   sections of accessory tiles — a tile that is on turns white, a tile that is
   off stays glass, exactly as the reference does. OK on a tile opens the sheet
   under the grid with that accessory's full controls.

   Nothing here invents state: a tile reads CleanFrameHA's cache and every
   control writes through the client. The module captures keys before the
   launcher sees them, because it is a modal screen: Back leaves the app. */
(function (root) {
  'use strict';

  var ha = root.CleanFrameHA;

  var box = null, sideEl = null, mainEl = null, sectionsEl = null, chipsEl = null;
  var titleEl = null, clockEl = null, dayEl = null;
  var sheetEl = null, sheetHeadEl = null, sheetRowsEl = null;
  var built = false, openFlag = false, clockTimer = 0;

  /* What the main pane is showing: 'home', 'cat:<type>' or a room id. */
  var zone = 'home';
  /* zone: 'side' or 'grid'. i is the focused sidebar row, c the focused control
     in the sheet. On the grid the focused element itself is remembered, so
     mixed tile sizes still move the way the eye expects. */
  var f = { zone: 'grid', i: 0, c: 0 };
  var focusEl = null;
  var sheetDev = null, sheetOpen = false;
  var lastSig = '';

  var ICON = {
    home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
    climate: '<path d="M12 3v18M4.4 7.6l15.2 8.8M19.6 7.6 4.4 16.4"/><path d="M12 6.1 10.2 4.3M12 6.1l1.8-1.8M12 17.9l-1.8 1.8M12 17.9l1.8 1.8"/>',
    fan: '<circle cx="12" cy="12" r="1.9"/><path d="M12 10.1c0-2.6-.9-5.1-2.6-5.1C7.9 5 7.4 6.6 7.9 8c.5 1.4 2 1.9 4.1 2.1zM13.9 12c2.6 0 5.1-.9 5.1-2.6 0-1.5-1.6-2-3-1.5-1.4.5-1.9 2-2.1 4.1zM12 13.9c0 2.6.9 5.1 2.6 5.1 1.5 0 2-1.6 1.5-3-.5-1.4-2-1.9-4.1-2.1zM10.1 12c-2.6 0-5.1.9-5.1 2.6 0 1.5 1.6 2 3 1.5 1.4-.5 1.9-2 2.1-4.1z"/>',
    light: '<path d="M12 3a6 6 0 0 0-3.6 10.8V16h7.2v-2.2A6 6 0 0 0 12 3Z"/><path d="M9.6 19h4.8M10.4 21.4h3.2"/>',
    media: '<path d="M11 4.6 6.4 8.8H3.2v6.4h3.2L11 19.4z"/><path d="M14.6 8.4a5.2 5.2 0 0 1 0 7.2M17.4 5.8a9 9 0 0 1 0 12.4"/>',
    power: '<path d="M12 4.2v7"/><path d="M7.5 7.2a6.8 6.8 0 1 0 9 0"/>',
    scene: '<path d="M20.2 14.6A8.2 8.2 0 0 1 9.4 3.8a8.2 8.2 0 1 0 10.8 10.8Z"/>',
    switch: '<rect x="3.4" y="7" width="17.2" height="10" rx="5"/><circle cx="16" cy="12" r="2.2"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    energy: '<path d="M13.5 3 5.6 13.4h5.2L10.5 21l7.9-10.4h-5.2z"/>'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ico(name, cls) {
    return '<svg class="ico ha-ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || ICON.switch) + '</svg>';
  }
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function haText(s) {
    s = String(s || '').replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function typeIcon(type) { return ICON[type] ? type : 'switch'; }

  /* ---------- The house ---------- */
  function rooms() { return (ha && ha.ROOMS) || []; }
  function scenes() { return (ha && ha.SCENES) || []; }
  function roomById(id) {
    var list = rooms();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function stateOf(dev) { return (ha && ha.getState && ha.getState(dev.id)) || {}; }
  function attrsOf(dev) { return stateOf(dev).attributes || {}; }
  function available(dev) {
    var s = stateOf(dev).state;
    if (dev.type === 'scene') return true;
    return !!s && s !== 'unavailable' && s !== 'unknown';
  }
  function isOn(dev) {
    var s = stateOf(dev).state;
    if (dev.type === 'media') return s === 'playing' || s === 'on';
    if (dev.type === 'climate') return ['cool', 'heat', 'dry', 'fan_only', 'auto'].indexOf(s) >= 0;
    if (dev.type === 'scene') return false;
    return s === 'on';
  }
  function fanStep(pct) { return clamp(Math.max(1, Math.round((pct || 0) / 16.667)), 1, 6); }
  function brightnessOf(dev) {
    var a = attrsOf(dev);
    if (typeof a.brightness === 'number') return Math.round(a.brightness / 2.55);
    if (typeof a.brightness_pct === 'number') return Math.round(a.brightness_pct);
    return 100;
  }
  function volumeOf(dev) {
    var v = attrsOf(dev).volume_level;
    return typeof v === 'number' ? Math.round(v * 100) : 0;
  }
  function devicesOf(room) {
    var out = [], list = (room && room.devices) || [], extra = (room && room.extras) || [], i, prefs = window.CleanFrameDevicePrefs;
    /* Devices removed in Settings are gone from every list at once: the room
       tiles, the category counts and the sidebar are all read through here. */
    function keep(dev) {
      if (!dev || !dev.id) return false;
      return !prefs || !prefs.isShown || prefs.isShown(dev.id);
    }
    for (i = 0; i < list.length; i++) if (keep(list[i])) out.push(list[i]);
    for (i = 0; i < extra.length; i++) if (keep(extra[i])) out.push(extra[i]);
    return out;
  }
  function allDevices() {
    var out = [], list = rooms(), i, j, devs;
    for (i = 0; i < list.length; i++) {
      devs = devicesOf(list[i]);
      for (j = 0; j < devs.length; j++) out.push(devs[j]);
    }
    return out;
  }
  function countOn(type) {
    var list = allDevices(), n = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].type === type && isOn(list[i])) n++;
    return n;
  }

  /* ---------- Sidebar ---------- */
  var CATS = [
    { id: 'cat:climate', type: 'climate', name: 'Climate' },
    { id: 'cat:light', type: 'light', name: 'Lights' },
    { id: 'cat:fan', type: 'fan', name: 'Fans' },
    { id: 'cat:media', type: 'media', name: 'Speakers & TVs' }
  ];

  function sideItems() {
    var out = [{ id: 'home', name: 'Home', icon: 'home', head: false }], i, list = rooms();
    out.push({ head: true, name: 'Categories' });
    for (i = 0; i < CATS.length; i++) out.push({ id: CATS[i].id, name: CATS[i].name, icon: CATS[i].type });
    out.push({ head: true, name: 'Rooms' });
    for (i = 0; i < list.length; i++) out.push({ id: list[i].id, name: list[i].name, icon: 'home' });
    return out;
  }
  function sideRowId(index) {
    var list = sideItems(), row = list[index];
    return row && !row.head ? row.id : zone;
  }

  /* ---------- Sections ---------- */
  /* What the main pane shows, in reading order. Every tile keeps a global index
     so the state signature and the sheet can name it without re-walking the DOM. */
  function sections() {
    var out = [], list, i, j, room, devs, dev;
    if (zone === 'home') {
      out.push({ name: 'Scenes', items: scenes().map(function (s) { return { dev: s }; }) });
      list = rooms();
      for (i = 0; i < list.length; i++) {
        devs = devicesOf(list[i]);
        out.push({ name: list[i].name, room: list[i].id, items: devs.map(function (d) { return { dev: d }; }) });
      }
      return out;
    }
    if (zone.indexOf('cat:') === 0) {
      list = allDevices();
      devs = [];
      for (j = 0; j < list.length; j++) if (list[j].type === zone.slice(4)) devs.push({ dev: list[j] });
      for (i = 0; i < CATS.length; i++) if (CATS[i].id === zone) out.push({ name: CATS[i].name, items: devs });
      return out;
    }
    room = roomById(zone);
    out.push({ name: (room || {}).name || 'Home', items: devicesOf(room).map(function (d) { return { dev: d }; }) });
    return out;
  }

  /* ---------- Tiles ---------- */
  function tileValue(dev) {
    var st = stateOf(dev), a = st.attributes || {}, on = isOn(dev);
    if (!available(dev)) return { main: 'Unavailable', sub: '' };
    if (dev.type === 'climate') {
      return {
        main: on && typeof a.temperature === 'number' ? a.temperature + '\u00b0' : 'Off',
        sub: typeof a.current_temperature === 'number' ? 'Room ' + a.current_temperature + '\u00b0' : on ? haText(st.state) : 'Off'
      };
    }
    if (dev.type === 'fan') {
      var pct = on ? Math.round(a.percentage || 0) : 0;
      return { main: on ? fanStep(pct) + ' of 6' : 'Off', sub: on ? pct + '%' : 'Off' };
    }
    if (dev.type === 'light') return { main: on ? brightnessOf(dev) + '%' : 'Off', sub: on ? 'On' : 'Off' };
    if (dev.type === 'media') {
      var title = a.media_title || a.app_name || '';
      return { main: on ? (title || 'Playing') : 'Paused', sub: on ? 'Playing' : 'Not Playing' };
    }
    if (dev.type === 'scene') return { main: 'Scene', sub: 'Run' };
    return { main: available(dev) ? haText(st.state) : 'Unavailable', sub: '' };
  }
  function tileSize(dev) {
    /* One height for every tile, so the grid reads as rows rather than a
       mosaic: a machine and a lamp are the same card, only the width differs. */
    if (dev.type === 'climate' || dev.type === 'media') return ' is-wide';
    return '';
  }
  function deviceTile(dev, i, focused) {
    var on = isOn(dev), v = tileValue(dev), avail = available(dev);
    return '<div class="ha-tile acc-' + esc(typeIcon(dev.type)) + (on ? ' is-on' : '') + (avail ? '' : ' is-away') +
      tileSize(dev) + (focused ? ' is-focus' : '') + '" role="button" tabindex="-1" data-i="' + i + '"' +
      ' aria-label="' + esc(dev.name + ', ' + v.main + '. OK opens its controls') + '">' +
      '<span class="ha-chip">' + ico(typeIcon(dev.type)) + '</span>' +
      '<span class="ha-tile-copy"><span class="ha-tile-name">' + esc(dev.name) + '</span>' +
        '<span class="ha-tile-state">' + esc(v.main) + '</span></span>' +
      (v.sub && dev.type === 'climate' ? '<span class="ha-tile-note">' + esc(v.sub) + '</span>' : '') +
    '</div>';
  }
  function sceneTile(dev, i, focused) {
    return '<div class="ha-tile acc-scene' + (focused ? ' is-focus' : '') + '" role="button" tabindex="-1" data-i="' + i + '"' +
      ' aria-label="' + esc(dev.name + '. OK runs the scene') + '">' +
      '<span class="ha-chip">' + ico('scene') + '</span>' +
      '<span class="ha-tile-copy"><span class="ha-tile-name">' + esc(dev.name) + '</span>' +
        '<span class="ha-tile-state">Scene</span></span>' +
    '</div>';
  }

  function chipsHtml() {
    var list = allDevices(), climates = [], lights = 0, media = 0, fans = 0, i, d;
    for (i = 0; i < list.length; i++) {
      d = list[i];
      if (d.type === 'climate' && isOn(d)) {
        var t = attrsOf(d).temperature;
        if (typeof t === 'number') climates.push(t);
      }
      if (d.type === 'light' && isOn(d)) lights++;
      if (d.type === 'media' && isOn(d)) media++;
      if (d.type === 'fan' && isOn(d)) fans++;
    }
    var climateText = climates.length ?
      Math.min.apply(null, climates) + '\u00b0\u2013' + Math.max.apply(null, climates) + '\u00b0' : 'All Off';
    return [
      { icon: 'climate', name: 'Climate', value: climateText },
      { icon: 'light', name: 'Lights', value: lights ? lights + ' On' : 'All Off' },
      { icon: 'media', name: 'Speakers & TVs', value: media ? media + ' Playing' : 'None Playing' },
      { icon: 'fan', name: 'Fans', value: fans ? fans + ' On' : 'All Off' }
    ].map(function (c) {
      return '<div class="ha-pill acc-' + c.icon + '"><span class="ha-pill-mark">' + ico(c.icon) + '</span>' +
        '<span class="ha-pill-copy"><span>' + esc(c.name) + '</span><i>' + esc(c.value) + '</i></span></div>';
    }).join('');
  }

  /* ---------- Building ---------- */
  function build() {
    if (built) return;
    box = root.document.getElementById('homeApp');
    if (!box) return;
    box.innerHTML =
      '<div class="ha-backdrop" aria-hidden="true"></div>' +
      '<div class="ha-veil" aria-hidden="true"></div>' +
      '<div class="ha-bar">' +
        '<span class="ha-bar-time" id="haClock"></span>' +
        '<span class="ha-bar-day" id="haDay"></span>' +
        '<span class="ha-bar-title">Home</span>' +
        '<span class="ha-bar-tools" aria-hidden="true">' + ico('plus') + ico('more') + '</span>' +
      '</div>' +
      '<nav class="ha-side" id="haSide" role="menu" aria-label="Categories and rooms"></nav>' +
      '<main class="ha-main">' +
        '<h1 class="ha-title" id="haTitle"></h1>' +
        '<div class="ha-chips" id="haChips"></div>' +
        '<div class="ha-sections" id="haSections"></div>' +
        '<p class="ha-hint">OK on an accessory opens temperature, speed, brightness and mode. Back leaves Home.</p>' +
      '</main>' +
      '<div class="ha-sheet" id="haSheet" hidden>' +
        '<div class="ha-sheet-head" id="haSheetHead"></div>' +
        '<div class="ha-sheet-rows" id="haSheetRows" role="menu"></div>' +
      '</div>' +

      '<div class="ha-setup" id="haSetup" hidden>' +
        '<h1 class="ha-setup-title">Connect to Home Assistant</h1>' +
        '<p class="ha-setup-lead">Sign in once with the account you already use. ' +
          'Home Assistant issues a token to this screen and can end it at any time ' +
          'under Profile -> Security.</p>' +
        '<div class="ha-field"><span class="ha-field-name">Address</span>' +
          '<input type="text" id="haUrl" spellcheck="false" autocomplete="off" ' +
          'placeholder="http://homeassistant.local:8123"></div>' +
        '<div class="ha-field"><span class="ha-field-name">Username</span>' +
          '<input type="text" id="haUser" spellcheck="false" autocapitalize="off" autocomplete="username"></div>' +
        '<div class="ha-field"><span class="ha-field-name">Password</span>' +
          '<input type="password" id="haPass" autocomplete="current-password"></div>' +
        '<div class="ha-field is-action"><span class="ha-field-name">Sign in</span>' +
          '<span class="ha-field-value" id="haGo">Connect</span></div>' +
        '<div class="ha-field is-alt" id="haAlt" hidden><span class="ha-field-name">Preview</span>' +
          '<span class="ha-field-value">Show the demo house</span></div>' +
        '<div class="ha-note" id="haNote">A long-lived access token works too: ' +
          'Profile -> Security -> Long-lived access tokens.</div>' +
      '</div>';
    sideEl = box.querySelector('#haSide');
    mainEl = box.querySelector('.ha-main');
    sectionsEl = box.querySelector('#haSections');
    chipsEl = box.querySelector('#haChips');
    titleEl = box.querySelector('#haTitle');
    clockEl = box.querySelector('#haClock');
    dayEl = box.querySelector('#haDay');
    sheetEl = box.querySelector('#haSheet');
    sheetHeadEl = box.querySelector('#haSheetHead');
    sheetRowsEl = box.querySelector('#haSheetRows');
    box.addEventListener('click', onClick);
    built = true;
  }

  function sideHtml() {
    var list = sideItems(), html = '', i, row;
    for (i = 0; i < list.length; i++) {
      row = list[i];
      if (row.head) { html += '<div class="ha-side-head">' + esc(row.name) + '<span>' + ico('chevron') + '</span></div>'; continue; }
      html += '<div class="ha-side-row' + (zone === row.id ? ' is-active' : '') +
        (f.zone === 'side' && f.i === i ? ' is-focus' : '') + '" role="menuitem" tabindex="-1" data-r="' + i + '">' +
        '<span class="ha-side-mark">' + ico(row.icon) + '</span><span>' + esc(row.name) + '</span></div>';
    }
    return html;
  }

  function sectionsHtml() {
    var list = sections(), html = '', i, j, k = 0, sec, tile;
    for (i = 0; i < list.length; i++) {
      sec = list[i];
      if (!sec.items.length) continue;
      html += '<section class="ha-section"><h2 class="ha-section-head">' + esc(sec.name) + '<span>' + ico('chevron') + '</span></h2><div class="ha-row-tiles">';
      for (j = 0; j < sec.items.length; j++) {
        tile = sec.items[j].dev;
        html += tile.type === 'scene' ? sceneTile(tile, k, false) : deviceTile(tile, k, false);
        k++;
      }
      html += '</div></section>';
    }
    return html || '<p class="ha-empty">Nothing here yet.</p>';
  }

  function tileElements() { return sectionsEl ? sectionsEl.querySelectorAll('.ha-tile') : []; }

  /* ---------- The sheet ---------- */
  function controlsFor(dev) {
    var st = stateOf(dev), a = st.attributes || {}, on = isOn(dev), rows = [];
    if (dev.type === 'climate') {
      rows.push({ id: 'power', label: 'Power', value: on ? haText(st.state) : 'Off', act: 'toggle' });
      rows.push({ id: 'temp', label: 'Temperature', value: (typeof a.temperature === 'number' ? a.temperature : '--') + '\u00b0C', act: 'step' });
      rows.push({ id: 'mode', label: 'Mode', value: haText(st.state || 'off'), act: 'cycle' });
      if (typeof a.current_temperature === 'number') rows.push({ id: 'room', label: 'Room Temperature', value: a.current_temperature + '\u00b0C', act: 'info' });
    } else if (dev.type === 'fan') {
      var pct = on ? Math.round(a.percentage || 0) : 0;
      rows.push({ id: 'power', label: 'Power', value: on ? 'On' : 'Off', act: 'toggle' });
      rows.push({ id: 'speed', label: 'Speed', value: on ? fanStep(pct) + ' of 6' : 'Off', act: 'step' });
    } else if (dev.type === 'light') {
      rows.push({ id: 'power', label: 'Power', value: on ? 'On' : 'Off', act: 'toggle' });
      rows.push({ id: 'brightness', label: 'Brightness', value: brightnessOf(dev) + '%', act: 'step' });
    } else if (dev.type === 'media') {
      rows.push({ id: 'play', label: 'Playback', value: on ? 'Playing' : 'Paused', act: 'toggle' });
      rows.push({ id: 'volume', label: 'Volume', value: volumeOf(dev) + '%', act: 'step' });
      rows.push({ id: 'title', label: 'Now Playing', value: a.media_title || a.app_name || 'Nothing', act: 'info' });
    } else if (dev.type === 'scene') {
      rows.push({ id: 'run', label: 'Run Scene', value: dev.name, act: 'toggle' });
    } else {
      rows.push({ id: 'power', label: 'Power', value: on ? 'On' : 'Off', act: 'toggle' });
    }
    rows.forEach(function (r) { r.focusable = r.act !== 'info'; });
    return rows;
  }
  function rowIndex(rows) {
    var out = [], i;
    for (i = 0; i < rows.length; i++) if (rows[i].focusable) out.push(i);
    return out;
  }

  function adjust(dev, id, dir) {
    var a = attrsOf(dev);
    if (!ha) return;
    if (id === 'temp') { ha.adjustClimateTemp(dev.id, dir * 0.5); return; }
    if (id === 'speed') { ha.setFanSpeed(dev.id, clamp((isOn(dev) ? (a.percentage || 0) : 0) + dir * (a.percentage_step || 16.667), 0, 100)); return; }
    if (id === 'brightness') { ha.setBrightness(dev.id, clamp(brightnessOf(dev) + dir * 10, 1, 100)); return; }
    if (id === 'volume') { ha.setVolume(dev.id, clamp((a.volume_level || 0) + dir * 0.05, 0, 1)); return; }
    if (id === 'mode') {
      var modes = ['cool', 'dry', 'fan_only', 'auto', 'off'], at = modes.indexOf(stateOf(dev).state);
      ha.callService('climate', 'set_hvac_mode', { entity_id: dev.id, hvac_mode: modes[(at + dir + modes.length) % modes.length] });
    }
  }
  function activate(dev, id) {
    if (!ha) return;
    if (dev.type === 'scene') { ha.activateScene(dev.id); return; }
    ha.toggleEntity(dev.id);
  }

  function sheetHeadHtml() {
    if (!sheetDev) return '';
    var v = tileValue(sheetDev);
    return '<span class="ha-chip is-large acc-' + typeIcon(sheetDev.type) + '">' + ico(typeIcon(sheetDev.type)) + '</span>' +
      '<div class="ha-sheet-copy"><h2>' + esc(sheetDev.name) + '</h2><p>' + esc(v.main + (v.sub ? ' \u00b7 ' + v.sub : '')) + '</p></div>' +
      '<span class="ha-sheet-hint">Back closes</span>';
  }
  function rowHtml() {
    if (!sheetDev) return '';
    var rows = controlsFor(sheetDev), html = '', i, r, focusAt = rowIndex(rows)[f.c];
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      html += '<div class="ha-row' + (r.act === 'info' ? ' is-info' : '') + (i === focusAt && r.focusable ? ' is-focus' : '') +
        '" role="menuitem" tabindex="-1" data-c="' + i + '">' +
        '<span class="ha-row-name">' + esc(r.label) + '</span>' +
        (r.act === 'step' || r.act === 'cycle' ? '<span class="ha-step">\u2039</span>' : '') +
        '<span class="ha-row-value">' + esc(r.value) + '</span>' +
        (r.act === 'step' || r.act === 'cycle' ? '<span class="ha-step">\u203a</span>' : '') +
      '</div>';
    }
    return html;
  }

  /* ---------- Painting ---------- */
  function sig() {
    var out = zone + '|' + (sheetDev ? sheetDev.id + ',' + f.c + ',' + sheetOpen : '-') + '|', list = allDevices(), i, d, st, a;
    for (i = 0; i < list.length; i++) {
      d = list[i]; st = stateOf(d); a = st.attributes || {};
      out += d.id + (st.state || '') + (a.temperature || '') + (a.current_temperature || '') + (a.percentage || '') +
        (a.brightness || '') + (a.volume_level || '') + (a.media_title || '') + ';';
    }
    return out;
  }

  function tick() {
    if (!clockEl) return;
    var d = new Date(), h = d.getHours() % 12 || 12, m = d.getMinutes();
    clockEl.textContent = h + ':' + (m < 10 ? '0' : '') + m;
    if (dayEl) {
      var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      dayEl.textContent = days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
    }
  }

  function focusTitle() {
    if (zone === 'home') return 'Home';
    if (zone.indexOf('cat:') === 0) {
      for (var i = 0; i < CATS.length; i++) if (CATS[i].id === zone) return CATS[i].name;
    }
    return (roomById(zone) || {}).name || 'Home';
  }

  function paint(force) {
    if (!built || !box || setupMode) return;
    var next = sig(), i, els;

    if (force || next !== lastSig) {
      lastSig = next;
      if (titleEl) titleEl.textContent = focusTitle();
      if (sideEl) sideEl.innerHTML = sideHtml();
      if (chipsEl) chipsEl.innerHTML = chipsHtml();
      if (sectionsEl) {
        sectionsEl.innerHTML = sectionsHtml();
        var tiles = tileElements();
        focusEl = tiles[0] || null;
      }
      if (sheetEl) sheetEl.hidden = !sheetOpen;
      if (sheetHeadEl) sheetHeadEl.innerHTML = sheetOpen ? sheetHeadHtml() : '';
      if (sheetRowsEl) sheetRowsEl.innerHTML = sheetOpen ? rowHtml() : '';
      if (f.zone === 'side') syncSideFocus();
      else syncGridFocus();
      return;
    }

    els = sideEl ? sideEl.children : [];
    for (i = 0; i < els.length; i++) {
      if (els[i].getAttribute && els[i].getAttribute('data-r') != null) {
        els[i].classList.toggle('is-focus', f.zone === 'side' && Number(els[i].getAttribute('data-r')) === f.i);
      }
    }
    if (f.zone === 'grid') syncGridFocus();
    if (sheetOpen && sheetDev && sheetRowsEl) {
      var rows = controlsFor(sheetDev), focusAt = rowIndex(rows)[f.c];
      els = sheetRowsEl.children;
      for (i = 0; i < els.length; i++) els[i].classList.toggle('is-focus', i === focusAt);
    }
  }

  function syncSideFocus() {
    var els = sideEl ? sideEl.children : [], i, n;
    for (i = 0; i < els.length; i++) {
      if (!els[i].getAttribute || els[i].getAttribute('data-r') == null) continue;
      n = Number(els[i].getAttribute('data-r'));
      els[i].classList.toggle('is-focus', n === f.i);
    }
    scrollRailToFocus();
  }
  function syncGridFocus() {
    var els = tileElements(), i;
    for (i = 0; i < els.length; i++) els[i].classList.toggle('is-focus', els[i] === focusEl && f.zone === 'grid' && !sheetOpen);
    scrollToFocus();
  }
  /* Scroll the section list only, by layout offsets: the stage is a scroll
     container and a scrollIntoView with default options drags the launcher
     sideways. The list is the positioned ancestor of every tile, so offsetTop
     is already measured inside it and no rect (which the stage's scale would
     distort) is involved. */
  function scrollToFocus() {
    if (!sectionsEl || !focusEl || f.zone !== 'grid' || sheetOpen) return;
    var view = sectionsEl.clientHeight, h = focusEl.offsetHeight, pad = 20;
    var section = focusEl.parentNode && focusEl.parentNode.parentNode;
    var top = focusEl.offsetTop;
    /* The first tile of a section brings its heading with it, so the viewer can
       read what the row belongs to after a jump. */
    if (section && section.classList && section.classList.contains('ha-section') && focusEl.offsetLeft === 0) {
      top = Math.min(top, section.offsetTop);
      h = Math.max(h, 30);
    }
    if (top < sectionsEl.scrollTop + pad) sectionsEl.scrollTop = Math.max(0, top - pad);
    else if (top + h > sectionsEl.scrollTop + view - pad) sectionsEl.scrollTop = top + h - view + pad;
  }

  /* The rail scrolls the same way when the home has more rooms than fit. */
  function scrollRailToFocus() {
    if (!sideEl) return;
    var row = sideEl.querySelector('.ha-side-row.is-focus');
    if (!row) return;
    var view = sideEl.clientHeight, top = row.offsetTop, h = row.offsetHeight;
    if (top < sideEl.scrollTop + 8) sideEl.scrollTop = Math.max(0, top - 8);
    else if (top + h > sideEl.scrollTop + view - 8) sideEl.scrollTop = top + h - view + 8;
  }

  /* ---------- D-pad ---------- */
  function tileCenter(el) {
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2, el: el };
  }
  /* The grid has mixed tile sizes, so a move is a geometry question: among the
     tiles on that side, take the nearest one, weighting the cross axis so a tile
     directly above or below wins over one further along the row. */
  function moveFocus(dir) {
    var els = tileElements(), i, cur, cx, cy, best = null, bestScore = Infinity, e, x, y, dx, dy, score;
    if (!els.length) return;
    if (!focusEl) { focusEl = els[0]; syncGridFocus(); return; }
    cur = tileCenter(focusEl);
    for (i = 0; i < els.length; i++) {
      e = els[i];
      if (e === focusEl) continue;
      var c = tileCenter(e);
      dx = c.x - cur.x; dy = c.y - cur.y;
      if (dir === 'left' && dx > -8) continue;
      if (dir === 'right' && dx < 8) continue;
      if (dir === 'up' && dy > -8) continue;
      if (dir === 'down' && dy < 8) continue;
      if (dir === 'left' || dir === 'right') score = Math.abs(dy) * 2.2 + Math.abs(dx);
      else score = Math.abs(dx) * 2.2 + Math.abs(dy);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) { focusEl = best; syncGridFocus(); }
  }

  /* Nothing sits left of the focused tile in its row or column. */
  function atLeftEdge() {
    var els = tileElements(), min = Infinity, i;
    for (i = 0; i < els.length; i++) min = Math.min(min, els[i].offsetLeft);
    return focusEl.offsetLeft <= min + 2;
  }

  function selectZone(id) {
    zone = id;
    f.zone = 'grid';
    f.i = 0;
    if (sectionsEl) sectionsEl.scrollTop = 0;
  }

  function openSheetFor(dev) {
    if (!dev) return;
    if (dev.type === 'scene') { if (ha) ha.activateScene(dev.id); return; }
    sheetDev = dev;
    sheetOpen = true;
    f.c = 0;
  }

  function focusedDevice() {
    var els = tileElements(), i;
    for (i = 0; i < els.length; i++) if (els[i] === focusEl) {
      var list = [], s = sections(), a, b;
      /* Empty sections are not drawn, so they are not counted here either:
         the flat list and the tile indices have to be the same list. */
      for (a = 0; a < s.length; a++) {
        if (!s[a].items.length) continue;
        for (b = 0; b < s[a].items.length; b++) list.push(s[a].items[b].dev);
      }
      return list[i];
    }
    return null;
  }

  function key(k) {
    var rows, idx, row;
    if (setupMode) { setupKey(k); return; }
    /* Back steps out one layer: the accessory sheet first, then the app. A
       viewer who opened a temperature by mistake should not lose the house. */
    if (k === 'back') {
      if (sheetOpen) { sheetOpen = false; sheetDev = null; paint(true); return; }
      close();
      return;
    }

    if (sheetOpen) {
      rows = controlsFor(sheetDev);
      idx = rowIndex(rows);
      if (k === 'down') { f.c = Math.min(idx.length - 1, f.c + 1); paint(false); return; }
      if (k === 'up') { f.c = Math.max(0, f.c - 1); paint(false); return; }
      row = rows[idx[f.c]];
      if (k === 'left' || k === 'right') {
        if (row && (row.act === 'step' || row.act === 'cycle')) adjust(sheetDev, row.id, k === 'left' ? -1 : 1);
        paint(true);
        return;
      }
      if (k === 'ok') { if (row && row.act === 'toggle') activate(sheetDev, row.id); paint(true); return; }
      return;
    }

    if (f.zone === 'side') {
      var list = sideItems();
      if (k === 'up' || k === 'down') {
        var n = f.i;
        do { n += (k === 'up' ? -1 : 1); } while (n >= 0 && n < list.length && list[n].head);
        if (n >= 0 && n < list.length) f.i = n;
      } else if (k === 'right') {
        if (tileElements().length) { f.zone = 'grid'; focusEl = tileElements()[0]; }
      } else if (k === 'ok' || k === 'left') {
        selectZone(sideRowId(f.i));
        paint(true);
        return;
      }
      paint(false);
      return;
    }

    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
      /* Left out of the first column returns to the sidebar, the way the
         reference's own focus order does. The column is measured against the
         leftmost tile, because a section's grid starts at its own origin. */
      if (k === 'left' && focusEl && atLeftEdge()) {
        f.zone = 'side';
        f.i = Math.max(0, sideItems().map(function (r) { return r.id; }).indexOf(zone));
        paint(false);
        return;
      }
      moveFocus(k);
      return;
    }
    if (k === 'ok') {
      openSheetFor(focusedDevice());
      paint(true);
    }
  }

  /* ---------- Pointer ---------- */
  function onClick(ev) {
    var el = ev.target;
    while (el && el !== box) {
      if (el.getAttribute) {
        if (el.getAttribute('data-r') != null) {
          var list = sideItems();
          f.zone = 'side';
          f.i = Number(el.getAttribute('data-r'));
          if (!list[f.i].head) { selectZone(list[f.i].id); paint(true); return; }
          paint(false);
          return;
        }
        if (el.getAttribute('data-i') != null) {
          focusEl = el;
          f.zone = 'grid';
          openSheetFor(focusedDevice());
          paint(true);
          return;
        }
        if (el.getAttribute('data-c') != null && sheetOpen) {
          var rows = controlsFor(sheetDev), at = Number(el.getAttribute('data-c'));
          var pos = rowIndex(rows).indexOf(at);
          if (pos >= 0) { f.c = pos; activate(sheetDev, rows[at].id); }
          paint(true);
          return;
        }
      }
      el = el.parentNode;
    }
  }

  /* ---------- Connect ---------- */
  /* Shown instead of the house when this screen has no token yet. It is the
     first thing a new installation sees, so it has to work with a remote:
     up and down move between fields, OK focuses one or presses Connect, and
     the fields themselves are ordinary inputs so the TV's keyboard types
     into them. */
  var setupMode = false, setupAt = 0, previewHouse = false;

  function setupFields() {
    if (!box) return [];
    var all = box.querySelectorAll('.ha-setup .ha-field'), out = [], i;
    for (i = 0; i < all.length; i++) if (!all[i].hidden) out.push(all[i]);
    return out;
  }

  function setupNote(text, bad) {
    var n = box && box.querySelector('#haNote');
    if (!n) return;
    n.textContent = text || '';
    n.className = 'ha-note' + (bad ? ' is-bad' : '');
  }

  function paintSetup() {
    if (!box) return;
    var setup = box.querySelector('#haSetup');
    if (setup) setup.hidden = !setupMode;
    var alt = box.querySelector('#haAlt');
    if (alt) alt.hidden = !(ha && ha.preview);
    var url = box.querySelector('#haUrl');
    if (url && !url.value && ha && ha.dashboardUrl) url.value = ha.dashboardUrl();
    var fields = setupFields(), i;
    for (i = 0; i < fields.length; i++) fields[i].classList.toggle('is-focus', i === setupAt);
  }

  function setupValue(sel) {
    var el = box && box.querySelector(sel);
    return el ? el.value : '';
  }

  function doConnect() {
    if (!ha || !ha.connect) { setupNote('This build has no Home Assistant client.', true); return; }
    setupNote('Signing in to Home Assistant...');
    ha.connect(setupValue('#haUrl'), setupValue('#haUser'), setupValue('#haPass'), function (err) {
      if (err) { setupNote(err, true); return; }
      setupMode = false;
      setupAt = 0;
      if (box) box.classList.remove('is-setup');
      paintSetup();
      lastSig = '';
      paint(true);
    });
  }

  function focusSetup() {
    var fields = setupFields(), f = fields[setupAt], input = f && f.querySelector('input');
    if (input) { try { input.focus(); } catch (e) {} return; }
    var a = root.document.activeElement;
    if (a && a.blur) a.blur();
  }

  function setupKey(k) {
    var fields = setupFields(), n = fields.length;
    if (!n) return;
    if (k === 'down') { setupAt = Math.min(n - 1, setupAt + 1); focusSetup(); paintSetup(); return; }
    if (k === 'up') { setupAt = Math.max(0, setupAt - 1); focusSetup(); paintSetup(); return; }
    if (k === 'ok') {
      var f = fields[setupAt];
      if (!f) return;
      if (f.classList.contains('is-action')) { doConnect(); return; }
      if (f.id === 'haAlt') { previewHouse = true; close(); setTimeout(open, 40); return; }
      var input = f.querySelector('input');
      if (input) { try { input.focus(); } catch (e) {} setupNote(''); }
      return;
    }
    if (k === 'back') { close(); return; }
  }

  /* ---------- Open / close ---------- */
  function open() {
    if (openFlag) return;
    build();
    if (!box) return;
    setupMode = !previewHouse && !(ha && ha.connected && ha.connected());
    /* The same picture as the Home tile's backdrop: the private package's
       photograph when it has one, the drawn mark otherwise. Read once per open
       so a backdrop change from elsewhere is picked up without a rebuild. */
    var pick = root.CleanFrameBackdrops && root.CleanFrameBackdrops.pick ? root.CleanFrameBackdrops.pick('homecontrol') : null;
    /* Absolute, because the stylesheet that reads --ha-photo lives in css/:
       a bare "assets/..." resolved against it and the photograph never loaded. */
    if (pick && pick.url) {
      var photo = pick.url;
      try { photo = new URL(pick.url, document.baseURI).href; } catch (e) {}
      box.style.setProperty('--ha-photo', 'url("' + photo + '")');
    }
    openFlag = true;
    zone = 'home';
    f = { zone: 'grid', i: 0, c: 0 };
    sheetOpen = false;
    sheetDev = null;
    focusEl = null;
    lastSig = '';
    if (sectionsEl) sectionsEl.scrollTop = 0;
    if (sheetEl) sheetEl.hidden = true;
    box.hidden = false;
    box.classList.remove('is-open');
    void box.offsetWidth;
    box.classList.add('is-open');
    if (setupMode) {
      box.classList.add('is-setup');
      setupAt = 0;
      paintSetup();
      focusSetup();
      tick();
      clearInterval(clockTimer);
      clockTimer = setInterval(tick, 20000);
      return;
    }
    box.classList.remove('is-setup');
    paintSetup();
    if (ha && ha.setPanelActive) ha.setPanelActive(true);
    if (ha && ha.refresh) ha.refresh();
    if (ha && ha.subscribe) {
      ha.subscribe(function () {
        if (!openFlag) return;
        paint(true);
      });
    }
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 20000);
    paint(true);
  }

  function close() {
    if (!openFlag) return;
    openFlag = false;
    setupMode = false;
    sheetOpen = false;
    sheetDev = null;
    clearInterval(clockTimer);
    clockTimer = 0;
    if (ha && ha.setPanelActive) ha.setPanelActive(false);
    if (!box) return;
    box.classList.remove('is-open');
    box.hidden = true;
    lastSig = '';
    if (root.CleanFrameAudio) { try { root.CleanFrameAudio.back(); } catch (e) {} }
  }

  /* Captured at the document, before the launcher's own handler. */
  root.document.addEventListener('keydown', function (ev) {
    if (!openFlag) return;
    var map = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 8: 'back', 27: 'back', 461: 'back', 10009: 'back' };
    var k = map[ev.keyCode];
    if (!k) return;
    /* Typing in the connect form: the caret belongs to the field, not to the
       d-pad, so the horizontal keys are left to it. */
    if (setupMode && ev.target && ev.target.tagName === 'INPUT' &&
        (ev.keyCode === 37 || ev.keyCode === 39)) return;
    ev.preventDefault();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    ev.stopPropagation();
    key(k);
  }, true);

  root.CleanFrameHomeApp = {
    open: open,
    close: close,
    isOpen: function () { return openFlag; },
    state: function () {
      return {
        open: openFlag, zone: zone, focus: { zone: f.zone, c: f.c, tile: focusedDevice() && focusedDevice().id },
        sheet: sheetOpen, sheetDevice: sheetDev && sheetDev.id
      };
    },
    key: key
  };
})(window);
