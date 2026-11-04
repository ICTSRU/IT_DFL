/**
 * ICTD Digital File Library — Google Apps Script backend
 * Version 1.0 (2026-11-04)
 *
 * Container-bound script: create a Google Sheet, open Extensions > Apps Script,
 * paste this file as Code.gs (and appsscript.json), run setup() once, then deploy as a Web app.
 *
 *   Sheet tabs  : Config · Drawers · Folders · Documents · AllowedUsers · AccessLog
 *   Files       : stored in Google Drive under the root folder created by setup()
 *   Security    : every request carries a Google ID token; it is verified server-side
 *                 (audience = your OAuth Client ID, hd/e-mail domain = sr.edu.sa),
 *                 then the user is looked up in AllowedUsers (Admin / Editor / Viewer).
 */

var VERSION = '1.0';

var SHEETS = {
  CONFIG: 'Config',
  DRAWERS: 'Drawers',
  FOLDERS: 'Folders',
  DOCS: 'Documents',
  USERS: 'AllowedUsers',
  LOG: 'AccessLog'
};

var HEADERS = {
  Config: ['Key', 'Value', 'Note'],
  Drawers: ['DrawerID', 'NameAr', 'NameEn', 'Icon', 'Color', 'Order', 'Active', 'Description', 'DriveFolderID', 'CreatedBy', 'CreatedAt'],
  Folders: ['FolderID', 'DrawerID', 'NameAr', 'NameEn', 'Order', 'Active', 'DriveFolderID', 'CreatedBy', 'CreatedAt'],
  Documents: ['DocID', 'Title', 'DrawerID', 'FolderID', 'DocDate', 'Owner', 'OwnerEmail', 'Tags', 'Description', 'Version', 'Status',
    'Confidentiality', 'FileName', 'MimeType', 'SizeBytes', 'DriveFileID', 'DriveURL', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Deleted'],
  AllowedUsers: ['Email', 'Name', 'Role', 'Active', 'AddedAt'],
  AccessLog: ['Date', 'Time', 'Email', 'Name', 'Role', 'Action', 'Detail']
};

var DEFAULT_CONFIG = [
  ['LibraryName', 'ICTD Digital File Library', 'Display name'],
  ['ClientID', 'PASTE_OAUTH_CLIENT_ID.apps.googleusercontent.com', 'Google OAuth Web Client ID (same value as GOOGLE_CLIENT_ID in assets/js/config.js)'],
  ['AllowedDomains', 'sr.edu.sa', 'Comma-separated Google Workspace domains allowed to sign in'],
  ['RestrictToAllowedList', true, 'TRUE = only users listed (and Active) in AllowedUsers may enter. FALSE = any @sr.edu.sa account enters as Viewer'],
  ['MaxUploadMB', 20, 'Maximum upload size per file (MB). Apps Script request limit is ~50 MB; keep this at or below 30'],
  ['RootFolderID', '', 'Filled automatically by setup(): the Drive folder that holds all drawers'],
  ['DefaultConfidentiality', 'Internal', 'General | Internal | Confidential']
];

var ROLES = ['Admin', 'Editor', 'Viewer'];
var STATUSES = ['Active', 'Draft', 'Archived', 'Superseded'];
var CONFS = ['General', 'Internal', 'Confidential'];
var ICONS_OK = ['archive', 'folder', 'scroll-text', 'file-signature', 'kanban', 'chart-column', 'users', 'shopping-cart', 'shield-check',
  'briefcase', 'book-open', 'database', 'server', 'layers', 'settings', 'star', 'layout-dashboard', 'file-text'];
var BLOCKED_EXT = ['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'jse', 'vbs', 'vbe', 'ps1', 'jar', 'sh', 'dll', 'apk', 'app', 'hta', 'lnk', 'reg'];
var TZ = 'Asia/Riyadh';

/* ------------------------------------------------------------------ *
 *  Web app entry points
 * ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, service: 'ICTD Digital File Library', version: VERSION });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var handler = ACTIONS[req.action];
    if (!handler) throw err_('BAD_REQUEST', 'Unknown action');
    var user = authorize_(req.idToken);
    out = { ok: true, data: handler(user, req.payload || {}) };
  } catch (ex) {
    if (ex && ex.code) {
      out = { ok: false, code: ex.code, error: ex.message };
    } else {
      console.error(ex && ex.stack ? ex.stack : ex);
      out = { ok: false, code: 'SERVER_ERROR', error: 'Unexpected server error. Check Apps Script Executions for details.' };
    }
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function err_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

var ACTIONS = {
  bootstrap: bootstrap_,
  addDrawer: addDrawer_,
  updateDrawer: updateDrawer_,
  addFolder: addFolder_,
  updateFolder: updateFolder_,
  addDocument: addDocument_,
  updateDocument: updateDocument_,
  deleteDocument: deleteDocument_,
  openDocument: openDocument_
};

/* ------------------------------------------------------------------ *
 *  Authentication & authorization
 * ------------------------------------------------------------------ */

function nowSec_() { return Math.floor(Date.now() / 1000); }

function sha_(s) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s));
}

