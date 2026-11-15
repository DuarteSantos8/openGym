#!/usr/bin/env python3
# openGym 数据备份 → 阿里云 OSS（纯标准库，OSS V1 签名，无 pip 依赖）
# 用法: oss-backup.py            数据有变才打包+上传+清理；无变化直接跳过（2026-11-12 加）
#       oss-backup.py --force    跳过变化检测，强制备份一次
#       oss-backup.py --test     只打包并自检签名，不联网不落指纹
import tarfile, time, hmac, hashlib, base64, sys, os, re
from urllib import request
DATA = '/opt/opengym/data'
HASH_FILE = '/opt/opengym/.last-backup-hash'

def load():
    # 密钥走环境变量（注册中心 start 时 source .oss-secrets 注入），与手机 .note_env 同构。
    # AI 只许跑掩码自检，不许 cat 本脚本读到的值。
    c = {k: os.environ.get(k, '') for k in ('ENDPOINT','BUCKET','AK','SK')}
    c.setdefault('PREFIX', os.environ.get('PREFIX', 'opengym-backup/'))
    c.setdefault('KEEP', os.environ.get('KEEP', '30'))
    miss = [k for k in ('ENDPOINT','BUCKET','AK','SK') if not c.get(k)]
    if miss: raise SystemExit('环境变量没注入（.oss-secrets）: ' + ','.join(miss))
    return c

def sig(c, verb, ctype, date, key):
    s = verb + '\n\n' + ctype + '\n' + date + '\n/' + c['BUCKET'] + '/' + key
    return 'OSS ' + c['AK'] + ':' + base64.b64encode(hmac.new(c['SK'].encode(), s.encode(), hashlib.sha1).digest()).decode()

def gmt():
    return time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime())

def fingerprint():
    """data 目录内容指纹: 相对路径+文件内容的 sha256。内容不变=指纹不变，与 mtime 无关。"""
    h = hashlib.sha256()
    for root, dirs, files in os.walk(DATA):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            h.update(os.path.relpath(p, DATA).encode())
            with open(p, 'rb') as fh:
                for chunk in iter(lambda: fh.read(65536), b''):
                    h.update(chunk)
    return h.hexdigest()

def last_hash():
    try:
        return open(HASH_FILE).read().strip()
    except OSError:
        return ''  # 首跑/文件丢失 → 视为有变化，宁可多备不漏备

def save_hash(fp):
    tmp = HASH_FILE + '.tmp'
    with open(tmp, 'w') as f:
        f.write(fp + '\n')
    os.replace(tmp, HASH_FILE)

def put(c, key, path):
    ctype = 'application/x-tar'
    req = request.Request('https://' + c['BUCKET'] + '.' + c['ENDPOINT'] + '/' + key, method='PUT', data=open(path,'rb').read())
    req.add_header('Date', gmt()); req.add_header('Content-Type', ctype)
    req.add_header('Authorization', sig(c, 'PUT', ctype, req.headers['Date'], key))
    return request.urlopen(req, timeout=120).status

def list_keys(c):
    req = request.Request('https://' + c['BUCKET'] + '.' + c['ENDPOINT'] + '/?prefix=' + c.get('PREFIX','opengym-backup/') + '&max-keys=200')
    req.add_header('Date', gmt()); req.add_header('Authorization', sig(c, 'GET', '', req.headers['Date'], ''))
    body = request.urlopen(req, timeout=60).read().decode()
    return re.findall(r'<Key>([^<]+)</Key>', body)

def delete(c, key):
    req = request.Request('https://' + c['BUCKET'] + '.' + c['ENDPOINT'] + '/' + key, method='DELETE')
    req.add_header('Date', gmt()); req.add_header('Authorization', sig(c, 'DELETE', '', req.headers['Date'], key))
    request.urlopen(req, timeout=60).read()

def main():
    c = load()
    fp = fingerprint()
    if '--test' not in sys.argv and '--force' not in sys.argv and fp == last_hash():
        print(time.strftime('%F %T'), '数据无变化（指纹一致），跳过备份')
        return
    key = c.get('PREFIX','opengym-backup/') + 'opengym-backup-' + time.strftime('%Y-%m-%d') + '.tgz'
    tmp = '/tmp/og-backup.tgz'
    with tarfile.open(tmp, 'w:gz') as t:
        t.add(DATA, arcname='data')
    print(time.strftime('%F %T'), '打包', key, f"{os.path.getsize(tmp)/1048576:.1f}MB")
    if '--test' in sys.argv:
        sig(c, 'PUT', 'application/x-tar', 'x', key)
        print('--test 通过: 打包与签名自检完成，未联网上传'); return
    put(c, key, tmp)
    save_hash(fp)  # 上传成功才落指纹；上传抛异常时这行不执行，次日自动重试
    print('已上传:', key)
    keep = int(c.get('KEEP') or 30)
    olds = sorted(k for k in list_keys(c) if k.startswith(c.get('PREFIX','opengym-backup/')) and k.endswith('.tgz'))[:-keep]
    for old in olds:
        delete(c, old); print('清理旧备份:', old)
    os.remove(tmp)

if __name__ == '__main__':
    main()
