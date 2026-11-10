/**
 * ICTD Digital File Library — Google Apps Script backend
 * Version 2.6 (2026-11-10)
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

var VERSION = '2.6';

/**
 * Paste your OAuth Web Client ID here. setup() / finishSetup() write it into the
 * Config sheet automatically, so you do not have to edit the cell by hand.
 * Leave it as '' to manage the ClientID cell manually instead.
 */
var CLIENT_ID = '286826767897-ptof53iq20gn5964e8ogvpk0c71cu944.apps.googleusercontent.com';

/**
 * Optional: re-home all file storage into this folder (e.g. the shared ITOC folder),
 * then run rebuildStorage() once. The folder must be shared with the account that runs
 * the script (Editor). Leave '' to keep storage where it is.
 */
var STORAGE_FOLDER_ID = '1KjQry87vYE4BdjA_HTW9SLrX-Yw0Yf4b';

var SHEETS = {
  CONFIG: 'Config',
  DRAWERS: 'Drawers',
  FOLDERS: 'Folders',
  DOCS: 'Documents',
  USERS: 'AllowedUsers',
  GRANTS: 'FolderGrants',
  LOG: 'AccessLog'
};

var HEADERS = {
  Config: ['Key', 'Value', 'Note'],
  Drawers: ['DrawerID', 'NameAr', 'NameEn', 'Icon', 'Color', 'Order', 'Active', 'Description', 'DriveFolderID', 'CreatedBy', 'CreatedAt'],
  Folders: ['FolderID', 'DrawerID', 'NameAr', 'NameEn', 'Order', 'Active', 'DriveFolderID', 'CreatedBy', 'CreatedAt', 'Access'],
  Documents: ['DocID', 'Title', 'DrawerID', 'FolderID', 'DocDate', 'Owner', 'OwnerEmail', 'Tags', 'Description', 'Version', 'Status',
    'Confidentiality', 'FileName', 'MimeType', 'SizeBytes', 'DriveFileID', 'DriveURL', 'CreatedBy', 'CreatedAt', 'UpdatedBy', 'UpdatedAt', 'Deleted'],
  AllowedUsers: ['Email', 'Name', 'Role', 'Active', 'AddedAt'],
  FolderGrants: ['GrantID', 'FolderID', 'Email', 'Role', 'Active', 'AddedBy', 'AddedAt'],
  AccessLog: ['Date', 'Time', 'Email', 'Name', 'Role', 'Action', 'Detail']
};

var DEFAULT_CONFIG = [
  ['LibraryName', 'ICTD Digital File Library', 'Display name'],
  ['ClientID', 'PASTE_OAUTH_CLIENT_ID.apps.googleusercontent.com', 'Google OAuth Web Client ID (same value as GOOGLE_CLIENT_ID in assets/js/config.js)'],
  ['AllowedDomains', 'sr.edu.sa', 'Comma-separated Google Workspace domains allowed to sign in'],
  ['RestrictToAllowedList', true, 'TRUE = only users listed (and Active) in AllowedUsers may enter. FALSE = any @sr.edu.sa account enters as Viewer'],
  ['MaxUploadMB', 40, 'Maximum in-app upload size per file (MB). Apps Script caps the POST body at ~50 MB and base64 adds ~37%, so keep this at or below ~40; for larger files use the Google Drive link option.'],
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
  deleteFolder: deleteFolder_,
  addDocument: addDocument_,
  updateDocument: updateDocument_,
  deleteDocument: deleteDocument_,
  openDocument: openDocument_,
  listUsers: listUsers_,
  saveUser: saveUser_,
  deleteUser: deleteUser_,
  auditLog: listAuditLog_,
  importDriveFolder: importDriveFolder_,
  listFolderAccess: listFolderAccess_,
  setFolderAccess: setFolderAccess_,
  saveFolderGrant: saveFolderGrant_,
  deleteFolderGrant: deleteFolderGrant_
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

// One-time (v2.5): raise the stored upload cap from the old 20 MB default to 40 MB.
// Guarded by a script property; only raises, never lowers an admin-set higher value.
function ensureUploadLimit_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('upload40_done')) return;
    var cur = Number(getConfig_().MaxUploadMB) || 0;
    if (cur < 40) setConfigValue_('MaxUploadMB', 40);
    props.setProperty('upload40_done', '1');
  } catch (e) { /* non-fatal */ }
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

/* ---- Folder-level access control (ACL) ---- */
var RANK = { Viewer: 1, Editor: 2, Admin: 3 };

/** Make sure the FolderGrants sheet and the Folders "Access" column exist (one-time). */
function ensureAcl_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('acl_ready') === '1') return;
  var book = ss_();
  if (!book.getSheetByName(SHEETS.GRANTS)) {
    var sh = book.insertSheet(SHEETS.GRANTS);
    sh.getRange(1, 1, 1, HEADERS.FolderGrants.length).setValues([HEADERS.FolderGrants]);
    try { styleHeader_(sh, HEADERS.FolderGrants.length); } catch (e) { /* styleHeader defined later; ignore */ }
    sh.setFrozenRows(1);
  }
  var fo = book.getSheetByName(SHEETS.FOLDERS);
  if (fo) { var col = HEADERS.Folders.indexOf('Access') + 1; if (String(fo.getRange(1, col).getValue()) !== 'Access') fo.getRange(1, col).setValue('Access'); }
  props.setProperty('acl_ready', '1');
}

function readGrants_() { try { return readAll_(SHEETS.GRANTS); } catch (e) { return []; } }

/** { folderId: { email: {role, active} } } */
function grantsIndex_() {
  var idx = {};
  readGrants_().forEach(function (g) {
    if (!g.FolderID || !g.Email) return;
    (idx[g.FolderID] = idx[g.FolderID] || {})[String(g.Email).toLowerCase().trim()] =
      { role: ROLES.indexOf(String(g.Role)) >= 0 ? String(g.Role) : 'Viewer', active: bool_(g.Active) };
  });
  return idx;
}

