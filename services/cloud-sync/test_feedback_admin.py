import tempfile,unittest,uuid,json,threading,http.client,os
from unittest.mock import patch
from server import Service,Failure,BoundedServer,handler

class FeedbackAdminTest(unittest.TestCase):
    def test_status_route_requires_admin(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'ADMIN_API_TOKEN':'admin-test'}):
            s=Service(d+'/db',b'x'*32,lambda *a:None)
            identity=str(uuid.uuid4());s.feedback.submit({'id':identity,'message':'test','version':'1','platform':'win32'})
            server=BoundedServer(('127.0.0.1',0),handler(s));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                for headers,expected in [({},403),({'X-Admin-Token':'admin-test'},200)]:
                    c=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
                    c.request('POST','/v1/admin/feedback/status',json.dumps({'id':identity,'previousStatus':'new','status':'resolved','reason':'verified fix'}),headers)
                    r=c.getresponse();r.read();self.assertEqual(r.status,expected);c.close()
            finally:server.shutdown();server.server_close();thread.join()

    def test_status_compare_and_swap_and_audit(self):
        with tempfile.TemporaryDirectory() as d:
            s=Service(d+'/db',b'x'*32,lambda *a:None)
            identity=str(uuid.uuid4())
            s.feedback.submit({'id':identity,'message':'test','version':'1.0','platform':'win32'})
            change={'id':identity,'previousStatus':'new','status':'investigating','reason':'password=secret123 checking'}
            self.assertEqual(s.feedback.update_status(change)['status'],'investigating')
            with self.assertRaises(Failure):s.feedback.update_status(change)
            with self.assertRaises(Failure):s.feedback.update_status(dict(change,status='unknown'))
            with self.assertRaises(Failure):s.feedback.update_status(dict(change,id=str(uuid.uuid4())))
            with s.db() as db:
                rows=db.execute("SELECT detail FROM admin_audit WHERE action='feedback.status'").fetchall()
            self.assertEqual(len(rows),1)
            self.assertNotIn('secret123',rows[0][0])
            self.assertEqual(s.feedback.list()['reports'][0]['status'],'investigating')

if __name__=='__main__':unittest.main()
