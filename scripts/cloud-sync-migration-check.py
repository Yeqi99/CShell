"""Read-only production snapshot -> private migration rehearsal; never prints row values."""
import argparse, hashlib, json, os, pathlib, sqlite3, sys, threading, http.client, time

def main():
 p=argparse.ArgumentParser();p.add_argument('--source-db',required=True);p.add_argument('--output',required=True);p.add_argument('--modules',required=True);a=p.parse_args()
 os.umask(0o077);out=pathlib.Path(a.output).resolve();out.mkdir(mode=0o700,parents=False,exist_ok=False)
 target=out/'rehearsal.sqlite'
 with sqlite3.connect(pathlib.Path(a.source_db).resolve().as_uri()+'?mode=ro',uri=True) as source,sqlite3.connect(target) as copy:source.backup(copy)
 os.chmod(target,0o600)
 critical=['accounts','passwords','keyboxes','memberships','sessions','vaults','vault_versions','cloud_devices','account_mcp_bridges','storage_grants','traffic_totals','traffic_limits','traffic_grants','traffic_rates','feedback']
 def snapshot(db,columns=None):
  result={}
  for table in critical:
   cols=columns.get(table) if columns is not None else [r[1] for r in db.execute('PRAGMA table_info("'+table+'")')]
   if not cols:continue
   rows=db.execute('SELECT '+','.join('"'+v+'"' for v in cols)+' FROM "'+table+'"').fetchall()
   digest=hashlib.sha256(json.dumps(sorted(rows,key=repr),ensure_ascii=True,default=str).encode()).hexdigest();result[table]=(cols,len(rows),digest)
  return result
 with sqlite3.connect(target) as db:before=snapshot(db)
 sys.path.insert(0,str(pathlib.Path(a.modules).resolve()));from server import Service,BoundedServer,handler
 service=Service(str(target),b'R'*32,lambda *args:None)
 with sqlite3.connect(target) as db:
  assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  after=snapshot(db,{k:v[0] for k,v in before.items()});assert before==after,'Existing account/credential/entitlement data changed'
  tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  assert {'vault_chunks','vault_chunk_meta','vault_uploads','traffic_reservations','mcp_operations'}<=tables
 # Synthetic identity is inserted only in the disposable copy.
 token='x'*43
 with service.db() as db:
  db.execute('INSERT INTO accounts VALUES(?,?)',('migration-fixture','migration@invalid.test'))
  db.execute('INSERT INTO sessions VALUES(?,?,?)',(service.digest(token),'migration-fixture',time.time()+60))
 server=BoundedServer(('127.0.0.1',0),handler(service));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  for path in ['/v1/health','/v1/mcp/bridges','/v1/domains']:
   c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5);c.request('GET',path,headers={'Authorization':'Bearer '+token});r=c.getresponse();r.read();assert r.status==200,(path,r.status);c.close()
 finally:server.shutdown();server.server_close();thread.join()
 print(json.dumps({'passed':True,'preservedTables':list(before),'newTableCount':len(tables),'integrity':'ok','http':['health','legacy bridges','domains'],'sourceUntouched':True}))
if __name__=='__main__':main()
