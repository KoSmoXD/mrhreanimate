# Mr H Reanimate 2.1.1

A patch-layer fork of [UhhhhhhModded](https://github.com/testing734/UhhhhhhModded), originally authored by STEVETHEREALONE with patches by BoredGal and Awes955. This package **does not include or relicense upstream source**. The `Mr_H_Reanimate.lua` loader retrieves the exact public commit `87467966d37ce4b8b2c219a0bcffaf2aa8f658a9` and patches it in memory before execution.

## What's changed

- Replaces the original **STEVE / THERE / ALONE** intro logo with **tplay / addon / real**.
- Keeps the **Mr H Reanimate** name on the splash screen, window title, and original controls. Only the background intro scroller uses **LEGIT HEAVEN FOR REANIMATORS**; the original splash captions and main-page greetings are preserved.
- Preserves the upstream reanimation engine, original settings and module system. Original author attribution remains in the source and documentation.
- Fixes a malformed Luau declaration (`local conn conn`) that otherwise prevents compilation.
- Fixes `cloneref` bootstrap ordering and an incorrectly named `sethiddenproperty` fallback.
- Moves preferred-text-size adjustment off of a per-frame callback and throttles save-data JSON checking to approximately 0.75-second intervals.
- Adds a `PlayerGui` nil check during touch handling.
- **Removes the upstream optional Easter-egg/background routine entirely:** this routine scanned local executor files, downloaded extraneous data, introduced random startup delays, and accepted remote WebSocket commands that executed arbitrary Lua through a `jumpscare` event.
- **Removes the extra purple Mr H companion HUD entirely.** Only the original upstream interface is launched. FPS and lighting controls that belonged to the removed HUD are no longer available from Mr H.
- Uses patch-count preconditions to fail closed if the pinned engine's shape no longer matches the reviewed patterns.

## Execution

Use a Roblox Luau executor that can execute a local `.lua` script and supports the APIs required by UhhhhhhModded. Load `Mr_H_Reanimate.lua`. If the executor supports reading local files, one conventional method is:

```lua
loadstring(readfile("Mr_H_Reanimate.lua"))()
```

The upstream engine requires executor-specific file APIs (`readfile`, `writefile`, etc.), HTTP requests, and other nonstandard capabilities. **It does not run as a normal LocalScript in Roblox Studio or through the standard Roblox mobile app alone.** No server-visible FE results can be guaranteed because they depend on physics replication and network ownership.

**Rejoin before testing the new intro** if an older version is already running. Executing v2.1.1 while v2.0 is active removes its legacy purple HUD when possible, but does not restart the upstream reanimation engine or replace its already-created startup text.

## Security limits

- The unsafe remote WebSocket command channel is disabled.
- **Not a full security audit.** Upstream still loads assets, modules and data from URLs outside this project. Review installed modules and the linked repository before use.
- Source is pinned to one commit to avoid unreviewed automatic updates. If you change the pin, source patch validation can fail and must be reviewed again.
- No background updates, analytics, automatic webhook delivery, or Discord RPC are introduced by Mr H.

## Verification

The loader rewrite was checked against pinned upstream source text, including unique patch anchors and the removal of the companion HUD. Compilation happens in the Roblox executor at runtime. The v2.1 startup screens and Roblox avatar mechanics have **not** been tested in a live Roblox client.
