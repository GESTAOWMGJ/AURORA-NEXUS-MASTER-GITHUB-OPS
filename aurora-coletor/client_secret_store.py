"""App-scoped client credentials: current-user DPAPI or macOS Keychain, no argv secrets."""
import ctypes
import os
from pathlib import Path
import re
import sys

from aurora_deployment import safe_path
from aurora_cloud_sync import SyncError


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
