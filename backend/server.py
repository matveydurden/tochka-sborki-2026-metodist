"""Single-user loopback HTTP API. No public deployment or authentication implied."""
import argparse
import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,unquote
from .service import Application,Store,Config,Invalid,Conflict,NotFound,Unavailable,dumps,export_docx

ROOT=Path(__file__).resolve().parent.parent
FRONTEND=ROOT/'frontend'


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass

    def reply(self,status,value,content_type='application/json; charset=utf-8',filename=None):
        data=dumps(value).encode() if content_type.startswith('application/json') else value
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'")
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass

    def body(self):
        if self.headers.get_content_type()!='application/json':raise Invalid('Требуется Content-Type application/json.')
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:raise Invalid('Некорректный размер запроса.')
        if not 0<length<=1_000_000:raise Invalid('Запрос пустой или превышает 1 МБ.')
        try:data=json.loads(self.rfile.read(length))
        except (ValueError,UnicodeError):raise Invalid('Некорректный JSON.')
        if not isinstance(data,dict):raise Invalid('Ожидается JSON-объект.')
        return data

    def dispatch(self):
        hosts={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
        host=self.headers.get('Host','')
        if host not in hosts:return self.reply(403,{'error':'Недопустимый адрес сервера.'})
        origin=self.headers.get('Origin')
        if origin is not None and origin!='http://'+host:return self.reply(403,{'error':'Запрос с другого сайта запрещён.'})
        path=unquote(urlsplit(self.path).path)
        app=self.server.app
        if self.server.config_loader:app.config=self.server.config_loader()
        method=self.command
        if method=='GET' and path=='/api/status':
            try:app.config.ready();configured=True
            except Unavailable:configured=False
            return self.reply(200,dict(configured=configured,model=app.config.model,provider=app.config.provider))
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
                if method=='GET' and action in ['export.json','export.docx']:
                    record=app.store.get(course_id)
                    if action=='export.json':return self.reply(200,dict(schemaVersion=2,courseId=record['id'],revision=record['revision'],course=record['course'],checks=record['checks']),filename='metodist-program.json')
                    return self.reply(200,export_docx(record['course']),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',filename='metodist-program.docx')
        if method=='POST' and len(parts)==4 and parts[:2]==['api','proposals']:
            body=self.body()
            if parts[3]=='accept':return self.reply(200,app.accept(parts[2],body.get('revision')))
            if parts[3]=='reject':app.reject(parts[2]);return self.reply(200,dict(ok=True))
        if method=='GET' and not path.startswith('/api/'):
            name='index.html' if path=='/' else path.lstrip('/')
            target=(FRONTEND/name).resolve()
            allowed={'index.html','app.js','api.js','model.js','styles.css'}
            if target.is_relative_to(FRONTEND) and target.is_file() and (name in allowed or name.startswith('assets/')):
                types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'}
                if target.suffix in types:return self.reply(200,target.read_bytes(),types[target.suffix])
        self.reply(404,dict(error='Не найдено.'))

    def handle_request(self):
        try:self.dispatch()
        except (Invalid,Conflict,NotFound,Unavailable) as exc:
            self.reply({Invalid:422,Conflict:409,NotFound:404,Unavailable:503}[type(exc)],dict(error=str(exc)))
        except (sqlite3.Error,OSError):self.reply(503,dict(error='Не удалось сохранить данные на сервере. Повторите запрос.'))
        except Exception:self.reply(500,dict(error='Ошибка сервера. Сохранённая программа не изменена.'))

    do_GET=handle_request
    do_POST=handle_request
    do_PUT=handle_request
    def do_OPTIONS(self):self.reply(403,dict(error='Межсайтовые запросы запрещены.'))


def make_server(app,port=4173,config_loader=None):
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.app=app;server.config_loader=config_loader
    return server


def main():
    parser=argparse.ArgumentParser(description='Методист — локальный сервер')
    parser.add_argument('--port',type=int,default=4173)
    parser.add_argument('--db',type=Path,default=ROOT/'.local/metodist.sqlite3')
    args=parser.parse_args()
    os.umask(0o077)
    app=Application(Store(args.db),config=Config.load(ROOT))
    server=make_server(app,args.port,config_loader=lambda:Config.load(ROOT))
    app.store.recover_jobs()
    print(f'Методист: http://127.0.0.1:{server.server_port} (только локально)',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=='__main__':main()
