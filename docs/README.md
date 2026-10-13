# Mr H Animations — community gallery

The website has been redesigned into a **black, minimal public animation browser**. Cards show the animation title, uploader, upload date, total pack size, and download button. Sign up and log in with a username and password. Authenticated users can publish animations, change their username/password, delete their uploads, and delete their account.

## Make Animation tab (Uhhhhhh only)

The public site now has **Browse Animations** and **Make Animation** tabs in the same black theme. The original gallery, registration, profile photos, owner verification, uploads and downloads are preserved.

Make Animation converts Roblox Studio `.rbxm` or `.rbxmx` model files containing one or more `KeyframeSequence` instances into Uhhhhhh's native binary `.anim` format. Users may supply an optional MP3 soundtrack and choose animation looping. The download is a ready-to-extract ZIP with matching auto-generated Uhhhhhh dance Lua modules:

- `UhhhhhhReanim/Content/Anims/<sequence>.anim`
- `UhhhhhhReanim/Content/Sounds/<sound>.mp3` (when music supplied)
- `UhhhhhhReanim/Modules/<sequence>.lua`

A single model can include up to 20 sequences (each becomes a dance module). Limits are 4 MiB for the Roblox model and 25 MiB for optional MP3. The model conversion runs in a resource-limited Python subprocess using STEVETHEREALONE's official MIT-licensed `tools/rbxm2anim.py` parser/converter, vendored in `backend/tools/` with attribution and its required license. The server does not execute user-uploaded Lua. Converted modules follow Uhhhhhh's `DANCE` module API.

The **David RBXM2ANIM** source website is linked from the Make Animation tab. It is external, not mirrored or recolored; this is an independently authored converter with the same Uhhhhhh-specific goal. Unrelated sections of David's website are not imported.

The conversion route is `POST /api/make-animation` with multipart fields `model`, optional `music`, optional `name`, and optional `loop`. It does not require an account.

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


## Verified owner and profile pictures

Every user can change their profile picture under **Account settings**. Accepted file types are PNG, JPEG, and WebP (up to 2 MiB). Pictures are stored in persistent server storage and shown beside the uploader's name in the animation gallery. Users can replace or remove their pictures.

The server owner is the reserved account **Mr_H**, which receives the **✅** verified mark after its username. This is a server-controlled role, not a username-only client badge. The owner can delete any published animation to moderate the gallery; regular users may only delete their own.

For a secure first claim:
1. Configure the Railway service variable \`OWNER_SETUP_KEY\` with a long private random value.
2. Visit the website, choose **Sign up → Owner setup**.
3. Enter the reserved username **Mr_H**, your chosen new password, and the private owner setup key.
4. The claim can succeed **once**. After a successful claim, simply use **Log in** with Mr_H and your password.
5. Keep the setup key private and delete the Railway \`OWNER_SETUP_KEY\` variable after the claim; it is not needed for future logins.

Reserved owner role assignments must **never** be granted solely by matching a username. If a user created Mr_H before the reservation feature, claiming it with the verified deployment setup key resets that account's password and invalidates previous sessions.

The owner's username cannot be changed or deleted through account settings. The owner can update their password and profile picture normally.

## Accounts and security

Passwords are hashed with bcrypt; login sessions are random tokens stored as hashes in SQLite and sent in HttpOnly, SameSite=Strict cookies (Secure over production HTTPS). Rate limits apply to signups, authentication and uploads. Only upload owners can delete their uploads. Username length is 3–24 characters (letters, digits, underscore), and passwords must be 10–72 UTF-8 bytes.

**There is no password recovery or email verification**, because the requested accounts use username/password only. Users should keep passwords safe. Before opening a public service, add abuse moderation, backups, upload scanning/review and an admin workflow.

## Verification

Repository-side static checks and syntax validation can be performed without deploying the backend. An integration test is included in `backend/test/`: once dependencies are installed, run `npm test` from `backend/`. Actual public accounts and shared uploads only function once the backend is deployed and accessible. The GitHub Pages URL, if enabled, is **not** the full deployed service.
