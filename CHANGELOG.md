# Changelog

Version numbers use one digit after the decimal point (… 1.9 → 2.0).

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
