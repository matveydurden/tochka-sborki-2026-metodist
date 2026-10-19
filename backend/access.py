"""Ephemeral team sessions for the public read-only hackathon demo."""
import secrets
import threading
import time
from http.cookies import SimpleCookie

class Access:
    def __init__(self,password='',secure=False):
        self.password=password;self.secure=secure;self.sessions={};self.failures=[];self.lock=threading.Lock()
    def token(self,header):
        try:
            cookie=SimpleCookie();cookie.load(header or '')
            return cookie['metodist_session'].value if 'metodist_session' in cookie else ''
        except Exception:return ''
    def authenticated(self,header):
        if not self.password:return True
        with self.lock:return self.sessions.get(self.token(header),0)>time.time()
    def login(self,password):
        with self.lock:
            current=time.time();self.failures=[x for x in self.failures if x>current-60]
            if len(self.failures)>=10:return None,429
            if not isinstance(password,str) or not secrets.compare_digest(password.encode(),self.password.encode()):
                self.failures.append(current);return None,401
            self.failures=[];self.sessions={k:v for k,v in self.sessions.items() if v>current}
            if len(self.sessions)>=50:self.sessions.pop(next(iter(self.sessions)))
            token=secrets.token_urlsafe(32);self.sessions[token]=current+8*3600
            return token,200
    def logout(self,header):
        with self.lock:self.sessions.pop(self.token(header),None)
    def cookie(self,token='',clear=False):
        return f'metodist_session={token}; Path=/; Max-Age={0 if clear else 28800}; HttpOnly; SameSite=Strict'+('; Secure' if self.secure else '')
