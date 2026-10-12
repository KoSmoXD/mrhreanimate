# Mr H Reanimate 2.0.0

A patch-layer fork of [UhhhhhhModded](https://github.com/testing734/UhhhhhhModded), originally authored by STEVETHEREALONE with patches by BoredGal and Awes955. This package **does not include or relicense upstream source**. The `Mr_H_Reanimate.lua` loader retrieves the exact public commit `87467966d37ce4b8b2c219a0bcffaf2aa8f658a9` and patches it in memory before execution.

## What's changed

- Branded original splash, UI heading, notifications and main page as **Mr H Reanimate** while preserving original internals, modules, saved configurations, and original author credit.
- Fixes a malformed Luau declaration (`local conn conn`) that otherwise prevents compilation.
- Fixes `cloneref` bootstrap ordering and an incorrectly named `sethiddenproperty` fallback.
- Moves preferred-text-size adjustment off of a per-frame callback and throttles save-data JSON checking to approximately 0.75-second intervals.
- Adds a `PlayerGui` nil check during touch handling.
- **Removes the upstream optional Easter-egg/background routine entirely:** this routine scanned local executor files, downloaded extraneous data, introduced random startup delays, and accepted remote WebSocket commands that executed arbitrary Lua through a `jumpscare` event.
- Adds a lightweight **Mr H** panel, usable by touchscreen and mouse, showing rig status and FPS. Optional local-only Fullbright, No Fog, reduced shadows, and an outline of the user's reanimated rig are reversible.
- Uses patch-count preconditions to fail closed if the pinned engine's shape no longer matches the reviewed patterns.

## Execution

Use a Roblox Luau executor that can execute a local `.lua` script and supports the APIs required by UhhhhhhModded. Load `Mr_H_Reanimate.lua`. If the executor supports reading local files, one conventional method is:

```lua
loadstring(readfile("Mr_H_Reanimate.lua"))()
```

The upstream engine requires executor-specific file APIs (`readfile`, `writefile`, etc.), HTTP requests, and other nonstandard capabilities. **It does not run as a normal LocalScript in Roblox Studio or through the standard Roblox mobile app alone.** No server-visible FE results can be guaranteed because they depend on physics replication and network ownership.

The Mr H panel is optional. Minimizing it keeps a small **MR H** launcher. "Remove companion HUD" removes only the new panel, restores its own lighting overrides, and keeps the upstream engine running; it is not a hot-unload for the original engine.

## Security limits

- The unsafe remote WebSocket command channel is disabled.
- **Not a full security audit.** Upstream still loads assets, modules and data from URLs outside this project. Review installed modules and the linked repository before use.
- Source is pinned to one commit to avoid unreviewed automatic updates. If you change the pin, source patch validation can fail and must be reviewed again.
- No background updates, analytics, automatic webhook delivery, or Discord RPC are introduced by Mr H.

## Verification

The loader can be syntax-checked with a stock Lua parser. Upstream patch anchors are checked against the pinned source before loading, and compilation is attempted at runtime in the executor. Actual Roblox avatar mechanics, netless replication, responsiveness, and executor compatibility **have not been live-tested** in this environment.
