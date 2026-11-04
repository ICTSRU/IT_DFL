# Changelog

Version numbers use one digit after the decimal point (… 1.9 → 2.0).

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
