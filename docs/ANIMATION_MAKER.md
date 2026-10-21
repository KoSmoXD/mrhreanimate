# Animation Maker

Open `/studio.html` or choose **AI Animation Maker** in the website navigation.

- The R6 renderer adapts the supplied `anim preview.html`: skin-weight mesh splitting, Motor6D joint offsets, quaternion interpolation, source easing, and full-motion camera fitting. The matching rig from `testing734/RBXM2ANIM/roblox_r6_rigged.glb` is bundled locally as `r6-rig.glb`. Three.js and GLTFLoader are served from the existing installed package, with no script CDN.
- Source projects keep editable local joint position, XYZ rotation (degrees), and outgoing cubic Bézier timing. The first and last keyframes anchor the clip. Click timeline diamonds or time buttons to select; drag interior diamonds to retime. Save project downloads editable JSON. The last outgoing curve is unused.
- `.anim` export bakes timing into linear frames at 30 fps, including original keyframe timestamps, for existing `.anim` consumers. Curves are retained in the project JSON, not native Roblox CurveAnimation objects. Rotation interpolation uses shortest-path quaternion slerp; use intermediate poses for full spins.
- Manual clips: 0.5–30 seconds; import supports up to 1500 keyframes, six R6 joints, and 8 MB. Invalid input is rejected. Project autosave and undo history stay in the browser. Importing/editing never executes Lua.
- A simple six-part software renderer remains available if WebGL is disabled. Full rig mesh/textures require WebGL. The gallery also keeps its original fallback.

## Enable actual AI generation

Set `OPENAI_API_KEY` and `ANIMATION_AI_MODEL` in the existing Railway service. The selected model must support Responses API strict structured outputs. Keys never go to the browser or into this repository. A ChatGPT subscription is separate from API access.

AI generation requires the site's existing session. Users log in through the main website. The endpoint limits each account to eight requests/hour, validates prompts/duration, has a 90-second timeout, and validates the returned document before opening it. No key/model means generation is disabled with an explicit connection message; the manual editor and labeled hand-authored example work independently. No live AI model call was tested without provider credentials.

## Checks

`npm test --prefix backend` includes format roundtrip, bounds, Bézier timing, endpoint authentication, unconfigured service behavior, mocked structured response, invalid response rejection, and the existing gallery/conversion tests.

## Inline dance and moveset previews

The existing Make Animation and Moveset Maker forms now each include the shared R6 viewer, playback/scrubbing controls, loop and speed controls, and optional selected music. Preview runs before ZIP generation and does not modify source files or generated ZIP contents.

Dance models convert into previewable tracks automatically; models with multiple KeyframeSequences expose a track picker. Movesets preview each supplied movement slot; a raw movement model must contain exactly one sequence, matching the ZIP builder. `.anim` files are parsed locally. Raw `.rbxm`/`.rbxmx` models use `/api/preview-model`, which returns only converted animation data, limits input to 4 MB and total output tracks to 8 MB, applies the existing bounded converter and per-IP request limit, and removes temporary files after processing. Model Lua is never executed. Preview clips support sparse joint tracks, single-frame poses and lengths up to 300 seconds, without the animation editor's 30-second authoring limit.

Selecting another track or leaving a maker pauses playback. Selected MP3s use local object URLs, are synchronized to the preview clock, and are revoked when replaced or when leaving the page. Full textured rendering requires WebGL; the browser checks used the software fallback because the test browser disables WebGL.
