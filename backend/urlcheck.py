"""Explicit, bounded availability probes. Never confirms the truth of a source."""
import http.client
import ipaddress
import queue
import socket
import ssl
import threading
from urllib.parse import urlsplit, quote
from .service import Invalid, now, text

DNS_TIMEOUT=3
NETWORK_TIMEOUT=5
_DNS_SLOTS=threading.BoundedSemaphore(4)
_REQUEST_SLOTS=threading.BoundedSemaphore(4)


def _public(address):
    try:ip=ipaddress.ip_address(address)
    except ValueError:return False
    return (ip.is_global and not any([ip.is_multicast,ip.is_reserved,ip.is_unspecified,ip.is_loopback,ip.is_link_local])
            and not (isinstance(ip,ipaddress.IPv6Address) and (ip.ipv4_mapped or ip.sixtofour or ip.teredo)))


def _resolve(host):
    # Timed-out DNS workers retain their slot until the OS resolver finishes.
    slots=_DNS_SLOTS
    if not slots.acquire(blocking=False):raise OSError('DNS busy')
    result=queue.Queue(maxsize=1)
    def resolve():
        try:result.put(socket.getaddrinfo(host,443,type=socket.SOCK_STREAM))
        except OSError:result.put(None)
        finally:slots.release()
    try:threading.Thread(target=resolve,daemon=True).start()
    except Exception:
        slots.release();raise
    try:addresses=result.get(timeout=DNS_TIMEOUT)
    except queue.Empty:raise TimeoutError('DNS timeout') from None
    if not addresses:raise OSError('DNS unavailable')
    return addresses


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self,host,address,**kwargs):
        super().__init__(host,port=443,**kwargs)
        self.address=address

    def connect(self):
        family,kind,protocol,_,address=self.address
        raw=socket.socket(family,kind,protocol)
        self.sock=raw
        try:
            raw.settimeout(self.timeout)
            raw.connect(address)
            self.sock=self._context.wrap_socket(raw,server_hostname=self.host)
        except Exception:
            raw.close();self.sock=None;raise


def _head(host,target,address):
    connection=PinnedHTTPSConnection(host,address,context=ssl.create_default_context(),timeout=NETWORK_TIMEOUT)
    def expire():
        sock=connection.sock
        if sock is not None:
            try:sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            sock.close()
    timer=threading.Timer(NETWORK_TIMEOUT,expire);timer.daemon=True;timer.start()
    try:
        connection.request('HEAD',target,headers={'User-Agent':'Metodist-LinkCheck/1.0','Accept':'*/*','Connection':'close'})
        response=connection.getresponse()
        return response.status  # Do not read the body or follow Location.
    finally:
        timer.cancel();connection.close()


def check(value):
    if isinstance(value,str) and (any(ord(c)<=32 or ord(c)==127 for c in value) or '\\' in value):raise Invalid('Ссылка содержит недопустимые символы.')
    value=text(value,'Ссылка',2000,True)
    try:
        url=urlsplit(value);host=url.hostname
        if url.scheme!='https' or not host or url.username is not None or url.password is not None or url.port not in [None,443] or url.fragment:raise ValueError()
        host=host.encode('idna').decode('ascii').lower()
        if '%' in host or host.endswith('.') or not ('.' in host or ':' in host):raise ValueError()
        try:literal=ipaddress.ip_address(host)
        except ValueError:literal=None
        if literal is not None and not _public(host):raise ValueError()
    except (ValueError,UnicodeError):raise Invalid('Для проверки нужна публичная HTTPS-ссылка на порту 443 без пароля и фрагмента.') from None
    if not _REQUEST_SLOTS.acquire(blocking=False):
        return dict(status='error',httpStatus=None,checkedAt=now(),message='Проверки заняты. Повторите вручную через несколько секунд.')
    try:
        addresses=_resolve(host)
        if not addresses or len(addresses)>32 or any(a[0] not in [socket.AF_INET,socket.AF_INET6] or not _public(a[4][0]) for a in addresses):
            raise Invalid('Ссылка ведёт на внутренний или непубличный адрес. Запрос запрещён.')
        target=quote(url.path or '/',safe="/%:@!$&'()*+,;=-._~")
        if url.query:target+='?'+quote(url.query,safe="/%?:@!$&'()*+,;=-._~")
        code=_head(host,target,addresses[0])
        if 200<=code<300:status,message='accessible','Страница доступна. Это не подтверждает достоверность источника.'
        elif 300<=code<400:status,message='redirect','Сайт вернул перенаправление. Переход не выполнялся; проверьте конечную ссылку вручную.'
        elif code in [401,403]:status,message='restricted','Сайт ограничил доступ. Доступность страницы не подтверждена.'
        elif code in [405,501]:status,message='unsupported','Сайт не поддерживает HEAD. Проверка содержимого не выполнялась.'
        else:status,message='unavailable','Сайт вернул ошибку. Проверьте адрес или повторите позже.'
        return dict(status=status,httpStatus=code,checkedAt=now(),message=message)
    except (OSError,http.client.HTTPException):
        return dict(status='error',httpStatus=None,checkedAt=now(),message='Не удалось проверить ссылку: ошибка DNS, TLS, сети или превышение времени. Подтверждение источника не изменено.')
    finally:_REQUEST_SLOTS.release()
