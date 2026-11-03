import tempfile,unittest,uuid,json,threading,http.client,os
from unittest.mock import patch
from server import Service,Failure,BoundedServer,handler
from feedback import redact

class FeedbackTest(unittest.TestCase):
    def test_json_secrets_and_url_credentials_are_removed(self):
        value=redact('{"apiKey":"secret-value","token":"quoted\\\"secret"} https://user:password@example.com')
        self.assertNotIn('secret-value',value)
        self.assertNotIn('quoted',value)
        self.assertNotIn('user:password',value)

    def test_reports_are_idempotent_redacted_and_bounded(self):
        with tempfile.TemporaryDirectory() as d:
            s=Service(d+'/db',b'x'*32,lambda *a:None)
            report={'id':str(uuid.uuid4()),'message':'cancel failed','version':'0.8.21','platform':'win32','diagnostic':'Authorization: Bearer abc123\npassword=secret123\nsk-proj-abcdefghijklmnop'}
            s.feedback.submit(report);s.feedback.submit(report)
            items=s.feedback.list()['reports']
            self.assertEqual(len(items),1)
            self.assertNotIn('abc123',items[0]['diagnostic'])
            self.assertNotIn('secret123',items[0]['diagnostic'])
            self.assertNotIn('abcdefghijklmnop',items[0]['diagnostic'])
            with self.assertRaises(Failure):s.feedback.submit(dict(report,message='changed'))
            with self.assertRaises(Failure):s.feedback.submit(dict(report,message='x'*6001))
            with self.assertRaises(Failure):s.feedback.submit(dict(report,credentials='no'))

    def test_http_submission_privacy_and_admin_boundary(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(os.environ,{'ADMIN_API_TOKEN':'test-admin-only'}):
            service=Service(d+'/db',b'x'*32,lambda *a:None)
            server=BoundedServer(('127.0.0.1',0),handler(service))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            def request(method,path,body=None,headers=None):
                client=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=3)
                try:
                    client.request(method,path,json.dumps(body) if body is not None else None,headers or {})
                    response=client.getresponse();return response.status,json.loads(response.read())
                finally:client.close()
            try:
                report={'id':str(uuid.uuid4()),'message':'取消连接后异常','version':'1.0.0','platform':'win32'}
                self.assertEqual(request('POST','/v1/feedback',report)[0],200)
                self.assertEqual(request('GET','/v1/admin/feedback')[0],403)
                status,body=request('GET','/v1/admin/feedback',headers={'X-Admin-Token':'test-admin-only'})
                self.assertEqual(status,200);self.assertEqual(len(body['reports']),1)
                self.assertEqual(request('POST','/v1/feedback',report,{'Origin':'https://untrusted.example'})[0],403)
                self.assertEqual(request('POST','/v1/feedback',dict(report,message='x'*140000))[0],413)
            finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
