# Mr H Reanimate 2.3.0 (encoded distribution)

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
- **Adds the Experimental Permadeath** Hats Reanimator option, currently implemented as a local-hold experiment. It does not call the removed `ConnectDiedSignalBackend` event and cannot guarantee FE replication.
- Uses patch-count preconditions to fail closed if the pinned engine's shape no longer matches the reviewed patterns.

## Execution

Use a Roblox Luau executor that can execute a local `.lua` script and supports the APIs required by UhhhhhhModded. Load `Mr_H_Reanimate.lua`. If the executor supports reading local files, one conventional method is:

```lua
loadstring(readfile("Mr_H_Reanimate.lua"))()
```

The upstream engine requires executor-specific file APIs (`readfile`, `writefile`, etc.), HTTP requests, and other nonstandard capabilities. **It does not run as a normal LocalScript in Roblox Studio or through the standard Roblox mobile app alone.** No server-visible FE results can be guaranteed because they depend on physics replication and network ownership.

**Rejoin before testing the new intro** if an older version is already running. Executing v2.3.0 while v2.0 is active removes its legacy purple HUD when possible, but does not restart the upstream reanimation engine or replace its already-created startup text.

## Experimental Permadeath

In **Hats Reanimator**, switch on **Experimental Permadeath** before starting reanimation. This is a local character-hold experiment, not a verified FE/server-side permadeath bypass. If your character gets stuck, rejoin the experience. The normal Hats method is unchanged when the option is off.

## Public script obfuscation

`Mr_H_Reanimate.lua` is an encoded public distribution build. Its decoded payload is the same v2.3.0 loader as before obfuscation, and it retains the same execution URL and features. The loader still retrieves the original public UhhhhhhModded engine; this was never private.

**Obfuscation does not protect source code from determined users.** Because this repository has always been public, older readable versions are accessible from its Git commit history. To prevent casual viewing of development source in the future, use a *new public distribution repository* with no readable history and a separate private source repository. Never embed private GitHub tokens in Roblox Lua.

## Security limits

- The unsafe remote WebSocket command channel is disabled.
- **Not a full security audit.** Upstream still loads assets, modules and data from URLs outside this project. Review installed modules and the linked repository before use.
- Source is pinned to one commit to avoid unreviewed automatic updates. If you change the pin, source patch validation can fail and must be reviewed again.
- No background updates, analytics, automatic webhook delivery, or Discord RPC are introduced by Mr H.

## Verification

The distributable's byte encoding and decoding were round-trip checked against the readable v2.3.0 Lua source. No live Roblox executor testing has been performed, and FE permadeath is not guaranteed.