function folderAccessMode_(f) { return String(f.Access || 'open').toLowerCase() === 'restricted' ? 'restricted' : 'open'; }

/** Effective role of user u on folder f: 'Admin' | 'Editor' | 'Viewer' | null (no access). */
function effFolderRole_(u, f, idx) {
  if (isAdmin_(u)) return 'Admin';
  var g = idx[f.FolderID] && idx[f.FolderID][u.email];
  var grantRole = (g && g.active) ? g.role : null;
  if (folderAccessMode_(f) === 'restricted') return grantRole; // only granted users (or global admins)
  var base = u.role === 'Editor' ? 'Editor' : (u.role === 'Viewer' ? 'Viewer' : null);
  if (!base) return grantRole;
  if (!grantRole) return base;
  return RANK[grantRole] >= RANK[base] ? grantRole : base;
}
function myFolderRole_(u, f) { return f ? effFolderRole_(u, f, grantsIndex_()) : null; }
function folderById_(id) { return readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === id; })[0]; }

function folderOut_(f, myRole) {
  return { id: f.FolderID, drawerId: f.DrawerID, nameAr: f.NameAr, nameEn: f.NameEn, order: Number(f.Order) || 0, active: bool_(f.Active),
    access: folderAccessMode_(f), myRole: myRole || null, canManage: myRole === 'Admin', canEdit: myRole === 'Admin' || myRole === 'Editor' };
}

function canEditDoc_(u, d, role) {
  if (role === 'Admin') return true;
  if (role === 'Editor') return String(d.CreatedBy).toLowerCase() === u.email || String(d.OwnerEmail).toLowerCase() === u.email;
  return false;
}

function docVisible_(u, d, role) {
  if (bool_(d.Deleted)) return false;
  if (role == null) return false;
  if (d.Confidentiality !== 'Confidential') return true;
  if (role === 'Admin' || role === 'Editor') return true;
  return String(d.CreatedBy).toLowerCase() === u.email || String(d.OwnerEmail).toLowerCase() === u.email;
}

function docOut_(u, d, role) {
  return {
    id: d.DocID, title: d.Title, drawerId: d.DrawerID, folderId: d.FolderID, date: d.DocDate, owner: d.Owner, ownerEmail: d.OwnerEmail,
    tags: String(d.Tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    description: d.Description || '', version: String(d.Version || ''), status: d.Status || 'Active', conf: d.Confidentiality || 'Internal',
    fileName: d.FileName || '', mime: d.MimeType || '', size: Number(d.SizeBytes) || 0, hasFile: !!(d.DriveURL),
    createdBy: d.CreatedBy, createdAt: d.CreatedAt, updatedBy: d.UpdatedBy, updatedAt: d.UpdatedAt, canEdit: canEditDoc_(u, d, role)
  };
}

/* ------------------------------------------------------------------ *
 *  Actions
 * ------------------------------------------------------------------ */

function bootstrap_(u, p) {
  ensureAcl_();
  ensureUploadLimit_();
  if (p.fresh) log_(u, 'signin', '');
  var cfg = getConfig_();
  var admin = isAdmin_(u);
  var idx = grantsIndex_();
  var drawers = readAll_(SHEETS.DRAWERS).filter(function (d) { return admin || bool_(d.Active); });
  var folderRole = {}, folders = [];
  readAll_(SHEETS.FOLDERS).forEach(function (f) {
    if (!admin && !bool_(f.Active)) return;
    var r = effFolderRole_(u, f, idx);
    if (r == null) return;              // no access to this folder
    folderRole[f.FolderID] = r; folders.push(f);
  });
  var docs = readAll_(SHEETS.DOCS).filter(function (d) { var r = folderRole[d.FolderID]; return r != null && docVisible_(u, d, r); });
  return {
    user: { email: u.email, name: u.name, role: u.role },
    config: { libraryName: cfg.LibraryName || 'ICTD Digital File Library', maxUploadMB: Number(cfg.MaxUploadMB) || 40,
      defaultConf: CONFS.indexOf(cfg.DefaultConfidentiality) >= 0 ? cfg.DefaultConfidentiality : 'Internal', version: VERSION },
    drawers: drawers.map(drawerOut_),
    folders: folders.map(function (f) { return folderOut_(f, folderRole[f.FolderID]); }),
    documents: docs.map(function (d) { return docOut_(u, d, folderRole[d.FolderID]); })
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
      DriveFolderID: f.getId(), CreatedBy: u.email, CreatedAt: safe_(stamp_().date), Access: 'open' };
    appendObj_(SHEETS.FOLDERS, row);
    log_(u, 'add_folder', id + ' ' + (n.en || n.ar));
    return folderOut_({ FolderID: id, DrawerID: drawer.DrawerID, NameAr: n.ar, NameEn: n.en, Order: row.Order, Active: true, Access: 'open' }, isAdmin_(u) ? 'Admin' : 'Editor');
  });
}

function updateFolder_(u, p) {
  return withLock_(function () {
    var f = readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === p.id; })[0];
    if (!f) throw err_('NOT_FOUND', 'Folder not found.');
    need_(myFolderRole_(u, f) === 'Admin', 'Only administrators or folder managers can edit this folder.');
    var n = names_(p);
    var patch = { NameAr: safe_(n.ar), NameEn: safe_(n.en), Active: !!p.active };
    if (p.order !== undefined && p.order !== '') patch.Order = Number(p.order) || 0;
    updateRow_(SHEETS.FOLDERS, f._row, patch);
    log_(u, 'edit_folder', f.FolderID);
    var fresh = readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === p.id; })[0];
    return folderOut_(fresh, myFolderRole_(u, fresh));
  });
}

