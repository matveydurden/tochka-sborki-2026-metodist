import socket
import ssl
import unittest
from unittest.mock import patch,MagicMock
from backend.service import Invalid
from backend import urlcheck

PUBLIC=[(socket.AF_INET,socket.SOCK_STREAM,socket.IPPROTO_TCP,'',('93.184.216.34',443))]

class URLCheckTests(unittest.TestCase):
    def test_unsafe_urls_never_resolve_or_connect(self):
        urls=['http://example.org','https://user:pass@example.org','https://example.org:8443',
              'https://127.0.0.1','https://[::1]','https://169.254.169.254/latest',
              'https://example.org/#fragment','https://example.org\\@127.0.0.1','https://example.org/\r\nx',
              'https://localhost','https://[::ffff:127.0.0.1]','https://example.org/\r\n']
        for url in urls:
            with self.subTest(url=url),patch.object(urlcheck,'_resolve',return_value=PUBLIC) as resolve,patch.object(urlcheck,'_head',return_value=200) as head:
                with self.assertRaises(Invalid):urlcheck.check(url)
                resolve.assert_not_called();head.assert_not_called()

    def test_mixed_or_nonpublic_dns_is_rejected_before_connection(self):
        for address in ['10.0.0.1','127.0.0.1','169.254.169.254','::1','fc00::1','ff02::1','2002:0808:0808::1']:
            answer=PUBLIC+[(socket.AF_INET6 if ':' in address else socket.AF_INET,socket.SOCK_STREAM,6,'',(address,443))]
            with self.subTest(address=address),patch.object(urlcheck,'_resolve',return_value=answer),patch.object(urlcheck,'_head') as head:
                with self.assertRaises(Invalid):urlcheck.check('https://example.org')
                head.assert_not_called()

    def test_statuses_do_not_follow_redirects_or_confirm_sources(self):
        for code,status in [(200,'accessible'),(204,'accessible'),(301,'redirect'),(403,'restricted'),(404,'unavailable'),(405,'unsupported'),(503,'unavailable')]:
            with self.subTest(code=code),patch.object(urlcheck,'_resolve',return_value=PUBLIC),patch.object(urlcheck,'_head',return_value=code) as head:
                result=urlcheck.check('https://example.org/path?q=1')
                self.assertEqual(result['status'],status);self.assertEqual(result['httpStatus'],code)
                self.assertIn('checkedAt',result);self.assertNotIn('confirmed',result)
                self.assertEqual(head.call_count,1)
                self.assertEqual(head.call_args.args[:3],('example.org','/path?q=1',PUBLIC[0]))

    def test_transport_failure_is_sanitized(self):
        with self.assertLogs('backend.urlcheck',level='WARNING') as logs:
            with patch.object(urlcheck,'_resolve',return_value=PUBLIC),patch.object(urlcheck,'_head',side_effect=ssl.SSLError('private details')):
                result=urlcheck.check('https://example.org/?key=private-query')
        self.assertEqual(result['status'],'error');self.assertNotIn('private details',str(result))
        diagnostic='\n'.join(logs.output)
        self.assertIn('SSLError',diagnostic)
        self.assertNotIn('private details',diagnostic)
        self.assertNotIn('private-query',diagnostic)
        with patch.object(urlcheck,'_resolve',return_value=PUBLIC),patch.object(urlcheck,'_head',return_value=200):
            self.assertEqual(urlcheck.check('https://example.org')['status'],'accessible')

    def test_dns_worker_preserves_failure_type_in_safe_diagnostics(self):
        with self.assertLogs('backend.urlcheck',level='WARNING') as logs:
            with patch('socket.getaddrinfo',side_effect=socket.gaierror('private-dns-details')):
                result=urlcheck.check('https://example.org/?key=private-query')
        self.assertEqual(result['status'],'error')
        diagnostic='\n'.join(logs.output)
        self.assertIn('gaierror',diagnostic)
        self.assertNotIn('private-dns-details',diagnostic)
        self.assertNotIn('private-query',diagnostic)

    def test_connection_pins_resolved_ip_and_keeps_hostname_for_tls(self):
        context=MagicMock();raw=MagicMock();wrapped=MagicMock();context.wrap_socket.return_value=wrapped
        with patch('socket.socket',return_value=raw),patch('socket.getaddrinfo') as dns:
            connection=urlcheck.PinnedHTTPSConnection('example.org',PUBLIC[0],context=context,timeout=2)
            connection.connect()
            raw.connect.assert_called_once_with(('93.184.216.34',443))
            context.wrap_socket.assert_called_once_with(raw,server_hostname='example.org')
            dns.assert_not_called();self.assertIs(connection.sock,wrapped)
            connection.close()

    def test_head_sends_no_auth_or_cookies_and_never_reads_body(self):
        response=MagicMock(status=302);connection=MagicMock();connection.getresponse.return_value=response
        with patch.object(urlcheck,'PinnedHTTPSConnection',return_value=connection):
            self.assertEqual(urlcheck._head('example.org','/',PUBLIC[0]),302)
        args,kwargs=connection.request.call_args
        self.assertEqual(args,('HEAD','/'))
        self.assertNotIn('Authorization',kwargs['headers']);self.assertNotIn('Cookie',kwargs['headers'])
        response.read.assert_not_called();connection.close.assert_called_once()

    def test_timed_out_dns_does_not_accumulate_unbounded_workers(self):
        import threading
        release=threading.Event();workers=[];original_thread=threading.Thread
        def thread(*args,**kwargs):
            worker=original_thread(*args,**kwargs);workers.append(worker);return worker
        def delayed(*args,**kwargs):release.wait(1);return PUBLIC
        try:
            with patch.object(urlcheck,'DNS_TIMEOUT',.01),patch.object(urlcheck,'_DNS_SLOTS',threading.BoundedSemaphore(1)),patch('socket.getaddrinfo',side_effect=delayed) as resolver,patch('threading.Thread',side_effect=thread):
                with self.assertRaises(TimeoutError):urlcheck._resolve('example.org')
                with self.assertRaises(OSError):urlcheck._resolve('example.org')
                self.assertEqual(resolver.call_count,1)
        finally:
            release.set()
            for worker in workers:worker.join(1)
        self.assertTrue(all(not worker.is_alive() for worker in workers))

    def test_network_deadline_shuts_down_the_live_socket(self):
        connection=MagicMock();connection.getresponse.return_value.status=200
        timer=MagicMock()
        with patch.object(urlcheck,'PinnedHTTPSConnection',return_value=connection),patch('threading.Timer',return_value=timer) as timer_factory:
            self.assertEqual(urlcheck._head('example.org','/',PUBLIC[0]),200)
            expire=timer_factory.call_args.args[1];expire()
            connection.sock.shutdown.assert_called_once_with(socket.SHUT_RDWR)
            timer.cancel.assert_called_once()

    def test_busy_service_never_resolves_or_connects(self):
        import threading
        with patch.object(urlcheck,'_REQUEST_SLOTS',threading.Semaphore(0)),patch.object(urlcheck,'_resolve') as dns,patch.object(urlcheck,'_head') as head:
            self.assertEqual(urlcheck.check('https://example.org')['status'],'error')
            dns.assert_not_called();head.assert_not_called()
