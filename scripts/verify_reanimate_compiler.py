#!/usr/bin/env python3
"""Prepare a reproducible Luau compiler test for the published Mr H loader.

The loader decodes a pinned upstream Uhhhhhh engine and rewrites selected
sections before compilation. Testing the encoded loader alone is insufficient:
the rewritten runtime engine must also compile within Luau's 200-register limit.
"""
import pathlib
import re
import sys
import urllib.request

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LOADER = REPO_ROOT / "Mr_H_Reanimate.lua"
UPSTREAM = (
    "https://raw.githubusercontent.com/testing734/UhhhhhhModded/"
    "87467966d37ce4b8b2c219a0bcffaf2aa8f658a9/"
    "uhhhhhh%20awes%20fork"
)

def published_source() -> str:
    raw = LOADER.read_text(encoding="utf-8")
    encoded = raw.split("local _0=table.concat({", 1)[1].split("})", 1)[0]
    chunks = re.findall(r'"([0-9A-F]+)"', encoded)
    if len(chunks) < 10:
        raise AssertionError("Expected encoded loader string blocks")
    encoded_bytes = bytes.fromhex("".join(chunks))
    decoded = bytes(
        (b - ((i * 73 + 91) % 256)) % 256
        for i, b in enumerate(encoded_bytes, start=1)
    ).decode("utf-8")
    if any(ord(ch) > 127 for ch in decoded):
        raise AssertionError("This hex byte wrapper must contain only ASCII source")
    if 'local VERSION = "2.9.7"' not in decoded:
        raise AssertionError("Unexpected public version")
    begin = decoded.index("    -- ONLINE MODULES: download uploaded packages")
    segment_start = decoded.rfind("    do\n", 0, begin)
    if segment_start < 0 or begin - segment_start > 12:
        raise AssertionError("Online Modules must use its own do/end scope")
    end = decoded.index("end -- end Online Modules local scope", begin)
    if end <= begin:
        raise AssertionError("Online Modules local scope not closed")
    if end > decoded.index("    -- CUSTOM UI COLORS", begin):
        raise AssertionError("Online Modules leaks locals into the rest of the engine")
    if "(function()" + chr(10) + "    HatReanimator.MrHCustomOverrides" not in decoded:
        raise AssertionError("Advanced Tools must run in its own function closure")
    if "end)() -- close isolated Advanced Tools function" not in decoded:
        raise AssertionError("Advanced Tools isolated function is not closed")
    for removed in (
        'Preview 3D: ',
        'MrH3DAnimationViewport',
        '3D Animation Preview',
        'parsePreview(data)',
        'viewState.Duration',
        'Preview track: ',
        'onlinePreview(',
    ):
        if removed in decoded:
            raise AssertionError("3D preview must live on the website, not in the loader: " + removed)
    for required in ('Online Modules (Mr H Website)', 'onlineInstall(kind, item)'):
        if required not in decoded:
            raise AssertionError("Online Modules install feature missing: " + required)


    if 'local data = [====[' not in decoded:
        raise AssertionError("Bundled UI changer is required; never block startup on a second HTTP fetch")
    if 'stage("engine compiled; starting UI")' not in decoded or 'timedRequest(' not in decoded:
        raise AssertionError("Monitored boot and bounded pinned HTTP requests are required")
    if 'Never restore an alternate UI during engine startup' not in decoded:
        raise AssertionError("Alternate libraries must not hide Original during startup")
    if 'published loader entered; decoding source' not in raw:
        raise AssertionError("Raw published loader must log entry before decoding")
    for required in (
        'UI Changer',
        '"Original", "Obsidian", "Linoria"',
        'three-mode UI changer with original fallback',
    ):
        if required not in decoded:
            raise AssertionError("UI changer is missing: " + required)
    for expected in (
        'track dance clock even when local audio cannot start',
        'dance music time fallback when local MP3 cannot play',
    ):
        if expected not in decoded:
            raise AssertionError("Missing dance playback fallback patch: " + expected)
    return decoded

def long_literal(s: str) -> str:
    for count in range(4, 50):
        eq = "=" * count
        if f"]{eq}]" not in s:
            return "[" + eq + "[" + s + "]" + eq + "]"
    raise AssertionError("No safe Lua long-string delimiter")

def generate(target_dir: pathlib.Path):
    decoded = published_source()
    start = decoded.index("local function escapePattern(str)")
    end = decoded.index("\nif env.UhhhhhhLoaded or _G.UhhhhhhLoaded", start)
    rewriting = decoded[start:end]
    if not rewriting.rstrip().endswith("end"):
        raise AssertionError("Rewrite function extraction appears incomplete")
    request = urllib.request.Request(
        UPSTREAM, headers={"User-Agent": "MrH-Reanimate-Compiler-CI"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        upstream = response.read().decode("utf-8")
    if len(upstream) < 150000:
        raise AssertionError("Pinned upstream source is unexpectedly small")
    if 'ForceModuleReload("SKIPHASH")' not in rewriting:
        raise AssertionError("Boot must skip the remote hash scan.")
    if "Hash request timed out after 6 seconds" not in rewriting:
        raise AssertionError("Manual remote hash scan needs a timeout.")
    if not target_dir.is_dir():
        target_dir.mkdir(parents=True)
    test_script = (
        "-- Generated test: run the real pinned upstream through Mr H patch rules.\n"
        "local state = {patches = {}}\n"
        + rewriting
        + "\nlocal upstream = "
        + long_literal(upstream)
        + "\nlocal rewritten = rewrite(upstream)\n"
        + 'print(rewritten)\n'
    )
    (target_dir / "published_decoded_loader.luau").write_text(decoded, encoding="utf-8")
    destination = target_dir / "rewrite_verify.luau"
    destination.write_text(test_script, encoding="utf-8")
    print(f"Prepared {destination} from pinned upstream source", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/verify_reanimate_compiler.py OUTPUT_DIR")
    generate(pathlib.Path(sys.argv[1]))
