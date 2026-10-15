"""App-scoped client credentials: current-user DPAPI or macOS Keychain, no argv secrets."""
import ctypes
from contextlib import contextmanager
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from aurora_deployment import safe_path
from aurora_cloud_sync import SyncError
from aurora_cloud_sync import unique_object

MAX_RECORD_BYTES=12288
MAX_ENCODED_RECORD=16384


def identity(org,name):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',org) or not re.fullmatch(r'AURORA_[A-Z0-9_]{3,70}',name):
        raise SyncError('SECRET_SCOPE_INVALID')
    return ('br.com.auroranexus.client.'+org).encode(),name.encode()


def keychain(org,name,value=None):
    service,account=identity(org,name)
    library=ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
    find=library.SecKeychainFindGenericPassword
    find.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_char_p,ctypes.c_uint32,ctypes.c_char_p,
                   ctypes.POINTER(ctypes.c_uint32),ctypes.POINTER(ctypes.c_void_p),ctypes.POINTER(ctypes.c_void_p)]
    length=ctypes.c_uint32();data=ctypes.c_void_p();item=ctypes.c_void_p()
    code=find(None,len(service),service,len(account),account,ctypes.byref(length),ctypes.byref(data),ctypes.byref(item))
    found=None
    if code==0:
        found=ctypes.string_at(data,length.value).decode('utf-8')
        library.SecKeychainItemFreeContent(None,data)
    elif code!=-25300:raise SyncError('KEYCHAIN_ACCESS_REQUIRED')
    if value is not None:
        raw=value.encode()
        if code==0:
            modify=library.SecKeychainItemModifyAttributesAndData
            modify.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint32,ctypes.c_char_p]
            code=modify(item,None,len(raw),raw)
        else:
            add=library.SecKeychainAddGenericPassword
            add.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_char_p,ctypes.c_uint32,ctypes.c_char_p,ctypes.c_uint32,ctypes.c_char_p,ctypes.c_void_p]
            code=add(None,len(service),service,len(account),account,len(raw),raw,None)
        if code!=0:raise SyncError('KEYCHAIN_WRITE_FAILED')
    if item.value:
        core=ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');core.CFRelease.argtypes=[ctypes.c_void_p];core.CFRelease(item)
    return found


def dpapi(raw,protect,scope):
    class Blob(ctypes.Structure):
        _fields_=[('size',ctypes.c_uint32),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buffer=ctypes.create_string_buffer(raw);extra=ctypes.create_string_buffer(scope)
    input_blob=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)))
    entropy=Blob(len(scope),ctypes.cast(extra,ctypes.POINTER(ctypes.c_ubyte)));output=Blob()
    operation=ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    operation.argtypes=[ctypes.POINTER(Blob),ctypes.c_wchar_p if protect else ctypes.POINTER(ctypes.c_wchar_p),
                        ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_uint32,ctypes.POINTER(Blob)]
    operation.restype=ctypes.c_int
    description='AURORA client credential' if protect else None
    if not operation(ctypes.byref(input_blob),description,ctypes.byref(entropy),None,None,1,ctypes.byref(output)):
        raise SyncError('DPAPI_CREDENTIAL_FAILED')
    try:return ctypes.string_at(output.data,output.size)
    finally:
        free=ctypes.windll.kernel32.LocalFree;free.argtypes=[ctypes.c_void_p];free.restype=ctypes.c_void_p;free(output.data)


def store(state,org,name,value):
    service,account=identity(org,name)
    if not isinstance(value,str) or not value or len(value)>16384 or any(c.isspace() for c in value):raise SyncError('CREDENTIAL_INVALID')
    if sys.platform=='darwin':keychain(org,name,value);return
    if sys.platform!='win32':raise SyncError('PROTECTED_OS_STORE_REQUIRED')
    directory=safe_path(Path(state)/'secrets');directory.mkdir(mode=0o700,exist_ok=True)
    path=safe_path(directory/(name+'.dpapi'));temporary=safe_path(directory/(name+'.new'))
    encoded=dpapi(value.encode(),True,service+b'\0'+account)
    with temporary.open('xb') as handle:handle.write(encoded)
    os.replace(temporary,path)


def load(state,org,name):
    service,account=identity(org,name)
    if sys.platform=='darwin':return keychain(org,name)
    if sys.platform!='win32':return None
    path=safe_path(Path(state)/'secrets'/(name+'.dpapi'))
    if not path.exists():return None
    if not path.is_file() or path.stat().st_nlink!=1 or path.stat().st_size>32768:raise SyncError('SECRET_STORAGE_INVALID')
    return dpapi(path.read_bytes(),False,service+b'\0'+account).decode('utf-8')


def record_digest(record):
    if record is None:return None
    return hashlib.sha256(json.dumps(record,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def encode_record(record):
    if not isinstance(record,dict):raise SyncError('PROTECTED_RECORD_INVALID')
    raw=json.dumps(record,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
    if len(raw)>MAX_RECORD_BYTES:raise SyncError('PROTECTED_RECORD_TOO_LARGE')
    value=base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')
    if len(value)>MAX_ENCODED_RECORD:raise SyncError('PROTECTED_RECORD_TOO_LARGE')
    return value


def load_record(state,org,name):
    value=load(state,org,name)
    if value is None:return None
    if (not isinstance(value,str) or not value or len(value)>MAX_ENCODED_RECORD
            or not re.fullmatch(r'[A-Za-z0-9_-]+',value)):
        raise SyncError('PROTECTED_RECORD_INVALID')
    try:
        raw=base64.b64decode(value+'='*((-len(value))%4),altchars=b'-_',validate=True)
        if len(raw)>MAX_RECORD_BYTES:raise ValueError()
        result=json.loads(raw.decode('utf-8'),object_pairs_hook=unique_object)
        if not isinstance(result,dict) or encode_record(result)!=value:raise ValueError()
        return result
    except (ValueError,UnicodeError,TypeError):
        raise SyncError('PROTECTED_RECORD_INVALID') from None


@contextmanager
def record_guard(state,org,name):
    identity(org,name)
    # Keychain items are global to this OS user, org and alias. A second state
    # directory must not create a separate lock for the same protected item.
    if sys.platform=='darwin':
        directory=safe_path(Path.home()/'Library/Application Support/AuroraNexus/credential-locks'/org)
        directory.mkdir(mode=0o700,parents=True,exist_ok=True)
    else:
        directory=safe_path(Path(state)/'secrets');directory.mkdir(mode=0o700,parents=False,exist_ok=True)
    path=safe_path(directory/(name+'.lock'))
    descriptor=os.open(path,os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
    try:
        import stat
        info=os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise SyncError('SECRET_STORAGE_INVALID')
        if os.name=='nt':
            import msvcrt
            if info.st_size==0:os.write(descriptor,b'0')
            os.lseek(descriptor,0,os.SEEK_SET)
            try:msvcrt.locking(descriptor,msvcrt.LK_NBLCK,1)
            except OSError:raise SyncError('PROTECTED_RECORD_BUSY') from None
        else:
            import fcntl
            try:fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except OSError:raise SyncError('PROTECTED_RECORD_BUSY') from None
        yield
    finally:os.close(descriptor)


def update_record(state,org,name,operation):
    """Serialize refresh/CAS in this OS-user store; never return or persist plaintext files."""
    with record_guard(state,org,name):
        previous=load_record(state,org,name)
        updated=operation(previous)
        encoded=encode_record(updated)
        if previous is None or encoded!=encode_record(previous):
            store(state,org,name,encoded)
            if load_record(state,org,name)!=updated:raise SyncError('PROTECTED_RECORD_READBACK_FAILED')
        return updated
