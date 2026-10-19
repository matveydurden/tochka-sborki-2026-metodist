"""Local course storage, validated model proposals, and atomic acceptance.

Uses only Python's standard library. Network calls happen outside SQLite transactions.
"""
import copy
import io
import json
import os
import sqlite3
import threading
import urllib.error
import urllib.request
import uuid
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape


class Invalid(Exception): pass
class Conflict(Exception): pass
class NotFound(Exception): pass
class Unavailable(Exception): pass


def now(): return datetime.now(timezone.utc).isoformat()
def dumps(value): return json.dumps(value, ensure_ascii=False)


def text(value, label, maximum=4000, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise Invalid(f'{label}: проверьте текст (до {maximum} символов).')
    if any(ord(c) < 32 and c not in '\n\r\t' for c in value) or any(0xD800 <= ord(c) <= 0xDFFF for c in value):
        raise Invalid(f'{label}: недопустимые символы.')
    return value.strip()


def integer(value, label, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise Invalid(f'{label}: нужно целое число от {minimum} до {maximum}.')
    return value


def items(value, label, maximum=100):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(item, dict) for item in value):
        raise Invalid(f'{label}: неверная структура списка.')
    return value


def normalize(data):
    if not isinstance(data, dict): raise Invalid('Ожидается объект программы.')
    result = {}
    for field, limit, required in [('title',160,True),('goal',4000,False),('audience',200,False),('level',200,False),('duration',80,False),('question',3000,False),('answer',3000,False),('task',12000,False)]:
        result[field] = text(data.get(field,''), field, limit, required)
    for field, choices, default in [
        ('type', ['Повышение квалификации','Общеразвивающая','Стажировка'], 'Повышение квалификации'),
        ('format',['Очно','Очно-заочно','Заочно','Дистанционно'],'Очно-заочно'),
        ('assessment',['Защита проекта','Тестирование','Практическое задание'],'Защита проекта')]:
        result[field] = data.get(field,default)
        if result[field] not in choices: raise Invalid(f'{field}: выберите допустимое значение.')
    result['hours'] = integer(data.get('hours'), 'Объём',16,500)
    result['group'] = integer(data.get('group',20),'Группа',1,10000)
    result['modules'] = [dict(title=text(m.get('title'),'Модуль',160,True),hours=integer(m.get('hours'),'Часы модуля',1,500),content=text(m.get('content',''),'Содержание модуля',20000)) for m in items(data.get('modules',[]),'Модули',50)]
    competencies = data.get('competencies',[])
    if not isinstance(competencies,list) or len(competencies)>20: raise Invalid('Неверный список результатов обучения.')
    result['competencies']=[text(value,'Результат обучения',1000,True) for value in competencies]
    for name, fields, limit in [('tests',[('question',3000),('answer',3000)],200),('tasks',[('text',12000),('criteria',4000)],100),('slides',[('title',160),('body',8000)],100)]:
        result[name]=[]
        for entry in items(data.get(name,[]),name,limit):
            parsed={field:text(entry.get(field,''),field,maxlen,True) for field,maxlen in fields}
            parsed['moduleIndex']=integer(entry.get('moduleIndex'),'Индекс модуля',0,max(0,len(result['modules'])-1))
            if not result['modules']: raise Invalid('Материалы должны относиться к существующему модулю.')
            result[name].append(parsed)
    slide=data.get('slide',{})
    if not isinstance(slide,dict): raise Invalid('Неверная структура слайда.')
    result['slide']={field:text(slide.get(field,''),'Слайд',8000) for field in ['title','body']}
    result['approved']=False  # Only the approval endpoint can set this flag.
    result['isDemo']=data.get('isDemo',False) is True
    result['materialsStale']=False
    return result


def checks(course):
    total=sum(m['hours'] for m in course['modules'])
    return dict(hours=dict(valid=bool(course['modules']) and total==course['hours'],total=total),
                structure=dict(valid=bool(course['goal'] and course['modules'] and course['competencies'])),
                materials=dict(valid=not course.get('materialsStale',False) and bool(course['modules']) and all(m['content'] for m in course['modules']) and all(set(range(len(course['modules']))) <= {x['moduleIndex'] for x in course[name]} for name in ['tests','tasks','slides'])),
                sources=dict(valid=False))


class Store:
    def __init__(self,path):
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL,updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,course_id TEXT NOT NULL,base_revision INTEGER NOT NULL,stage TEXT NOT NULL,patch TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending');
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,course_id TEXT NOT NULL,base_revision INTEGER NOT NULL,stage TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,error TEXT,proposal_id TEXT,created TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON jobs(course_id) WHERE status='running';
            ''')
        os.chmod(self.path,0o600)

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path, timeout=10)
        db.row_factory=sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def record(self,db,course_id):
        row=db.execute('SELECT * FROM courses WHERE id=?',(course_id,)).fetchone()
        if row is None: raise NotFound('Программа не найдена.')
        course=json.loads(row['data']); course['revision']=row['revision']
        proposal=db.execute("SELECT * FROM proposals WHERE course_id=? AND status='pending' ORDER BY rowid DESC LIMIT 1",(course_id,)).fetchone()
        job=db.execute('SELECT id FROM jobs WHERE course_id=? ORDER BY rowid DESC LIMIT 1',(course_id,)).fetchone()
        return dict(id=row['id'], revision=row['revision'],course=course,updatedAt=row['updated'],checks=checks(course),
                    proposal=None if proposal is None else dict(id=proposal['id'],revision=proposal['base_revision'],stage=proposal['stage'],patch=json.loads(proposal['patch'])),
                    job=self._job(db,job['id']) if job else None)

    def get(self,course_id):
        with self.connect() as db: return self.record(db,course_id)

    def list(self):
        with self.connect() as db:
            return [dict(id=r['id'],revision=r['revision'],title=json.loads(r['data'])['title'],updatedAt=r['updated']) for r in db.execute('SELECT * FROM courses ORDER BY updated DESC')]

    def create(self,data):
        course=normalize(data); course_id=str(uuid.uuid4())
        with self.connect() as db:
            db.execute('INSERT INTO courses VALUES(?,?,?,?)',(course_id,0,dumps(course),now()))
            return self.record(db,course_id)

    def write(self,db,course_id,revision,course):
        cursor=db.execute('UPDATE courses SET revision=revision+1,data=?,updated=? WHERE id=? AND revision=?',(dumps(course),now(),course_id,revision))
        if cursor.rowcount!=1: raise Conflict('Программа изменена в другой вкладке. Сначала откройте сохранённую версию.')
        return self.record(db,course_id)

    def save(self,course_id,revision,data):
        integer(revision,'Версия',0,2**31)
        course=normalize(data)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=self.record(db,course_id)['course']
            changed=any(old.get(field)!=course.get(field) for field in ['title','goal','competencies','audience','hours','type','format','assessment','modules'])
            has_materials=bool(old.get('tests') or old.get('tasks') or old.get('slides') or any(m.get('content') for m in old['modules']))
            course['materialsStale']=old.get('materialsStale',False) or (changed and has_materials)
            return self.write(db,course_id,revision,course)

    def _job(self,db,job_id):
        row=db.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if row is None: raise NotFound('Запуск не найден.')
        return dict(id=row['id'],status=row['status'],stage=row['stage'],error=row['error'],proposalId=row['proposal_id'])

    def job(self,job_id):
        with self.connect() as db: return self._job(db,job_id)

    def start_job(self,course_id,revision,stage,prompt,request_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM jobs WHERE request_id=?',(request_id,)).fetchone()
            if old:
                if (old['course_id'],old['base_revision'],old['stage'],old['prompt'])!=(course_id,revision,stage,prompt): raise Conflict('Идентификатор запроса уже используется.')
                return self._job(db,old['id']),False
            record=self.record(db,course_id)
            if record['revision']!=revision: raise Conflict('Программа изменилась. Откройте сохранённую версию.')
            if stage=='materials' and not record['course']['approved']: raise Conflict('Сначала согласуйте каркас.')
            job_id=str(uuid.uuid4())
            try: db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)',(job_id,request_id,course_id,revision,stage,prompt,'running',None,None,now()))
            except sqlite3.IntegrityError as exc: raise Conflict('Генерация для этой программы уже идёт.') from exc
            return self._job(db,job_id),True

    def recover_jobs(self):
        with self.connect() as db: db.execute("UPDATE jobs SET status='failed',error='Сервер был перезапущен. Повторите генерацию; программа сохранена.' WHERE status='running'")


def output_schema(stage,course):
    def obj(properties): return {'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}
    string={'type':'string'}
    module={'title':string,'hours':{'type':'integer','minimum':1,'maximum':500}}
    if stage!='skeleton':module['content']=string
    properties={'modules':{'type':'array','items':obj(module)}}
    if stage!='materials':properties.update(goal=string,competencies={'type':'array','items':string})
    if stage!='skeleton':
        index={'type':'integer','minimum':0,'maximum':max(0,len(course['modules'])-1)}
        for name,fields in [('tests',['question','answer']),('tasks',['text','criteria']),('slides',['title','body'])]:
            properties[name]={'type':'array','items':obj(dict(moduleIndex=index,**{field:string for field in fields}))}
    return obj(properties)


INTERNAL_MODELS={'Qwen/Qwen3.6-35B-A3B','Qwen/Qwen3.5-397B-A17B','GigaChat/GigaChat-2-Max','openai/gpt-oss-120b'}

@dataclass
class Config:
    key: str=''
    model: str='Qwen/Qwen3.6-35B-A3B'
    base_url: str='https://foundation-models.api.cloud.ru/v1'

    @property
    def provider(self):
        return 'Шлюз хакатона' if self.base_url=='https://hub.gigaschool.ru/api/v1/llm/v1' else 'Cloud.ru'

    @classmethod
    def load(cls,root):
        values={}
        path=Path(root)/'.env'
        if path.exists():
            for line in path.read_text().splitlines():
                if '=' in line and not line.lstrip().startswith('#'):
                    key,value=line.split('=',1); values[key.strip()]=value.strip().strip('\"\'')
        return cls(key=os.environ.get('LLM_API_KEY',values.get('LLM_API_KEY',os.environ.get('CLOUD_RU_FOUNDATION_MODELS_API_KEY',values.get('CLOUD_RU_FOUNDATION_MODELS_API_KEY','')))),
                   model=os.environ.get('CLOUDRU_MODEL',values.get('CLOUDRU_MODEL',cls.model)),
                   base_url=os.environ.get('LLM_BASE_URL',values.get('LLM_BASE_URL',cls.base_url)).rstrip('/'))

    def ready(self):
        if not self.key: raise Unavailable('Ключ Cloud.ru не настроен. Добавьте его в .env на сервере; курс уже сохранён.')
        if self.base_url not in {'https://foundation-models.api.cloud.ru/v1','https://hub.gigaschool.ru/api/v1/llm/v1'}: raise Unavailable('Адрес LLM должен указывать на Cloud.ru или командный шлюз хакатона.')
        allowed={'GigaChat/GigaChat-3-Pro','ai-sage/GigaChat3.5-432B-A28B-Reasoning'} if self.provider=='Шлюз хакатона' else INTERNAL_MODELS
        if self.model not in allowed: raise Unavailable('Выберите доступную текстовую модель в CLOUDRU_MODEL.')

    def generate(self,stage,course,prompt):
        self.ready()
        if stage=='materials':return self.material_bundle(course,prompt,self._complete)
        if stage=='skeleton':
            instruction='Подготовь каркас образовательной программы: цель, измеримые результаты обучения и модули. Сумма целых часов модулей должна ТОЧНО равняться общему объёму. Не добавляй учебное содержание до согласования.'
        else:
            instruction='Подготовь единый пакет правок по запросу. Общий объём часов не меняй. Для курса без материалов меняй только каркас, content оставляй пустым, tests/tasks/slides оставляй пустыми. Для курса с материалами обнови весь связанный комплект. Массивы tests, tasks, slides находятся в корне JSON, в modules — только модули.'
        system='Ты помощник методиста. Отвечай по-русски одним JSON-объектом по схеме. Не выдумывай источники, реквизиты, результаты проверок. '+instruction
        return self._complete(system,{'program':course,'request':prompt},output_schema(stage,course))

    def material_bundle(self,course,prompt,complete):
        def obj(properties):return {'type':'object','properties':properties,'required':list(properties),'additionalProperties':False}
        string={'type':'string'}
        schema=obj(dict(content=string,tests={'type':'array','items':obj(dict(question=string,answer=string))},task=obj(dict(text=string,criteria=string)),slide=obj(dict(title=string,body=string))))
        bundle=dict(modules=[],tests=[],tasks=[],slides=[])
        system='Ты преподаватель и методист. Подготовь краткий учебный черновик для ОДНОГО указанного модуля. content: 150–250 слов с одним небольшим примером. Каждый ответ теста — до 50 слов, задание и слайд — до 100 слов. Верни JSON строго с четырьмя ключами: content (учебное объяснение с примерами), tests (массив вопросов и ключей ответа), task (одно практическое задание с критериями), slide (один слайд). Подготовь минимум два теста. Не включай названия модулей и часы в ответ, не добавляй корневой ключ modules. Не выдумывай источники или реквизиты.'
        for index,module in enumerate(course['modules']):
            user=dict(program={key:course[key] for key in ['title','audience','goal','competencies','hours']},module={'title':module['title'],'hours':module['hours']},request=prompt)
            result=complete(system,user,schema)
            if not isinstance(result,dict) or not all(key in result for key in ['content','tests','task','slide']):raise Invalid(f'Модуль {index+1}: модель вернула неполную структуру. Курс сохранён.')
            bundle['modules'].append(dict(title=module['title'],hours=module['hours'],content=text(result['content'],'Содержание',20000,True)))
            tests=items(result['tests'],'Тесты',50)
            if not tests:raise Invalid(f'Модуль {index+1}: модель не подготовила тесты.')
            bundle['tests'].extend(dict(item,moduleIndex=index) for item in tests)
            for name,key in [('tasks','task'),('slides','slide')]:
                if not isinstance(result[key],dict):raise Invalid(f'Модуль {index+1}: неверная структура материалов.')
                bundle[name].append(dict(result[key],moduleIndex=index))
        return bundle

    def _complete(self,system,user,schema):
        payload={'model':self.model,'messages':[{'role':'system','content':system},{'role':'user','content':dumps(user)}],'max_tokens':4000,'temperature':0.3,'stream':False,'response_format':{'type':'json_schema','json_schema':{'name':'educational_program','strict':True,'schema':schema}}}
        request=urllib.request.Request(self.base_url+'/chat/completions',data=dumps(payload).encode(),headers={'Authorization':'Bearer '+self.key,'Content-Type':'application/json'},method='POST')
        try:
            # Do not follow redirects with an Authorization header.
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self,*args,**kwargs): return None
            with urllib.request.build_opener(NoRedirect).open(request,timeout=150) as response:
                raw=response.read(2_000_001)
            if len(raw)>2_000_000: raise Invalid('Ответ модели слишком большой.')
            data=json.loads(raw)
            choice=data['choices'][0]
            if choice.get('finish_reason')=='length': raise Invalid('Ответ модели обрезан. Уменьшите объём запроса.')
            content=choice['message']['content'].strip()
            if content.startswith('```'): content=content.split('\n',1)[1].rsplit('```',1)[0]
            return json.loads(content)
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code in (401,403): raise Unavailable('Cloud.ru отклонил ключ или доступ к модели.') from None
            if exc.code==429: raise Unavailable('Cloud.ru: лимит запросов или токенов. Повторите позже.') from None
            raise Unavailable(f'Cloud.ru вернул ошибку {exc.code}. Программа сохранена.') from None
        except (OSError,TimeoutError,ValueError,KeyError,IndexError,TypeError):
            raise Unavailable('Не удалось получить корректный ответ Cloud.ru. Программа сохранена; можно повторить запрос.') from None


def proposal_patch(stage,course,result):
    if not isinstance(result,dict): raise Invalid('Модель вернула неверную структуру.')
    allowed=['goal','competencies','modules'] if stage=='skeleton' else ['modules','tests','tasks','slides'] if stage=='materials' else ['goal','competencies','modules','tests','tasks','slides']
    if not all(key in result for key in allowed): raise Invalid('В ответе модели отсутствуют обязательные поля.')
    patch={key:result[key] for key in allowed}
    if stage=='skeleton': patch.update(tests=[],tasks=[],slides=[],question='',answer='',task='',slide={'title':'','body':''})
    candidate=normalize(dict(course,**patch))
    if stage=='skeleton' and any(m['content'] for m in candidate['modules']): raise Invalid('Каркас не должен содержать учебные материалы до согласования.')
    if stage=='revision' and not course['approved'] and not checks(course)['materials']['valid']:
        if any(candidate[name]!=course.get(name,[]) for name in ['tests','tasks','slides']) or any(m['content'] for m in candidate['modules']):
            raise Invalid('Для подготовки материалов сначала согласуйте каркас.')
    candidate_checks=checks(candidate)
    if not candidate_checks['hours']['valid'] or not candidate_checks['structure']['valid']: raise Invalid('Модель вернула неполный каркас или неверную сумму часов. Текущая программа не изменена.')
    if stage=='materials':
        if [(m['title'],m['hours']) for m in candidate['modules']]!=[(m['title'],m['hours']) for m in course['modules']]: raise Invalid('Модель изменила согласованный каркас. Материалы не приняты.')
        if not candidate_checks['materials']['valid']: raise Invalid('Модель не подготовила материалы для всех модулей.')
    if stage=='revision' and checks(course)['materials']['valid'] and not candidate_checks['materials']['valid']: raise Invalid('Пакет изменений потерял связанные материалы.')
    return {key:candidate[key] for key in candidate if key not in ['approved']}


class Application:
    def __init__(self,store,generator=None,config=None):
        self.store=store; self.config=config or Config(); self.generator=generator

    def generate(self,course_id,body):
        revision=integer(body.get('revision'),'Версия',0,2**31)
        stage=body.get('stage')
        if stage not in ['skeleton','materials','revision']: raise Invalid('Неизвестный этап генерации.')
        prompt=text(body.get('prompt',''),'Запрос',4000)
        request_id=text(body.get('requestId'),'Идентификатор запроса',100,True)
        course=self.store.get(course_id)['course']
        if not course['audience']: raise Invalid('Укажите аудиторию программы перед генерацией.')
        if self.generator is None: self.config.ready()
        job,created=self.store.start_job(course_id,revision,stage,prompt,request_id)
        if created:
            threading.Thread(target=self._run,args=(job['id'],course_id,revision,stage,course,prompt),daemon=True).start()
        return job

    def _run(self,job_id,course_id,revision,stage,course,prompt):
        try:
            result=(self.generator or self.config.generate)(stage,copy.deepcopy(course),prompt)
            patch=proposal_patch(stage,course,result)
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if self.store.record(db,course_id)['revision']!=revision: raise Conflict('Программа изменилась во время генерации. Повторите запрос для текущей версии.')
                proposal_id=str(uuid.uuid4())
                db.execute('INSERT INTO proposals(id,course_id,base_revision,stage,patch) VALUES(?,?,?,?,?)',(proposal_id,course_id,revision,stage,dumps(patch)))
                db.execute("UPDATE jobs SET status='completed',proposal_id=? WHERE id=?",(proposal_id,job_id))
        except Exception as exc:
            # Provider bodies and credentials never enter logs or API errors.
            message=str(exc) if isinstance(exc,(Invalid,Conflict,Unavailable)) else 'Не удалось подготовить комплект. Программа сохранена; повторите запрос.'
            with self.store.connect() as db: db.execute("UPDATE jobs SET status='failed',error=? WHERE id=?",(message,job_id))

    def approve(self,course_id,revision):
        integer(revision,'Версия',0,2**31)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            record=self.store.record(db,course_id)
            if record['revision']!=revision: raise Conflict('Программа изменилась. Откройте сохранённую версию.')
            if not all(record['checks'][key]['valid'] for key in ['hours','structure']): raise Invalid('Проверьте цель, результаты обучения и сумму часов.')
            course=record['course'];course['approved']=True
            return self.store.write(db,course_id,revision,course)

    def accept(self,proposal_id,revision):
        integer(revision,'Версия',0,2**31)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM proposals WHERE id=?',(proposal_id,)).fetchone()
            if row is None: raise NotFound('Предложение не найдено.')
            record=self.store.record(db,row['course_id'])
            if row['status']=='applied': return record
            if row['status']!='pending': raise Conflict('Предложение отклонено.')
            if record['revision']!=revision or row['base_revision']!=revision: raise Conflict('Программа изменилась. Подготовьте предложение заново.')
            course=normalize(dict(record['course'],**json.loads(row['patch'])))
            course['approved']=row['stage']=='materials' and record['course']['approved']
            course['isDemo']=False
            db.execute("UPDATE proposals SET status='applied' WHERE id=?",(proposal_id,))
            return self.store.write(db,row['course_id'],revision,course)

    def reject(self,proposal_id):
        with self.store.connect() as db:
            cursor=db.execute("UPDATE proposals SET status='rejected' WHERE id=? AND status='pending'",(proposal_id,))
            if cursor.rowcount!=1: raise Conflict('Предложение уже обработано.')


def export_docx(course):
    def p(value,style=None):
        props=f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
        lines=str(value).splitlines() or ['']
        runs='<w:br/>'.join(f'<w:t xml:space="preserve">{escape(line)}</w:t>' for line in lines)
        return f'<w:p>{props}<w:r>{runs}</w:r></w:p>'
    content=p(course['title'],'Title')+p(course['type'])+p(f"Объём {course['hours']} часов · {course['format']} · {course['duration']}")
    content+=p('Черновик для проверки методистом. Реквизиты утверждения и подписи не заполнены.')
    if course.get('materialsStale'):content+=p('Материалы требуют обновления после изменения каркаса. Содержание сохранено для повторной проверки.')
    if not checks(course)['hours']['valid']:content+=p('Обнаружено расхождение часов между модулями и общим объёмом.')
    content+=p('Цель программы','Heading1')+p(course['goal'] or 'Не заполнена')+p('Аудитория','Heading1')+p(course['audience'] or 'Не заполнена')
    content+=p('Результаты обучения','Heading1')+''.join(p(f'{i+1}. {value}') for i,value in enumerate(course['competencies']))
    content+=p('Учебный план','Heading1')+''.join(p(f"{i+1}. {module['title']} — {module['hours']} ч") for i,module in enumerate(course['modules']))
    for module in course['modules']: content+=p(module['title'],'Heading1')+p(module['content'] or 'Содержание ещё не подготовлено')
    content+=p('Тестовые вопросы и ключи','Heading1')
    for i,item in enumerate(course['tests']): content+=p(f"{i+1}. {item['question']}")+p('Ответ: '+item['answer'])
    content+=p('Практические задания','Heading1')
    for i,item in enumerate(course['tasks']): content+=p(f"{i+1}. {item['text']}")+p('Критерии: '+item['criteria'])
    content+=p('Аттестация','Heading1')+p(course['assessment'])+p('Источники','Heading1')+p('Подтверждённые источники не добавлены. Предметное содержание требует экспертной проверки.')
    xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+content+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1417"/></w:sectPr></w:body></w:document>'
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml','''<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>''')
        archive.writestr('_rels/.rels','''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>''')
        archive.writestr('word/document.xml',xml)
        archive.writestr('word/_rels/document.xml.rels','''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''')
        archive.writestr('word/styles.xml','''<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="27"/></w:rPr></w:style></w:styles>''')
    return buffer.getvalue()
