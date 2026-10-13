#!/usr/bin/env python3
"""Convert user-supplied Roblox KeyframeSequence models to Uhhhhhh .anim files.

The model parser and binary converter are from STEVETHEREALONE (MIT); this
wrapper adds bounds, safe filenames and a noninteractive command interface.
Called only from the Node backend; never evaluates Lua or Roblox scripts.
"""
import sys, os, re, json, math, resource
from pathlib import Path
from steve_rbxm2anim import RBXModel, convert

def apply_limits():
    # Hard stop for hostile compressed RBXM/XML models on Linux.
    resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (7, 8))
    resource.setrlimit(resource.RLIMIT_FSIZE, (9 * 1024 * 1024, 9 * 1024 * 1024))

def main():
    if len(sys.argv) != 3:
        raise ValueError("Input and output paths required")
    apply_limits()
    path=Path(sys.argv[1])
    directory=Path(sys.argv[2])
    if path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("Model exceeds 4 MB limit")
    raw=path.read_bytes()
    roots=RBXModel.parse(raw)
    sequences=[]
    seen=set()
    def visit(obj,depth=0):
        if depth>45 or len(seen)>70000:
            raise ValueError("Too many model instances")
        marker=id(obj)
        if marker in seen:return
        seen.add(marker)
        if getattr(obj,'ClassName','')=='KeyframeSequence':
            sequences.append(obj)
            return
        for child in obj.GetChildren():
            visit(child,depth+1)
    for root in roots:
        visit(root)
    if not sequences:
        raise ValueError("No KeyframeSequence found. Export a Roblox KeyframeSequence model.")
    if len(sequences)>20:
        raise ValueError("Maximum 20 sequences per file")
    directory.mkdir(parents=True,exist_ok=True)
    os.chdir(directory)
    outputs=[]
    names=set()
    for index,sequence in enumerate(sequences):
        frames=[k for k in sequence.GetChildren() if k.ClassName=='Keyframe']
        if not (1<=len(frames)<=1500):
            raise ValueError("Each sequence must contain 1–1500 keyframes")
        if any(not math.isfinite(float(getattr(f,'Time',0) or 0)) or
               float(getattr(f,'Time',0) or 0)<0 or float(getattr(f,'Time',0) or 0)>300 for f in frames):
            raise ValueError("Invalid keyframe time (0–300s)")
        if any(len([p for p in frame.GetDescendants() if p.ClassName=='Pose'])>100 for frame in frames):
            raise ValueError("Too many poses (max 100 per frame)")
        original=str(getattr(sequence,'Name','') or 'Animation')
        base=re.sub(r'[^A-Za-z0-9_ -]','_',original).strip()[:48] or 'Animation'
        if base.lower() in names:base=(base[:40]+'_'+str(index+1))
        while base.lower() in names:base=base[:45]+'_x'
        names.add(base.lower())
        sequence.Name=base
        convert(sequence)
        outfile=Path(base+'.anim')
        if not outfile.is_file() or outfile.stat().st_size>8*1024*1024:
            raise ValueError("Converter produced invalid animation data")
        outputs.append(dict(name=base,filename=outfile.name,keyframes=len(frames),size=outfile.stat().st_size))
    Path('_results.json').write_text(json.dumps(outputs),encoding='utf-8')

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print(str(exc)[:300],file=sys.stderr)
        sys.exit(1)