function verifyToken_(idToken) {
  if (!idToken || typeof idToken !== 'string') throw err_('AUTH', 'Please sign in with your university Google account.');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + sha_(idToken);
  var hit = cache.get(key);
  if (hit) {
    var cached = JSON.parse(hit);
    if (cached.exp > nowSec_()) return cached;
  }
  var cfg = getConfig_();
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw err_('AUTH_EXPIRED', 'Your sign-in has expired. Please sign in again.');
  var p = JSON.parse(res.getContentText());
  var exp = Number(p.exp);
  if (!exp || exp <= nowSec_()) throw err_('AUTH_EXPIRED', 'Your sign-in has expired. Please sign in again.');
  if (!cfg.ClientID || p.aud !== cfg.ClientID) throw err_('AUTH', 'This sign-in was not issued for the ICTD Digital File Library.');
  if (String(p.email_verified) !== 'true') throw err_('AUTH', 'Your e-mail address is not verified.');
  var email = String(p.email || '').toLowerCase();
  var domain = email.split('@')[1] || '';
  var domains = String(cfg.AllowedDomains || 'sr.edu.sa').toLowerCase().split(',').map(function (d) { return d.trim(); }).filter(Boolean);
  if (domains.indexOf(domain) < 0 || String(p.hd || '').toLowerCase() !== domain) {
    throw err_('DOMAIN', 'Access is limited to university (@' + domains.join(', @') + ') accounts.');
  }
  var info = { email: email, name: String(p.name || email), exp: exp };
  cache.put(key, JSON.stringify(info), Math.max(60, Math.min(exp - nowSec_(), 3000)));
  return info;
}

function authorize_(idToken) {
  var id = verifyToken_(idToken);
  var cfg = getConfig_();
  var users = readAll_(SHEETS.USERS);
  var rec = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].Email).toLowerCase().trim() === id.email && bool_(users[i].Active)) { rec = users[i]; break; }
  }
  var restrict = cfg.RestrictToAllowedList === undefined || cfg.RestrictToAllowedList === '' ? true : bool_(cfg.RestrictToAllowedList);
  if (!rec && restrict) {
    log_({ email: id.email, name: id.name, role: '-' }, 'denied', 'Not in AllowedUsers');
    throw err_('NOT_ALLOWED', 'Your account is not authorised for this library. Please ask the ICTD administrator to add you.');
  }
  var role = rec && ROLES.indexOf(String(rec.Role)) >= 0 ? String(rec.Role) : 'Viewer';
  return { email: id.email, name: (rec && rec.Name) || id.name, role: role };
}

function isEditor_(u) { return u.role === 'Admin' || u.role === 'Editor'; }
function isAdmin_(u) { return u.role === 'Admin'; }

function need_(cond, msg) { if (!cond) throw err_('FORBIDDEN', msg || 'You do not have permission for this action.'); }

