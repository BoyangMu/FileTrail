"""Real HTTP acceptance checks; uses only Python's standard library.

Creates an isolated test account. Does not access any existing user's files.
Usage: python3 scripts/smoke.py --url http://127.0.0.1:4173
"""
import argparse
import concurrent.futures
import hashlib
import http.cookiejar
import json
import os
import urllib.request
import urllib.error
import uuid

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:4173')
    args = parser.parse_args()
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def request(path, method='GET', body=None, expected=200, headers=None):
        h = {'X-FileTrail': '1'}
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode()
            h['Content-Type'] = 'application/json'
        if headers:
            h.update(headers)
        req = urllib.request.Request(args.url + '/api' + path, data=body, method=method, headers=h)
        try:
            res = client.open(req, timeout=120)
        except urllib.error.HTTPError as error:
            res = error
        data = res.read()
        assert res.status == expected, (path, res.status, data[:300])
        return json.loads(data) if 'application/json' in res.headers.get('Content-Type', '') and data else data
    checksum = lambda b: hashlib.sha256(b).hexdigest()
    request('/health')
    account = request('/auth/register', 'POST', {'email': f'smoke-{uuid.uuid4()}@example.test', 'password': str(uuid.uuid4()), 'displayName': '自动验收账户'})
    data = os.urandom(150_000)
    def begin(data, target=None, base=None, name='acceptance.bin'):
        return request('/uploads', 'POST', {'requestKey':str(uuid.uuid4()),'name':name,'size':len(data),'sha256':checksum(data),'partSize':65536,'source':'acceptance','targetId':target,'baseVersion':base,'parentId':None})
    def send(session, data, index):
        chunk=data[index*65536:(index+1)*65536]
        return request(f'/uploads/{session["id"]}/parts/{index}', 'PUT', chunk, headers={'Content-Type':'application/octet-stream','X-Content-SHA256':checksum(chunk)})
    session=begin(data)
    send(session,data,0)
    send(session,data,0)
    progress=request('/uploads/'+session['id'])
    assert len(progress['parts'])==1
    request('/uploads/'+session['id']+'/complete','POST',expected=409)
    assert request('/files')==[]
    for i in range(1,session['part_count']): send(session,data,i)
    result=request('/uploads/'+session['id']+'/complete','POST')
    assert result['state']=='PUBLISHED'
    assert request('/uploads/'+session['id']+'/complete','POST')['result_version']==result['result_version']
    file,base=result['result_file'],result['result_version']
    assert request(f'/files/{file}/versions/{base}/download')==data
    print('PASS: resume, duplicate part, incomplete visibility, idempotent publication, exact download')
    a,b=begin(b'device A',file,base),begin(b'device B',file,base)
    send(a,b'device A',0);send(b,b'device B',0)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes=list(pool.map(lambda s:request('/uploads/'+s['id']+'/complete','POST'),[a,b]))
    assert {x['state'] for x in outcomes}=={'PUBLISHED','CONFLICT'}
    assert len(request('/files?view=conflicts'))==1
    current=request('/files/'+file)['current_version']
    key=str(uuid.uuid4())
    body={'versionId':base,'baseVersion':current,'requestKey':key}
    restored=request('/files/'+file+'/restore','POST',body)
    assert request('/files/'+file+'/restore','POST',body)['id']==restored['id']
    assert restored['sha256']==checksum(data)
    assert len(request('/files/'+file+'/versions'))==3
    print('PASS: true concurrent updates preserve both; restore creates exactly one new version')
    share=request('/files/'+file+'/shares','POST',{'versionId':base,'days':1})
    assert request('/public/shares/'+share['token']+'/download')==data
    request('/shares/'+share['id'],'DELETE')
    request('/public/shares/'+share['token']+'/download',expected=410)
    request('/files/'+file,'DELETE')
    assert len(request('/files?view=trash'))==1
    request('/files/'+file+'/untrash','POST')
    assert request('/files/'+file)['current_version']==restored['id']
    print('PASS: pinned share, revocation, trash and restoration')
    other=request('/auth/register','POST',{'email':f'other-{uuid.uuid4()}@example.test','password':str(uuid.uuid4()),'displayName':'权限验收'})
    request('/files/'+file,expected=404)
    request('/uploads/'+session['id'],expected=404)
    print('PASS: cross-account ownership checks')
    print(json.dumps({'status':'passed','base_url':args.url,'test_account':account['id'],'second_account':other['id']},ensure_ascii=False))

if __name__=='__main__':
    main()
