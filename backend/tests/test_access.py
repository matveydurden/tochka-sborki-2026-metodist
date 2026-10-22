import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from backend.service import Store,Application,Config
from backend.server import make_server
from test_service import draft

class AccessTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();app=Application(Store(Path(self.tmp.name)/'db'),config=Config())
        self.server=make_server(app,0,password='team-secret')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def call(self,path,body=None,cookie=None,headers=None):
        req=urllib.request.Request(self.url+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {}),**(headers or {})})
        try:response=urllib.request.urlopen(req)
        except urllib.error.HTTPError as error:response=error
        with response:return response.status,json.loads(response.read()),response.headers
    def test_public_read_and_protected_mutation(self):
        status,data,_=self.call('/api/status');self.assertEqual(status,200);self.assertTrue(data['requiresLogin']);self.assertFalse(data['authenticated'])
        self.assertEqual(self.call('/api/courses')[0],200)
        self.assertEqual(self.call('/api/courses',{'course':draft()})[0],401)
        self.assertEqual(self.call('/api/references/extract',{})[0],401)
    def test_login_cookie_logout_and_wrong_password(self):
        self.assertEqual(self.call('/api/session',{'password':'wrong'})[0],401)
        status,_,headers=self.call('/api/session',{'password':'team-secret'});self.assertEqual(status,200)
        cookie=headers['Set-Cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=Strict',cookie)
        self.assertEqual(self.call('/api/courses',{'course':draft()},cookie)[0],201)
        self.assertEqual(self.call('/api/session/logout',{},cookie)[0],200)
        self.assertEqual(self.call('/api/courses',{'course':draft()},cookie)[0],401)
        self.assertEqual(self.call('/api/courses',{'course':draft()},'metodist_session=fake')[0],401)
    def test_external_origin_rejected_even_during_login(self):
        self.assertEqual(self.call('/api/session',{'password':'team-secret'},headers={'Origin':'https://evil.example'})[0],403)

    def test_cookie_parser_failure_is_diagnosed_and_access_stays_closed(self):
        from unittest.mock import patch
        with self.assertLogs('backend.access',level='WARNING') as logs:
            with patch('backend.access.SimpleCookie',side_effect=RuntimeError('secret-cookie')):
                status,body,_=self.call('/api/status',cookie='metodist_session=secret-cookie')
        self.assertEqual(status,200)
        self.assertFalse(body['authenticated'])
        diagnostic='\n'.join(logs.output)
        self.assertIn('RuntimeError',diagnostic)
        self.assertNotIn('secret-cookie',diagnostic)
    def test_external_binding_requires_password_and_https_origin(self):
        app=self.server.app
        with self.assertRaises(ValueError):make_server(app,0,host='0.0.0.0')
        with self.assertRaises(ValueError):make_server(app,0,host='0.0.0.0',password='abc',public_origin='http://example.com')

    def test_source_checks_require_team_session_and_valid_origin(self):
        from unittest.mock import patch
        with patch('backend.urlcheck.check',return_value={'status':'accessible'}) as probe:
            self.assertEqual(self.call('/api/sources/check',{'url':'https://example.org'})[0],401)
            probe.assert_not_called()
            _,_,headers=self.call('/api/session',{'password':'team-secret'})
            cookie=headers['Set-Cookie']
            self.assertEqual(self.call('/api/sources/check',{'url':'https://example.org'},cookie,headers={'Origin':'https://evil.example'})[0],403)
            probe.assert_not_called()
            self.assertEqual(self.call('/api/sources/check',{'url':'https://example.org'},cookie)[0],200)
            probe.assert_called_once()
