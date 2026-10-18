"""Bounded durable event feed. Cursors belong to one explicit subscription."""
import json,sqlite3,time,uuid
from .contracts import require

class EventJournal:
    def __init__(self,path,capacity=10000,ttl=604800):
        self.db=sqlite3.connect(path,timeout=2)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.capacity,self.ttl=capacity,ttl
        self.db.executescript('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,k TEXT UNIQUE,body TEXT NOT NULL,created REAL NOT NULL);')
        if not self.get('stream'):
            self.set('stream',uuid.uuid4().hex);self.set('floor',0)
    def get(self,key,default=None):
        r=self.db.execute('SELECT v FROM meta WHERE k=?',(key,)).fetchone()
        return json.loads(r[0]) if r else default
    def set(self,key,value):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES(?,?)',(key,json.dumps(value)));self.db.commit()
    def token(self,seq):return self.get('stream')+':'+str(seq)
    def prune(self):
        cutoff=self.db.execute('SELECT MAX(seq) FROM events WHERE created<?',(time.time()-self.ttl,)).fetchone()[0] or 0
        overflow=self.db.execute('SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?',(self.capacity,)).fetchone()
        cutoff=max(cutoff,overflow[0] if overflow else 0)
        if cutoff:
            self.db.execute('DELETE FROM events WHERE seq<=?',(cutoff,))
            self.set('floor',max(self.get('floor',0),cutoff))
        self.db.commit()
    def append(self,event):
        body=json.dumps(event,ensure_ascii=False)
        require(len(body.encode())<=65536,'EVENT_LIMIT','Event exceeds 64 KiB')
        key=None
        if event.get('kind')=='message' and event.get('messageId') not in (None,'','0'):
            key=str(event.get('conversationId'))+':'+str(event['messageId'])
        cursor=self.db.execute('INSERT OR IGNORE INTO events(k,body,created) VALUES(?,?,?)',(key,body,time.time()))
        self.db.commit();self.prune()
        return self.token(cursor.lastrowid) if cursor.rowcount else None
    def read(self,cursor=None,limit=50):
        require(type(limit) is int and 1<=limit<=100,'INVALID_LIMIT','Use 1..100 events')
        self.prune();seq=0
        if cursor is not None:
            require(isinstance(cursor,str) and len(cursor)<100,'INVALID_CURSOR','Invalid cursor')
            parts=cursor.split(':')
            require(len(parts)==2 and parts[0]==self.get('stream') and parts[1].isdigit() and len(parts[1])<=19,'INVALID_CURSOR','Cursor belongs to another subscription')
            seq=int(parts[1]);require(seq<=self.latest(),'INVALID_CURSOR','Cursor is ahead of queue')
        rows=self.db.execute('SELECT seq,body FROM events WHERE seq>? ORDER BY seq LIMIT ?',(seq,limit+1)).fetchall()
        events=[dict(json.loads(body),cursor=self.token(n)) for n,body in rows[:limit]]
        return {'events':events,'nextCursor':self.token(rows[min(len(rows),limit)-1][0] if rows else max(seq,self.get('floor',0))),
                'hasMore':len(rows)>limit,'gap':seq<self.get('floor',0) or any(e.get('kind')=='gap' for e in events),
                'status':self.get('status','stopped'),'historyReplay':False,'retentionSeconds':self.ttl,'capacity':self.capacity}
    def latest(self):return max(self.get('floor',0),self.db.execute('SELECT COALESCE(MAX(seq),0) FROM events').fetchone()[0])
    def close(self):self.db.close()
