"""Version-pinned native attachment sending with immutable local staging.

The source path is on the computer running this bridge (including CAgent).
Native return does not prove upload/delivery; unknown outcomes are not retried.
"""
import hashlib
import os
import pathlib
import re
import shutil
import stat
import tempfile
from .contracts import require,identifier
from .state import SendJournal
from .runtime import send

MAX_FILE_BYTES=128*1024*1024
STAGING_BYTES=512*1024*1024
STAGING_FILES=64

def prepare(params):
    require(isinstance(params,dict) and not set(params)-{'recipient','path','idempotencyKey'},'INVALID_REQUEST','Unknown file-send field')
    target=params.get('recipient')
    if target!='filehelper':identifier(target)
    key=params.get('idempotencyKey')
    require(isinstance(key,str) and re.fullmatch(r'[A-Za-z0-9_-]{8,128}',key),'INVALID_KEY','Use a stable idempotency key')
    value=params.get('path')
    require(isinstance(value,str) and 0<len(value)<=32767 and '\0' not in value,'INVALID_PATH','Absolute file path required')
    path=pathlib.Path(value)
    require(path.is_absolute() and not value.startswith(('\\\\','//')),'INVALID_PATH','Use a local absolute path on the target machine')
    if os.name=='nt':require(':' not in value[2:],'INVALID_PATH','Alternate data streams are not supported')
    require(len(path.name.encode('utf8'))<=1023,'INVALID_PATH','File name is too long')
    return target,path,key

def stage(source,directory,check):
    directory.mkdir(parents=True,exist_ok=True)
    files=[p for p in directory.glob('*/*') if p.is_file()]
    require(len(files)<STAGING_FILES,'STAGING_FULL','Archive retained attachment staging before sending more files')
    used=sum(p.stat().st_size for p in files)
    work=pathlib.Path(tempfile.mkdtemp(prefix='file-',dir=directory));dest=work/source.name
    try:
        require(len(str(dest).encode('utf-16-le'))//2<1024,'INVALID_PATH','Native staging path is too long')
        digest=hashlib.sha256();total=0
        with source.open('rb') as src,dest.open('xb') as out:
            before=os.fstat(src.fileno())
            require(stat.S_ISREG(before.st_mode),'INVALID_FILE','Source must be a regular file')
            require(0<before.st_size<=MAX_FILE_BYTES,'FILE_SIZE','Attachment must be 1 byte to 128 MiB')
            require(used+before.st_size<=STAGING_BYTES,'STAGING_FULL','Retained attachments exceed 512 MiB')
            while True:
                check();block=src.read(1024*1024)
                if not block:break
                total+=len(block)
                require(total<=MAX_FILE_BYTES and used+total<=STAGING_BYTES,'FILE_SIZE','File grew past the staging budget')
                digest.update(block);out.write(block)
            after=os.fstat(src.fileno())
            require((before.st_size,before.st_mtime_ns,before.st_ino)==(after.st_size,after.st_mtime_ns,after.st_ino)
                    and total==before.st_size,'FILE_CHANGED','Source changed while staging; nothing was sent')
            out.flush();os.fsync(out.fileno())
        check()
        return {'path':str(dest),'size':total,'sha256':digest.hexdigest(),'name':source.name}
    except BaseException:
        shutil.rmtree(work)
        raise

def attempt(memory,binding,path,base,params,directory,check):
    target,source,key=prepare(params)
    attachment=stage(source,directory/'attachments',check)
    journal=None
    retain=False
    try:
        journal=SendJournal(directory/'file-send-journal.sqlite3')
        record,existing=journal.reserve(binding,key,[target,attachment['name'],attachment['size'],attachment['sha256']])
        if existing:return {'status':existing,'replayed':True,'newSend':False,'deliveryConfirmed':False}
        check()
        # Once submission starts, retain the stable file for asynchronous upload.
        # A crash/cancellation/unknown result must never remove or resend it.
        retain=True
        result=send(memory,binding,path,base,target,attachment['name'],check,
                    attachment={'path':attachment['path'],'size':attachment['size']})
        journal.finish(record,result['status'])
        retain=result['status']!='not_submitted'
        return dict(result,file={'name':attachment['name'],'bytes':attachment['size'],'sha256':attachment['sha256']},
                    newSend=result['status']!='not_submitted',stagingRetained=retain,
                    limitations=['native_returned is not upload or recipient delivery confirmation',
                                 'Use the same idempotency key after interruptions; do not retry unknown outcomes with a new key'])
    finally:
        try:
            if journal is not None:journal.close()
        finally:
            if not retain:shutil.rmtree(pathlib.Path(attachment['path']).parent)
