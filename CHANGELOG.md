# Changelog

Version numbers use one digit after the decimal point (… 1.9 → 2.0).

## v2.6 — 2026-11-10

- Added **Import from Drive folder** (استيراد من مجلد Drive) for admins / folder managers (Add/Editor rights on the target folder). Paste a Google Drive folder link and every file already in it is indexed into the chosen library folder **by reference** — files are not moved or copied, so there is no size limit (handles the 474 MB+ videos).
  - Idempotent: files already indexed in that folder are skipped, so re-running after adding more files only imports the new ones. Blocked file types are skipped and counted.
  - Each imported file becomes a normal document (title from filename, Drive date, size, type, link); the result shows imported / skipped / not-allowed counts, and flags when more than one batch (>400 files) remains.
  - Button sits in the folder header next to Bulk upload; logs an `import_drive` entry to the Audit Log.
- **Access reminder:** imported files stay where they are in Drive and keep their own sharing — the library account needs access to the folder, and the files must be shared with your users for them to open.
- Version bumped to 2.6.

## v2.5 — 2026-11-10

- Raised the in-app upload limit from **20 MB to 40 MB** per file. A one-time migration (`ensureUploadLimit_`) bumps the stored `MaxUploadMB` on the live Config sheet from the old default; it only raises, never lowers an admin-set value, and runs once.
- 40 MB sits just under the Apps Script POST ceiling (~50 MB, and base64 adds ~37%). For anything larger, the **Google Drive link** path is the supported route: upload to Drive, paste the share link in the Add Document form.
- Improved oversize handling: when a chosen file exceeds the limit, the form now shows a clear bilingual hint and **auto-switches to the "Google Drive link" tab** instead of a generic error — at both file-selection and save time. Bulk upload continues to skip oversize files with a clear status.
- Version bumped to 2.5.

## v2.4 — 2026-11-09

- Added **folder-level access control** (صلاحيات مفروضة على الفولدر). Each folder now has an access mode — **عام / Open** or **مقيّد / Restricted** — and a per-folder grants list that a folder manager (or a global Admin) opens from the 🔑 button on the folder card or inside the folder.
  - *Open* folder: visible to everyone per their global role; individual grants can **raise** a person's role on that folder only (e.g. make a Viewer an Editor there).
  - *Restricted* folder: hidden from everyone except global Admins and the people explicitly granted; each grant sets their role (مدير/محرّر/مطّلع) inside that folder.
- Permissions are **enforced server-side**: `bootstrap` filters folders and documents by each user's effective folder role, and add/edit/delete-document, edit/delete-folder, and open-document all re-check the folder role. New `FolderGrants` sheet + `Access` column on `Folders` are created automatically on first run.
- Every change is written to the **Audit Log**: `folder_access` (mode change), `grant_save` (grant added/updated), `grant_remove` (grant revoked). Deleting a folder also cleans up its grants.
- Restricted folders show a lock badge on the cabinet card and in the folder header.
- Version bumped to 2.4.

## v2.3 — 2026-11-09

- Added an Admin-only in-app Audit Log (سجل التدقيق) reading the AccessLog: shows every change — sign-ins, denied attempts, document/folder/drawer add-edit-delete, user role changes, policy imports — with when, who (name, e-mail, role), a colour-coded action badge, and details, plus a quick text filter. Backend auditLog action is Admin-gated.
- Renamed the Viewer role label to "مطّلع" (Arabic) to match ICTD wording; roles stay Admin/Editor/Viewer with the same server-enforced permissions.
- Version bumped to 2.3.

## v2.2 — 2026-11-05

