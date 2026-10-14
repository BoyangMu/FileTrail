"""Kill/restart a dedicated local backend and verify persisted upload results.

Never controls the user's running server. Uses a temporary data directory and
port 18080 by default. Build the backend JAR first.
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import socket
import tempfile
import time
import urllib.error
import urllib.request
import uuid

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=18080)
    args=parser.parse_args()
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', args.port))
    root=Path(__file__).resolve().parents[1]
    jar=root/'backend/target/filetrail-0.1.0.jar'
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base=f'http://127.0.0.1:{args.port}/api'
    def request(path,method='GET',body=None,headers=None):
        h={'X-FileTrail':'1'}
        if body is not None and not isinstance(body,bytes):body=json.dumps(body).encode();h['Content-Type']='application/json'
        h.update(headers or {})
        res=client.open(urllib.request.Request(base+path,data=body,method=method,headers=h),timeout=30)
        data=res.read()
        return json.loads(data) if 'application/json' in res.headers.get('Content-Type','') else data
    process=None
    with tempfile.TemporaryDirectory(prefix='filetrail-restart-') as directory:
        with open(Path(directory)/'server.log','w') as log:
            def start():
                env=os.environ.copy()
                # Do not inherit a production database or storage configuration.
                env.update(DATABASE_URL=f'jdbc:h2:file:{directory}/metadata;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;WRITE_DELAY=0',DATABASE_USER='sa',DATABASE_PASSWORD='',STORAGE='local',DATA_DIR=directory+'/objects',WORKER_ENABLED='false',SECURE_COOKIE='false')
                p=subprocess.Popen(['java','-jar',str(jar),f'--server.port={args.port}','--server.address=127.0.0.1'],cwd=directory,env=env,stdout=log,stderr=subprocess.STDOUT)
                for _ in range(100):
                    if p.poll() is not None:raise RuntimeError('Dedicated backend exited; check Java and port availability')
                    try:
                        if request('/health')['status']=='ok':return p
                    except (OSError,urllib.error.URLError):pass
                    time.sleep(.1)
                p.kill();p.wait();raise RuntimeError('Dedicated backend did not become ready')
            try:
                process=start()
                request('/auth/register','POST',{'email':f'restart-{uuid.uuid4()}@example.test','displayName':'Restart test','password':str(uuid.uuid4())})
                data=os.urandom(140_000)
                sha=lambda b:hashlib.sha256(b).hexdigest()
                s=request('/uploads','POST',{'requestKey':str(uuid.uuid4()),'name':'restart.bin','size':len(data),'sha256':sha(data),'partSize':65536,'source':'restart-test','parentId':None,'targetId':None,'baseVersion':None})
                def part(i):
                    b=data[i*65536:(i+1)*65536]
                    request(f'/uploads/{s["id"]}/parts/{i}','PUT',b,{'Content-Type':'application/octet-stream','X-Content-SHA256':sha(b)})
                part(0)
                process.kill();process.wait();process=start()
                progress=request('/uploads/'+s['id'])
                assert [p['part_no'] for p in progress['parts']]==[0]
                for i in range(1,s['part_count']):part(i)
                result=request('/uploads/'+s['id']+'/complete','POST')
                process.kill();process.wait();process=start()
                replay=request('/uploads/'+s['id']+'/complete','POST')
                assert replay['result_version']==result['result_version']
                assert len(request('/files/'+result['result_file']+'/versions'))==1
                downloaded=request(f'/files/{result["result_file"]}/versions/{result["result_version"]}/download')
                assert downloaded==data
                print('PASS: SIGKILL after partial upload, resume persisted parts, SIGKILL after publication, same result on retry, exact downloaded bytes')
            finally:
                if process and process.poll() is None:process.terminate();process.wait(timeout=15)

if __name__=='__main__':main()
