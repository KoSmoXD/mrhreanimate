# Mr H Reanimate 2.2.0

A patch-layer fork of [UhhhhhhModded](https://github.com/testing734/UhhhhhhModded), originally authored by STEVETHEREALONE with patches by BoredGal and Awes955. This package **does not include or relicense upstream source**. The `Mr_H_Reanimate.lua` loader retrieves the exact public commit `87467966d37ce4b8b2c219a0bcffaf2aa8f658a9` and patches it in memory before execution.

## What's changed

- Replaces the original **STEVE / THERE / ALONE** intro logo with **tplay / addon / real**.
- The splash and menu top bar display **Mr H Reanimate** consistently, without randomized title replacement. Only the background intro scroller uses **LEGIT HEAVEN FOR REANIMATORS**.
- Removes the STEVE/BoredGal/Awes955 credit line from the main menu while retaining proper upstream attribution in the source and this README.
- Preserves the upstream reanimation engine, original settings and module system. Original author attribution remains in the source and documentation.
- Fixes a malformed Luau declaration (`local conn conn`) that otherwise prevents compilation.
- Fixes `cloneref` bootstrap ordering and an incorrectly named `sethiddenproperty` fallback.
- Moves preferred-text-size adjustment off of a per-frame callback and throttles save-data JSON checking to approximately 0.75-second intervals.
- Adds a `PlayerGui` nil check during touch handling.
- **Removes the upstream optional Easter-egg/background routine entirely:** this routine scanned local executor files, downloaded extraneous data, introduced random startup delays, and accepted remote WebSocket commands that executed arbitrary Lua through a `jumpscare` event.
- **Removes the extra purple Mr H companion HUD entirely.** Only the original upstream interface is launched. FPS and lighting controls that belonged to the removed HUD are no longer available from Mr H.
- **Adds opt-in Experimental Permadeath (Hats)** to the existing Hats Reanimator settings. The legacy `ConnectDiedSignalBackend` is attempted only when `replicatesignal` and the signal are available. Failures revert to the normal Hats behavior, and the status shows `UNVERIFIED` rather than promising FE replication. The setting is **off by default**; never changes `Players.RespawnTime` to infinity.
- Uses patch-count preconditions to fail closed if the pinned engine's shape no longer matches the reviewed patterns.

## Execution

Use a Roblox Luau executor that can execute a local `.lua` script and supports the APIs required by UhhhhhhModded. Load `Mr_H_Reanimate.lua`. If the executor supports reading local files, one conventional method is:

```lua
loadstring(readfile("Mr_H_Reanimate.lua"))()
```

The upstream engine requires executor-specific file APIs (`readfile`, `writefile`, etc.), HTTP requests, and other nonstandard capabilities. **It does not run as a normal LocalScript in Roblox Studio or through the standard Roblox mobile app alone.** No server-visible FE results can be guaranteed because they depend on physics replication and network ownership.

**Rejoin before testing the new intro** if an older version is already running. Executing v2.2.0 while v2.0 is active removes its legacy purple HUD when possible, but does not restart the upstream reanimation engine or replace its already-created startup text.

## Experimental Permadeath (Hats)

Select **Hats Reanimator**, find **Experimental Permadeath (Hats)** and enable it before pressing **Reanimate**. It is disabled by default. When `replicatesignal` is unavailable, the switch reverts to off. If the legacy backend death signal cannot be fired, the engine falls back to its standard Hats behavior.

**This is not confirmed working FE permadeath in current Roblox games.** A successful executor call cannot prove the Roblox server accepted the signal, and network ownership remains controlled by Roblox. Test in a private experience and rejoin if your avatar becomes stuck.

Changing `game:GetService("Players").RespawnTime` to `math.huge` through a client script does not reliably change the server's respawn schedule. For genuine no-respawn gameplay in your own game, use a server-side `Players.CharacterAutoLoads = false` and manage character loading explicitly.

## Security limits

- The unsafe remote WebSocket command channel is disabled.
- **Not a full security audit.** Upstream still loads assets, modules and data from URLs outside this project. Review installed modules and the linked repository before use.
- Source is pinned to one commit to avoid unreviewed automatic updates. If you change the pin, source patch validation can fail and must be reviewed again.
- No background updates, analytics, automatic webhook delivery, or Discord RPC are introduced by Mr H.

## Verification

The loader rewrite was checked against the pinned upstream source, including five new exact-match experimental permadeath anchors. Compilation happens at runtime in the executor. **No client/server FE verification has been performed**, and this option may not work on current executors or Roblox servers.
