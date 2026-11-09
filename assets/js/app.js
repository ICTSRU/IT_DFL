/* ICTD Digital File Library v1.0 — front end (vanilla JS, no build step) */
(function () {
  'use strict';

  var CFG = window.ICTD_LIB_CONFIG || {};
  var LANGS = window.I18N;
  var DEMO = /[?&]demo=1\b/.test(location.search);
  var COLORS = ['#501e8c', '#0a6eaa', '#1f7a5c', '#b4540a', '#8a2a6b', '#3a4a8a', '#9b2226', '#2f6f73'];
  var DRAWER_ICONS = ['archive', 'folder', 'scroll-text', 'file-signature', 'kanban', 'chart-column', 'users', 'shopping-cart', 'shield-check',
    'briefcase', 'book-open', 'database', 'server', 'layers', 'settings', 'star', 'layout-dashboard', 'file-text'];
  var STATUSES = ['Active', 'Draft', 'Archived', 'Superseded'];
  var CONFS = ['General', 'Internal', 'Confidential'];
  var root = document.getElementById('root');

  var S = {
    lang: 'ar', user: null, config: {}, drawers: [], folders: [], docs: [], dById: {}, fById: {}, cnt: { d: {}, f: {} },
    q: '', f: blankFilters(), showFilters: false, sort: { key: 'date', dir: -1 }, token: '', tokenExp: 0, view: { name: 'cabinet' }
  };
  var FORM = {};
  var refreshResolver = null;
  var gisReady = false;

  /* ---------------- helpers ---------------- */
  function blankFilters() { return { drawerId: '', folderId: '', owner: '', tag: '', from: '', to: '', status: '', conf: '' }; }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function sess(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function t(k) { var d = LANGS[S.lang] || LANGS.ar; return d[k] !== undefined ? d[k] : (LANGS.ar[k] || k); }
  var MOON_SVG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var SUN_SVG = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>';
  function curTheme() { return store('ictd_lib_theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme() { try { document.documentElement.setAttribute('data-theme', curTheme()); } catch (e) { /* ignore */ } }
  function themeMark() { var dk = curTheme() === 'dark'; return (dk ? SUN_SVG : MOON_SVG) + '<span>' + esc(t(dk ? 'themeLight' : 'themeDark')) + '</span>'; }
  function themeBtn(cls) { return '<button class="' + cls + '" data-act="theme" aria-label="' + esc(t(curTheme() === 'dark' ? 'themeLight' : 'themeDark')) + '">' + themeMark() + '</button>'; }
  function refreshThemeButtons() { $$('[data-act="theme"]').forEach(function (b) { b.innerHTML = themeMark(); }); }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function nm(o) { return ((S.lang === 'ar' ? (o.nameAr || o.nameEn) : (o.nameEn || o.nameAr)) || ''); }
  function nm2(o) { var a = nm(o); var other = S.lang === 'ar' ? o.nameEn : o.nameAr; return other && other !== a ? other : ''; }
  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#501e8c'; }
  function iconName(n) { return window.ICONS[n] ? n : 'archive'; }
  function todayISO() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
  }
  function fmtSize(b) { b = Number(b) || 0; if (!b) return ''; if (b < 1024) return b + ' B'; if (b < 1048576) return Math.round(b / 1024) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
  function cntLabel(n) { return n + ' ' + (n === 1 ? t('doc1') : t('docN')); }
  function isAdmin() { return S.user && S.user.role === 'Admin'; }
  function isEditor() { return S.user && (S.user.role === 'Admin' || S.user.role === 'Editor'); }
  // folder-level effective rights (server supplies canManage/canEdit per folder; fall back to global role)
  function fManage(f) { return !!(f && (f.canManage !== undefined ? f.canManage : isAdmin())); }
  function fEdit(f) { return !!(f && (f.canEdit !== undefined ? f.canEdit : isEditor())); }
  function fileIcon(d) {
    var ext = (d.fileName || '').split('.').pop().toLowerCase();
    if (/^(pdf|doc|docx|txt|rtf|odt|ppt|pptx)$/.test(ext)) return 'file-text';
    if (/^(xls|xlsx|csv|ods)$/.test(ext)) return 'file-spreadsheet';
    if (/^(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(ext)) return 'file-image';
    if (/^(zip|rar|7z|gz)$/.test(ext)) return 'file-archive';
    if (d.fileName === 'Google Drive link') return 'link';
    return 'file';
  }
  function logo(key, alt, fb) {
    var src = CFG.LOGOS && CFG.LOGOS[key];
    if (!src) return '<span class="logo-fallback">' + esc(fb) + '</span>';
    return '<img class="logo" data-fb="' + esc(fb) + '" src="' + esc(src) + '" alt="' + esc(alt) + '">';
  }
  document.addEventListener('error', function (e) {
    var im = e.target;
    if (im && im.tagName === 'IMG' && im.classList.contains('logo')) {
      var s = document.createElement('span'); s.className = 'logo-fallback'; s.textContent = im.getAttribute('data-fb') || ''; im.replaceWith(s);
    }
  }, true);

  function toast(msg, kind) {
    var el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(function () { el.remove(); }, kind === 'bad' ? 6500 : 3200);
  }
  function showLoader(msg) {
    hideLoader();
    var el = document.createElement('div'); el.className = 'loader'; el.id = 'loader';
    el.innerHTML = '<div class="box">' + icon('loader-circle', 'spin') + '<span>' + esc(msg) + '</span></div>'; document.body.appendChild(el);
  }
  function hideLoader() { var l = $('#loader'); if (l) l.remove(); }

  /* ---------------- auth ---------------- */
  function parseJwt(tok) {
    try {
      var p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), function (c) { return c.charCodeAt(0); })));
    } catch (e) { return null; }
  }
  function setToken(tok) {
    var p = parseJwt(tok); if (!p) return false;
    S.token = tok; S.tokenExp = Number(p.exp) || 0; sess('ictd_lib_tok', tok); return true;
  }
  function tokenValid(margin) { return S.token && S.tokenExp - Math.floor(Date.now() / 1000) > (margin || 0); }
  function configured() { return !/^PASTE_/.test(CFG.WEB_APP_URL || 'PASTE_') && !/^PASTE_/.test(CFG.GOOGLE_CLIENT_ID || 'PASTE_'); }

  function whenGoogle(cb, tries) {
    if (window.google && google.accounts && google.accounts.id) return cb(true);
    if ((tries || 0) > 100) return cb(false);
    setTimeout(function () { whenGoogle(cb, (tries || 0) + 1); }, 100);
  }
  function initGoogle(cb) {
    whenGoogle(function (ok) {
      if (!ok) return cb && cb(false);
      if (!gisReady) {
        google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, hd: CFG.ALLOWED_DOMAIN, auto_select: store('ictd_lib_skip') === '1', cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
        gisReady = true;
      }
      cb && cb(true);
    });
  }
  function onCredential(resp) {
    if (!resp || !resp.credential || !setToken(resp.credential)) return;
    if (refreshResolver) { var r = refreshResolver; refreshResolver = null; r(); return; }
    boot(true);
  }
  function refreshToken() {
    return new Promise(function (res, rej) {
      initGoogle(function (ok) {
        if (!ok) return rej();
        var done = false;
        refreshResolver = function () { done = true; res(); };
        try { google.accounts.id.prompt(); } catch (e) { /* ignore */ }
        setTimeout(function () { if (!done) { refreshResolver = null; rej(); } }, 12000);
      });
    });
  }
  function signOut(msg) {
    S.token = ''; S.tokenExp = 0; S.user = null; sess('ictd_lib_tok', null);
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
    hideLoader(); closeModal(); renderLogin(msg);
  }

  /* ---------------- API ---------------- */
  function call(action, payload) {
    return fetch(CFG.WEB_APP_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ action: action, idToken: S.token, payload: payload || {} }) })
      .then(function (r) { return r.json(); })
      .catch(function () { throw { code: 'NETWORK' }; })
      .then(function (j) { if (j && j.ok) return j.data; throw { code: (j && j.code) || 'ERROR', message: j && j.error }; });
  }
  function api(action, payload) {
    if (DEMO) return window.DemoApi(action, payload || {});
    var go = function () { return call(action, payload); };
    var pre = tokenValid(90) ? Promise.resolve() : refreshToken().catch(function () { /* the server will answer AUTH_EXPIRED if needed */ });
    return pre.then(go).catch(function (e) {
      if (e && e.code === 'AUTH_EXPIRED') {
        return refreshToken().then(go).catch(function (e2) { throw (e2 && e2.code) ? e2 : { code: 'SESSION', message: t('sessionExpired') }; });
      }
      throw e;
    });
  }
  function handleErr(e, box) {
    var code = e && e.code; var msg = (e && e.message) || t('errGeneric');
    if (code === 'NETWORK') msg = t('errNetwork');
    if (['AUTH', 'AUTH_EXPIRED', 'SESSION', 'DOMAIN', 'NOT_ALLOWED'].indexOf(code) >= 0) { signOut(msg); return; }
    if (box) { box.textContent = msg; } else { toast(msg, 'bad'); }
  }

  /* ---------------- data ---------------- */
  function boot(fresh) {
    showLoader(t('loading'));
    api('bootstrap', { fresh: !!fresh }).then(function (d) {
      S.user = d.user; S.config = d.config || {}; S.drawers = d.drawers || []; S.folders = d.folders || []; S.docs = d.documents || [];
      reindex(); hideLoader(); renderApp(); route();
    }).catch(function (e) { hideLoader(); handleErr(e); if (!S.user && !$('.login')) renderLogin(); });
  }
  function reindex() {
    var byOrder = function (a, b) { return (a.order - b.order) || String(a.id).localeCompare(b.id); };
    S.drawers.sort(byOrder); S.folders.sort(byOrder);
    S.dById = {}; S.fById = {}; S.cnt = { d: {}, f: {} };
    S.drawers.forEach(function (d) { S.dById[d.id] = d; });
    S.folders.forEach(function (f) { S.fById[f.id] = f; });
    S.docs.forEach(function (d) {
      var dr = S.dById[d.drawerId] || {}, fo = S.fById[d.folderId] || {};
      d._hay = norm([d.title, d.description, d.owner, (d.tags || []).join(' '), dr.nameAr, dr.nameEn, fo.nameAr, fo.nameEn, d.date, d.fileName, d.version].join(' '));
      S.cnt.d[d.drawerId] = (S.cnt.d[d.drawerId] || 0) + 1; S.cnt.f[d.folderId] = (S.cnt.f[d.folderId] || 0) + 1;
    });
  }
  function owners() { var m = {}; S.docs.forEach(function (d) { if (d.owner) m[d.owner] = 1; }); return Object.keys(m).sort(); }
  function tagStats() {
    var m = {}; S.docs.forEach(function (d) { (d.tags || []).forEach(function (g) { var k = g.toLowerCase(); m[k] = m[k] || { tag: g, n: 0 }; m[k].n++; }); });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.n - a.n || a.tag.localeCompare(b.tag); });
  }
  function hasSearch() { var f = S.f; return !!(S.q.trim() || f.drawerId || f.folderId || f.owner || f.tag || f.from || f.to || f.status || f.conf); }
  function matches(d) {
    var f = S.f;
    if (f.drawerId && d.drawerId !== f.drawerId) return false;
    if (f.folderId && d.folderId !== f.folderId) return false;
    if (f.owner && d.owner !== f.owner) return false;
    if (f.tag && (d.tags || []).map(function (x) { return x.toLowerCase(); }).indexOf(f.tag.toLowerCase()) < 0) return false;
    if (f.from && d.date < f.from) return false;
    if (f.to && d.date > f.to) return false;
    if (f.status && d.status !== f.status) return false;
    if (f.conf && d.conf !== f.conf) return false;
    var toks = norm(S.q).split(/\s+/).filter(Boolean);
    for (var i = 0; i < toks.length; i++) if (d._hay.indexOf(toks[i]) < 0) return false;
    return true;
  }
  function sortDocs(list) {
    var k = S.sort.key, dir = S.sort.dir;
    return list.slice().sort(function (a, b) {
      var x = k === 'title' || k === 'owner' ? String(a[k]).localeCompare(String(b[k]), S.lang) : String(a[k] || '').localeCompare(String(b[k] || ''), 'en', { numeric: true });
      return (x || String(a.id).localeCompare(b.id)) * dir;
    });
  }

  /* ---------------- shell ---------------- */
  function brandBar() { return '<div class="brand-bar" dir="ltr">' + logo('ictd', 'ICTD', 'ICTD') + logo('sru', 'Sulaiman Al Rajhi University', 'SRU') + '</div>'; }
  function band() {
    var u = S.user;
    return '<div class="band sru-tech-bg"><div class="band-inner"><div class="app-mark">' + icon('archive') + '</div>' +
      '<div><h1>' + esc(t('appName')) + ' <span class="ver">v' + esc(CFG.VERSION) + '</span></h1><div class="sub">' + esc(t('appSub')) + '</div></div>' +
      '<div class="band-actions">' + (u ? '<span class="chip">' + icon('user') + '<bdi>' + esc(u.name) + '</bdi> · ' + esc(t('role_' + u.role)) + '</span>' : '') +
      (u && isAdmin() ? '<button class="btn ghost" data-act="admin-users">' + icon('shield-check') + esc(t('manageAccess')) + '</button>' : '') +
      (u && isAdmin() ? '<button class="btn ghost" data-act="audit-log">' + icon('scroll-text') + esc(t('auditLog')) + '</button>' : '') +
      themeBtn('btn ghost') +
      '<button class="btn ghost" data-act="lang">' + icon('languages') + esc(t('lang')) + '</button>' +
      (u ? '<button class="btn ghost" data-act="signout">' + icon('log-out') + esc(t('signOut')) + '</button>' : '') + '</div></div></div>';
  }
  function footer() {
    return '<footer class="site sru-tech-bg-dark"><div class="foot-inner" dir="ltr">' +
      '<a class="itoc" href="' + esc(CFG.ITOC_HUB_URL) + '" target="_blank" rel="noopener">' + logo('itoc', 'ITOC', 'ITOC') + '</a>' +
      '<div class="grow" dir="' + (S.lang === 'ar' ? 'rtl' : 'ltr') + '">' + esc(t('footerRights')) + '</div>' +
      '<span class="ver">' + esc(t('version')) + ' ' + esc(CFG.VERSION) + '</span>' +
      '<a class="support" href="mailto:' + esc(CFG.SUPPORT_EMAIL) + '">' + icon('info') + ' ' + esc(t('forSupport')) + '</a></div></footer>';
  }
  function setDir() { document.documentElement.lang = S.lang; document.documentElement.dir = S.lang === 'ar' ? 'rtl' : 'ltr'; document.title = t('appName') + ' · ICTD'; }

  function gLogo() {
    return '<span class="gwrap"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
      '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
      '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
      '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
      '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>';
  }
  function loginHeader() {
    return '<div class="brand-bar login-bar" dir="ltr">' + logo('ictd', 'ICTD', 'ICTD') +
      themeBtn('lang-mini') +
      '<button class="lang-mini" data-act="lang">' + icon('languages') + '<span>' + esc(t('lang')) + '</span></button>' +
      logo('sru', 'Sulaiman Al Rajhi University', 'SRU') + '</div><div class="brand-rule sru-tech-bg"></div>';
  }
  function renderLogin(msg) {
    setDir();
    var cfgOk = configured();
    root.innerHTML = '<div class="login">' + loginHeader() +
      '<div class="stage"><div class="login-card">' +
      '<div class="lc-logo">' + logo('ictd', 'ICTD', 'ICTD') + '</div>' +
      '<h2>' + esc(t('appName')) + '</h2>' +
      '<p class="plat">' + esc(t('signinPlatform')) + '</p>' +
      (msg ? '<div class="cfgwarn" role="alert">' + esc(msg) + '</div>' : '') +
      '<div class="infobox">' + icon('mail') + '<span>' + esc(t('signinInfo')) + '</span></div>' +
      (cfgOk
        ? '<div class="uni-signin"><button type="button" class="btn uni" id="uni-btn">' + gLogo() + '<span>' + esc(t('signinUniBtn')) + '</span></button>' +
          '<div id="gbtn" class="gbtn-overlay" aria-hidden="false"></div></div>' +
          '<ol class="steps"><li><span class="n">1</span><span>' + esc(t('step1')) + '</span></li>' +
          '<li><span class="n">2</span><span>' + esc(t('step2')) + '</span></li>' +
          '<li><span class="n">3</span><span>' + esc(t('step3')) + '</span></li></ol>' +
          '<label class="skip"><input type="checkbox" id="skip-next"' + (store('ictd_lib_skip') === '1' ? ' checked' : '') + '> ' + esc(t('skipNext')) + '</label>'
        : '<div class="cfgwarn">' + esc(t('notConfigured')) + '</div>') +
      '<div class="lc-foot">' + esc(t('signinFoot')) + '</div>' +
      '<div class="lc-demo"><a class="btn secondary sm" href="?demo=1">' + icon('eye') + esc(t('tryDemo')) + '</a></div>' +
      '</div></div>' + footer() + '</div>';
    var skip = $('#skip-next');
    if (skip) skip.addEventListener('change', function () { store('ictd_lib_skip', skip.checked ? '1' : '0'); });
    var ub = $('#uni-btn');
    if (ub) ub.addEventListener('click', function () { try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.prompt(); } catch (e) { /* ignore */ } });
    if (cfgOk) initGoogle(function (ok) {
      var host = $('#gbtn'); if (!ok || !host) return;
      google.accounts.id.renderButton(host, { type: 'standard', theme: 'filled_blue', size: 'large', shape: 'rectangular', text: 'signin_with', width: 360, locale: S.lang });
      if (ub) ub.style.pointerEvents = 'none'; // the invisible Google button on top now handles the click
    });
  }

  function renderApp() {
    setDir();
    root.innerHTML = (DEMO ? '<div class="demo-ribbon">' + esc(t('demoBadge')) + '</div>' : '') + brandBar() + band() +
      '<div class="toolbar"><div class="toolbar-inner"><div class="searchbox">' + icon('search') +
      '<input id="q" type="text" inputmode="search" autocomplete="off" placeholder="' + esc(t('searchPh')) + '" value="' + esc(S.q) + '" aria-label="' + esc(t('searchPh')) + '">' +
      '<button class="clear' + (S.q ? '' : ' hidden') + '" id="qclear" data-act="clear-q" aria-label="' + esc(t('clearFilters')) + '">' + icon('x') + '</button></div>' +
      '<button class="btn secondary" data-act="toggle-filters">' + icon('sliders-horizontal') + esc(t('filters')) + '</button>' +
      (isEditor() ? '<button class="btn secondary" data-act="bulk-upload">' + icon('upload') + esc(t('bulkUpload')) + '</button>' : '') +
      (isEditor() ? '<button class="btn" data-act="add-doc">' + icon('file-plus') + esc(t('addDoc')) + '</button>' : '') + '</div></div>' +
      '<div id="filters"></div><main id="view"></main>' + footer();
    renderFilters();
  }

  /* ---------------- filters ---------------- */
  function sel(id, label, opts, val) {
    return '<div><label class="f" for="' + id + '">' + esc(label) + '</label><select class="in" id="' + id + '"><option value="">' + esc(t('all')) + '</option>' +
      opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
  }
  function renderFilters() {
    var host = $('#filters'); if (!host) return;
    if (!S.showFilters) { host.innerHTML = ''; return; }
    var f = S.f, tags = tagStats();
    var folders = S.folders.filter(function (x) { return !f.drawerId || x.drawerId === f.drawerId; });
    host.innerHTML = '<div class="filters"><div class="filters-grid">' +
      sel('f-drawer', t('fSubject'), S.drawers.map(function (d) { return [d.id, nm(d)]; }), f.drawerId) +
      sel('f-folder', t('fFolder'), folders.map(function (x) { return [x.id, nm(x)]; }), f.folderId) +
      sel('f-owner', t('fOwner'), owners().map(function (o) { return [o, o]; }), f.owner) +
      sel('f-tag', t('fTag'), tags.map(function (g) { return [g.tag, g.tag]; }), f.tag) +
      '<div><label class="f" for="f-from">' + esc(t('fFrom')) + '</label><input class="in" type="date" id="f-from" value="' + esc(f.from) + '"></div>' +
      '<div><label class="f" for="f-to">' + esc(t('fTo')) + '</label><input class="in" type="date" id="f-to" value="' + esc(f.to) + '"></div>' +
      sel('f-status', t('fStatus'), STATUSES.map(function (s) { return [s, t('status_' + s)]; }), f.status) +
      sel('f-conf', t('fConf'), CONFS.map(function (s) { return [s, t('conf_' + s)]; }), f.conf) +
      '</div><div class="tagcloud"><button class="btn secondary sm" data-act="clear-filters">' + icon('x') + esc(t('clearFilters')) + '</button>' +
      (tags.length ? '<span>' + esc(t('popularTags')) + ':</span>' + tags.slice(0, 12).map(function (g) {
        return '<button class="tag' + (f.tag.toLowerCase() === g.tag.toLowerCase() ? ' on' : '') + '" data-act="tag" data-tag="' + esc(g.tag) + '">#' + esc(g.tag) + ' · ' + g.n + '</button>';
      }).join('') : '') + '</div></div>';
  }

  /* ---------------- routing ---------------- */
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function route() {
    if (!S.user) return;
    var h = location.hash || '#/'; var m;
    if ((m = h.match(/^#\/d\/([\w-]+)/))) S.view = { name: 'drawer', id: m[1] };
    else if ((m = h.match(/^#\/f\/([\w-]+)/))) S.view = { name: 'folder', id: m[1] };
    else if (h === '#/s') S.view = { name: 'search' };
    else S.view = { name: 'cabinet' };
    renderView(); window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  function crumbs(items) {
    var sep = '<span class="sep">' + icon('chevron-right') + '</span>';
    return '<nav class="crumbs" aria-label="breadcrumb">' + items.map(function (it, i) {
      var last = i === items.length - 1;
      return last ? '<span><bdi>' + esc(it[0]) + '</bdi></span>' : '<a href="' + esc(it[1]) + '"><bdi>' + esc(it[0]) + '</bdi></a>' + sep;
    }).join('') + '</nav>';
  }

  function renderView() {
    var host = $('#view'); if (!host) return;
    var v = S.view, html = '';
    if (v.name === 'drawer') html = viewDrawer(v.id);
    else if (v.name === 'folder') html = viewFolder(v.id);
    else if (v.name === 'search') html = viewSearch();
    else html = viewCabinet();
    host.innerHTML = html;
    var qc = $('#qclear'); if (qc) qc.classList.toggle('hidden', !S.q);
  }

  function viewCabinet() {
    var html = '<div class="page-head"><h2>' + icon('archive') + ' ' + esc(t('cabinet')) + '</h2><span class="grow"></span>' +
      (isAdmin() ? '<button class="btn secondary" data-act="new-drawer">' + icon('plus') + esc(t('newDrawer')) + '</button>' : '') + '</div>' +
      '<div class="cabinet"><div class="cab-top"><span class="cab-plate"><bdi>' + esc(t('cabinetPlate')) + '</bdi></span><span class="cab-lock">' + icon('lock') + '</span></div><div class="drawers-row">';
    if (!S.drawers.length) html += '<div class="empty" style="color:#fff;grid-column:1/-1">' + esc(t('nothingHere')) + '</div>';
    S.drawers.forEach(function (d) {
      var n = S.cnt.d[d.id] || 0, sub = nm2(d);
      html += '<button class="drawer' + (d.active ? '' : ' inactive') + '" style="--accent:' + safeColor(d.color) + '" data-act="open-drawer" data-id="' + esc(d.id) + '" aria-label="' + esc(nm(d)) + '">' +
        '<span class="holder"><b>' + icon(iconName(d.icon)) + '<bdi>' + esc(nm(d)) + '</bdi></b>' + (sub ? '<small><bdi>' + esc(sub) + '</bdi></small>' : '') + '</span>' +
        '<span class="count">' + icon('file-text') + n + '</span><span class="handle"></span></button>';
    });
    html += '</div><div class="cab-base"></div></div><div class="cab-below">' + statsCard() + recentCard() + '</div>';
    return html;
  }
  function statsCard() {
    return '<div class="card" style="margin-bottom:16px"><h3>' + icon('layers') + esc(t('stats')) + '</h3><div class="stats">' +
      '<div class="stat"><b>' + S.drawers.length + '</b><span>' + esc(t('drawers')) + '</span></div>' +
      '<div class="stat"><b>' + S.folders.length + '</b><span>' + esc(t('folders')) + '</span></div>' +
      '<div class="stat"><b>' + S.docs.length + '</b><span>' + esc(t('documents')) + '</span></div></div></div>';
  }
  function recentCard() {
    var list = S.docs.slice().sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id).localeCompare(a.id); }).slice(0, 6);
    return '<div class="card"><h3>' + icon('clock') + esc(t('recent')) + '</h3>' + (list.length ? '<ul class="recent">' + list.map(function (d) {
      var dr = S.dById[d.drawerId] || {};
      return '<li data-act="doc-details" data-id="' + esc(d.id) + '">' + icon(fileIcon(d)) + '<div><div class="t"><bdi>' + esc(d.title) + '</bdi></div><div class="m"><bdi>' + esc(nm(dr)) + '</bdi> · ' + esc(d.date) + '</div></div></li>';
    }).join('') + '</ul>' : '<div class="empty">' + esc(t('noRecent')) + '</div>') + '</div>';
  }

  function viewDrawer(id) {
    var d = S.dById[id]; if (!d) { go('#/'); return ''; }
    var fl = S.folders.filter(function (f) { return f.drawerId === id; });
    var html = crumbs([[t('cabinet'), '#/'], [nm(d), '']]) +
      '<div class="page-head"><h2>' + icon(iconName(d.icon)) + ' <bdi>' + esc(nm(d)) + '</bdi></h2><span class="chip" style="background:var(--purple-light);color:var(--purple);border-color:var(--border)">' + esc(cntLabel(S.cnt.d[id] || 0)) + '</span><span class="grow"></span>' +
      (isAdmin() ? '<button class="btn secondary" data-act="edit-drawer" data-id="' + esc(id) + '">' + icon('pencil') + esc(t('edit')) + '</button>' : '') + '</div>' +
      '<div class="drawer-open" style="--accent:' + safeColor(d.color) + '"><span class="drawer-plate">' + icon(iconName(d.icon)) + '<bdi>' + esc(nm(d)) + '</bdi></span><div class="folders">';
    fl.forEach(function (f) {
      var sub = nm2(f);
      html += '<div class="manila' + (f.active ? '' : ' inactive') + (f.access === 'restricted' ? ' locked' : '') + '" role="button" tabindex="0" data-act="open-folder" data-id="' + esc(f.id) + '"><span class="nm">' +
        (f.access === 'restricted' ? '<span class="lock" title="' + esc(t('accRestricted')) + '" aria-label="' + esc(t('accRestricted')) + '">' + icon('lock') + '</span>' : '') +
        '<bdi>' + esc(nm(f)) + '</bdi></span>' +
        (sub ? '<span class="en"><bdi>' + esc(sub) + '</bdi></span>' : '') +
        (fManage(f) ? '<button class="icon-btn key" data-act="folder-access" data-id="' + esc(f.id) + '" aria-label="' + esc(t('folderAccess')) + '" title="' + esc(t('folderAccess')) + '">' + icon('key-round') + '</button>' +
          '<button class="icon-btn pen" data-act="edit-folder" data-id="' + esc(f.id) + '" aria-label="' + esc(t('edit')) + '">' + icon('pencil') + '</button>' +
          '<button class="icon-btn del2 danger" data-act="del-folder" data-id="' + esc(f.id) + '" aria-label="' + esc(t('delFolder')) + '" title="' + esc(t('delFolder')) + '">' + icon('trash-2') + '</button>' : '') +
        '<span class="cnt">' + (S.cnt.f[f.id] || 0) + '</span></div>';
    });
    if (isEditor()) html += '<div class="manila add" role="button" tabindex="0" data-act="new-folder" data-id="' + esc(id) + '"><span>' + icon('folder-plus') + '<br>' + esc(t('newFolder')) + '</span></div>';
    html += '</div>' + (!fl.length && !isEditor() ? '<div class="empty" style="color:#fff">' + esc(t('emptyDrawer')) + '</div>' : '') + '</div>';
    return html;
  }

  function viewFolder(id) {
    var f = S.fById[id]; if (!f) { go('#/'); return ''; }
    var d = S.dById[f.drawerId] || {};
    var list = S.docs.filter(function (x) { return x.folderId === id; });
    return crumbs([[t('cabinet'), '#/'], [nm(d), '#/d/' + d.id], [nm(f), '']]) +
      '<div class="page-head"><h2>' + icon('folder-open') + ' <bdi>' + esc(nm(f)) + '</bdi></h2><span class="chip" style="background:var(--purple-light);color:var(--purple);border-color:var(--border)">' + esc(cntLabel(list.length)) + '</span>' +
      (f.access === 'restricted' ? '<span class="chip lockchip">' + icon('lock') + esc(t('accRestricted')) + '</span>' : '') + '<span class="grow"></span>' +
      (fEdit(f) ? '<button class="btn secondary" data-act="bulk-upload" data-drawer="' + esc(d.id) + '" data-folder="' + esc(id) + '">' + icon('upload') + esc(t('bulkUpload')) + '</button>' : '') +
      (fEdit(f) ? '<button class="btn" data-act="add-doc" data-drawer="' + esc(d.id) + '" data-folder="' + esc(id) + '">' + icon('file-plus') + esc(t('addDoc')) + '</button>' : '') +
      (fManage(f) ? '<button class="btn secondary" data-act="folder-access" data-id="' + esc(id) + '">' + icon('key-round') + esc(t('folderAccess')) + '</button>' : '') +
      (fManage(f) ? '<button class="btn secondary" data-act="edit-folder" data-id="' + esc(id) + '">' + icon('pencil') + esc(t('edit')) + '</button>' : '') + '</div>' +
      docTable(list, false, t('emptyFolder'));
  }

  function filterChips() {
    var f = S.f, c = [];
    function add(k, label) { c.push('<button class="tag on" data-act="rm-f" data-k="' + k + '">' + esc(label) + ' ✕</button>'); }
    if (S.q.trim()) add('q', '“' + S.q.trim() + '”');
    if (f.drawerId && S.dById[f.drawerId]) add('drawerId', t('drawer') + ': ' + nm(S.dById[f.drawerId]));
    if (f.folderId && S.fById[f.folderId]) add('folderId', t('folder') + ': ' + nm(S.fById[f.folderId]));
    if (f.owner) add('owner', t('fOwner') + ': ' + f.owner);
    if (f.tag) add('tag', '#' + f.tag);
    if (f.from) add('from', t('fFrom') + ': ' + f.from);
    if (f.to) add('to', t('fTo') + ': ' + f.to);
    if (f.status) add('status', t('status_' + f.status));
    if (f.conf) add('conf', t('conf_' + f.conf));
    return c.length ? '<div class="tagcloud" style="margin:0 0 12px">' + c.join('') + '</div>' : '';
  }
  function viewSearch() {
    var list = S.docs.filter(matches);
    return crumbs([[t('cabinet'), '#/'], [t('results'), '']]) +
      '<div class="page-head"><h2>' + icon('search') + ' ' + list.length + ' ' + esc(t('results')) + '</h2><span class="grow"></span>' +
      '<button class="btn secondary" data-act="clear-all">' + icon('x') + esc(t('clearFilters')) + '</button></div>' + filterChips() + docTable(list, true, t('noResults'));
  }

  function docTable(list, showPath, emptyMsg) {
    if (!list.length) return '<div class="tbl-wrap"><div class="empty">' + icon('file-text') + esc(emptyMsg) + '</div></div>';
    var arrow = function (k) { return S.sort.key === k ? ' <span>' + (S.sort.dir > 0 ? '▲' : '▼') + '</span>' : ''; };
    var th = function (k, l) { return '<th data-act="sort" data-k="' + k + '">' + esc(l) + arrow(k) + '</th>'; };
    var html = '<div class="tbl-wrap"><table class="docs"><thead><tr>' + th('title', t('colTitle')) + (showPath ? '<th class="nosort">' + esc(t('colFolder')) + '</th>' : '') +
      th('date', t('colDate')) + th('owner', t('colOwner')) + '<th class="nosort">' + esc(t('colTags')) + '</th>' + th('version', t('colVer')) + '<th class="nosort">' + esc(t('colActions')) + '</th></tr></thead><tbody>';
    sortDocs(list).forEach(function (d) {
      var dr = S.dById[d.drawerId] || {}, fo = S.fById[d.folderId] || {};
      html += '<tr><td data-l="' + esc(t('colTitle')) + '"><div class="dt">' + icon(fileIcon(d), 'fi') + '<div><a data-act="doc-details" data-id="' + esc(d.id) + '"><bdi>' + esc(d.title) + '</bdi></a>' +
        (d.description ? '<small><bdi>' + esc(d.description.length > 120 ? d.description.slice(0, 120) + '…' : d.description) + '</bdi></small>' : '') +
        '<div>' + (d.conf !== 'General' ? '<span class="badge conf-' + esc(d.conf) + '">' + esc(t('conf_' + d.conf)) + '</span> ' : '') +
        (d.status !== 'Active' ? '<span class="badge st">' + esc(t('status_' + d.status)) + '</span>' : '') + '</div></div></div></td>' +
        (showPath ? '<td data-l="' + esc(t('colFolder')) + '"><span class="path"><bdi>' + esc(nm(dr)) + '</bdi> › <bdi>' + esc(nm(fo)) + '</bdi></span></td>' : '') +
        '<td data-l="' + esc(t('colDate')) + '"><span class="latin">' + esc(d.date) + '</span></td><td data-l="' + esc(t('colOwner')) + '"><bdi>' + esc(d.owner) + '</bdi></td>' +
        '<td data-l="' + esc(t('colTags')) + '">' + (d.tags || []).map(function (g) { return '<button class="tag" data-act="tag" data-tag="' + esc(g) + '">#' + esc(g) + '</button>'; }).join('') + '</td>' +
        '<td data-l="' + esc(t('colVer')) + '"><span class="latin">' + esc(d.version) + '</span></td><td><div class="actions">' +
        '<button class="icon-btn" data-act="open-doc" data-id="' + esc(d.id) + '" title="' + esc(t('open')) + '" aria-label="' + esc(t('open')) + '">' + icon('external-link') + '</button>' +
        '<button class="icon-btn" data-act="doc-details" data-id="' + esc(d.id) + '" title="' + esc(t('details')) + '" aria-label="' + esc(t('details')) + '">' + icon('info') + '</button>' +
        (d.canEdit ? '<button class="icon-btn" data-act="edit-doc" data-id="' + esc(d.id) + '" title="' + esc(t('edit')) + '" aria-label="' + esc(t('edit')) + '">' + icon('pencil') + '</button>' +
          '<button class="icon-btn danger" data-act="del-doc" data-id="' + esc(d.id) + '" title="' + esc(t('del')) + '" aria-label="' + esc(t('del')) + '">' + icon('trash-2') + '</button>' : '') + '</div></td></tr>';
    });
    return html + '</tbody></table></div>';
  }

  /* ---------------- modals ---------------- */
  function modal(title, body, foot, opt) {
    removeModal(); opt = opt || {};
    var el = document.createElement('div'); el.className = 'overlay'; el.id = 'modal';
    el.innerHTML = '<div class="dialog ' + (opt.cls || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><h3>' + esc(title) + '</h3>' +
      '<button class="icon-btn" data-act="close-modal" aria-label="' + esc(t('close')) + '">' + icon('x') + '</button></header><div class="body">' + body + '</div>' + (foot ? '<footer>' + foot + '</footer>' : '') + '</div>';
    if (!opt.sticky) el.addEventListener('mousedown', function (e) { if (e.target === el) closeModal(); });
    document.body.appendChild(el);
    var first = $('input:not([type=file]),select,textarea', el); if (first && opt.focus !== false) first.focus();
    return el;
  }
  function removeModal() { var m = $('#modal'); if (m) m.remove(); }
  function closeModal() { removeModal(); FORM = {}; }

  function folderOptions(drawerId, sel) {
    return S.folders.filter(function (f) { return f.drawerId === drawerId; }).map(function (f) {
      return '<option value="' + esc(f.id) + '"' + (f.id === sel ? ' selected' : '') + '>' + esc(nm(f)) + '</option>';
    }).join('');
  }
  function renderFormTags() {
    var box = $('#m-tags'); if (!box) return;
    box.innerHTML = FORM.tags.map(function (g, i) { return '<span class="tag">#' + esc(g) + '<button type="button" data-act="rm-tag" data-i="' + i + '" aria-label="remove">✕</button></span>'; }).join('') +
      '<input id="m-taginput" placeholder="' + esc(t('fTagsHint')) + '" maxlength="40">';
  }
  function addFormTag(v) {
    v = String(v || '').replace(/^#/, '').trim().slice(0, 40); if (!v) return;
    if (FORM.tags.some(function (x) { return x.toLowerCase() === v.toLowerCase(); }) || FORM.tags.length >= 20) return;
    FORM.tags.push(v); renderFormTags();
    var i = $('#m-taginput'); if (i) i.focus();
  }

  function openDocForm(doc, pre) {
    var edit = !!doc;
    var d = doc || { title: '', drawerId: (pre && pre.drawerId) || (S.drawers[0] && S.drawers[0].id) || '', folderId: (pre && pre.folderId) || '', date: todayISO(), owner: S.user.name,
      tags: [], description: '', version: '1.0', status: 'Active', conf: S.config.defaultConf || 'Internal' };
    if (!d.folderId) { var ff = S.folders.filter(function (x) { return x.drawerId === d.drawerId; })[0]; d.folderId = ff ? ff.id : ''; }
    FORM = { tags: (d.tags || []).slice(), file: null, src: 'upload', editId: edit ? doc.id : '' };
    var names = {}; (CFG.TEAM_NAMES || []).concat(owners(), [S.user.name]).forEach(function (n) { if (n) names[n] = 1; });
    var maxMB = Math.min(S.config.maxUploadMB || 20, CFG.MAX_UPLOAD_MB || 20);
    var body = '<form id="docform" novalidate>' +
      '<div class="field"><label class="f" for="m-title">' + esc(t('fTitle')) + ' <span class="req">*</span></label><input class="in" id="m-title" maxlength="250" value="' + esc(d.title) + '"></div>' +
      '<div class="row2"><div class="field"><label class="f" for="m-drawer">' + esc(t('fDrawer')) + ' <span class="req">*</span></label><select class="in" id="m-drawer">' +
      S.drawers.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === d.drawerId ? ' selected' : '') + '>' + esc(nm(x)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="f" for="m-folder">' + esc(t('fFolder')) + ' <span class="req">*</span></label><select class="in" id="m-folder">' + folderOptions(d.drawerId, d.folderId) + '</select></div></div>' +
      '<div class="row3"><div class="field"><label class="f" for="m-date">' + esc(t('fDate')) + ' <span class="req">*</span></label><input class="in" type="date" id="m-date" value="' + esc(d.date) + '"></div>' +
      '<div class="field"><label class="f" for="m-owner">' + esc(t('fOwner')) + ' <span class="req">*</span></label><input class="in" id="m-owner" list="m-owners" maxlength="100" value="' + esc(d.owner) + '"><datalist id="m-owners">' +
      Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>' +
      '<div class="field"><label class="f" for="m-version">' + esc(t('fVersion')) + '</label><input class="in" id="m-version" maxlength="20" value="' + esc(d.version) + '"></div></div>' +
      '<div class="row2"><div class="field"><label class="f" for="m-status">' + esc(t('fStatus')) + '</label><select class="in" id="m-status">' +
      STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === d.status ? ' selected' : '') + '>' + esc(t('status_' + s)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="f" for="m-conf">' + esc(t('fConf')) + '</label><select class="in" id="m-conf">' +
      CONFS.map(function (s) { return '<option value="' + s + '"' + (s === d.conf ? ' selected' : '') + '>' + esc(t('conf_' + s)) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><label class="f">' + esc(t('fTags')) + '</label><div class="tagbox" id="m-tags"></div></div>' +
      '<div class="field"><label class="f" for="m-desc">' + esc(t('fDesc')) + '</label><textarea class="in" id="m-desc" maxlength="2000">' + esc(d.description) + '</textarea></div>' +
      (edit ? '' : '<div class="tabs"><button type="button" class="on" data-act="src" data-v="upload">' + icon('upload') + ' ' + esc(t('srcUpload')) + '</button><button type="button" data-act="src" data-v="link">' + icon('link') + ' ' + esc(t('srcLink')) + '</button></div>' +
        '<div id="src-upload"><input type="file" id="m-file" class="sr-only"><label class="drop" id="m-drop" for="m-file"><div>' + icon('upload') + '</div><div id="m-fname"><b>' + esc(t('dropHere')) + '</b></div><small>' + esc(t('maxSize')) + ': ' + maxMB + ' MB</small></label></div>' +
        '<div id="src-link" class="hidden"><label class="f" for="m-link">' + esc(t('fLink')) + '</label><input class="in latin" style="display:block" id="m-link" placeholder="https://drive.google.com/file/d/…"></div>') +
      '<div class="err" id="m-err" role="alert"></div></form>';
    var foot = '<button class="btn secondary" data-act="close-modal">' + esc(t('cancel')) + '</button><button class="btn" id="m-save" data-act="save-doc">' + icon('check') + esc(t('save')) + '</button>';
    modal(edit ? t('editDoc') : t('addDocTitle'), body, foot, { sticky: true });
    renderFormTags();
  }

  function saveDoc() {
    var err = $('#m-err'), btn = $('#m-save'); err.textContent = '';
    var p = { title: $('#m-title').value.trim(), drawerId: $('#m-drawer').value, folderId: $('#m-folder').value, date: $('#m-date').value, owner: $('#m-owner').value.trim(),
      version: $('#m-version').value.trim() || '1.0', status: $('#m-status').value, conf: $('#m-conf').value, tags: FORM.tags.slice(), description: $('#m-desc').value.trim() };
    var pending = $('#m-taginput'); if (pending && pending.value.trim()) { FORM.tags.push(pending.value.trim().replace(/^#/, '')); p.tags = FORM.tags.slice(); }
    if (!p.title || !p.drawerId || !p.folderId || !p.date || !p.owner) { err.textContent = t('errRequired'); return; }
    p.ownerEmail = p.owner === S.user.name ? S.user.email : '';
    var prior = FORM.editId ? S.docs.filter(function (x) { return x.id === FORM.editId; })[0] : null;
    if (prior && p.owner === prior.owner) p.ownerEmail = prior.ownerEmail || '';
    var action, prep;
    if (FORM.editId) { p.id = FORM.editId; action = 'updateDocument'; prep = Promise.resolve(); }
    else {
      action = 'addDocument';
      if (FORM.src === 'upload') {
        var file = FORM.file;
        if (!file) { err.textContent = t('errNeedFile'); return; }
        var maxMB = Math.min(S.config.maxUploadMB || 20, CFG.MAX_UPLOAD_MB || 20);
        if (file.size > maxMB * 1048576) { err.textContent = t('errTooBig') + ' (' + maxMB + ' MB)'; return; }
        prep = new Promise(function (res, rej) {
          var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = rej; r.readAsDataURL(file);
        }).then(function (b64) { p.upload = { name: file.name, mime: file.type || 'application/octet-stream', data: b64 }; });
      } else {
        var link = $('#m-link').value.trim();
        if (!/^https:\/\/(drive|docs)\.google\.com\//.test(link)) { err.textContent = t('errNeedFile'); return; }
        p.link = link; prep = Promise.resolve();
      }
    }
    btn.disabled = true; btn.innerHTML = icon('loader-circle', 'spin') + esc(p.upload ? t('uploading') : t('saving'));
    prep.then(function () { return api(action, p); }).then(function (doc) {
      if (FORM.editId) S.docs = S.docs.map(function (x) { return x.id === doc.id ? doc : x; }); else S.docs.push(doc);
      reindex(); closeModal(); renderFilters(); renderView(); toast(t('saved'));
    }).catch(function (e) { btn.disabled = false; btn.innerHTML = icon('check') + esc(t('save')); handleErr(e, err); });
  }

  /* ---------------- bulk upload ---------------- */
  var BULK = { items: [] };
  function toB64(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = rej; r.readAsDataURL(file); }); }
  function bulkMaxMB() { return Math.min(S.config.maxUploadMB || 20, CFG.MAX_UPLOAD_MB || 20); }
  function openBulkUpload(pre) {
    pre = pre || {};
    BULK = { items: [] };
    var drawerId = pre.drawerId || (S.drawers[0] && S.drawers[0].id) || '';
    var folderId = pre.folderId || '';
    if (!folderId) { var ff = S.folders.filter(function (x) { return x.drawerId === drawerId; })[0]; folderId = ff ? ff.id : ''; }
    var maxMB = bulkMaxMB();
    var body = '<div class="row2"><div class="field"><label class="f" for="bk-drawer">' + esc(t('fDrawer')) + '</label><select class="in" id="bk-drawer">' +
      S.drawers.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === drawerId ? ' selected' : '') + '>' + esc(nm(x)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="f" for="bk-folder">' + esc(t('fFolder')) + '</label><select class="in" id="bk-folder">' + folderOptions(drawerId, folderId) + '</select></div></div>' +
      '<input type="file" id="bk-file" multiple class="sr-only"><label class="drop" id="bk-drop" for="bk-file"><div>' + icon('upload') + '</div><div><b>' + esc(t('bulkChoose')) + '</b></div><small>' + esc(t('maxSize')) + ': ' + maxMB + ' MB · ' + esc(t('bulkCap')) + '</small></label>' +
      '<div id="bk-rows"></div><div class="err" id="m-err" role="alert"></div>';
    var foot = '<button class="btn secondary" data-act="close-modal">' + esc(t('close')) + '</button><button class="btn" id="bk-go" data-act="bulk-go" disabled>' + icon('upload') + esc(t('uploadAll')) + '</button>';
    modal(t('bulkTitle'), body, foot, { sticky: true, focus: false, cls: 'wide' });
  }
  function addBulkFiles(list) {
    if (!list) return;
    var maxMB = bulkMaxMB(), names = {}; (CFG.TEAM_NAMES || []).concat([S.user.name]).forEach(function (n) { if (n) names[n] = 1; });
    Array.prototype.forEach.call(list, function (f) {
      if (BULK.items.length >= 50) return;
      var d = f.lastModified ? new Date(f.lastModified) : new Date();
      var iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      BULK.items.push({ file: f, title: f.name.replace(/\.[^.]+$/, '').slice(0, 250), date: iso, owner: S.user.name,
        tags: '', conf: S.config.defaultConf || 'Internal', version: '1.0', tooBig: f.size > maxMB * 1048576, status: '' });
    });
    renderBulkRows();
  }
  function renderBulkRows() {
    var host = $('#bk-rows'); if (!host) return;
    if (!BULK.items.length) { host.innerHTML = ''; var g0 = $('#bk-go'); if (g0) g0.disabled = true; return; }
    var rows = BULK.items.map(function (it, i) {
      return '<tr data-i="' + i + '"><td data-l="' + esc(t('fFile')) + '">' + icon(fileIcon({ fileName: it.file.name })) + ' <bdi>' + esc(it.file.name) + '</bdi><div class="path">' + esc(fmtSize(it.file.size)) + (it.tooBig ? ' · <span class="req">' + esc(t('errTooBig')) + '</span>' : '') + '</div></td>' +
        '<td data-l="' + esc(t('colTitle')) + '"><input class="in bk-t" value="' + esc(it.title) + '" maxlength="250"></td>' +
        '<td data-l="' + esc(t('colDate')) + '"><input class="in bk-d" type="date" value="' + esc(it.date) + '"></td>' +
        '<td data-l="' + esc(t('colOwner')) + '"><input class="in bk-o" value="' + esc(it.owner) + '" maxlength="100"></td>' +
        '<td data-l="' + esc(t('fConf')) + '"><select class="in bk-c">' + CONFS.map(function (s) { return '<option value="' + s + '"' + (s === it.conf ? ' selected' : '') + '>' + esc(t('conf_' + s)) + '</option>'; }).join('') + '</select></td>' +
        '<td data-l="' + esc(t('colVer')) + '"><input class="in bk-v" value="' + esc(it.version) + '" maxlength="20" style="width:64px"></td>' +
        '<td class="bk-st">' + (it.status || '') + '</td>' +
        '<td><button class="icon-btn danger" data-act="bulk-del" data-i="' + i + '" aria-label="' + esc(t('del')) + '">' + icon('x') + '</button></td></tr>';
    }).join('');
    host.innerHTML = '<div class="tbl-wrap" style="margin-top:12px"><table class="docs bktbl"><thead><tr><th class="nosort">' + esc(t('fFile')) + '</th><th class="nosort">' + esc(t('colTitle')) + '</th><th class="nosort">' + esc(t('colDate')) + '</th><th class="nosort">' + esc(t('colOwner')) + '</th><th class="nosort">' + esc(t('fConf')) + '</th><th class="nosort">' + esc(t('colVer')) + '</th><th class="nosort">' + esc(t('colStatus')) + '</th><th class="nosort"></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    var g = $('#bk-go'); if (g) g.disabled = false;
  }
  function startBulkUpload() {
    var err = $('#m-err'); err.textContent = '';
    if (!BULK.items.length) { err.textContent = t('bulkNoFiles'); return; }
    var drawerId = $('#bk-drawer').value, folderId = $('#bk-folder').value;
    if (!folderId) { err.textContent = t('errRequired'); return; }
    // snapshot per-row field values from the DOM
    $$('#bk-rows tbody tr').forEach(function (tr) {
      var i = Number(tr.getAttribute('data-i')), it = BULK.items[i]; if (!it) return;
      it.title = $('.bk-t', tr).value.trim(); it.date = $('.bk-d', tr).value; it.owner = $('.bk-o', tr).value.trim();
      it.conf = $('.bk-c', tr).value; it.version = $('.bk-v', tr).value.trim() || '1.0';
    });
    var go = $('#bk-go'), close = $('[data-act="close-modal"]'); go.disabled = true; if (close) close.disabled = true;
    var ok = 0, i = 0;
    function setStatus(idx, html) { var c = $('#bk-rows tr[data-i="' + idx + '"] .bk-st'); if (c) c.innerHTML = html; }
    function next() {
      if (i >= BULK.items.length) {
        reindex(); renderFilters(); renderView();
        toast(t('bulkResult').replace('{ok}', ok).replace('{n}', BULK.items.length), ok === BULK.items.length ? '' : 'warn');
        go.innerHTML = icon('check') + esc(t('bulkDone')); if (close) close.disabled = false;
        return;
      }
      var it = BULK.items[i], idx = i; i++;
      if (!it.title || !it.date || !it.owner) { setStatus(idx, '<span class="req">' + esc(t('errRequired')) + '</span>'); return next(); }
      if (it.tooBig) { setStatus(idx, '<span class="req">' + esc(t('bulkFail')) + '</span>'); return next(); }
      setStatus(idx, icon('loader-circle', 'spin') + ' ' + esc(t('bulkUploading')));
      toB64(it.file).then(function (b64) {
        return api('addDocument', { title: it.title, drawerId: drawerId, folderId: folderId, date: it.date, owner: it.owner,
          ownerEmail: it.owner === S.user.name ? S.user.email : '', version: it.version, status: 'Active', conf: it.conf, tags: [],
          description: '', upload: { name: it.file.name, mime: it.file.type || 'application/octet-stream', data: b64 } });
      }).then(function (doc) { S.docs.push(doc); ok++; setStatus(idx, '<span style="color:var(--ok)">' + icon('check') + ' ' + esc(t('bulkDone')) + '</span>'); next(); })
        .catch(function (e) { setStatus(idx, '<span class="req">' + esc((e && e.message) || t('bulkFail')) + '</span>'); if (['AUTH', 'AUTH_EXPIRED', 'SESSION', 'NOT_ALLOWED'].indexOf(e && e.code) >= 0) { handleErr(e); return; } next(); });
    }
    next();
  }

  function docById(id) { return S.docs.filter(function (d) { return d.id === id; })[0]; }
  function showDetails(id) {
    var d = docById(id); if (!d) return;
    var dr = S.dById[d.drawerId] || {}, fo = S.fById[d.folderId] || {};
    var row = function (k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>' : ''; };
    var body = '<dl class="kv">' + row(t('colTitle'), '<b><bdi>' + esc(d.title) + '</bdi></b>') + row(t('colFolder'), '<bdi>' + esc(nm(dr)) + '</bdi> › <bdi>' + esc(nm(fo)) + '</bdi>') +
      row(t('colDate'), '<span class="latin">' + esc(d.date) + '</span>') + row(t('colOwner'), '<bdi>' + esc(d.owner) + '</bdi>') +
      row(t('colTags'), (d.tags || []).map(function (g) { return '<span class="tag">#' + esc(g) + '</span>'; }).join('')) + row(t('colVer'), '<span class="latin">' + esc(d.version) + '</span>') +
      row(t('fStatus'), esc(t('status_' + d.status))) + row(t('fConf'), '<span class="badge conf-' + esc(d.conf) + '">' + esc(t('conf_' + d.conf)) + '</span>') +
      row(t('file'), d.fileName ? '<bdi>' + esc(d.fileName) + '</bdi>' + (d.size ? ' · ' + esc(fmtSize(d.size)) : '') : '') +
      row(t('fDesc'), d.description ? '<bdi>' + esc(d.description) + '</bdi>' : '') +
      row(t('created'), esc(d.createdAt || '') + (d.createdBy ? ' ' + esc(t('by')) + ' <span class="latin">' + esc(d.createdBy) + '</span>' : '')) +
      row(t('updated'), d.updatedAt ? esc(d.updatedAt) + ' ' + esc(t('by')) + ' <span class="latin">' + esc(d.updatedBy) + '</span>' : '') + '</dl>';
    var foot = (d.canEdit ? '<button class="btn danger sm" data-act="del-doc" data-id="' + esc(id) + '">' + icon('trash-2') + esc(t('del')) + '</button><button class="btn secondary" data-act="edit-doc" data-id="' + esc(id) + '">' + icon('pencil') + esc(t('edit')) + '</button>' : '') +
      '<button class="btn" data-act="open-doc" data-id="' + esc(id) + '">' + icon('external-link') + esc(t('open')) + '</button>';
    modal(t('details'), body, foot, { focus: false });
  }

  function openDoc(id) {
    var w = null; try { w = window.open('', '_blank'); if (w) w.opener = null; } catch (e) { w = null; }
    if (!w) { toast(t('popupBlocked'), 'warn'); return; }
    try { w.document.write('<title>…</title><body style="font-family:sans-serif;padding:24px">' + esc(t('opening')) + '</body>'); } catch (e) { /* ignore */ }
    api('openDocument', { id: id }).then(function (r) {
      if (r.demo) { w.close(); toast('Demo: ' + t('open')); return; }
      if (!/^https:\/\/(drive|docs)\.google\.com\//.test(r.url || '')) { w.close(); toast(t('errGeneric'), 'bad'); return; }
      w.location.href = r.url; if (r.granted === false) toast(t('grantWarn'), 'warn');
    }).catch(function (e) { w.close(); handleErr(e); });
  }

  function confirmDelete(id) {
    var d = docById(id); if (!d) return;
    modal(t('del'), '<p><b><bdi>' + esc(d.title) + '</bdi></b></p><p>' + esc(t('confirmDelete')) + '</p><div class="err" id="m-err"></div>',
      '<button class="btn secondary" data-act="close-modal">' + esc(t('cancel')) + '</button><button class="btn danger" id="m-del" data-act="do-delete" data-id="' + esc(id) + '">' + icon('trash-2') + esc(t('confirm')) + '</button>', { cls: 'sm', focus: false });
  }
  function doDelete(id) {
    var b = $('#m-del'); b.disabled = true;
    api('deleteDocument', { id: id }).then(function () {
      S.docs = S.docs.filter(function (x) { return x.id !== id; }); reindex(); closeModal(); renderFilters(); renderView(); toast(t('deleted'));
    }).catch(function (e) { b.disabled = false; handleErr(e, $('#m-err')); });
  }

  /* drawers & folders */
  function swatches(cur) { return COLORS.map(function (c) { return '<button type="button" class="' + (c === cur ? 'on' : '') + '" style="background:' + c + '" data-act="pick-color" data-v="' + c + '" aria-label="' + c + '"></button>'; }).join(''); }
  function iconPick(cur) { return DRAWER_ICONS.map(function (n) { return '<button type="button" class="' + (n === cur ? 'on' : '') + '" data-act="pick-icon" data-v="' + n + '" aria-label="' + n + '">' + icon(n) + '</button>'; }).join(''); }
  function openDrawerForm(d) {
    var edit = !!d; d = d || { nameAr: '', nameEn: '', icon: 'archive', color: COLORS[0], description: '', active: true, order: S.drawers.length + 1 };
    FORM = { icon: iconName(d.icon), color: safeColor(d.color), editId: edit ? d.id : '', kind: 'drawer' };
    var body = '<form id="drawerform" novalidate><div class="row2"><div class="field"><label class="f" for="m-nar">' + esc(t('nameAr')) + '</label><input class="in" id="m-nar" maxlength="80" value="' + esc(d.nameAr) + '"></div>' +
      '<div class="field"><label class="f" for="m-nen">' + esc(t('nameEn')) + '</label><input class="in latin" style="display:block" id="m-nen" maxlength="80" value="' + esc(d.nameEn) + '"></div></div>' +
      '<div class="field"><label class="f">' + esc(t('icon')) + '</label><div class="iconpick" id="m-icons">' + iconPick(FORM.icon) + '</div></div>' +
      '<div class="field"><label class="f">' + esc(t('color')) + '</label><div class="swatches" id="m-colors">' + swatches(FORM.color) + '</div></div>' +
      '<div class="field"><label class="f" for="m-ddesc">' + esc(t('description')) + '</label><input class="in" id="m-ddesc" maxlength="300" value="' + esc(d.description) + '"></div>' +
      (edit ? '<div class="row2"><div class="field"><label class="f" for="m-order">' + esc(t('order')) + '</label><input class="in" type="number" id="m-order" value="' + esc(d.order) + '"></div>' +
        '<div class="field"><label class="f"><input type="checkbox" id="m-active"' + (d.active ? ' checked' : '') + '> ' + esc(t('active')) + '</label></div></div>' : '') +
      '<div class="err" id="m-err" role="alert"></div></form>';
    modal(edit ? t('editDrawer') : t('newDrawer'), body, '<button class="btn secondary" data-act="close-modal">' + esc(t('cancel')) + '</button><button class="btn" id="m-save" data-act="save-drawer">' + icon('check') + esc(t('save')) + '</button>', { sticky: true });
  }
  function saveDrawer() {
    var err = $('#m-err'), btn = $('#m-save'); err.textContent = '';
    var p = { nameAr: $('#m-nar').value.trim(), nameEn: $('#m-nen').value.trim(), icon: FORM.icon, color: FORM.color, description: $('#m-ddesc').value.trim() };
    if (!p.nameAr && !p.nameEn) { err.textContent = t('errRequired'); return; }
    var action = 'addDrawer';
    if (FORM.editId) { action = 'updateDrawer'; p.id = FORM.editId; p.order = $('#m-order').value; p.active = $('#m-active').checked; }
    btn.disabled = true;
    api(action, p).then(function (d) {
      if (FORM.editId) S.drawers = S.drawers.map(function (x) { return x.id === d.id ? d : x; }); else S.drawers.push(d);
      reindex(); closeModal(); renderFilters(); renderView(); toast(t('saved'));
    }).catch(function (e) { btn.disabled = false; handleErr(e, err); });
  }
  function openFolderForm(f, drawerId) {
    var edit = !!f; f = f || { nameAr: '', nameEn: '', active: true, order: S.folders.filter(function (x) { return x.drawerId === drawerId; }).length + 1 };
    FORM = { editId: edit ? f.id : '', drawerId: edit ? f.drawerId : drawerId, kind: 'folder' };
    var body = '<form id="folderform" novalidate><div class="row2"><div class="field"><label class="f" for="m-nar">' + esc(t('nameAr')) + '</label><input class="in" id="m-nar" maxlength="80" value="' + esc(f.nameAr) + '"></div>' +
      '<div class="field"><label class="f" for="m-nen">' + esc(t('nameEn')) + '</label><input class="in latin" style="display:block" id="m-nen" maxlength="80" value="' + esc(f.nameEn) + '"></div></div>' +
      (edit ? '<div class="row2"><div class="field"><label class="f" for="m-order">' + esc(t('order')) + '</label><input class="in" type="number" id="m-order" value="' + esc(f.order) + '"></div>' +
        '<div class="field"><label class="f"><input type="checkbox" id="m-active"' + (f.active ? ' checked' : '') + '> ' + esc(t('active')) + '</label></div></div>' : '') +
      '<div class="err" id="m-err" role="alert"></div></form>';
    modal(edit ? t('editFolder') : t('newFolder'), body, '<button class="btn secondary" data-act="close-modal">' + esc(t('cancel')) + '</button><button class="btn" id="m-save" data-act="save-folder">' + icon('check') + esc(t('save')) + '</button>', { cls: 'sm', sticky: true });
  }
  function saveFolder() {
    var err = $('#m-err'), btn = $('#m-save'); err.textContent = '';
    var p = { nameAr: $('#m-nar').value.trim(), nameEn: $('#m-nen').value.trim() };
    if (!p.nameAr && !p.nameEn) { err.textContent = t('errRequired'); return; }
    var action = 'addFolder'; p.drawerId = FORM.drawerId;
    if (FORM.editId) { action = 'updateFolder'; p.id = FORM.editId; p.order = $('#m-order').value; p.active = $('#m-active').checked; }
    btn.disabled = true;
    api(action, p).then(function (f) {
      if (FORM.editId) S.folders = S.folders.map(function (x) { return x.id === f.id ? f : x; }); else S.folders.push(f);
      reindex(); closeModal(); renderFilters(); renderView(); toast(t('saved'));
    }).catch(function (e) { btn.disabled = false; handleErr(e, err); });
  }
  function folderDocCount(id) { return S.docs.filter(function (d) { return d.folderId === id; }).length; }
  function confirmDeleteFolder(id) {
    var f = S.fById[id]; if (!f) return;
    var n = folderDocCount(id);
    var body = '<p><b><bdi>' + esc(nm(f)) + '</bdi></b></p><p>' + (n ? esc(t('folderHasDocs').replace('{n}', n)) : esc(t('confirmDeleteFolder'))) + '</p><div class="err" id="m-err"></div>';
    modal(t('delFolder'), body,
      '<button class="btn secondary" data-act="close-modal">' + esc(t('cancel')) + '</button><button class="btn danger" id="m-delfolder" data-act="do-del-folder" data-id="' + esc(id) + '" data-force="' + (n ? '1' : '0') + '">' + icon('trash-2') + esc(t('confirm')) + '</button>',
      { cls: 'sm', focus: false });
  }
  function doDeleteFolder(id, force) {
    var b = $('#m-delfolder'); if (b) b.disabled = true;
    api('deleteFolder', { id: id, force: force }).then(function (r) {
      S.folders = S.folders.filter(function (x) { return x.id !== r.id; });
      if (r.deletedDocs && r.deletedDocs.length) { var del = {}; r.deletedDocs.forEach(function (x) { del[x] = 1; }); S.docs = S.docs.filter(function (d) { return !del[d.id]; }); }
      reindex(); closeModal(); renderFilters(); renderView(); toast(t('folderDeleted'));
    }).catch(function (e) {
      if (e && e.code === 'HAS_DOCS') { if (b) { b.disabled = false; b.setAttribute('data-force', '1'); } var x = $('#m-err'); if (x) x.textContent = t('folderHasDocs').replace('{n}', e.message); return; }
      if (b) b.disabled = false; handleErr(e, $('#m-err'));
    });
  }

  /* ---------------- search / filter plumbing ---------------- */
  function ensureSearchView() { if (S.view.name !== 'search') go('#/s'); else renderView(); }
  function clearAll() { S.q = ''; S.f = blankFilters(); var q = $('#q'); if (q) q.value = ''; renderFilters(); go('#/'); }
  var qTimer = null;

  /* ---------------- actions ---------------- */
  /* ---------------- access management (Admin) ---------------- */
  var ADMIN_ME = '';
  function roleOptions(sel) {
    return [['Admin', 'roleAdminFull'], ['Editor', 'roleEditorAdd'], ['Viewer', 'roleViewerView']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + esc(t(o[1])) + '</option>'; }).join('');
  }
  function openAdminUsers() {
    modal(t('accessPanel'),
      '<div class="err" id="m-err" role="alert"></div><div id="users-body" class="userwrap"><div class="empty">' + icon('loader-circle', 'spin') + ' ' + esc(t('loading')) + '</div></div>',
      '<button class="btn secondary" data-act="close-modal">' + esc(t('close')) + '</button>', { sticky: true, focus: false });
    loadUsers();
  }
  function loadUsers() {
    api('listUsers', {}).then(function (d) { ADMIN_ME = d.me; renderUsers(d.users); })
      .catch(function (e) { var b = $('#m-err'); handleErr(e, b); });
  }
  function renderUsers(list) {
    var body = $('#users-body'); if (!body) return;
    var rows = list.map(function (x) {
      var self = x.email === ADMIN_ME;
      return '<tr data-email="' + esc(x.email) + '"><td data-l="' + esc(t('colEmail2')) + '"><span class="latin">' + esc(x.email) + '</span>' + (self ? ' <span class="chip">' + esc(t('role_Admin')) + '</span>' : '') + '</td>' +
        '<td data-l="' + esc(t('colName')) + '"><input class="in u-name" value="' + esc(x.name) + '" maxlength="120"></td>' +
        '<td data-l="' + esc(t('colRole')) + '"><select class="in u-role"' + (self ? ' disabled' : '') + '>' + roleOptions(x.role) + '</select></td>' +
        '<td data-l="' + esc(t('colActive')) + '" style="text-align:center"><input type="checkbox" class="u-active"' + (x.active ? ' checked' : '') + (self ? ' disabled' : '') + '></td>' +
        '<td class="actions"><button class="icon-btn" data-act="save-user" aria-label="' + esc(t('save')) + '" title="' + esc(t('save')) + '">' + icon('check') + '</button>' +
        (self ? '' : '<button class="icon-btn danger" data-act="del-user" aria-label="' + esc(t('del')) + '" title="' + esc(t('del')) + '">' + icon('trash-2') + '</button>') + '</td></tr>';
    }).join('');
    body.innerHTML =
      '<div class="adduser"><input class="in latin" id="nu-email" placeholder="' + esc(t('emailPh')) + '"><input class="in" id="nu-name" placeholder="' + esc(t('namePh')) + '"><select class="in" id="nu-role">' + roleOptions('Viewer') + '</select><button class="btn" data-act="add-user">' + icon('plus') + esc(t('addUser')) + '</button></div>' +
      '<p class="hint" style="margin:0 0 12px">' + esc(t('roleHelp')) + '</p>' +
      (list.length ? '<div class="tbl-wrap"><table class="docs utbl"><thead><tr><th class="nosort">' + esc(t('colEmail2')) + '</th><th class="nosort">' + esc(t('colName')) + '</th><th class="nosort">' + esc(t('colRole')) + '</th><th class="nosort">' + esc(t('colActive')) + '</th><th class="nosort">' + esc(t('colActions')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">' + esc(t('noUsers')) + '</div>');
  }
  function saveUserCall(payload, btn) {
    var box = $('#m-err'); if (box) box.textContent = '';
    if (btn) btn.disabled = true;
    api('saveUser', payload).then(function (d) { ADMIN_ME = d.me; renderUsers(d.users); toast(t('userSaved')); })
      .catch(function (e) { if (btn) btn.disabled = false; handleErr(e, $('#m-err')); });
  }
  function confirmRemoveUser(email) {
    modal(t('del'), '<p><b class="latin">' + esc(email) + '</b></p><p>' + esc(t('confirmRemoveUser')) + '</p><div class="err" id="m-err"></div>',
      '<button class="btn secondary" data-act="admin-users">' + esc(t('cancel')) + '</button><button class="btn danger" id="m-deluser" data-act="do-del-user" data-email="' + esc(email) + '">' + icon('trash-2') + esc(t('confirm')) + '</button>', { cls: 'sm', focus: false });
  }

  /* ---------------- audit log (Admin) ---------------- */
  var AUDIT = { rows: [], filter: '' };
  function actionLabel(a) { var k = 'act_' + String(a || '').trim(); var v = t(k); return v === k ? (a || '') : v; }
  function actionClass(a) { a = String(a || ''); if (a.indexOf('delete') >= 0 || a === 'denied' || a === 'grant_remove') return 'bad'; if (a.indexOf('add') >= 0 || a === 'import_policies') return 'ok'; if (a.indexOf('edit') >= 0 || a === 'save_user' || a === 'grant_save' || a === 'folder_access') return 'warn'; return 'info'; }
  function openAuditLog() {
    AUDIT = { rows: [], filter: '' };
    modal(t('auditTitle'),
      '<div class="field" style="margin-bottom:10px"><input class="in" id="au-filter" placeholder="' + esc(t('auditFilter')) + '"></div><div id="au-body"><div class="empty">' + icon('loader-circle', 'spin') + ' ' + esc(t('loading')) + '</div></div>',
      '<button class="btn secondary" data-act="close-modal">' + esc(t('close')) + '</button>', { sticky: true, focus: false, cls: 'wide' });
    api('auditLog', { limit: 300 }).then(function (d) { AUDIT.rows = d.log || []; renderAudit(); }).catch(function (e) { var b = $('#au-body'); if (b) b.innerHTML = '<div class="empty">' + esc(t('errGeneric')) + '</div>'; handleErr(e); });
  }
  function renderAudit() {
    var host = $('#au-body'); if (!host) return;
    var f = norm(AUDIT.filter);
    var list = AUDIT.rows.filter(function (r) { if (!f) return true; return norm([r.email, r.name, r.action, actionLabel(r.action), r.detail, r.role].join(' ')).indexOf(f) >= 0; });
    if (!list.length) { host.innerHTML = '<div class="empty">' + esc(t('auditEmpty')) + '</div>'; return; }
    var rows = list.map(function (r) {
      return '<tr><td data-l="' + esc(t('colWhen')) + '"><span class="latin">' + esc(r.date) + ' ' + esc(r.time) + '</span></td>' +
        '<td data-l="' + esc(t('colWho')) + '"><bdi>' + esc(r.name || '') + '</bdi><div class="path latin">' + esc(r.email || '') + (r.role ? ' · ' + esc(r.role) : '') + '</div></td>' +
        '<td data-l="' + esc(t('colAction')) + '"><span class="badge au-' + actionClass(r.action) + '">' + esc(actionLabel(r.action)) + '</span></td>' +
        '<td data-l="' + esc(t('colDetail')) + '"><bdi>' + esc(r.detail || '') + '</bdi></td></tr>';
    }).join('');
    host.innerHTML = '<p class="hint" style="margin:0 0 8px">' + esc(t('auditCount').replace('{n}', list.length)) + '</p>' +
      '<div class="tbl-wrap"><table class="docs autbl"><thead><tr><th class="nosort">' + esc(t('colWhen')) + '</th><th class="nosort">' + esc(t('colWho')) + '</th><th class="nosort">' + esc(t('colAction')) + '</th><th class="nosort">' + esc(t('colDetail')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* ---------------- folder access (folder managers / admins) ---------------- */
  var FACC = { folderId: '', access: 'open', grants: [], users: [] };
  function openFolderAccess(folderId) {
    FACC = { folderId: folderId, access: 'open', grants: [], users: [] };
    var f = S.fById[folderId] || {};
    modal(t('folderAccess') + ' — ' + nm(f),
      '<div class="err" id="fa-err" role="alert"></div><div id="fa-body"><div class="empty">' + icon('loader-circle', 'spin') + ' ' + esc(t('loading')) + '</div></div>',
      '<button class="btn secondary" data-act="close-modal">' + esc(t('close')) + '</button>', { sticky: true, focus: false });
    api('listFolderAccess', { folderId: folderId }).then(applyFacc).catch(function (e) { handleErr(e, $('#fa-err')); var b = $('#fa-body'); if (b) b.innerHTML = ''; });
  }
  function applyFacc(d) { FACC.access = d.access || 'open'; FACC.grants = d.grants || []; FACC.users = d.users || []; renderFolderAccess(); }
  function renderFolderAccess() {
    var body = $('#fa-body'); if (!body) return;
    var restricted = FACC.access === 'restricted';
    var rows = FACC.grants.map(function (g) {
      return '<tr data-email="' + esc(g.email) + '"><td data-l="' + esc(t('colEmail2')) + '"><span class="latin">' + esc(g.email) + '</span>' +
        (g.name ? '<div class="path"><bdi>' + esc(g.name) + '</bdi></div>' : '') + '</td>' +
        '<td data-l="' + esc(t('colRole')) + '"><select class="in g-role">' + roleOptions(g.role) + '</select></td>' +
        '<td data-l="' + esc(t('colActive')) + '" style="text-align:center"><input type="checkbox" class="g-active"' + (g.active ? ' checked' : '') + '></td>' +
        '<td class="actions"><button class="icon-btn" data-act="save-grant" aria-label="' + esc(t('save')) + '" title="' + esc(t('save')) + '">' + icon('check') + '</button>' +
        '<button class="icon-btn danger" data-act="rm-grant" aria-label="' + esc(t('del')) + '" title="' + esc(t('del')) + '">' + icon('trash-2') + '</button></td></tr>';
    }).join('');
    var dl = FACC.users.map(function (x) { return '<option value="' + esc(x.email) + '">' + esc(x.name || '') + '</option>'; }).join('');
    body.innerHTML =
      '<div class="acc-mode"><span class="acc-mode-l">' + icon(restricted ? 'lock' : 'lock-open') + esc(t('accMode')) + '</span>' +
      '<div class="seg"><button class="' + (restricted ? '' : 'on') + '" data-act="set-access" data-v="open">' + esc(t('accOpen')) + '</button>' +
      '<button class="' + (restricted ? 'on' : '') + '" data-act="set-access" data-v="restricted">' + esc(t('accRestricted')) + '</button></div></div>' +
      '<p class="hint" style="margin:0 0 12px">' + esc(t(restricted ? 'accRestrictedHelp' : 'accOpenHelp')) + '</p>' +
      '<h4 class="acc-h">' + esc(t('grantsTitle')) + '</h4>' +
      '<div class="adduser"><input class="in latin" id="ng-email" list="ng-users" placeholder="' + esc(t('emailPh')) + '"><datalist id="ng-users">' + dl + '</datalist>' +
      '<select class="in" id="ng-role">' + roleOptions('Viewer') + '</select><button class="btn" data-act="add-grant">' + icon('user-plus') + esc(t('addGrant')) + '</button></div>' +
      (FACC.grants.length ? '<div class="tbl-wrap"><table class="docs utbl"><thead><tr><th class="nosort">' + esc(t('colEmail2')) + '</th><th class="nosort">' + esc(t('colRole')) + '</th><th class="nosort">' + esc(t('colActive')) + '</th><th class="nosort">' + esc(t('colActions')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty">' + esc(t('noGrants')) + '</div>');
  }
  function faccCall(action, payload, btn) {
    var box = $('#fa-err'); if (box) box.textContent = '';
    if (btn) btn.disabled = true;
    payload.folderId = FACC.folderId;
    return api(action, payload).then(function (d) {
      applyFacc(d);
      var f = S.fById[FACC.folderId]; if (f) f.access = FACC.access; // keep manila lock badge in sync
      toast(t('accSaved'));
    }).catch(function (e) { if (btn) btn.disabled = false; handleErr(e, $('#fa-err')); });
  }

  var ACT = {
    'admin-users': openAdminUsers,
    'audit-log': openAuditLog,
    'folder-access': function (el) { closeModal(); openFolderAccess(el.getAttribute('data-id')); },
    'set-access': function (el) { var v = el.getAttribute('data-v'); if (v === FACC.access) return; faccCall('setFolderAccess', { access: v }, el); },
    'add-grant': function () {
      var email = $('#ng-email').value.trim(), role = $('#ng-role').value;
      if (!email) { $('#fa-err').textContent = t('errRequired'); return; }
      faccCall('saveFolderGrant', { email: email, role: role, active: true });
    },
    'save-grant': function (el) {
      var tr = el.closest('tr'); if (!tr) return;
      faccCall('saveFolderGrant', { email: tr.getAttribute('data-email'), role: $('.g-role', tr).value, active: $('.g-active', tr).checked }, el);
    },
    'rm-grant': function (el) {
      var tr = el.closest('tr'); if (!tr) return;
      faccCall('deleteFolderGrant', { email: tr.getAttribute('data-email') }, el);
    },
    'add-user': function () {
      var email = $('#nu-email').value.trim(), name = $('#nu-name').value.trim(), role = $('#nu-role').value;
      if (!email) { $('#m-err').textContent = t('errRequired'); return; }
      saveUserCall({ email: email, name: name, role: role, active: true });
    },
    'save-user': function (el) {
      var tr = el.closest('tr'); if (!tr) return;
      saveUserCall({ email: tr.getAttribute('data-email'), name: $('.u-name', tr).value.trim(), role: $('.u-role', tr).value, active: $('.u-active', tr).checked }, el);
    },
    'del-user': function (el) { var tr = el.closest('tr'); if (tr) confirmRemoveUser(tr.getAttribute('data-email')); },
    'do-del-user': function (el) {
      el.disabled = true;
      api('deleteUser', { email: el.getAttribute('data-email') }).then(function () { toast(t('userRemoved')); openAdminUsers(); })
        .catch(function (e) { el.disabled = false; handleErr(e, $('#m-err')); });
    },
    'lang': function () { S.lang = S.lang === 'ar' ? 'en' : 'ar'; store('ictd_lib_lang', S.lang); closeModal(); if (S.user) { renderApp(); renderView(); } else renderLogin(); },
    'theme': function () { store('ictd_lib_theme', curTheme() === 'dark' ? 'light' : 'dark'); applyTheme(); refreshThemeButtons(); },
    'signout': function () { signOut(); },
    'open-drawer': function (el) { el.classList.add('opening'); var id = el.getAttribute('data-id'); setTimeout(function () { go('#/d/' + id); }, 200); },
    'open-folder': function (el) { go('#/f/' + el.getAttribute('data-id')); },
    'new-drawer': function () { openDrawerForm(null); },
    'edit-drawer': function (el) { openDrawerForm(S.dById[el.getAttribute('data-id')]); },
    'new-folder': function (el) { openFolderForm(null, el.getAttribute('data-id')); },
    'edit-folder': function (el) { openFolderForm(S.fById[el.getAttribute('data-id')]); },
    'del-folder': function (el) { confirmDeleteFolder(el.getAttribute('data-id')); },
    'do-del-folder': function (el) { doDeleteFolder(el.getAttribute('data-id'), el.getAttribute('data-force') === '1'); },
    'save-drawer': saveDrawer, 'save-folder': saveFolder,
    'add-doc': function (el) { openDocForm(null, { drawerId: el.getAttribute('data-drawer') || '', folderId: el.getAttribute('data-folder') || '' }); },
    'bulk-upload': function (el) { openBulkUpload({ drawerId: el.getAttribute('data-drawer') || '', folderId: el.getAttribute('data-folder') || '' }); },
    'bulk-del': function (el) { BULK.items.splice(Number(el.getAttribute('data-i')), 1); renderBulkRows(); },
    'bulk-go': startBulkUpload,
    'edit-doc': function (el) { var d = docById(el.getAttribute('data-id')); if (d) openDocForm(d); },
    'save-doc': saveDoc,
    'del-doc': function (el) { confirmDelete(el.getAttribute('data-id')); },
    'do-delete': function (el) { doDelete(el.getAttribute('data-id')); },
    'doc-details': function (el) { showDetails(el.getAttribute('data-id')); },
    'open-doc': function (el) { openDoc(el.getAttribute('data-id')); },
    'close-modal': closeModal,
    'toggle-filters': function () { S.showFilters = !S.showFilters; renderFilters(); },
    'clear-q': function () { S.q = ''; $('#q').value = ''; $('#qclear').classList.add('hidden'); if (hasSearch()) renderView(); else go('#/'); },
    'clear-filters': function () { S.f = blankFilters(); renderFilters(); if (S.view.name === 'search') { if (hasSearch()) renderView(); else go('#/'); } },
    'clear-all': clearAll,
    'rm-f': function (el) { var k = el.getAttribute('data-k'); if (k === 'q') { S.q = ''; $('#q').value = ''; } else S.f[k] = ''; if (k === 'drawerId') S.f.folderId = ''; renderFilters(); if (hasSearch()) renderView(); else go('#/'); },
    'tag': function (el) { closeModal(); S.f.tag = el.getAttribute('data-tag'); renderFilters(); ensureSearchView(); },
    'sort': function (el) { var k = el.getAttribute('data-k'); S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === 'date' ? -1 : 1) }; renderView(); },
    'src': function (el) {
      FORM.src = el.getAttribute('data-v');
      $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b === el); });
      $('#src-upload').classList.toggle('hidden', FORM.src !== 'upload'); $('#src-link').classList.toggle('hidden', FORM.src !== 'link');
    },
    'rm-tag': function (el) { FORM.tags.splice(Number(el.getAttribute('data-i')), 1); renderFormTags(); },
    'pick-icon': function (el) { FORM.icon = el.getAttribute('data-v'); $$('#m-icons button').forEach(function (b) { b.classList.toggle('on', b === el); }); },
    'pick-color': function (el) { FORM.color = el.getAttribute('data-v'); $$('#m-colors button').forEach(function (b) { b.classList.toggle('on', b === el); }); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null; if (!el) return;
    var fn = ACT[el.getAttribute('data-act')]; if (!fn) return;
    if (el.tagName === 'A' && !el.getAttribute('href')) e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { var m = $('#modal'); if (m) closeModal(); return; }
    var el = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && el.getAttribute && el.getAttribute('role') === 'button' && el.getAttribute('data-act')) { e.preventDefault(); el.click(); return; }
    if (el.id === 'm-taginput') {
      if (e.key === 'Enter' || e.key === ',' || e.key === '،') { e.preventDefault(); addFormTag(el.value); el.value = ''; }
      else if (e.key === 'Backspace' && !el.value && FORM.tags.length) { FORM.tags.pop(); renderFormTags(); var i = $('#m-taginput'); if (i) i.focus(); }
    } else if (e.key === 'Enter' && el.tagName === 'INPUT' && el.closest && el.closest('#docform,#drawerform,#folderform') && el.id !== 'm-file') {
      e.preventDefault(); var b = $('#m-save'); if (b && !b.disabled) b.click();
    }
  });
  document.addEventListener('focusout', function (e) { if (e.target.id === 'm-taginput' && e.target.value.trim()) { addFormTag(e.target.value); } });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'au-filter') { AUDIT.filter = e.target.value; renderAudit(); return; }
    if (e.target.id !== 'q') return;
    S.q = e.target.value; var c = $('#qclear'); if (c) c.classList.toggle('hidden', !S.q);
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { if (hasSearch()) ensureSearchView(); else if (S.view.name === 'search') go('#/'); }, 160);
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'm-drawer') { var fs = $('#m-folder'); fs.innerHTML = folderOptions(e.target.value, ''); return; }
    if (id === 'bk-drawer') { var bf = $('#bk-folder'); if (bf) bf.innerHTML = folderOptions(e.target.value, ''); return; }
    if (id === 'bk-file') { addBulkFiles(e.target.files); e.target.value = ''; return; }
    if (id === 'm-file') { setFile(e.target.files && e.target.files[0]); return; }
    var map = { 'f-drawer': 'drawerId', 'f-folder': 'folderId', 'f-owner': 'owner', 'f-tag': 'tag', 'f-from': 'from', 'f-to': 'to', 'f-status': 'status', 'f-conf': 'conf' };
    if (map[id]) {
      S.f[map[id]] = e.target.value; if (id === 'f-drawer') S.f.folderId = '';
      renderFilters(); if (hasSearch()) ensureSearchView(); else if (S.view.name === 'search') go('#/');
    }
  });
  function setFile(file) {
    if (!file) return; FORM.file = file;
    var n = $('#m-fname'); if (n) n.innerHTML = icon('file-check') + ' <b><bdi>' + esc(file.name) + '</bdi></b> · ' + esc(fmtSize(file.size));
  }
  document.addEventListener('dragover', function (e) { var d = e.target.closest && e.target.closest('#m-drop,#bk-drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('#m-drop,#bk-drop'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', function (e) {
    var d = e.target.closest && e.target.closest('#m-drop,#bk-drop'); if (!d) return;
    e.preventDefault(); d.classList.remove('over');
    if (d.id === 'bk-drop') addBulkFiles(e.dataTransfer.files); else setFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  /* ---------------- start ---------------- */
  function init() {
    var saved = store('ictd_lib_lang'); S.lang = saved === 'en' ? 'en' : 'ar'; setDir(); applyTheme();
    if (DEMO) { boot(false); return; }
    if (configured()) initGoogle();
    var tok = sess('ictd_lib_tok');
    if (tok && setToken(tok) && tokenValid(60)) { boot(false); return; }
    sess('ictd_lib_tok', null); renderLogin();
  }
  init();
})();
