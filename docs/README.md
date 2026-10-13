# Mr H Animations — Pack Uploader

This is a static, dark-themed animation pack website for Mr H Reanimate.

## Required files

Each working animation package needs **all three matching files**:

1. **Animation**: `.anim` — custom Uhhhhhh/Mr H keyframe binary.
2. **Music**: `.mp3` — soundtrack used by the animation.
3. **Lua**: `.lua` — the actual animation module which references those assets and implements playback using Mr H's module interface.

The website does **not** automatically generate a valid Lua module or install it in Roblox; the three files must match. Do not run unknown Lua files without reviewing their contents.

## Website features

- Three mandatory file upload slots and a multi-file drag-and-drop area.
- Validation of file extensions, safety size limits, and `.anim` binary structure.
- Native MP3 audio preview in the browser.
- Pack name, optional creator and notes.
- **Download animation pack**: browser-built ZIP containing exactly the three original uploaded files (unchanged bytes and filenames).
- Save/open/download/delete packs locally through IndexedDB where supported.

**Privacy:** Files remain local to each visitor's browser. The app does not upload or publish files to a shared public gallery. Public sharing would require a separate backend with storage, permissions and moderation.

The `.anim` parser accepts the binary format defined by `AnimLib.Track.frombuffer` in the pinned upstream engine. It does not accept Roblox `.rbxm`, `.rbxmx`, or published animation asset IDs.

## Deployment

Use **GitHub → Settings → Pages** and configure **Deploy from a branch**, branch **main**, folder **/docs**. Once GitHub confirms deployment, the expected public URL is:

`https://kosmoxd.github.io/mrhreanimate/`

GitHub Pages hosting is not automatically activated by committing the site files.

No build step or JavaScript dependencies are required. Fonts use a remote Google Fonts stylesheet but fall back to system fonts offline.

## Limits

Maximum size per file: `.anim` 8 MiB, `.mp3` 35 MiB, `.lua` 2 MiB, total 48 MiB. Browsers can impose lower storage quotas. Saved packs are not synchronized between devices.
