"""Curated program profiles; user evidence never becomes an automatic legal guarantee."""
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

CATALOG=json.loads((Path(__file__).resolve().parent.parent/'frontend/assets/program-profiles.json').read_text(encoding='utf-8'))


def profile(course):
    return CATALOG['profiles'][course['type']]


def canonical_url(value):
    try:
        parsed=urlsplit(value)
        if parsed.scheme not in ('http','https') or parsed.username or parsed.password or parsed.port not in (None,80,443):return None
        return (parsed.hostname or '').lower(),parsed.path.lower().rstrip('/')
    except (TypeError,ValueError):return None


def identifies_document(title,key):
    pattern=r'273[\s-]*фз' if key=='law273' else r'приказ[^\n]{0,100}(?<!\d)'+('266' if key=='order266' else '629')+r'(?!\d)'
    return bool(re.search(pattern,title.lower()))


def normative_entries(course):
    result=[]
    for key in profile(course)['documents']:
        document=CATALOG['documents'][key]
        source=next((s for s in course.get('sources',[]) if identifies_document(s.get('title',''),key) and canonical_url(s.get('url',''))==canonical_url(document['url']) and s.get('status')=='confirmed' and s.get('evidence','').strip()),None)
        result.append(dict(document,status='confirmed' if source else 'unverified',evidence=source['evidence'] if source else 'Применимость и редакцию не подтвердил методист.'))
    return result


def checks(course):
    entries=normative_entries(course)
    missing=[f"НЕ ПОДТВЕРЖДЁН: {x['title']}. Проверьте редакцию и применимость, добавьте официальный URL и сведения о проверке в источники: {x['url']}" for x in entries if x['status']!='confirmed']
    sections=[f'{label}: не заполнено.' for key,label in DETAIL_FIELDS.items() if not course.get('programDetails',{}).get(key)]
    standards=[]
    if profile(course)['id']=='professional':
        for index in range(len(course['competencies'])):
            entry=next((x for x in course.get('competencyMap',[]) if x['competencyIndex']==index),{})
            if entry.get('professionalStandard',{}).get('status')!='confirmed':standards.append(f'РО-{index+1}: профстандарт и трудовая функция не подтверждены методистом.')
        if not course['competencies']:standards.append('Сначала определите результаты обучения и их связь с профстандартом.')
    return dict(normativeBasis=dict(valid=not missing,details=missing),programSections=dict(valid=not sections,details=sections),professionalStandards=dict(valid=not standards,details=standards))

DETAIL_FIELDS={'admissionRequirements':'Требования к поступающим','completionDocument':'Документ по итогам обучения','calendarSchedule':'Календарный график','learningConditions':'Условия обучения','normativeNotes':'Обоснование применимости нормативных документов'}


def extend(data,course):
    from .service import Invalid,text
    raw=data.get('programDetails',{})
    if not isinstance(raw,dict) or set(raw)-set(DETAIL_FIELDS):raise Invalid('Неверные поля программы.')
    course['programDetails']={key:text(value,key,4000) for key,value in raw.items()}
    for source,target in zip(data.get('competencyMap',[]),course.get('competencyMap',[])):
        if 'professionalStandard' not in source:continue
        raw=source['professionalStandard']
        fields=['title','code','functionCode','url','evidence','status']
        if not isinstance(raw,dict) or set(raw)-set(fields):raise Invalid('Неверная структура профстандарта.')
        parsed={key:text(raw.get(key,''),key,2000) for key in fields if key!='status'}
        parsed['status']=raw.get('status','unverified')
        if parsed['status'] not in ('confirmed','unverified'):raise Invalid('Неверный статус профстандарта.')
        if parsed['url'] and canonical_url(parsed['url']) is None:raise Invalid('Профстандарт: требуется ссылка http(s).')
        if parsed['status']=='confirmed':
            host=(canonical_url(parsed['url']) or ('',''))[0]
            if not re.fullmatch(r'\d{2}\.\d{3}',parsed['code']) or not re.fullmatch(r'[A-ZА-Я]/\d{2}\.\d{1,2}',parsed['functionCode']) or not urlsplit(parsed['url']).path.strip('/'):raise Invalid('Укажите код профстандарта вида 06.001, трудовой функции вида A/01.6 и ссылку на конкретный официальный документ; эти форматы не подтверждают существование стандарта.')
            if not all(parsed[k] for k in ['title','code','functionCode','evidence']) or host not in ('publication.pravo.gov.ru','pravo.gov.ru','profstandart.rosmintrud.ru','mintrud.gov.ru'):raise Invalid('Подтверждение профстандарта требует названия, кодов, официального источника и свидетельства ручной проверки.')
        if parsed['status']=='confirmed' or any(parsed[key] for key in fields if key!='status'):target['professionalStandard']=parsed
    return course
