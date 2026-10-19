"""Install the approved public demo as a system service on the assigned VM.

Run as the team user. Reads secrets from environment/getpass; never prints them.
"""
import argparse
import getpass
import json
import os
import pwd
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from backend.service import Config


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--origin',required=True)
    args=parser.parse_args()
    origin=args.origin.rstrip('/');url=urlsplit(origin)
    if url.scheme!='https' or not url.hostname or url.path or url.query or url.fragment or url.username or url.password:parser.error('Нужен точный HTTPS origin.')
    config=Config.load(ROOT);config.ready()
    password=os.environ.get('METODIST_PASSWORD') or getpass.getpass('Пароль команды (от 16 символов): ')
    if len(password)<16:parser.error('Пароль должен содержать от 16 символов.')
    user=pwd.getpwuid(os.getuid()).pw_name
    private=Path.home()/'.config/metodist';private.mkdir(parents=True,exist_ok=True);private.chmod(0o700)
    envfile=private/'service.env'
    values=dict(LLM_API_KEY=config.key,LLM_BASE_URL=config.base_url,CLOUDRU_MODEL=config.model,METODIST_PASSWORD=password,PYTHONDONTWRITEBYTECODE='1')
    fd=os.open(envfile,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as output:output.write(''.join(key+'='+json.dumps(value)+'\n' for key,value in values.items()))
    envfile.chmod(0o600)
    local=ROOT/'.local';local.mkdir(exist_ok=True)
    target=Path('/etc/systemd/system/metodist.service')
    if target.exists() and f'WorkingDirectory={ROOT}\n' not in target.read_text():raise RuntimeError('metodist.service принадлежит другому проекту; установка остановлена.')
    unit=f'''[Unit]
Description=Metodist hackathon demo
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User={user}
WorkingDirectory={ROOT}
EnvironmentFile={envfile}
ExecStart={ROOT}/.venv/bin/python -m backend.server --host 0.0.0.0 --port 8000 --public-origin {origin}
Restart=always
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={local}
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=1G
[Install]
WantedBy=multi-user.target
'''
    unitfile=local/'metodist.service';unitfile.write_text(unit)
    for command in [['sudo','-n','install','-m','644',str(unitfile),str(target)],['sudo','-n','systemctl','daemon-reload'],['sudo','-n','systemctl','enable','metodist.service'],['sudo','-n','systemctl','restart','metodist.service']]:subprocess.run(command,check=True)
    print('Сервис установлен. Секреты сохранены вне Git; проверьте systemctl status metodist.service и публичное демо.')

if __name__=='__main__':main()