/* ------------------------------------------------------------------ *
 *  Sheet helpers
 * ------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw err_('NOT_SETUP', 'Sheet "' + name + '" is missing. Run setup() from the Apps Script editor.');
  return sh;
}

function bool_(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function cell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : v;
}

function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var cols = HEADERS[name].length;
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols).getValues();
  var head = HEADERS[name];
  var out = [];
  for (var r = 0; r < vals.length; r++) {
    var o = { _row: r + 2 };
    var empty = true;
    for (var c = 0; c < head.length; c++) {
      o[head[c]] = cell_(vals[r][c]);
      if (vals[r][c] !== '' && vals[r][c] !== null) empty = false;
    }
    if (!empty) out.push(o);
  }
  return out;
}

/** Text that Sheets could misread as a formula, number or date is stored as text. */
function safe_(v, max) {
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (max && s.length > max) s = s.substring(0, max);
  if (/^[=+\-@\t\r]/.test(s) || /^\d{1,4}[-\/.]\d{1,2}([-\/.]\d{1,4})?/.test(s) || /^\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return s;
}

function appendObj_(name, obj) {
  var sh = sheet_(name);
  var head = HEADERS[name];
  var row = head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  sh.appendRow(row);
}

function updateRow_(name, rowIndex, patch) {
  var sh = sheet_(name);
  var head = HEADERS[name];
  var range = sh.getRange(rowIndex, 1, 1, head.length);
  var vals = range.getValues()[0];
  head.forEach(function (h, i) { if (patch[h] !== undefined) vals[i] = patch[h]; });
  range.setValues([vals]);
}

function getConfig_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('cfg_v1');
  if (hit) return JSON.parse(hit);
  var cfg = {};
  var sh = ss_().getSheetByName(SHEETS.CONFIG);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0]) cfg[String(r[0]).trim()] = r[1];
    });
  }
  cache.put('cfg_v1', JSON.stringify(cfg), 120);
  return cfg;
}

function setConfigValue_(key, value) {
  var sh = sheet_(SHEETS.CONFIG);
  var vals = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === key) { sh.getRange(i + 2, 2).setValue(value); CacheService.getScriptCache().remove('cfg_v1'); return; }
  }
  sh.appendRow([key, value, '']);
  CacheService.getScriptCache().remove('cfg_v1');
}

function stamp_() {
  var d = new Date();
  return { date: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), time: Utilities.formatDate(d, TZ, 'HH:mm:ss') };
}

function log_(user, action, detail) {
  try {
    var s = stamp_();
    sheet_(SHEETS.LOG).appendRow([safe_(s.date), safe_(s.time), user.email, safe_(user.name, 120), user.role, action, safe_(detail || '', 300)]);
  } catch (e) {
    console.error('log failed: ' + e);
  }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function nextId_(prefix) {
  var props = PropertiesService.getScriptProperties();
  var key = 'seq_' + prefix;
  var n = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(n));
  return prefix + '-' + ('0000' + n).slice(-4);
}

/* ------------------------------------------------------------------ *
 *  Shapes sent to the browser
 * ------------------------------------------------------------------ */

function drawerOut_(d) {
  return { id: d.DrawerID, nameAr: d.NameAr, nameEn: d.NameEn, icon: d.Icon || 'archive', color: d.Color || '#501e8c',
    order: Number(d.Order) || 0, active: bool_(d.Active), description: d.Description || '' };
}

function folderOut_(f) {
  return { id: f.FolderID, drawerId: f.DrawerID, nameAr: f.NameAr, nameEn: f.NameEn, order: Number(f.Order) || 0, active: bool_(f.Active) };
}

function canEditDoc_(u, d) {
  if (isAdmin_(u)) return true;
  if (u.role !== 'Editor') return false;
  return String(d.CreatedBy).toLowerCase() === u.email || String(d.OwnerEmail).toLowerCase() === u.email;
}

function docVisible_(u, d) {
  if (bool_(d.Deleted)) return false;
  if (isEditor_(u)) return true;
  if (d.Confidentiality !== 'Confidential') return true;
  return String(d.CreatedBy).toLowerCase() === u.email || String(d.OwnerEmail).toLowerCase() === u.email;
}

