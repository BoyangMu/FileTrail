"""Small reproducible baseline, not a capacity/soak test. Creates a new test account."""
import argparse
import hashlib
import http.cookiejar
import json
import os
import platform
import statistics
import tempfile
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:4173')
    parser.add_argument('--mib',type=int,default=16)
    parser.add_argument('--iterations',type=int,default=3)
    parser.add_argument('--storage-label',required=True)
    parser.add_argument('--hardware',default='not recorded')
    parser.add_argument('--output',default='docs/performance-baseline.json')
    args=parser.parse_args()
    if not 1<=args.mib<=256 or not 1<=args.iterations<=20:parser.error('Use 1–256 MiB and 1–20 iterations for this baseline script')
    client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    latencies=[]
    def request(path,method='GET',body=None,headers=None):
        h={'X-FileTrail':'1'}
        if body is not None and not isinstance(body,bytes):body=json.dumps(body).encode();h['Content-Type']='application/json'
        h.update(headers or {})
        begin=time.perf_counter()
        response=client.open(urllib.request.Request(args.url+'/api'+path,data=body,method=method,headers=h),timeout=300)
        raw=response.read();latencies.append((time.perf_counter()-begin)*1000)
        return json.loads(raw) if raw else None
    request('/auth/register','POST',{'email':f'benchmark-{uuid.uuid4()}@example.test','displayName':'基线测量','password':str(uuid.uuid4())})
    latencies.clear()
    runs=[]
    chunk_size=4*1024*1024
    with tempfile.TemporaryFile() as source:
        digest=hashlib.sha256()
        remaining=args.mib*1024*1024
        while remaining:
            block=os.urandom(min(chunk_size,remaining));source.write(block);digest.update(block);remaining-=len(block)
        checksum=digest.hexdigest()
        for run in range(args.iterations):
            source.seek(0)
            started=time.perf_counter()
            session=request('/uploads','POST',{'requestKey':str(uuid.uuid4()),'name':f'baseline-{run}.bin','size':args.mib*1024*1024,'sha256':checksum,'partSize':chunk_size,'source':'baseline','parentId':None,'targetId':None,'baseVersion':None})
            index=0
            while block:=source.read(chunk_size):
                request(f'/uploads/{session["id"]}/parts/{index}','PUT',block,{'Content-Type':'application/octet-stream','X-Content-SHA256':hashlib.sha256(block).hexdigest()});index+=1
            upload_seconds=time.perf_counter()-started
            commit_start=time.perf_counter()
            result=request('/uploads/'+session['id']+'/complete','POST')
            commit_seconds=time.perf_counter()-commit_start
            download_start=time.perf_counter()
            response=client.open(args.url+f'/api/files/{result["result_file"]}/versions/{result["result_version"]}/download',timeout=300)
            received=hashlib.sha256()
            while block:=response.read(65536):received.update(block)
            download_seconds=time.perf_counter()-download_start
            assert received.hexdigest()==checksum
            runs.append({'upload_seconds':round(upload_seconds,4),'publish_seconds':round(commit_seconds,4),'upload_and_publish_mib_per_second':round(args.mib/(upload_seconds+commit_seconds),2),'download_seconds':round(download_seconds,4),'sha256_verified':True})
    latencies.sort()
    output={'measured_at':datetime.now(timezone.utc).isoformat(),'os':platform.platform(),'architecture':platform.machine(),'hardware':args.hardware,'environment':args.storage_label,'base_url':args.url,'network':'loopback on the same development machine','file_mib':args.mib,'iterations':args.iterations,'concurrency':1,'part_mib':4,'runs':runs,'request_samples':len(latencies),'request_p50_ms':round(statistics.median(latencies),2),'request_p95_ms':round(latencies[min(len(latencies)-1,int(len(latencies)*.95))],2),'limits':['Small sequential baseline; not a capacity, load, or durability guarantee.','Request samples mix create/part/complete endpoints; not endpoint-specific percentiles.','Client hashing and test-data generation are excluded from upload timing.','API memory, storage IOPS and multi-device sync latency are not measured.']}
    Path(args.output).write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(output,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
