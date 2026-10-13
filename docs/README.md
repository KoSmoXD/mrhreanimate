# Mr H Animation Studio

Static animation website for Mr H Reanimate. Inspired by the dark visual style of Roblox script-hub landing pages (independent of mspaint.cc).

## Hosting with GitHub Pages

1. Open the repository **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select branch **main**, folder **/docs**, then **Save**.
4. After GitHub Pages finishes publishing, the expected project URL is `https://kosmoxd.github.io/mrhreanimate/`.

This application needs no server, build step, API key, or external runtime libraries. Open `docs/index.html` locally for offline use (Google Fonts will fall back to system fonts).

## Supported format

This app supports the custom **binary .anim** format read by the pinned engine's `AnimLib.Track.frombuffer`, **not** Roblox `.rbxm`, `.rbxmx`, `.fbx`, `.gif`, or native published animation asset IDs.

Binary format is little-endian:

- u16 byte length + UTF-8 name
- u32 keyframe count
- for each keyframe: f32 time, u32 pose count
- for each pose: u16-length pose name, f32 weight, u16-length easing style, u16-length easing direction, 12 × f32 CFrame matrix components

The page preserves unrecognized pose names on re-export. The preview currently renders standard R6 body parts using **linear interpolation and quaternion rotation blending**. Easing settings are preserved in exported files but not visually simulated. Files larger than 8 MB, animations over 300s and other invalid bounds are rejected.

## Features

- Drag-and-drop multiple `.anim` files or use the file picker.
- Preview a simplified R6 model with mouse/touch orbit, zoom, grid, and PNG capture.
- Play, pause, loop, change speed, scrub, navigate/add/delete keyframes.
- Edit per-joint position/rotation and animation name.
- Export binary `.anim` compatible with Mr H Animation Maker.
- Save and restore clips in this browser using IndexedDB when available.
- Built-in Walk Cycle and Wave Sample demos.

## Privacy and limitations

All uploads are processed locally in the user's browser. **Uploading here does not publish the animation for other visitors.** The site has no public/community database or sign-in. Saving to IndexedDB stores files only in the current browser profile. For a public shared upload/gallery feature, a backend with file storage and moderation must be added.

To use exported animations with Mr H Reanimate, move files into the executor workspace path `UhhhhhhReanim/Content/Anims/` and open them with the Animation Library.

Do not treat a browser-side R6 preview as a Roblox rendering/replication test. Roblox physics, rig constraints and animation priority may differ.
