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

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=Application(Store(Path(self.tmp.name)/'db.sqlite3'),config=Config(key=''))
        self.server=make_server(self.app,port=0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def call(self,path,body=None,method=None,headers=None):
        request=urllib.request.Request(self.url+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with urllib.request.urlopen(request) as response:return response.status,json.loads(response.read())
        except urllib.error.HTTPError as error:
            with error:return error.code,json.loads(error.read())
    def test_program_catalog_is_available_as_json_module_without_exposing_other_files(self):
        status,catalog=self.call('/assets/program-profiles.json')
        self.assertEqual(status,200)
        self.assertIn('Общеразвивающая',catalog['profiles'])
        self.assertEqual(self.call('/backend/programs.py')[0],404)

    def test_create_get_save_and_conflict(self):
        status,record=self.call('/api/courses',{'course':draft()});self.assertEqual(status,201)
        path='/api/courses/'+record['id']
        self.assertEqual(self.call(path)[1]['course']['title'],'Основы Python')
        body={'revision':0,'course':dict(draft(),goal='Ручная цель')}
        self.assertEqual(self.call(path,body,'PUT')[0],200)
        self.assertEqual(self.call(path,body,'PUT')[0],409)
    def test_origin_and_static_secret_boundary(self):
        self.assertEqual(self.call('/api/courses',{'course':draft()},headers={'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.call('/.env')[0],404)
        self.assertEqual(self.call('/../.env')[0],404)
        status,data=self.call('/api/status');self.assertEqual(status,200)
        self.assertFalse(data['configured']);self.assertNotIn('key',data)
    def test_export_and_no_key(self):
        _,record=self.call('/api/courses',{'course':draft()})
        path='/api/courses/'+record['id']
        status,data=self.call(path+'/generate',dict(revision=0,stage='skeleton',prompt='',requestId='missing'))
        self.assertEqual(status,503)
        self.assertIn('error',data)
        self.assertEqual(self.call(path+'/export.json')[1]['course']['title'],'Основы Python')
        with urllib.request.urlopen(self.url+path+'/export.docx') as response:
            self.assertTrue(response.read().startswith(b'PK'))

    def test_failed_save_is_diagnosed_without_secrets_and_can_be_retried(self):
        from unittest.mock import patch
        import sqlite3
        _,record=self.call('/api/courses',{'course':draft()})
        path='/api/courses/'+record['id']
        body=dict(revision=0,course=dict(record['course'],goal='Ручная цель'))
        for failure,status in [(sqlite3.OperationalError('secret-db-value'),503),(RuntimeError('secret-db-value'),500)]:
            with self.subTest(status=status):
                with self.assertLogs('backend.server',level='ERROR') as logs:
                    with patch.object(self.app.store,'save',side_effect=failure):
                        actual,error=self.call(path,body,'PUT')
                    self.assertEqual(actual,status)
                    self.assertIn('error',error)
                diagnostic='\n'.join(logs.output)
                self.assertIn(type(failure).__name__,diagnostic)
                self.assertIn('server.py:',diagnostic)
                self.assertNotIn('secret-db-value',diagnostic+json.dumps(error))
                self.assertEqual(self.call(path)[1],record)
        saved=self.call(path,body,'PUT')
        self.assertEqual(saved[0],200)
        self.assertEqual(saved[1]['course']['goal'],'Ручная цель')

    def test_access_log_does_not_include_query_or_cookie(self):
        with self.assertLogs('backend.server',level='INFO') as logs:
            self.assertEqual(self.call('/api/status?key=secret-query',headers={'Cookie':'metodist_session=secret-cookie'})[0],200)
        diagnostic='\n'.join(logs.output)
        self.assertIn('200',diagnostic)
        self.assertNotIn('secret-query',diagnostic)
        self.assertNotIn('secret-cookie',diagnostic)

    def test_extract_and_exports_use_real_routes(self):
        import base64
        status,result=self.call('/api/references/extract',dict(name='brief.txt',data=base64.b64encode('ИИ для учителей'.encode()).decode()))
        self.assertEqual(status,200);self.assertIn('учителей',result['text'])
        _,record=self.call('/api/courses',{'course':draft()})
        for extension in ['pptx','moodle.xml']:
            self.assertEqual(self.call('/api/courses/'+record['id']+'/export.'+extension)[0],422)



    def test_source_check_is_explicit_small_post_and_does_not_change_course(self):
        from unittest.mock import patch
        _,record=self.call('/api/courses',{'course':draft()})
        result=dict(status='accessible',httpStatus=200,checkedAt='2026-10-20T07:00:00+00:00',message='Страница доступна')
        with patch('backend.urlcheck.check',return_value=result) as probe:
            status,data=self.call('/api/sources/check',{'url':'https://example.org'})
            self.assertEqual(status,200);self.assertEqual(data,result)
            probe.assert_called_once_with('https://example.org')
        self.assertEqual(self.call('/api/courses/'+record['id'])[1],record)
        with patch('backend.urlcheck.check') as probe:
            self.assertEqual(self.call('/api/sources/check',{'url':'https://example.org','extra':True})[0],422)
            self.assertEqual(self.call('/api/sources/check',{'url':'x'*5000})[0],422)
            probe.assert_not_called()
        self.assertEqual(self.call('/api/sources/check')[0],404)
        self.assertEqual(self.call('/api/sources/check',{'url':'https://127.0.0.1'})[0],422)


if __name__=='__main__':unittest.main()
