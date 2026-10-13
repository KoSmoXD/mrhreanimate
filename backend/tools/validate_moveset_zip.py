#!/usr/bin/env python3
"""Validate a community Uhhhhhh MOVESET ZIP without extracting or executing code."""
import sys,zipfile,resource,re,struct

def fail(text):raise ValueError(text)
def read_anim(blob):
    mv=memoryview(blob);p=0
    def get(n):
        nonlocal p
        if p+n>len(mv):fail("Broken .anim track.")
        value=mv[p:p+n];p+=n;return value
    def u16():return struct.unpack('<H',get(2))[0]
    def u32():return struct.unpack('<I',get(4))[0]
    def string():
        n=u16()
        if n>512:fail("Oversized .anim string.")
        get(n)
    def f32():
        import math
        x=struct.unpack('<f',get(4))[0]
        if not math.isfinite(x) or abs(x)>1000000:fail("Invalid track value.")
        return x
    string();frames=u32()
    if not 1<=frames<=1500:fail("Invalid animation keyframes.")
    duration=0
    for _ in range(frames):
        t=f32()
        if not 0<=t<=300:fail("Invalid animation time.")
        duration=max(duration,t)
        poses=u32()
        if poses>100:fail("Too many animation poses.")
        for _ in range(poses):
            string();f32();string();string()
            for v in range(12):f32()
    if p!=len(mv) or duration<0.05:fail("Animation is incomplete or has zero duration.")

def validate(filename):
    resource.setrlimit(resource.RLIMIT_AS,(384*1024*1024,384*1024*1024))
    resource.setrlimit(resource.RLIMIT_CPU,(8,9))
    allowed={
       'UhhhhhhReanim/Content/Anims/':'.anim',
       'UhhhhhhReanim/Content/Sounds/':'.mp3',
       'UhhhhhhReanim/Modules/':'.lua'
    }
    counts={'.anim':0,'.mp3':0,'.lua':0}
    seen=set();total=0
    with zipfile.ZipFile(filename) as z:
        entries=z.infolist()
        if len(entries)>45:fail("Too many files inside the ZIP.")
        for info in entries:
            name=info.filename
            if info.is_dir():continue
            if (name in seen or '\\' in name or name.startswith('/') or '..' in name.split('/')
                or not name.isascii() or '\x00' in name):fail("Unsafe ZIP file paths.")
            seen.add(name)
            extension=None
            for prefix,ext in allowed.items():
                if name.startswith(prefix) and name[len(prefix):] and '/' not in name[len(prefix):]:
                    if name.lower().endswith(ext):extension=ext
            if not extension:fail("ZIP contains files outside Uhhhhhh moveset folders.")
            if info.flag_bits & 1:fail("Encrypted ZIP files are not supported.")
            if info.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED):
                fail("Unsupported ZIP compression.")
            if (info.external_attr>>16)&0o170000 == 0o120000:fail("ZIP symbolic links not allowed.")
            maxsize={'.anim':8*1048576,'.mp3':35*1048576,'.lua':2*1048576}[extension]
            if not 1<=info.file_size<=maxsize:fail("A ZIP entry exceeds its file limit.")
            total+=info.file_size
            if total>80*1048576:fail("ZIP expands beyond 80 MB.")
            if info.compress_size and info.file_size/max(info.compress_size,1)>300:fail("ZIP compression ratio is suspicious.")
            counts[extension]+=1
            content=z.read(info)
            if extension=='.anim':read_anim(content)
            if extension=='.mp3' and not (content[:3]==b'ID3' or (len(content)>2 and content[0]==255 and content[1]&224==224)):
                fail("Invalid MP3.")
            if extension=='.lua':
                if b'\0' in content:fail("Lua must be text.")
                script=content.decode('utf-8')
                if not re.search(r'\bModuleType\s*=\s*["\']MOVESET["\']',script):
                    fail("Lua module must declare MOVESET.")
        if counts['.lua']<1 or counts['.anim']<2:
            fail("Moveset ZIP needs a MOVESET .lua module and at least two .anim files.")
        if counts['.lua']>8 or counts['.anim']>25 or counts['.mp3']>4:
            fail("Moveset ZIP has too many assets.")
    print("valid")
if __name__=='__main__':
    try:validate(sys.argv[1])
    except Exception as e:
        print(str(e)[:220],file=sys.stderr)
        sys.exit(1)