function deleteFolder_(u, p) {
  return withLock_(function () {
    var f = readAll_(SHEETS.FOLDERS).filter(function (x) { return x.FolderID === p.id; })[0];
    if (!f) throw err_('NOT_FOUND', 'Folder not found.');
    need_(myFolderRole_(u, f) === 'Admin', 'Only administrators or folder managers can delete this folder.');
    var docs = readAll_(SHEETS.DOCS).filter(function (d) { return d.FolderID === f.FolderID && !bool_(d.Deleted); });
    if (docs.length && !p.force) throw err_('HAS_DOCS', String(docs.length));
    var s = stamp_(), deletedDocs = [];
    docs.forEach(function (d) {
      updateRow_(SHEETS.DOCS, d._row, { Deleted: true, UpdatedBy: u.email, UpdatedAt: safe_(s.date + ' ' + s.time) });
      deletedDocs.push(d.DocID);
    });
    // remove the folder row and any access grants on it
    sheet_(SHEETS.FOLDERS).deleteRow(f._row);
    var gsh = ss_().getSheetByName(SHEETS.GRANTS);
    if (gsh) readGrants_().filter(function (g) { return g.FolderID === f.FolderID; }).sort(function (a, b) { return b._row - a._row; }).forEach(function (g) { gsh.deleteRow(g._row); });
    // trash the Drive subfolder only if it is now empty
    if (f.DriveFolderID) {
      try {
        var fo = DriveApp.getFolderById(String(f.DriveFolderID));
        if (!fo.getFiles().hasNext() && !fo.getFolders().hasNext()) fo.setTrashed(true);
      } catch (e) { /* leave the Drive folder as-is */ }
    }
    log_(u, 'delete_folder', f.FolderID + (deletedDocs.length ? ' (+' + deletedDocs.length + ' docs)' : ''));
    return { id: f.FolderID, deletedDocs: deletedDocs };
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

function folderIdFromUrl_(s) {
  s = String(s || '').trim();
  var m = s.match(/\/folders\/([\w-]{15,})/) || s.match(/[?&]id=([\w-]{15,})/) || s.match(/^([\w-]{15,})$/);
  return m ? m[1] : '';
}

function addDocument_(u, p) {
  var v = validateDocFields_(p);
  return withLock_(function () {
    var loc = resolveFolder_(p);
    var role = myFolderRole_(u, loc.folder);
    need_(role === 'Admin' || role === 'Editor', 'You do not have permission to add documents to this folder.');
    var cfg = getConfig_();
    var fileName = '', mime = '', size = 0, fileId = '', url = '';
    if (p.upload && p.upload.data) {
      var name = String(p.upload.name || 'document').replace(/[\\\/:*?"<>|]/g, '-').substring(0, 180);
      var ext = (name.split('.').pop() || '').toLowerCase();
      if (BLOCKED_EXT.indexOf(ext) >= 0) throw err_('VALIDATION', 'This file type is not allowed.');
      var maxMB = Number(cfg.MaxUploadMB) || 40;
      var tooBigMsg = 'File is larger than ' + maxMB + ' MB. Please upload it to Google Drive and paste the share link instead.';
      if (p.upload.data.length > maxMB * 1024 * 1024 * 1.38) throw err_('VALIDATION', tooBigMsg);
      var bytes = Utilities.base64Decode(p.upload.data);
      if (bytes.length > maxMB * 1024 * 1024) throw err_('VALIDATION', tooBigMsg);
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
    return docOut_(u, row, role);
  });
}

// Bulk-index every file already sitting in a Google Drive folder into a library folder,
// by reference (link) — files are not moved or copied. Idempotent: skips files already indexed here.
function importDriveFolder_(u, p) {
  var driveId = folderIdFromUrl_(p.driveUrl);
  if (!driveId) throw err_('VALIDATION', 'Please paste a valid Google Drive folder link.');
  return withLock_(function () {
    var loc = resolveFolder_(p);
    var role = myFolderRole_(u, loc.folder);
    need_(role === 'Admin' || role === 'Editor', 'You do not have permission to add documents to this folder.');
    var src;
    try { src = DriveApp.getFolderById(driveId); }
    catch (e) { throw err_('NOT_FOUND', 'Could not open that Drive folder. Check the link and make sure the library account has access to it.'); }
    var cfg = getConfig_();
    var defConf = CONFS.indexOf(cfg.DefaultConfidentiality) >= 0 ? cfg.DefaultConfidentiality : 'Internal';
    var existing = {};
    readAll_(SHEETS.DOCS).forEach(function (d) {
      if (!bool_(d.Deleted) && d.FolderID === loc.folder.FolderID && d.DriveFileID) existing[String(d.DriveFileID)] = true;
    });
    var owner = (u.name || u.email).substring(0, 100);
    var s = stamp_();
    var added = [], skipped = 0, blocked = 0, guard = 0;
    var it = src.getFiles();
    while (it.hasNext() && guard < 400) {
      guard++;
      var f = it.next();
      var fid = f.getId();
      if (existing[fid]) { skipped++; continue; }
      var name = String(f.getName() || 'file');
      var ext = (name.split('.').pop() || '').toLowerCase();
      if (BLOCKED_EXT.indexOf(ext) >= 0) { blocked++; continue; }
      var dt; try { dt = Utilities.formatDate(f.getLastUpdated() || new Date(), TZ, 'yyyy-MM-dd'); } catch (e2) { dt = s.date; }
      var id = nextId_('DOC');
      var row = {
        DocID: id, Title: safe_(name.substring(0, 250)), DrawerID: loc.drawer.DrawerID, FolderID: loc.folder.FolderID,
        DocDate: safe_(dt), Owner: safe_(owner), OwnerEmail: u.email, Tags: '', Description: '',
        Version: '1.0', Status: 'Active', Confidentiality: defConf, FileName: safe_(name.substring(0, 180)),
        MimeType: safe_(String(f.getMimeType() || '')), SizeBytes: Number(f.getSize()) || 0, DriveFileID: fid, DriveURL: f.getUrl(),
        CreatedBy: u.email, CreatedAt: safe_(s.date + ' ' + s.time), UpdatedBy: '', UpdatedAt: '', Deleted: false
      };
      appendObj_(SHEETS.DOCS, row);
      existing[fid] = true;
      row.Title = name; row.FileName = name; row.DocDate = dt; row.Owner = owner; row.Tags = ''; row.CreatedAt = s.date + ' ' + s.time;
      added.push(docOut_(u, row, role));
    }
    log_(u, 'import_drive', loc.folder.FolderID + ' +' + added.length + (skipped ? ' (skip ' + skipped + ')' : '') + (blocked ? ' (blocked ' + blocked + ')' : ''));
    return { imported: added.length, skipped: skipped, blocked: blocked, more: it.hasNext(), docs: added, folderId: loc.folder.FolderID };
  });
}

function updateDocument_(u, p) {
  var v = validateDocFields_(p);
  return withLock_(function () {
    var d = readAll_(SHEETS.DOCS).filter(function (x) { return x.DocID === p.id && !bool_(x.Deleted); })[0];
    if (!d) throw err_('NOT_FOUND', 'Document not found.');
    var idx = grantsIndex_();
    var srcRole = effFolderRole_(u, folderById_(d.FolderID) || { FolderID: d.FolderID }, idx);
    need_(canEditDoc_(u, d, srcRole), 'You can only edit documents you created or own.');
    var loc = resolveFolder_(p);
    if (loc.folder.FolderID !== d.FolderID) {
      var destRole = effFolderRole_(u, loc.folder, idx);
      need_(destRole === 'Admin' || destRole === 'Editor', 'You do not have permission to move the document to that folder.');
    }
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
    return docOut_(u, fresh, myFolderRole_(u, loc.folder));
  });
}

function deleteDocument_(u, p) {
  return withLock_(function () {
    var d = readAll_(SHEETS.DOCS).filter(function (x) { return x.DocID === p.id && !bool_(x.Deleted); })[0];
    if (!d) throw err_('NOT_FOUND', 'Document not found.');
    need_(canEditDoc_(u, d, myFolderRole_(u, folderById_(d.FolderID) || { FolderID: d.FolderID })), 'You can only delete documents you created or own.');
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
  if (!d) throw err_('NOT_FOUND', 'Document not found.');
  var role = myFolderRole_(u, folderById_(d.FolderID) || { FolderID: d.FolderID });
  if (!docVisible_(u, d, role) || !d.DriveURL) throw err_('NOT_FOUND', 'Document not found.');
  var granted = grantViewer_(String(d.DriveFileID || ''), u.email);
  log_(u, 'open', d.DocID + ' ' + d.Title);
  return { url: d.DriveURL, granted: granted };
}

/* ------------------------------------------------------------------ *
 *  Access management (Admin only) — AllowedUsers
 * ------------------------------------------------------------------ */

function usersOut_() {
  return readAll_(SHEETS.USERS).filter(function (r) { return String(r.Email).trim(); }).map(function (r) {
    return { email: String(r.Email).toLowerCase().trim(), name: r.Name || '',
      role: ROLES.indexOf(String(r.Role)) >= 0 ? String(r.Role) : 'Viewer', active: bool_(r.Active), addedAt: r.AddedAt || '' };
  }).sort(function (a, b) { return a.email.localeCompare(b.email); });
}

function listUsers_(u) {
  need_(isAdmin_(u), 'Only administrators can manage access.');
  return { users: usersOut_(), me: u.email };
}

/* ---- Folder access management (folder managers / admins) ---- */
function canManageFolder_(u, f) { return myFolderRole_(u, f) === 'Admin'; }

function folderAccessOut_(u, f) {
  var idx = grantsIndex_()[f.FolderID] || {};
  var names = {}; usersOut_().forEach(function (x) { names[x.email] = x.name; });
  var grants = Object.keys(idx).map(function (em) { return { email: em, name: names[em] || '', role: idx[em].role, active: idx[em].active }; })
    .sort(function (a, b) { return a.email.localeCompare(b.email); });
  return { folderId: f.FolderID, nameAr: f.NameAr, nameEn: f.NameEn, access: folderAccessMode_(f), grants: grants, me: u.email, users: usersOut_() };
}

function listFolderAccess_(u, p) {
  ensureAcl_();
  var f = folderById_(p.folderId);
  if (!f) throw err_('NOT_FOUND', 'Folder not found.');
  need_(canManageFolder_(u, f), 'Only administrators or folder managers can manage folder access.');
  return folderAccessOut_(u, f);
}

function setFolderAccess_(u, p) {
  ensureAcl_();
  return withLock_(function () {
    var f = folderById_(p.folderId);
    if (!f) throw err_('NOT_FOUND', 'Folder not found.');
    need_(canManageFolder_(u, f), 'Only administrators or folder managers can manage folder access.');
    var acc = p.access === 'restricted' ? 'restricted' : 'open';
    updateRow_(SHEETS.FOLDERS, f._row, { Access: acc });
    log_(u, 'folder_access', f.FolderID + ' → ' + acc);
    return folderAccessOut_(u, folderById_(p.folderId));
  });
}

function saveFolderGrant_(u, p) {
  ensureAcl_();
  var email = validEmail_(p.email);
  if (!email) throw err_('VALIDATION', 'Please enter a valid e-mail address.');
  var role = ROLES.indexOf(p.role) >= 0 ? p.role : 'Viewer';
  var active = p.active === undefined ? true : !!p.active;
  return withLock_(function () {
    var f = folderById_(p.folderId);
    if (!f) throw err_('NOT_FOUND', 'Folder not found.');
    need_(canManageFolder_(u, f), 'Only administrators or folder managers can manage folder access.');
    var g = readGrants_().filter(function (x) { return x.FolderID === f.FolderID && String(x.Email).toLowerCase().trim() === email; })[0];
    if (g) updateRow_(SHEETS.GRANTS, g._row, { Role: role, Active: active });
    else appendObj_(SHEETS.GRANTS, { GrantID: nextId_('GRT'), FolderID: f.FolderID, Email: email, Role: role, Active: active, AddedBy: u.email, AddedAt: safe_(stamp_().date) });
    log_(u, 'grant_save', f.FolderID + ' ' + email + ' → ' + role + (active ? '' : ' (inactive)'));
    return folderAccessOut_(u, f);
  });
}

function deleteFolderGrant_(u, p) {
  ensureAcl_();
  var email = validEmail_(p.email);
  return withLock_(function () {
    var f = folderById_(p.folderId);
    if (!f) throw err_('NOT_FOUND', 'Folder not found.');
    need_(canManageFolder_(u, f), 'Only administrators or folder managers can manage folder access.');
    var g = readGrants_().filter(function (x) { return x.FolderID === f.FolderID && String(x.Email).toLowerCase().trim() === email; })[0];
    if (!g) throw err_('NOT_FOUND', 'Grant not found.');
    sheet_(SHEETS.GRANTS).deleteRow(g._row);
    log_(u, 'grant_remove', f.FolderID + ' ' + email);
    return folderAccessOut_(u, f);
  });
}

function listAuditLog_(u, p) {
  need_(isAdmin_(u), 'Only administrators can view the audit log.');
  var limit = Math.min(Math.max(Number(p && p.limit) || 300, 1), 1000);
  var rows = readAll_(SHEETS.LOG).map(function (r) {
    return { date: r.Date, time: r.Time, email: r.Email, name: r.Name, role: r.Role, action: r.Action, detail: r.Detail };
  });
  rows.reverse(); // AccessLog is appended chronologically → newest first
  return { log: rows.slice(0, limit), total: rows.length };
}

function validEmail_(e) {
  e = String(e || '').toLowerCase().trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : '';
}
function activeAdminsExcept_(all, email) {
  return all.filter(function (r) {
    return String(r.Role) === 'Admin' && bool_(r.Active) && String(r.Email).toLowerCase().trim() !== email;
  });
}

function saveUser_(u, p) {
  need_(isAdmin_(u), 'Only administrators can manage access.');
  var email = validEmail_(p.email);
  if (!email) throw err_('VALIDATION', 'Please enter a valid e-mail address.');
  var role = ROLES.indexOf(p.role) >= 0 ? p.role : 'Viewer';
  var active = p.active === undefined ? true : !!p.active;
  return withLock_(function () {
    var all = readAll_(SHEETS.USERS);
    var rec = all.filter(function (r) { return String(r.Email).toLowerCase().trim() === email; })[0];
    if (email === u.email && (role !== 'Admin' || !active)) throw err_('FORBIDDEN', 'You cannot change your own administrator access.');
    if (rec && String(rec.Role) === 'Admin' && bool_(rec.Active) && (role !== 'Admin' || !active) && !activeAdminsExcept_(all, email).length)
      throw err_('FORBIDDEN', 'At least one active administrator must remain.');
    if (rec) {
      updateRow_(SHEETS.USERS, rec._row, { Name: safe_(p.name !== undefined ? p.name : rec.Name, 120), Role: role, Active: active });
    } else {
      appendObj_(SHEETS.USERS, { Email: email, Name: safe_(p.name || '', 120), Role: role, Active: active, AddedAt: safe_(stamp_().date) });
    }
    log_(u, 'save_user', email + ' → ' + role + (active ? '' : ' (inactive)'));
    return { users: usersOut_(), me: u.email };
  });
}

function deleteUser_(u, p) {
  need_(isAdmin_(u), 'Only administrators can manage access.');
  var email = validEmail_(p.email);
  return withLock_(function () {
    var all = readAll_(SHEETS.USERS);
    var rec = all.filter(function (r) { return String(r.Email).toLowerCase().trim() === email; })[0];
    if (!rec) throw err_('NOT_FOUND', 'User not found.');
    if (email === u.email) throw err_('FORBIDDEN', 'You cannot remove your own account.');
    if (String(rec.Role) === 'Admin' && bool_(rec.Active) && !activeAdminsExcept_(all, email).length)
      throw err_('FORBIDDEN', 'At least one active administrator must remain.');
    sheet_(SHEETS.USERS).deleteRow(rec._row);
    log_(u, 'delete_user', email);
    return { users: usersOut_(), me: u.email };
  });
}

/* ------------------------------------------------------------------ *
 *  One-time setup (run from the editor or from the "ICTD Library" menu)
 * ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ICTD Library')
    .addItem('Run setup (first time)', 'setup')
    .addItem('Finish / repair setup (Client ID + make me Admin)', 'finishSetup')
    .addItem('Re-home storage into STORAGE_FOLDER_ID', 'rebuildStorage')
    .addItem('Import ICTD policies (25 PDFs) into Policies', 'importPolicies')
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

  // Write the OAuth Client ID from the constant above (overwrites the placeholder)
  if (CLIENT_ID && CLIENT_ID.indexOf('PASTE_') < 0) setConfigValue_('ClientID', CLIENT_ID);

  // Validation lists
  var users = book.getSheetByName(SHEETS.USERS);
  users.getRange(2, 3, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROLES, true).build());
  users.getRange(2, 4, 500, 1).insertCheckboxes();
  var docs = book.getSheetByName(SHEETS.DOCS);
  docs.getRange(2, 11, 2000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  docs.getRange(2, 12, 2000, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CONFS, true).build());

  // First administrator = the person running setup.
  // NOTE: inserting the checkboxes above makes getLastRow() unreliable (every checkbox
  // row counts as used), so we look for an existing e-mail in column A instead.
  ensureAdmin_(users);

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

/**
 * Add the person running the script to AllowedUsers as Admin, if no row for their
 * e-mail exists yet. Detects existing users by column A (Email) so pre-inserted
 * checkboxes in the Active column cannot hide the fact that the list is empty.
 * Writes into the first row whose Email cell is blank, so no blank rows are left above it.
 */
function ensureAdmin_(users) {
  users = users || sheet_(SHEETS.USERS);
  var me = (Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  if (!me) return '';
  var last = users.getLastRow();
  var colA = last >= 2 ? users.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < colA.length; i++) {
    if (String(colA[i][0] || '').toLowerCase().trim() === me) return me; // already listed
  }
  var row = last + 1;
  for (var j = 0; j < colA.length; j++) { if (String(colA[j][0] || '').trim() === '') { row = j + 2; break; } }
  users.getRange(row, 1, 1, 5).setValues([[me, 'Library Administrator', 'Admin', true, safe_(stamp_().date)]]);
  return me;
}

/**
 * Run this any time after setup() to (re)apply the OAuth Client ID and make sure
 * you are an Admin — safe to run repeatedly. Use it to repair a library where the
 * ClientID cell still shows the placeholder or AllowedUsers has no Admin.
 */
function finishSetup() {
  var changes = [];
  if (CLIENT_ID && CLIENT_ID.indexOf('PASTE_') < 0) { setConfigValue_('ClientID', CLIENT_ID); changes.push('ClientID set to ' + CLIENT_ID); }
  var me = ensureAdmin_(sheet_(SHEETS.USERS));
  changes.push(me ? ('Admin ensured: ' + me) : 'Could not read your e-mail to add you as Admin.');
  CacheService.getScriptCache().remove('cfg_v1');
  var msg = 'Done.\n\n- ' + changes.join('\n- ') +
    '\n\nRemember to deploy: Deploy > Manage deployments > Edit > New version (Who has access = Anyone).';
  try { SpreadsheetApp.getUi().alert('ICTD Digital File Library', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(msg); }
}

/**
 * Re-home the whole cabinet into STORAGE_FOLDER_ID (or the current Config RootFolderID):
 * recreates a Drive subfolder for every drawer and folder under the new root, updates the
 * DriveFolderID columns, moves any existing document files across, and points Config.RootFolderID
 * at the new root. Safe to run more than once. The target folder must be shared with the account
 * running the script as Editor.
 */
/** Parent folder IDs of a Drive folder/file, or null if it cannot be opened. */
function parentIds_(id) {
  try {
    var it = DriveApp.getFolderById(id).getParents(); var ids = [];
    while (it.hasNext()) ids.push(it.next().getId());
    return ids;
  } catch (e) { return null; }
}
function hasParent_(id, parentId) {
  var p = id ? parentIds_(id) : null;
  return !!(p && p.indexOf(parentId) >= 0);
}

/**
 * Idempotent: only (re)creates the Drive subfolders that are not already in the right place
 * under the target root, so it can be run repeatedly and will never make duplicate folders.
 * Also moves any document file that is not yet inside its folder. Target must be shared with
 * the account running the script as Editor.
 */
function rebuildStorage() {
  var targetId = (STORAGE_FOLDER_ID && STORAGE_FOLDER_ID.indexOf('PASTE') < 0 && STORAGE_FOLDER_ID.trim())
    ? STORAGE_FOLDER_ID.trim() : String(getConfig_().RootFolderID || '').trim();
  if (!targetId) throw err_('VALIDATION', 'Set STORAGE_FOLDER_ID at the top of Code.gs (or RootFolderID in Config) first.');
  var me = Session.getEffectiveUser().getEmail() || 'the script account';
  var root;
  try { root = DriveApp.getFolderById(targetId); } catch (e) {
    var m = 'Cannot open folder ' + targetId + '.\nShare it with ' + me + ' as Editor, then run again.';
    try { SpreadsheetApp.getUi().alert('ICTD Digital File Library', m, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e2) {}
    throw err_('NO_ACCESS', m);
  }
  return withLock_(function () {
    setConfigValue_('RootFolderID', targetId);
    var drawers = readAll_(SHEETS.DRAWERS);
    var folders = readAll_(SHEETS.FOLDERS);
    var docs = readAll_(SHEETS.DOCS);
    var created = 0, kept = 0, moved = 0;
    var drawerFolder = {};
    drawers.forEach(function (d) {
      var cur = String(d.DriveFolderID || '');
      if (cur && hasParent_(cur, targetId)) { drawerFolder[d.DrawerID] = DriveApp.getFolderById(cur); kept++; return; }
      var f = root.createFolder(label_(d));
      updateRow_(SHEETS.DRAWERS, d._row, { DriveFolderID: f.getId() });
      drawerFolder[d.DrawerID] = f; created++;
    });
    var folderFolder = {};
    folders.forEach(function (fo) {
      var parent = drawerFolder[fo.DrawerID];
      if (!parent) return;
      var pid = parent.getId();
      var cur = String(fo.DriveFolderID || '');
      if (cur && hasParent_(cur, pid)) { folderFolder[fo.FolderID] = DriveApp.getFolderById(cur); kept++; return; }
      var f = parent.createFolder(label_(fo));
      updateRow_(SHEETS.FOLDERS, fo._row, { DriveFolderID: f.getId() });
      folderFolder[fo.FolderID] = f; created++;
    });
    docs.forEach(function (d) {
      if (bool_(d.Deleted) || !d.DriveFileID) return;
      var dest = folderFolder[d.FolderID];
      if (!dest) return;
      if (hasParent_(String(d.DriveFileID), dest.getId())) return;
      try { DriveApp.getFileById(String(d.DriveFileID)).moveTo(dest); moved++; } catch (e) { console.warn('move failed ' + d.DocID + ': ' + e); }
    });
    CacheService.getScriptCache().remove('cfg_v1');
    var msg = 'Storage re-homed into folder ' + targetId + '.\n' +
      '- Subfolders created this run: ' + created + '\n' +
      '- Already in place (kept): ' + kept + '\n' +
      '- Files moved: ' + moved + '\n\n' +
      'New uploads now land in this folder. Any leftover empty folders in the previous location can be deleted manually.';
    try { SpreadsheetApp.getUi().alert('ICTD Digital File Library', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(msg); }
    return msg;
  });
}

/**
 * One-time import of the 25 ICTD policy PDFs (rendered from the Policy platform, finalized, dated
 * Nov 2026) into the Policies drawer under a "ICTD Policies" folder, and index each in Documents.
 * PDFs are fetched from the public repo; re-running is idempotent (skips any policy code already present).
 */
var POLICY_PDF_BASE = 'https://raw.githubusercontent.com/ICTSRU/IT_DFL/main/policy-pdfs/';
var POLICY_LIST = [
  {code:"ICTD-01P",file:"ICTD-01P.pdf",titleAr:"سياسة البريد الإلكتروني الجامعي",titleEn:"University Email Policy",version:"13.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-02P",file:"ICTD-02P.pdf",titleAr:"سياسة حسابات البريد الإلكتروني للخريجين",titleEn:"Alumni Email Accounts Policy",version:"3.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-03P",file:"ICTD-03P.pdf",titleAr:"سياسة أجهزة الحاسب الآلي وملحقاتها",titleEn:"Computer Equipment and Peripherals Policy",version:"13.0",owner:"Mohamed Omar"},
  {code:"ICTD-05P",file:"ICTD-05P.pdf",titleAr:"سياسة حقوق نسخ البرمجيات",titleEn:"Software Copyright and Licensing Policy",version:"12.0",owner:"Mohamed Saleh"},
  {code:"ICTD-06P",file:"ICTD-06P.pdf",titleAr:"سياسة إدارة التغيير في تقنية المعلومات",titleEn:"IT Change Management Policy",version:"12.0",owner:"Mohamed ElMahdy"},
  {code:"ICTD-07P",file:"ICTD-07P.pdf",titleAr:"سياسة كلمات السر",titleEn:"Password Policy",version:"12.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-08P",file:"ICTD-08P.pdf",titleAr:"سياسة النسخ الاحتياطي والاستعادة",titleEn:"Backup and Restore Policy",version:"12.0",owner:"Mohamed Omar"},
  {code:"ICTD-09P",file:"ICTD-09P.pdf",titleAr:"سياسة مركز البيانات وغرف الخوادم",titleEn:"Data Center and Server Room Policy",version:"12.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-10P",file:"ICTD-10P.pdf",titleAr:"سياسة حلول الطباعة",titleEn:"Printing Solutions Policy",version:"12.0",owner:"Mohamed Omar"},
  {code:"ICTD-11P",file:"ICTD-11P.pdf",titleAr:"سياسة قواعد السلوك",titleEn:"IT Code of Conduct Policy",version:"12.0",owner:"Mohamed ElMahdy"},
  {code:"ICTD-12P",file:"ICTD-12P.pdf",titleAr:"سياسة تقييم الاحتياجات التقنية",titleEn:"IT Needs Assessment Policy",version:"12.0",owner:"Mohamed Omar"},
  {code:"ICTD-13P",file:"ICTD-13P.pdf",titleAr:"سياسة استخدام اجتماعات Zoom",titleEn:"Zoom Meetings Usage Policy",version:"10.0",owner:"Mohamed Omar"},
  {code:"ICTD-14P",file:"ICTD-14P.pdf",titleAr:"سياسة مشاركة الملفات",titleEn:"File Sharing Policy",version:"12.0",owner:"Mohamed Omar"},
  {code:"ICTD-15P",file:"ICTD-15P.pdf",titleAr:"سياسة الوصول الخارجي لموارد الجامعة",titleEn:"External Remote Access Policy",version:"12.0",owner:"Mohamed Omar"},
  {code:"ICTD-16P",file:"ICTD-16P.pdf",titleAr:"سياسة حسابات التعليم الإلكتروني",titleEn:"E-Learning Accounts Policy",version:"12.1",owner:"Mohamed Saleh"},
  {code:"ICTD-17P",file:"ICTD-17P.pdf",titleAr:"سياسة التشغيل الآمن للويب",titleEn:"Secure Web Gateway Policy",version:"12.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-18P",file:"ICTD-18P.pdf",titleAr:"سياسة تحرير الموقع الإلكتروني",titleEn:"Website Content Editing Policy",version:"12.0",owner:"Mohamed Saleh"},
  {code:"ICTD-19P",file:"ICTD-19P.pdf",titleAr:"سياسة إدارة المخاطر",titleEn:"IT Risk Management Policy",version:"12.0",owner:"Mohamed ElMahdy"},
  {code:"ICTD-20P",file:"ICTD-20P.pdf",titleAr:"السياسة العامة للنظم والمعلومات للطلاب والطالبات",titleEn:"General IT Systems Policy for Students",version:"12.0",owner:"Mohamed Saleh"},
  {code:"ICTD-04P",file:"ICTD-04P.pdf",titleAr:"سياسة استخدام الشبكات والإنترنت",titleEn:"Network and Internet Acceptable Use Policy",version:"11.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-21P",file:"ICTD-21P.pdf",titleAr:"سياسة توزيع الشاشات",titleEn:"Display Screens Allocation Policy",version:"4.0",owner:"Mohamed Omar"},
  {code:"ICTD-22P",file:"ICTD-22P.pdf",titleAr:"سياسة نظام المراسلات الإدارية",titleEn:"Administrative Correspondence System Policy",version:"2.0",owner:"Mohamed Saleh"},
  {code:"ICTD-23P",file:"ICTD-23P.pdf",titleAr:"سياسة استخدام أدوات التواصل الاجتماعي",titleEn:"Social Media Use Policy",version:"2.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-24P",file:"ICTD-24P.pdf",titleAr:"سياسة الأمن السيبراني",titleEn:"Cybersecurity Policy",version:"2.0",owner:"Mohamed Nawaz"},
  {code:"ICTD-025P",file:"ICTD-025P.pdf",titleAr:"سياسة الاستخدام العادل والتحكم في الوصول إلى الإنترنت",titleEn:"Fair Use and Internet Access Control Policy",version:"1.3",owner:"Mohamed Nawaz"}
];

function importPolicies() {
  var me = (Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || 'import').toLowerCase();
  return withLock_(function () {
    var drawer = readAll_(SHEETS.DRAWERS).filter(function (d) { return d.NameEn === 'Policies' || d.NameAr === 'السياسات'; })[0];
    if (!drawer) throw err_('NOT_FOUND', 'Policies drawer not found — run setup() first.');
    var folder = readAll_(SHEETS.FOLDERS).filter(function (f) { return f.DrawerID === drawer.DrawerID && (f.NameEn === 'ICTD Policies'); })[0];
    var drawerDrive = ensureDriveFolder_(drawer, SHEETS.DRAWERS, ensureRoot_(), label_(drawer));
    if (!folder) {
      var fid = nextId_('FLD');
      var ff = drawerDrive.createFolder('ICTD Policies');
      appendObj_(SHEETS.FOLDERS, { FolderID: fid, DrawerID: drawer.DrawerID, NameAr: 'سياسات الإدارة', NameEn: 'ICTD Policies',
        Order: readAll_(SHEETS.FOLDERS).filter(function (f) { return f.DrawerID === drawer.DrawerID; }).length + 1, Active: true,
        DriveFolderID: ff.getId(), CreatedBy: me, CreatedAt: safe_(stamp_().date) });
      folder = { FolderID: fid, DrawerID: drawer.DrawerID, DriveFolderID: ff.getId() };
    }
    var dest = DriveApp.getFolderById(folder.DriveFolderID);
    var have = {};
    readAll_(SHEETS.DOCS).forEach(function (d) { String(d.Tags || '').split(',').forEach(function (t) { have[t.trim().toUpperCase()] = true; }); });
    var added = 0, skipped = 0, failed = [];
    POLICY_LIST.forEach(function (p) {
      if (have[p.code.toUpperCase()]) { skipped++; return; }
      try {
        var res = UrlFetchApp.fetch(POLICY_PDF_BASE + p.file, { muteHttpExceptions: true });
        if (res.getResponseCode() !== 200) { failed.push(p.code + ' (http ' + res.getResponseCode() + ')'); return; }
        var blob = res.getBlob().setName(p.code + ' ' + p.titleAr + ' v' + p.version + '.pdf');
        var bytes = blob.getBytes();
        if (String.fromCharCode.apply(null, bytes.slice(0, 5).map(function (b) { return (b + 256) % 256; })) !== '%PDF-') { failed.push(p.code + ' (not pdf)'); return; }
        var file = dest.createFile(blob);
        var id = nextId_('DOC'), s = stamp_();
        appendObj_(SHEETS.DOCS, {
          DocID: id, Title: safe_(p.titleAr), DrawerID: drawer.DrawerID, FolderID: folder.FolderID, DocDate: safe_('2026-11-05'),
          Owner: safe_(p.owner), OwnerEmail: '', Tags: safe_(p.code + ', سياسة, policy'), Description: safe_(p.titleEn),
          Version: safe_(p.version), Status: 'Active', Confidentiality: 'Internal', FileName: safe_(file.getName()),
          MimeType: 'application/pdf', SizeBytes: bytes.length, DriveFileID: file.getId(), DriveURL: file.getUrl(),
          CreatedBy: me, CreatedAt: safe_(s.date + ' ' + s.time), UpdatedBy: '', UpdatedAt: '', Deleted: false
        });
        added++;
      } catch (e) { failed.push(p.code + ' (' + e + ')'); }
    });
    CacheService.getScriptCache().remove('cfg_v1');
    log_({ email: me, name: 'import', role: 'Admin' }, 'import_policies', 'added ' + added + ' skipped ' + skipped + ' failed ' + failed.length);
    var msg = 'ICTD policies import finished.\n- Added: ' + added + '\n- Already present (skipped): ' + skipped +
      '\n- Failed: ' + failed.length + (failed.length ? '\n  ' + failed.join('\n  ') : '') +
      '\n\nThey are in Policies ▸ ICTD Policies, and listed in the library.';
    try { SpreadsheetApp.getUi().alert('ICTD Digital File Library', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(msg); }
    return msg;
  });
}

function showChecklist() {
  var msg = 'Setup finished.\n\nNext steps:\n' +
    '1) Client ID and your Admin account are set automatically (CLIENT_ID constant in Code.gs).\n' +
    '2) AllowedUsers sheet: add the rest of your team (Admin / Editor / Viewer).\n' +
    '3) Deploy > New deployment > Web app: Execute as "Me", Who has access "Anyone".\n' +
    '4) Copy the Web app URL into assets/js/config.js (WEB_APP_URL).\n' +
    '5) Optional: share the Drive root folder (Config > RootFolderID) with your ICTD group as Viewer.';
  try { SpreadsheetApp.getUi().alert('ICTD Digital File Library', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { console.log(msg); }
}
