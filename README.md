# ICTD Digital File Library — v1.0

A digital filing cabinet for the ICTD at Sulaiman Al Rajhi University.

**Cabinet → Drawers (main subjects) → Folders → Documents.**
Files live in **Google Drive**, every document is indexed in a **Google Sheet**, and the library is searchable by **title, subject, date, owner and tag**. Access is limited to **@sr.edu.sa** accounts.

| Layer | Technology | Where |
|---|---|---|
| Front end | Static HTML / CSS / JS (Arabic RTL + English, no build step) | GitHub Pages |
| Back end | Google Apps Script web app | Script bound to the Google Sheet |
| Index | Google Sheet (Config, Drawers, Folders, Documents, AllowedUsers, AccessLog) | Your Google Drive |
| Files | Google Drive folder tree (one folder per drawer / folder) | Your Google Drive |
| Sign-in | Google Identity Services, ID token verified server-side | — |

Try the interface without any setup: open `index.html?demo=1` (sample data, nothing is saved).

---

## 1. Create the Google Sheet and the backend (≈10 min)

1. Create a new Google Sheet, e.g. **ICTD Digital File Library** (sign in with the account that should own the files).
2. **Extensions → Apps Script**. Replace `Code.gs` with `apps-script/Code.gs`.
3. **Project Settings → Show "appsscript.json" manifest file**, then replace its content with `apps-script/appsscript.json`
   (it sets the Asia/Riyadh time zone and enables the Drive API v3 service used to grant view access without e-mail notifications).
4. Select the function **`setup`** and click **Run**. Approve the permissions. It creates the six sheets, six sample drawers with 18 folders (Policies, Contracts, Projects, Reports, HR, Procurement), the Drive root folder, and adds **you** as the first Admin.
   (After a refresh the sheet also shows an **ICTD Library** menu with the same command.)

## 2. Create the Google sign-in (OAuth Client ID) (≈5 min)

1. Google Cloud Console → **APIs & Services → OAuth consent screen** → user type **Internal** (limits sign-in to your Workspace organisation — a useful first layer).
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized JavaScript origins:** your GitHub Pages origin, e.g. `https://ictsru.github.io` (origin only, no path). Add `http://localhost:8000` if you test locally. No redirect URI is needed.
4. Copy the **Client ID**.
5. Paste it in two places:
   - Sheet → **Config** tab → row `ClientID`
   - `assets/js/config.js` → `GOOGLE_CLIENT_ID`

## 3. Deploy the web app

Apps Script → **Deploy → New deployment → Web app**
- Execute as: **Me**
- Who has access: **Anyone** (every request is rejected unless it carries a valid @sr.edu.sa Google ID token)

Copy the **Web app URL** (ends with `/exec`) into `assets/js/config.js` → `WEB_APP_URL`.
After any later change to `Code.gs`: **Deploy → Manage deployments → Edit → New version** (the URL stays the same).

## 4. Add your people

Sheet → **AllowedUsers**: one row per person (`Email`, `Name`, `Role`, `Active`).

| Role | Can do |
|---|---|
| **Admin** | Everything: drawers, folders, any document |
| **Editor** | Add folders and documents; edit/delete documents they created or own; see Confidential documents |
| **Viewer** | Browse, search and open; does **not** see Confidential documents |

`Config → RestrictToAllowedList = TRUE` (default) means only listed users can enter. Set it to `FALSE` to let any @sr.edu.sa account in as Viewer.

## 5. Publish the front end on GitHub

1. Put the **contents of this folder** in a repository (the folder name carries the version, the files do not).
2. Add the logos to `assets/img/` (`sru-logo.png`, `ictd-logo.png`, `itoc-logo.png`) or point `LOGOS` in `config.js` to the shared `ICTSRU/brand` library. Missing logos fall back to text.
3. **Settings → Pages → Deploy from branch → main / root.**
4. Open the Pages URL, sign in with your @sr.edu.sa account.

---

## How it works

- **Open a document:** the server checks your role, adds you as a Drive *viewer* of that single file (no e-mail sent) and logs the open. Files are never shared publicly or by link.
- **Add a document:** upload a file (stored under *Root / Drawer / Folder* in Drive) or register an existing Google Drive / Docs link.
- **Search:** instant, in the browser, Arabic-aware (ignores diacritics and أ/إ/آ, ى/ي, ة/ه differences). Combine free text with drawer, folder, owner, tag, date range, status and confidentiality.
- **Audit:** `AccessLog` records every sign-in (e-mail, date, time) plus opens, adds, edits, deletes and denied attempts.
- **Delete** is a soft delete: the row stays in the sheet (Deleted = TRUE) and the file stays in Drive.

## Security notes

- ID token verified with Google (`tokeninfo`): audience = your Client ID, e-mail verified, domain and `hd` claim = `sr.edu.sa`, not expired. Results cached for the token lifetime.
- All input is validated server-side; text that could be read as a formula, number or date is stored as text.
- All output is HTML-escaped in the browser; Drive links must start with `https://drive.google.com/` or `https://docs.google.com/`.
- Executable file types are blocked; default size limit 20 MB (`Config → MaxUploadMB`, Apps Script's request limit is ≈50 MB).
- The Web App URL is public by design; without a valid token it returns nothing but a health message.

## Limits (v1.0)

- Comfortable up to a few thousand documents (the index is loaded once per visit).
- Large uploads are sent as base64 through Apps Script; for files over ~30 MB, upload to Drive directly and register the link.
- No file replacement / version history yet (use the *Version* field, or add a new document).

## Optional automation

`.github/workflows/deploy-apps-script.yml` pushes `apps-script/` to Apps Script and redeploys on every commit (uses `clasp`; needs the secrets `CLASPRC_JSON`, `SCRIPT_ID`, `DEPLOYMENT_ID`). It assumes this folder's contents are the repository root. This workflow was not run against your account — test it once on a branch.

## Files

```
index.html                     page shell
assets/css/style.css           SRU identity + "SRU Tech Background · Network"
assets/js/config.js            ← your settings (URL, Client ID, logos, team names)
assets/js/app.js               application
assets/js/i18n.js              Arabic / English strings
assets/js/icons.js             inlined Lucide icons (ISC licence)
assets/js/demo.js              sample-data backend for ?demo=1
apps-script/Code.gs            backend
apps-script/appsscript.json    manifest
CHANGELOG.md                   change record
```

Third-party: Lucide icons (ISC), Cairo font (SIL OFL, loaded from Google Fonts), Google Identity Services.
