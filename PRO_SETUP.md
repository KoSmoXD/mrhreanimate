# Pro, personal AI keys, and Roblox sign-in

AI generation requires an authenticated site account with active Pro access. The owner account has access automatically. Manual animation editing and exports remain free.

## Access keys

Sign in as the site owner, open studio.html, and use **Owner: create access key**. Choose hours, days, or lifetime. A key is single use; its duration starts on redemption. Timed keys extend current timed access; lifetime access never expires. Keys have 75 bits of random entropy and are stored only as SHA-256 hashes. Keep issued keys private.

## AI provider keys

Supported: OpenAI Responses API, Anthropic Messages API, and Google Gemini generateContent API. Users supply a key for the selected provider and the exact model ID available to their account. Provider API charges are separate from Pro. Keys travel over HTTPS through the server to that provider only. They are not saved in the database, project files, localStorage, or logs. The browser field is cleared when switching providers or leaving the page. Validation and rate limits apply even to Pro accounts. No arbitrary endpoint URLs are accepted.

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

## Enable the 15 Robux lifetime purchase

Create the game pass under your Roblox account, put it on sale for **15 Robux**, and set pricing so the intended 15-Robux price applies. The website does not set Roblox prices.

Set these Railway service variables:

- PRO_ROBLOX_PASS_ID: your actual pass ID
- ROBLOX_INVENTORY_API_KEY: your Roblox Open Cloud key with inventory access
- PRO_KEY_ENCRYPTION_SECRET: at least 32 random characters; preserve this value to retrieve already-issued purchase keys

After Roblox sign-in, the website uses the linked numeric Roblox user ID and the official Open Cloud inventory API to check that exact pass. A verified purchase issues one lifetime key. Returning to the page checks ownership again; **Check Roblox purchase** also allows manual retry. Redemption activates access. Pending or private/unavailable ownership never grants access. Each Roblox user/pass pair gets one key; repeated checks retrieve the same key, encrypted at rest, rather than issuing new transferable keys. Users must make ownership verifiable to the configured Inventory API.

The checkout remains unavailable until the pass ID, inventory API key and encryption secret are configured. Roblox sign-in additionally needs OAuth configuration. No game pass, OAuth app, or credentials were created by this change.

## Validation

New integration tests cover all three AI adapters, key hashing/redemption/replay, owner-only issuance, timed expiry, Pro API gating, buyer identity spoofing, purchase idempotency/encrypted storage, and OAuth PKCE/state/replay/account linking. No real Robux purchase or paid AI call was made. The Windows full-suite run passed 21 tests, skipped one, and could not run four existing Linux/Python conversion cases (`python3` / `resource` are unavailable here).

Primary API references:

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://platform.claude.com/docs/en/api/beta/messages/create
- https://ai.google.dev/api/generate-content
- https://create.roblox.com/docs/cloud/auth/oauth2-reference
- https://create.roblox.com/docs/cloud/guides/inventory