function docOut_(u, d) {
  return {
    id: d.DocID, title: d.Title, drawerId: d.DrawerID, folderId: d.FolderID, date: d.DocDate, owner: d.Owner, ownerEmail: d.OwnerEmail,
    tags: String(d.Tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    description: d.Description || '', version: String(d.Version || ''), status: d.Status || 'Active', conf: d.Confidentiality || 'Internal',
    fileName: d.FileName || '', mime: d.MimeType || '', size: Number(d.SizeBytes) || 0, hasFile: !!(d.DriveURL),
    createdBy: d.CreatedBy, createdAt: d.CreatedAt, updatedBy: d.UpdatedBy, updatedAt: d.UpdatedAt, canEdit: canEditDoc_(u, d)
  };
}

/* ------------------------------------------------------------------ *
 *  Actions
 * ------------------------------------------------------------------ */

function bootstrap_(u, p) {
  if (p.fresh) log_(u, 'signin', '');
  var cfg = getConfig_();
  var admin = isAdmin_(u);
  var drawers = readAll_(SHEETS.DRAWERS).filter(function (d) { return admin || bool_(d.Active); });
  var folders = readAll_(SHEETS.FOLDERS).filter(function (f) { return admin || bool_(f.Active); });
  var okFolder = {};
  folders.forEach(function (f) { okFolder[f.FolderID] = true; });
  var docs = readAll_(SHEETS.DOCS).filter(function (d) { return docVisible_(u, d) && (admin || okFolder[d.FolderID]); });
  return {
    user: { email: u.email, name: u.name, role: u.role },
    config: { libraryName: cfg.LibraryName || 'ICTD Digital File Library', maxUploadMB: Number(cfg.MaxUploadMB) || 20,
      defaultConf: CONFS.indexOf(cfg.DefaultConfidentiality) >= 0 ? cfg.DefaultConfidentiality : 'Internal', version: VERSION },
    drawers: drawers.map(drawerOut_),
    folders: folders.map(folderOut_),
    documents: docs.map(function (d) { return docOut_(u, d); })
  };
}

function ensureRoot_() {
  var cfg = getConfig_();
  if (cfg.RootFolderID) {
    try { return DriveApp.getFolderById(String(cfg.RootFolderID)); } catch (e) { /* recreate below */ }
  }
  var root = DriveApp.createFolder((cfg.LibraryName || 'ICTD Digital File Library') + ' (Files)');
  setConfigValue_('RootFolderID', root.getId());
  return root;
}

function ensureDriveFolder_(row, sheetName, parent, label) {
  if (row.DriveFolderID) {
    try { return DriveApp.getFolderById(String(row.DriveFolderID)); } catch (e) { /* recreate */ }
  }
  var f = parent.createFolder(label);
  updateRow_(sheetName, row._row, { DriveFolderID: f.getId() });
  return f;
}

function label_(o) { return String(o.NameEn || o.NameAr || 'Folder').replace(/[\\\/:*?"<>|]/g, '-').substring(0, 80); }

function names_(p) {
  var ar = String(p.nameAr || '').trim().substring(0, 80);
  var en = String(p.nameEn || '').trim().substring(0, 80);
  if (!ar && !en) throw err_('VALIDATION', 'Please enter a name (Arabic or English).');
  return { ar: ar, en: en };
}

function addDrawer_(u, p) {
  need_(isAdmin_(u), 'Only administrators can add drawers.');
  var n = names_(p);
  var icon = ICONS_OK.indexOf(p.icon) >= 0 ? p.icon : 'archive';
  var color = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#501e8c';
  return withLock_(function () {
    var all = readAll_(SHEETS.DRAWERS);
    var id = nextId_('DRW');
    var row = { DrawerID: id, NameAr: safe_(n.ar), NameEn: safe_(n.en), Icon: icon, Color: color,
      Order: p.order !== undefined && p.order !== '' ? Number(p.order) || 0 : all.length + 1, Active: true,
      Description: safe_(p.description || '', 300), DriveFolderID: '', CreatedBy: u.email, CreatedAt: safe_(stamp_().date) };
    var f = ensureRoot_().createFolder(label_({ NameEn: n.en, NameAr: n.ar }));
    row.DriveFolderID = f.getId();
    appendObj_(SHEETS.DRAWERS, row);
    log_(u, 'add_drawer', id + ' ' + (n.en || n.ar));
    return drawerOut_({ DrawerID: id, NameAr: n.ar, NameEn: n.en, Icon: icon, Color: color, Order: row.Order, Active: true, Description: p.description || '' });
  });
}

function updateDrawer_(u, p) {
  need_(isAdmin_(u), 'Only administrators can edit drawers.');
  return withLock_(function () {
    var d = readAll_(SHEETS.DRAWERS).filter(function (x) { return x.DrawerID === p.id; })[0];
    if (!d) throw err_('NOT_FOUND', 'Drawer not found.');
    var n = names_(p);
    var patch = { NameAr: safe_(n.ar), NameEn: safe_(n.en), Description: safe_(p.description || '', 300), Active: !!p.active };
    if (ICONS_OK.indexOf(p.icon) >= 0) patch.Icon = p.icon;
    if (/^#[0-9a-fA-F]{6}$/.test(p.color || '')) patch.Color = p.color;
    if (p.order !== undefined && p.order !== '') patch.Order = Number(p.order) || 0;
    updateRow_(SHEETS.DRAWERS, d._row, patch);
    log_(u, 'edit_drawer', d.DrawerID);
    return drawerOut_(readAll_(SHEETS.DRAWERS).filter(function (x) { return x.DrawerID === p.id; })[0]);
  });
}

function addFolder_(u, p) {
  need_(isEditor_(u), 'Only editors can add folders.');
  var n = names_(p);
  return withLock_(function () {
    var drawer = readAll_(SHEETS.DRAWERS).filter(function (x) { return x.DrawerID === p.drawerId; })[0];
    if (!drawer) throw err_('NOT_FOUND', 'Drawer not found.');
    var siblings = readAll_(SHEETS.FOLDERS).filter(function (x) { return x.DrawerID === drawer.DrawerID; });
    var parent = ensureDriveFolder_(drawer, SHEETS.DRAWERS, ensureRoot_(), label_(drawer));
    var id = nextId_('FLD');
    var f = parent.createFolder(label_({ NameEn: n.en, NameAr: n.ar }));
    var row = { FolderID: id, DrawerID: drawer.DrawerID, NameAr: safe_(n.ar), NameEn: safe_(n.en), Order: siblings.length + 1, Active: true,
      DriveFolderID: f.getId(), CreatedBy: u.email, CreatedAt: safe_(stamp_().date) };
    appendObj_(SHEETS.FOLDERS, row);
    log_(u, 'add_folder', id + ' ' + (n.en || n.ar));
    return folderOut_({ FolderID: id, DrawerID: drawer.DrawerID, NameAr: n.ar, NameEn: n.en, Order: row.Order, Active: true });
  });
}

function updateFolder_(u, p) {
  need_(isAdmin_(u), 'Only administrators can edit folders.');
  return withLock_(function () {
    var f = readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === p.id; })[0];
    if (!f) throw err_('NOT_FOUND', 'Folder not found.');
    var n = names_(p);
    var patch = { NameAr: safe_(n.ar), NameEn: safe_(n.en), Active: !!p.active };
    if (p.order !== undefined && p.order !== '') patch.Order = Number(p.order) || 0;
    updateRow_(SHEETS.FOLDERS, f._row, patch);
    log_(u, 'edit_folder', f.FolderID);
    return folderOut_(readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === p.id; })[0]);
  });
}

function cleanTags_(tags) {
  var arr = Array.isArray(tags) ? tags : String(tags || '').split(',');
  var seen = {};
  var out = [];
  arr.forEach(function (t) {
    t = String(t).replace(/[,\n\r]/g, ' ').trim().substring(0, 40);
    var k = t.toLowerCase();
    if (t && !seen[k] && out.length < 20) { seen[k] = true; out.push(t); }
  });
  return out;
}

function validateDocFields_(p) {
  var title = String(p.title || '').trim();
  if (!title) throw err_('VALIDATION', 'Title is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) throw err_('VALIDATION', 'Document date is required (YYYY-MM-DD).');
  var owner = String(p.owner || '').trim();
  if (!owner) throw err_('VALIDATION', 'Owner is required.');
  var ownerEmail = String(p.ownerEmail || '').trim().toLowerCase();
  if (ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) ownerEmail = '';
  return {
    title: title.substring(0, 250), date: p.date, owner: owner.substring(0, 100), ownerEmail: ownerEmail,
    tags: cleanTags_(p.tags).join(', '), description: String(p.description || '').substring(0, 2000),
    version: String(p.version || '1.0').substring(0, 20),
    status: STATUSES.indexOf(p.status) >= 0 ? p.status : 'Active',
    conf: CONFS.indexOf(p.conf) >= 0 ? p.conf : 'Internal'
  };
}

function resolveFolder_(p) {
  var folder = readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === p.folderId; })[0];
  if (!folder || folder.DrawerID !== p.drawerId) throw err_('VALIDATION', 'Please choose a valid drawer and folder.');
  var drawer = readAll_(SHEETS.DRAWERS).filter(function (x) { return x.DrawerID === folder.DrawerID; })[0];
  if (!drawer) throw err_('VALIDATION', 'Please choose a valid drawer and folder.');
  return { folder: folder, drawer: drawer };
}

