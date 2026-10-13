#!/usr/bin/env python3
"""Safely enumerate/extract one file from previously validated Uhhhhhh MOVESET ZIP."""
import json,os,sys,resource,zipfile
from pathlib import Path
PREFIXES={"UhhhhhhReanim/Content/Anims/":(".anim",8*1048576),
          "UhhhhhhReanim/Content/Sounds/":(".mp3",35*1048576),
          "UhhhhhhReanim/Modules/":(".lua",2*1048576)}
def validate(files):
    if len(files)>45: raise ValueError("Too many moveset ZIP files.")
    seen=set()
    out=[]
    for i,entry in enumerate(files):
        if entry.is_dir():continue
        name=entry.filename
        if (name in seen or not name.isascii() or '\\' in name or
            name.startswith('/') or '..' in name.split('/') or '\x00' in name):
            raise ValueError("Unsafe ZIP filename.")
        seen.add(name)
        matched=False
        for prefix,(extension,cap) in PREFIXES.items():
            short=name.removeprefix(prefix)
            if name.startswith(prefix) and '/' not in short and short and short.lower().endswith(extension):
                if not 1<=entry.file_size<=cap:raise ValueError("Oversized module asset.")
                matched=True;break
        if not matched:raise ValueError("Unexpected ZIP asset.")
        if entry.flag_bits&1 or entry.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):
            raise ValueError("Unsupported ZIP entry.")
        if (entry.external_attr>>16)&0o170000 == 0o120000:
            raise ValueError("ZIP symlink rejected.")
        out.append({"index":i,"path":name,"sizeBytes":entry.file_size})
    if len(out)>45:raise ValueError("Too many files.")
    return out
def main():
    resource.setrlimit(resource.RLIMIT_AS,(384*1048576,384*1048576))
    resource.setrlimit(resource.RLIMIT_CPU,(7,8))
    if len(sys.argv) not in (3,5):raise ValueError("Invalid invocation.")
    action,filename=sys.argv[1:3]
    with zipfile.ZipFile(filename) as archive:
        entries=archive.infolist()
        files=validate(entries)
        if action=="list" and len(sys.argv)==3:
            print(json.dumps(files,separators=(',',':')))
        elif action=="extract" and len(sys.argv)==5:
            number=int(sys.argv[3])
            item=next((v for v in files if v["index"]==number),None)
            if item is None:raise ValueError("Asset not found.")
            target=Path(sys.argv[4])
            if target.exists():raise ValueError("Output already exists.")
            with archive.open(entries[number]) as reader, target.open('xb') as dest:
                limit=item["sizeBytes"]
                written=0
                while True:
                    chunk=reader.read(min(131072,limit-written+1))
                    if not chunk:break
                    written+=len(chunk)
                    if written>limit:raise ValueError("Expanded ZIP data exceeded expected size.")
                    dest.write(chunk)
                if written!=limit:raise ValueError("ZIP entry size mismatch.")
        else:raise ValueError("Unknown ZIP action.")
if __name__=="__main__":
    try:main()
    except Exception as error:
        print(str(error)[:180],file=sys.stderr)
        sys.exit(1)
