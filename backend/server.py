"""Single-user HTTP API: local mode or public read-only demo with team sessions."""
import argparse
import json
import logging
import os
import sqlite3
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,unquote
from .service import Application,Store,Config,Invalid,Conflict,NotFound,Unavailable,dumps,export_docx,env_values
from .diagnostics import log_failure

ROOT=Path(__file__).resolve().parent.parent
FRONTEND=ROOT/'frontend'
LOGGER=logging.getLogger(__name__)


class Handler(BaseHTTPRequestHandler):
    def log_request(self,code='-',size='-'):
        # The default HTTP log includes the raw URL and may reveal query secrets.
        LOGGER.info('http_response method=%s status=%s',self.command if self.command in ['GET','POST','PUT','OPTIONS'] else 'OTHER',code)

    def log_message(self,*args):
        LOGGER.warning('http_protocol_error')

    def reply(self,status,value,content_type='application/json; charset=utf-8',filename=None,headers=None):
        data=dumps(value).encode() if content_type.startswith('application/json') and not isinstance(value,bytes) else value
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'")
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        for key,value in (headers or {}).items():self.send_header(key,value)
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError) as error:
            LOGGER.debug('http_client_disconnected exception=%s',type(error).__name__)

    def body(self,maximum=1_000_000):
        if self.headers.get_content_type()!='application/json':raise Invalid('Требуется Content-Type application/json.')
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:raise Invalid('Некорректный размер запроса.')
        if not 0<length<=maximum:raise Invalid('Запрос пустой или превышает допустимый размер.')
        try:data=json.loads(self.rfile.read(length))
        except (ValueError,UnicodeError):raise Invalid('Некорректный JSON.')
        if not isinstance(data,dict):raise Invalid('Ожидается JSON-объект.')
        return data

    def dispatch(self):
        hosts={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        if self.server.public_origin:hosts.add(urlsplit(self.server.public_origin).netloc)
        host=self.headers.get('Host','')
        if host not in hosts:return self.reply(403,{'error':'Недопустимый адрес сервера.'})
        origin=self.headers.get('Origin')
        expected_origin=self.server.public_origin or 'http://'+host
        if origin is not None and origin!=expected_origin:return self.reply(403,{'error':'Запрос с другого сайта запрещён.'})
        path=unquote(urlsplit(self.path).path)
        app=self.server.app
        if self.server.config_loader:app.config=self.server.config_loader()
        method=self.command
        access=self.server.access;cookie=self.headers.get('Cookie','')
        if method=='POST' and path=='/api/session':
            token,status=access.login(self.body().get('password'))
            if status!=200:return self.reply(status,dict(error='Слишком много попыток входа. Подождите минуту.' if status==429 else 'Неверный пароль команды.'))
            return self.reply(200,dict(authenticated=True),headers={'Set-Cookie':access.cookie(token)})
        if method=='POST' and path=='/api/session/logout':
            access.logout(cookie);return self.reply(200,dict(authenticated=False),headers={'Set-Cookie':access.cookie(clear=True)})
        if method in ['POST','PUT'] and not access.authenticated(cookie):return self.reply(401,dict(error='Войдите с паролем команды, чтобы изменять программы и запускать модель.'))
        if method=='GET' and path=='/api/status':
            try:app.config.ready();configured=True
            except Unavailable:configured=False
            return self.reply(200,dict(configured=configured,model=app.config.model,provider=app.config.provider,requiresLogin=bool(access.password),authenticated=access.authenticated(cookie),publicDemo=bool(self.server.public_origin)))
        if method=='POST' and path=='/api/sources/check':
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length',[]))!=1:raise Invalid('Требуется однозначный размер JSON-запроса.')
            timeout=self.connection.gettimeout()
            try:
                self.connection.settimeout(5)
                body=self.body(maximum=4096)
            except TimeoutError:raise Invalid('Превышено время чтения запроса.') from None
            finally:self.connection.settimeout(timeout)
            if set(body)!={'url'}:raise Invalid('Укажите только поле url.')
            from .urlcheck import check
            return self.reply(200,check(body['url']))
        if method=='POST' and path=='/api/references/extract':
            from .references import extract
            return self.reply(200,extract(self.body(maximum=28_100_000)))
        if path=='/api/courses':
            if method=='GET':return self.reply(200,dict(courses=app.store.list()))
            if method=='POST':return self.reply(201,app.store.create(self.body().get('course')))
        parts=path.strip('/').split('/')
        if len(parts)>=3 and parts[:2]==['api','courses']:
            course_id=parts[2]
            if len(parts)==3:
                if method=='GET':return self.reply(200,app.store.get(course_id))
                if method=='PUT':
                    body=self.body();return self.reply(200,app.store.save(course_id,body.get('revision'),body.get('course')))
            if len(parts)==4:
                action=parts[3]
                if method=='POST' and action=='approve':return self.reply(200,app.approve(course_id,self.body().get('revision')))
                if method=='POST' and action=='generate':return self.reply(202,app.generate(course_id,self.body()))
                if method=='GET' and action in ['export.json','export.docx','export.pptx','export.moodle.xml']:
                    record=app.store.get(course_id)
                    if action=='export.json':return self.reply(200,dict(schemaVersion=3,courseId=record['id'],revision=record['revision'],course=record['course'],checks=record['checks'],lastRun=record['job']),filename='metodist-program.json')
                    if action=='export.pptx':
                        from .exports import pptx
                        return self.reply(200,pptx(record['course']),'application/vnd.openxmlformats-officedocument.presentationml.presentation',filename='metodist-slides.pptx')
                    if action=='export.moodle.xml':
                        from .exports import moodle
                        return self.reply(200,moodle(record['course']),'application/xml; charset=utf-8',filename='metodist-tests.xml')
                    return self.reply(200,export_docx(record['course']),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',filename='metodist-program.docx')
        if method=='POST' and len(parts)==4 and parts[:2]==['api','proposals']:
            body=self.body()
            if parts[3]=='accept':return self.reply(200,app.accept(parts[2],body.get('revision')))
            if parts[3]=='reject':app.reject(parts[2]);return self.reply(200,dict(ok=True))
        if method=='GET' and not path.startswith('/api/'):
            name='index.html' if path=='/' else path.lstrip('/')
            target=(FRONTEND/name).resolve()
            allowed={'index.html','app.js','api.js','model.js','curriculum.js','programs.js','styles.css'}
            if target.is_relative_to(FRONTEND) and target.is_file() and (name in allowed or name.startswith('assets/')):
                types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8'}
                if target.suffix in types:return self.reply(200,target.read_bytes(),types[target.suffix])
        self.reply(404,dict(error='Не найдено.'))

    def handle_request(self):
        try:self.dispatch()
        except (Invalid,Conflict,NotFound,Unavailable) as exc:
            self.reply({Invalid:422,Conflict:409,NotFound:404,Unavailable:503}[type(exc)],dict(error=str(exc)))
        except (sqlite3.Error,OSError) as error:
            log_failure(LOGGER,'http_dependency_failed',error,status=503)
            self.reply(503,dict(error='Не удалось сохранить данные на сервере. Повторите запрос.'))
        except Exception as error:
            log_failure(LOGGER,'http_request_failed',error,status=500)
            self.reply(500,dict(error='Ошибка сервера. Сохранённая программа не изменена.'))

    do_GET=handle_request
    do_POST=handle_request
    do_PUT=handle_request
    def do_OPTIONS(self):self.reply(403,dict(error='Межсайтовые запросы запрещены.'))


def make_server(app,port=4173,config_loader=None,host='127.0.0.1',password='',public_origin=None):
    from .access import Access
    if public_origin:
        parsed=urlsplit(public_origin)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ['', '/'] or parsed.query or parsed.fragment:raise ValueError('Публичный origin должен быть точным HTTPS-адресом без пути и параметров.')
        public_origin=public_origin.rstrip('/')
    if host!='127.0.0.1' and (len(password)<16 or not public_origin):raise ValueError('Для внешнего доступа нужны HTTPS origin и пароль команды от 16 символов.')
    server=ThreadingHTTPServer((host,port),Handler)
    server.access=Access(password,secure=bool(public_origin));server.public_origin=public_origin
    server.app=app;server.config_loader=config_loader
    return server


def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(name)s %(message)s')
    parser=argparse.ArgumentParser(description='Методист — локальный сервер')
    parser.add_argument('--port',type=int,default=4173)
    parser.add_argument('--db',type=Path,default=ROOT/'.local/metodist.sqlite3')
    parser.add_argument('--host',choices=['127.0.0.1','0.0.0.0'],default='127.0.0.1')
    parser.add_argument('--public-origin',default=os.environ.get('METODIST_PUBLIC_ORIGIN'))
    args=parser.parse_args()
    os.umask(0o077)
    app=Application(Store(args.db),config=Config.load(ROOT))
    password=os.environ.get('METODIST_PASSWORD',env_values(ROOT).get('METODIST_PASSWORD',''))
    try:server=make_server(app,args.port,config_loader=lambda:Config.load(ROOT),host=args.host,password=password,public_origin=args.public_origin)
    except ValueError as error:parser.error(str(error))
    app.store.recover_jobs()
    print(f'Методист: {args.public_origin or f"http://127.0.0.1:{server.server_port}"} (изменения защищены паролем)' if password else f'Методист: http://127.0.0.1:{server.server_port} (только локально)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
