# +, personal AI keys, and Roblox sign-in

AI generation requires an authenticated site account with active + access. The owner account has access automatically. Manual animation editing and exports remain free.

## Access keys

Keys are issued only on an explicit request from Mr H. There is no website key generator, HTTP issuance endpoint, purchase verification, or automatic issuance. Do not issue keys during deployment or startup.

On the production server, from `backend`, use the persistent production `DATA_DIR` and run one of:

```sh
node scripts/create-plus-key.js --hours 24
node scripts/create-plus-key.js --lifetime
```

Run only the command matching the requested duration. The command prints one `PLUS-` key and stores its SHA-256 hash. It requires an existing initialized database. Each key is single use, and its duration starts on redemption. Timed access extends current timed access; lifetime access never expires. Previously issued `PRO-` keys and existing access remain valid. Keep issued keys private.

## AI provider keys

Supported: OpenAI Responses API, Anthropic Messages API, and Google Gemini generateContent API. Users supply a key for the selected provider and the exact model ID available to their account. Provider API charges are separate from + access. Keys travel over HTTPS through the server to that provider only. They are not saved in the database, project files, localStorage, or logs. The browser field is cleared when switching providers or leaving the page. Validation and rate limits apply even to + accounts. No arbitrary endpoint URLs are accepted.

Provider transport and validation are tested with mocked responses; paid calls were not made during development. A valid provider key and compatible model are required for an end-to-end paid-generation check.

## Enable Sign in with Roblox

Create your own Roblox OAuth application and register this exact callback:

https://mrh-animation-web-production.up.railway.app/api/auth/roblox/callback

Set these Railway service variables:

- ROBLOX_OAUTH_CLIENT_ID
- ROBLOX_OAUTH_CLIENT_SECRET
- ROBLOX_OAUTH_REDIRECT_URI (the callback above)

Enable the `openid profile` scopes. The flow uses PKCE, a browser-bound state cookie, expiring single-use state records, and server-side userinfo verification. Existing site accounts should sign in normally first, then use Roblox sign-in to link accounts. New Roblox logins get a separate member account; matching display names never grant ownership or link an existing account. OAuth tokens are not stored.

Roblox requires an eligible account to register/publish OAuth apps. Configure production credentials before testing real sign-in. The button stays disabled when not configured.

## Validation

Integration tests cover offline issuance, blocked HTTP issuance (including owner accounts), removed purchase verification, legacy key compatibility, hashing, redemption, replay, expiry, AI access checks, provider adapters, and OAuth state verification.
