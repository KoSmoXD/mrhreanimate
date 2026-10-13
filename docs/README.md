# Mr H Animations — community gallery

The website has been redesigned into a **black, minimal public animation browser**. Cards show the animation title, uploader, upload date, total pack size, and download button. Sign up and log in with a username and password. Authenticated users can publish animations, change their username/password, delete their uploads, and delete their account.

## Running the full website

**GitHub Pages alone cannot host this version.** User accounts, shared uploads, and community downloads require the Node.js backend. The backend serves the site from ../docs on the same origin.

### Option A: Docker (recommended)

At the repository root:

```sh
docker build -t mrh-animations .
docker volume create mrh-gallery-data
docker run -d --name mrh-animations -p 3000:3000 \
  -v mrh-gallery-data:/data \
  -e NODE_ENV=development \
  mrh-animations
```

Open `http://localhost:3000` for local testing. For an **internet-facing** site, use an HTTPS domain and set `NODE_ENV=production` (Secure cookies require HTTPS). Mount **persistent** writable storage at `/data`; without it all accounts, uploaded files and SQLite data will be lost if the container restarts/redeploys with a new filesystem.

You can deploy the Dockerfile to a service that supports persistent volumes (or a VPS with Docker). Set `PUBLIC_ORIGIN=https://your-real-domain.example` to require that exact origin on state-changing requests, and `DATA_DIR=/data`.

### Railway deployment (persistent accounts and uploads)

1. Open [Railway](https://railway.com/) and create a new project with **Deploy from GitHub repo**.
2. Select **KoSmoXD/mrhreanimate**, branch **main**, root directory **/**. Railway detects the repository root Dockerfile.
3. Add a **volume** mounted at `/data`. This is essential: it stores all passwords (as hashes), session data, animation uploads, and gallery records across redeploys.
4. Under **Variables**, configure `NODE_ENV=production`, `DATA_DIR=/data`, and `RAILWAY_RUN_UID=0` (Railway volumes are root-owned).
5. Under **Settings → Networking**, generate a public HTTPS domain. Optionally set `PUBLIC_ORIGIN` to the exact generated URL (such as `https://your-service.up.railway.app`).
6. Deploy and open `https://your-domain/api/health`; it should return `{"ok":true}`. Then test registering, uploading a valid pack, downloading the ZIP, and updating account settings.

Do **not** set the web service's root directory to `/backend`; the Dockerfile and `docs` are at the repository root. The site and API must be served from the **same origin** for session cookies to work.

### Option B: Node.js

```sh
cd backend
npm install
NODE_ENV=development DATA_DIR=./data npm start
```

Then open `http://localhost:3000`. Production requires Node.js 20+, HTTPS, and persistent writable data. Use a trusted reverse proxy when deploying; the backend trusts one reverse-proxy hop by default. Configure `TRUST_PROXY=false` when not behind a reverse proxy.

## API and data

- `POST /api/register` — register username/password.
- `POST /api/login`, `POST /api/logout` — cookie-based sessions.
- `GET /api/me`, `PATCH /api/me`, `DELETE /api/me` — account details, username/password settings, account deletion (deletes all uploads).
- `GET /api/animations` — public paginated gallery; optional search.
- `POST /api/animations` — authenticated multipart upload: `title`, `anim`, `mp3`, `lua`.
- `GET /api/animations/:id/download` — public ZIP download with the engine's expected paths.
- `DELETE /api/animations/:id` — uploader only.
- `GET /api/health` — deployment health check.

Uploads require all three matching assets: `.anim` (max 8 MiB), `.mp3` (max 35 MiB), `.lua` (max 2 MiB). File extensions, sizes, basic MP3 header, text-only Lua, and binary `.anim` structure are checked. The backend never executes uploaded Lua.

ZIP downloads contain:
```text
UhhhhhhReanim/Content/Anims/YourAnimation.anim
UhhhhhhReanim/Content/Sounds/YourMusic.mp3
UhhhhhhReanim/Modules/YourDance.lua
```

**Important:** The uploaded Lua module must itself correctly reference the matching sound and animation filenames. Packaging valid files does not prove a module runs or is safe. Downloaded Lua is untrusted code; examine it before running it.

## Accounts and security

Passwords are hashed with bcrypt; login sessions are random tokens stored as hashes in SQLite and sent in HttpOnly, SameSite=Strict cookies (Secure over production HTTPS). Rate limits apply to signups, authentication and uploads. Only upload owners can delete their uploads. Username length is 3–24 characters (letters, digits, underscore), and passwords must be 10–72 UTF-8 bytes.

**There is no password recovery or email verification**, because the requested accounts use username/password only. Users should keep passwords safe. Before opening a public service, add abuse moderation, backups, upload scanning/review and an admin workflow.

## Verification

Repository-side static checks and syntax validation can be performed without deploying the backend. An integration test is included in `backend/test/`: once dependencies are installed, run `npm test` from `backend/`. Actual public accounts and shared uploads only function once the backend is deployed and accessible. The GitHub Pages URL, if enabled, is **not** the full deployed service.