- Bulk upload: editors can drop/select many files at once into any folder. Each file becomes its own document, with metadata auto-filled per file (title from the file name, date from the file's last-modified, owner = current user, version 1.0, default confidentiality) and editable per row before uploading. Files upload one by one with per-row status; reuses the existing addDocument backend (no backend change).
- Version bumped to 2.2.

## v2.1 — 2026-11-05

- Added a night (dark) mode toggle next to the language switch, in both the app header and the sign-in screen; the choice is remembered per browser and applies across the app and login. The official white brand bar is kept in both themes so the logos stay legible.
- Version bumped to 2.1.

## v2.0 — 2026-11-05

- Platform admins can now delete folders: a delete button on each folder (Admin only) with a confirm dialog. Deleting an empty folder removes it (and trashes its empty Drive subfolder); deleting a folder that still has documents warns with the count and, on confirm, removes the folder and soft-deletes its documents from the index (the files stay in Drive). Backend deleteFolder action is Admin-gated.
- Version bumped to 2.0.

## v1.9 — 2026-11-05

- Added an Admin-only "Manage access" control panel (إدارة صلاحيات الدخول) in the header: add users and set each to Admin (full), Editor (add & edit) or Viewer (view only), toggle Active, and remove users — written straight to AllowedUsers. Backend actions listUsers/saveUser/deleteUser are Admin-gated, with guards so the last active admin can't be removed and you can't lock out your own admin access.
- Version bumped to 1.9.

## v1.8 — 2026-11-05

- Added the 25 ICTD policy PDFs (rendered from the Policy platform's own layout, marked معتمدة/Approved and dated 5 Nov 2026) under policy-pdfs/, and an importPolicies() backend function + menu item that imports them into the Policies drawer ("ICTD Policies" folder) and indexes each in the Documents sheet. Idempotent (skips policies already present).
- Version bumped to 1.8.

## v1.7 — 2026-11-05

- Cabinet interface switched from vertical stacked drawers to a horizontal layout: the drawers now sit side by side as pull-out columns (lateral file cabinet), wrapping responsively, with the cabinet summary and recently-added panels moved below.
- Version bumped to 1.7 (shown in header and footer).

## v1.6 — 2026-11-05

- Redesigned the sign-in screen to the standard ITOC landing used across the other SRU platforms: white brand bar (ICTD left, university right) over a purple→blue rule, a branded card with the ICTD logo, platform title and "@sr.edu.sa only" note, an info box, a large purple "تسجيل الدخول بحساب الجامعة / Sign in with your university account" button, numbered 1-2-3 steps, a "skip this screen next time" option, and the dark ITOC footer.
- The purple button triggers the same secure Google sign-in (an invisible Google button is overlaid on it), so the ID-token verification is unchanged.
- "Skip this screen next time" sets Google auto-select so returning users sign in without the extra click.
- Footer now reads "ITOC Operations Center — …" with the © year, matching the other platforms.
- Version bumped to 1.6 (shown in header and footer).

## v1.5 — 2026-11-05

- rebuildStorage() is now idempotent: it checks each drawer/folder's actual Drive parent and only (re)creates the ones not already under the target root, so re-running never creates duplicate folders and a partial run can be finished by simply running it again. Files already inside their folder are left in place.
- Version bumped to 1.5 (shown in header and footer).

## v1.4 — 2026-11-05

- New STORAGE_FOLDER_ID constant + rebuildStorage() function/menu item: re-homes the whole cabinet (all drawer and folder subfolders, and any existing files) into a chosen folder — e.g. the shared ITOC folder — and repoints Config.RootFolderID. Safe to re-run.
- Version bumped to 1.4 (shown in header and footer).

## v1.3 — 2026-11-05

- Fixed setup() bug: inserting the AllowedUsers checkboxes inflated getLastRow(), so the Admin row was never created and sign-in was rejected for everyone. Admin is now detected and seeded by the Email column.
- setup() now writes the OAuth Client ID into the Config sheet automatically from the new CLIENT_ID constant in Code.gs — no manual cell edit needed.
- New menu item / function "Finish / repair setup" (finishSetup) re-applies the Client ID and ensures you are an Admin; safe to run repeatedly.
- Version bumped to 1.3 (shown in header and footer).

## v1.2 — 2026-11-04

- Google OAuth Client ID set in `assets/js/config.js`; the sign-in screen now shows the "Sign in with Google" button instead of the setup notice.
- Version bumped to 1.2 (shown in header and footer).

## v1.1 — 2026-11-04

- Web App URL set in `assets/js/config.js` using the standard `/macros/s/…/exec` form instead of the domain-scoped `/a/macros/sr.edu.sa/s/…/exec` form, which redirects to a Google sign-in page and fails when called from GitHub Pages.
- Version bumped to 1.1 (shown in header and footer).

## v1.0 — 2026-11-04

First release.

- Filing-cabinet interface: cabinet → drawers → folders → documents, with manila-folder tabs and drawer pull-out animation.
- Google Drive file storage (Root / Drawer / Folder tree) indexed in a Google Sheet via an Apps Script web app.
- Search by title, subject, date, owner and tag (Arabic-aware), advanced filters (drawer, folder, owner, tag, date range, status, confidentiality), sortable results, tag cloud.
- Add documents by upload (up to `MaxUploadMB`) or by Google Drive link; edit and soft-delete.
- Admin tools: add/edit drawers (name, icon, colour, order, active) and folders.
- Access limited to @sr.edu.sa: branded sign-in screen, Google ID token verified server-side (audience, e-mail verified, domain and `hd`), AllowedUsers roles (Admin / Editor / Viewer).
- Confidential documents hidden from Viewers; per-file view access granted at open time without e-mail notification.
- AccessLog: sign-ins (e-mail, date, time), opens, adds, edits, deletes, denied attempts.
- Arabic (RTL, default) and English interface; responsive layout; version shown in the header and footer.
- SRU identity: purple/blue palette, Cairo font, "SRU Tech Background · Network" header and footer, ITOC footer link.
- Demo mode (`?demo=1`) with sample data.
- Optional GitHub Action to deploy the Apps Script with clasp.