function fileIdFromUrl_(url) {
  var m = String(url).match(/\/d\/([\w-]{20,})/) || String(url).match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : '';
}

function addDocument_(u, p) {
  need_(isEditor_(u), 'Only editors can add documents.');
  var v = validateDocFields_(p);
  return withLock_(function () {
    var loc = resolveFolder_(p);
    var cfg = getConfig_();
    var fileName = '', mime = '', size = 0, fileId = '', url = '';
    if (p.upload && p.upload.data) {
      var name = String(p.upload.name || 'document').replace(/[\\\/:*?"<>|]/g, '-').substring(0, 180);
      var ext = (name.split('.').pop() || '').toLowerCase();
      if (BLOCKED_EXT.indexOf(ext) >= 0) throw err_('VALIDATION', 'This file type is not allowed.');
      var maxMB = Number(cfg.MaxUploadMB) || 20;
      if (p.upload.data.length > maxMB * 1024 * 1024 * 1.38) throw err_('VALIDATION', 'File is larger than ' + maxMB + ' MB.');
      var bytes = Utilities.base64Decode(p.upload.data);
      if (bytes.length > maxMB * 1024 * 1024) throw err_('VALIDATION', 'File is larger than ' + maxMB + ' MB.');
      var blob = Utilities.newBlob(bytes, String(p.upload.mime || 'application/octet-stream'), name);
      var parent = ensureDriveFolder_(loc.folder, SHEETS.FOLDERS,
        ensureDriveFolder_(loc.drawer, SHEETS.DRAWERS, ensureRoot_(), label_(loc.drawer)), label_(loc.folder));
      var file = parent.createFile(blob);
      fileName = name; mime = blob.getContentType() || ''; size = bytes.length; fileId = file.getId(); url = file.getUrl();
    } else if (p.link) {
      if (!/^https:\/\/(drive|docs)\.google\.com\//.test(String(p.link))) throw err_('VALIDATION', 'Please paste a Google Drive or Google Docs link.');
      url = String(p.link).substring(0, 500);
      fileId = fileIdFromUrl_(url);
      fileName = 'Google Drive link';
    } else {
      throw err_('VALIDATION', 'Please attach a file or paste a Google Drive link.');
    }
    var id = nextId_('DOC');
    var s = stamp_();
    var row = {
      DocID: id, Title: safe_(v.title), DrawerID: loc.drawer.DrawerID, FolderID: loc.folder.FolderID, DocDate: safe_(v.date), Owner: safe_(v.owner),
      OwnerEmail: v.ownerEmail, Tags: safe_(v.tags), Description: safe_(v.description), Version: safe_(v.version), Status: v.status,
      Confidentiality: v.conf, FileName: safe_(fileName), MimeType: safe_(mime), SizeBytes: size, DriveFileID: fileId, DriveURL: url,
      CreatedBy: u.email, CreatedAt: safe_(s.date + ' ' + s.time), UpdatedBy: '', UpdatedAt: '', Deleted: false
    };
    appendObj_(SHEETS.DOCS, row);
    log_(u, 'add_doc', id + ' ' + v.title);
    row.Title = v.title; row.DocDate = v.date; row.Owner = v.owner; row.Tags = v.tags; row.Description = v.description;
    row.Version = v.version; row.FileName = fileName; row.MimeType = mime; row.CreatedAt = s.date + ' ' + s.time;
    return docOut_(u, row);
  });
}

function updateDocument_(u, p) {
  var v = validateDocFields_(p);
  return withLock_(function () {
    var d = readAll_(SHEETS.DOCS).filter(function (x) { return x.DocID === p.id && !bool_(x.Deleted); })[0];
    if (!d) throw err_('NOT_FOUND', 'Document not found.');
    need_(canEditDoc_(u, d), 'You can only edit documents you created or own.');
    var loc = resolveFolder_(p);
    if (d.FolderID !== loc.folder.FolderID && d.DriveFileID) {
      try {
        var target = ensureDriveFolder_(loc.folder, SHEETS.FOLDERS,
          ensureDriveFolder_(loc.drawer, SHEETS.DRAWERS, ensureRoot_(), label_(loc.drawer)), label_(loc.folder));
        DriveApp.getFileById(String(d.DriveFileID)).moveTo(target);
      } catch (e) { console.warn('Could not move Drive file: ' + e); }
    }
    var s = stamp_();
    var patch = {
      Title: safe_(v.title), DrawerID: loc.drawer.DrawerID, FolderID: loc.folder.FolderID, DocDate: safe_(v.date), Owner: safe_(v.owner),
      OwnerEmail: v.ownerEmail, Tags: safe_(v.tags), Description: safe_(v.description), Version: safe_(v.version), Status: v.status,
      Confidentiality: v.conf, UpdatedBy: u.email, UpdatedAt: safe_(s.date + ' ' + s.time)
    };
    updateRow_(SHEETS.DOCS, d._row, patch);
    log_(u, 'edit_doc', d.DocID);
    var fresh = readAll_(SHEETS.DOCS).filter(function (x) { return x.DocID === p.id; })[0];
    return docOut_(u, fresh);
  });
}

function deleteDocument_(u, p) {
  return withLock_(function () {
    var d = readAll_(SHEETS.DOCS).filter(function (x) { return x.DocID === p.id && !bool_(x.Deleted); })[0];
    if (!d) throw err_('NOT_FOUND', 'Document not found.');
    need_(canEditDoc_(u, d), 'You can only delete documents you created or own.');
    var s = stamp_();
    updateRow_(SHEETS.DOCS, d._row, { Deleted: true, UpdatedBy: u.email, UpdatedAt: safe_(s.date + ' ' + s.time) });
    log_(u, 'delete_doc', d.DocID + ' ' + d.Title);
    return { id: d.DocID };
  });
}

function grantViewer_(fileId, email) {
  if (!fileId) return false;
  try {
    if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.create) {
      Drive.Permissions.create({ role: 'reader', type: 'user', emailAddress: email }, fileId, { sendNotificationEmail: false, supportsAllDrives: true });
    } else {
      DriveApp.getFileById(fileId).addViewer(email);
    }
    return true;
  } catch (e) {
    console.warn('grantViewer failed: ' + e);
    return false;
  }
}

function openDocument_(u, p) {
  var d = readAll_(SHEETS.DOCS).filter(function (x) { return x.DocID === p.id; })[0];
  if (!d || !docVisible_(u, d) || !d.DriveURL) throw err_('NOT_FOUND', 'Document not found.');
  var granted = grantViewer_(String(d.DriveFileID || ''), u.email);
  log_(u, 'open', d.DocID + ' ' + d.Title);
  return { url: d.DriveURL, granted: granted };
}

/* ------------------------------------------------------------------ *
 *  One-time setup (run from the editor or from the "ICTD Library" menu)
 * ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ICTD Library')
    .addItem('Run setup (first time)', 'setup')
    .addItem('Show deployment checklist', 'showChecklist')
    .addToUi();
}

function styleHeader_(sh, n) {
  var r = sh.getRange(1, 1, 1, n);
  r.setFontWeight('bold').setFontColor('#ffffff').setBackground('#501e8c');
  sh.setFrozenRows(1);
}

function setup() {
  var book = ss_();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = book.getSheetByName(name) || book.insertSheet(name);
    var head = HEADERS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    styleHeader_(sh, head.length);
    sh.autoResizeColumns(1, head.length);
  });
  var blank = book.getSheetByName('Sheet1');
  if (blank && book.getSheets().length > 1 && blank.getLastRow() === 0) book.deleteSheet(blank);

  // Config defaults (never overwrite existing values)
  var cfgSheet = book.getSheetByName(SHEETS.CONFIG);
  var have = {};
  if (cfgSheet.getLastRow() >= 2) cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 1).getValues().forEach(function (r) { have[String(r[0]).trim()] = true; });
  DEFAULT_CONFIG.forEach(function (r) { if (!have[r[0]]) cfgSheet.appendRow(r); });
  cfgSheet.setColumnWidth(2, 360); cfgSheet.setColumnWidth(3, 520);
  CacheService.getScriptCache().remove('cfg_v1');

  // Validation lists
  var users = book.getSheetByName(SHEETS.USERS);
  users.getRange(2, 3, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).build());
  users.getRange(2, 4, 500, 1).insertCheckboxes();
  var docs = book.getSheetByName(SHEETS.DOCS);
  docs.getRange(2, 11, 2000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  docs.getRange(2, 12, 2000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CONFS, true).build());

  // First administrator = the person running setup
  if (users.getLastRow() < 2) {
    var me = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
    if (me) users.appendRow([me.toLowerCase(), 'Library Administrator', 'Admin', true, safe_(stamp_().date)]);
  }

  // Root folder, sample drawers and folders (only on a fresh install)
  var root = ensureRoot_();
  var drawersSheet = book.getSheetByName(SHEETS.DRAWERS);
  if (drawersSheet.getLastRow() < 2) {
    var seed = [
      ['السياسات', 'Policies', 'scroll-text', '#501e8c', 'سياسات الإدارة ولوائحها', [['أمن المعلومات', 'Information Security'], ['تشغيل تقنية المعلومات', 'IT Operations'], ['الاستخدام المقبول', 'Acceptable Use']]],
      ['العقود', 'Contracts', 'file-signature', '#0a6eaa', 'العقود واتفاقيات الخدمة', [['عقود سارية', 'Active Contracts'], ['عقود منتهية', 'Expired Contracts'], ['اتفاقيات عدم الإفصاح', 'NDAs']]],
      ['المشاريع', 'Projects', 'kanban', '#1f7a5c', 'وثائق المشاريع', [['مشاريع جارية', 'Active Projects'], ['مشاريع مكتملة', 'Completed Projects'], ['مقترحات المشاريع', 'Project Proposals']]],
      ['التقارير', 'Reports', 'chart-column', '#b4540a', 'التقارير الدورية', [['تقارير أسبوعية', 'Weekly Reports'], ['تقارير شهرية', 'Monthly Reports'], ['تقارير سنوية', 'Annual Reports']]],
      ['الموارد البشرية', 'HR', 'users', '#8a2a6b', 'وثائق الموارد البشرية', [['الأوصاف الوظيفية', 'Job Descriptions'], ['التدريب', 'Training'], ['التقييمات', 'Evaluations']]],
      ['المشتريات', 'Procurement', 'shopping-cart', '#3a4a8a', 'طلبات الشراء والعروض', [['طلبات الشراء', 'Purchase Requests'], ['عروض الأسعار', 'Quotations'], ['أوامر الشراء', 'Purchase Orders']]]
    ];
    var admin = Session.getEffectiveUser().getEmail() || 'setup';
    var today = safe_(stamp_().date);
    seed.forEach(function (d, i) {
      var did = nextId_('DRW');
      var df = root.createFolder(d[1]);
      appendObj_(SHEETS.DRAWERS, { DrawerID: did, NameAr: d[0], NameEn: d[1], Icon: d[2], Color: d[3], Order: i + 1, Active: true,
        Description: d[4], DriveFolderID: df.getId(), CreatedBy: admin, CreatedAt: today });
      d[5].forEach(function (f, j) {
        var ff = df.createFolder(f[1]);
        appendObj_(SHEETS.FOLDERS, { FolderID: nextId_('FLD'), DrawerID: did, NameAr: f[0], NameEn: f[1], Order: j + 1, Active: true,
          DriveFolderID: ff.getId(), CreatedBy: admin, CreatedAt: today });
      });
    });
  }
  showChecklist();
}

function showChecklist() {
  var msg = 'Setup finished.\n\nNext steps:\n' +
    '1) Config sheet: paste your OAuth Client ID in ClientID.\n' +
    '2) AllowedUsers sheet: add your team (Admin / Editor / Viewer).\n' +
    '3) Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".\n' +
    '4) Copy the Web app URL into assets/js/config.js (WEB_APP_URL) and the Client ID into GOOGLE_CLIENT_ID.\n' +
    '5) Optional: share the Drive root folder (Config > RootFolderID) with your ICTD group as Viewer.';
  try { SpreadsheetApp.getUi().alert('ICTD Digital File Library', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(msg); }
}
