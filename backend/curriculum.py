"""Structured curriculum and traceability; legacy courses keep explicit gaps."""
from urllib.parse import urlsplit
from .service import Invalid, text, integer, items

HOUR_FIELDS=('lectureHours','practiceHours','labHours','selfStudyHours','assessmentHours')


def strings(value,label,maximum=30):
    if not isinstance(value,list) or len(value)>maximum:raise Invalid(f'{label}: неверный список.')
    return [text(x,label,2000,True) for x in value]


def indices(value,count):
    if not isinstance(value,list) or len(value)>20:raise Invalid('Неверные связи результатов обучения.')
    result=[integer(x,'Связь с результатом',0,max(0,count-1)) for x in value]
    if result and not count:raise Invalid('Сначала добавьте результаты обучения.')
    if len(set(result))!=len(result):raise Invalid('Связи результатов обучения повторяются.')
    return result


def extend(data,course):
    count=len(course['competencies'])
    course['competencyMap']=[]
    seen=set()
    for item in items(data.get('competencyMap',[]),'Карта компетенций',20):
        index=integer(item.get('competencyIndex'),'Компетенция',0,max(0,count-1))
        if not count or index in seen:raise Invalid('Неверная или повторная компетенция в карте.')
        seen.add(index)
        course['competencyMap'].append(dict(competencyIndex=index,**{k:strings(item.get(k,[]),k) for k in ['knowledge','skills','abilities']}))
    for raw,module in zip(data.get('modules',[]),course['modules']):
        module['topics']=[]
        for topic in items(raw.get('topics',[]),'Темы',50):
            parsed=dict(title=text(topic.get('title'),'Тема',200,True),competencyIndices=indices(topic.get('competencyIndices',[]),count))
            parsed.update({key:integer(topic.get(key,0),key,0,500) for key in HOUR_FIELDS})
            if not sum(parsed[key] for key in HOUR_FIELDS):raise Invalid('Тема должна содержать часы учебной работы.')
            module['topics'].append(parsed)
        module['lecturePlan']=text(raw.get('lecturePlan',''),'План лекции',12000)
    for name in ['tests','tasks','slides']:
        for raw,entry in zip(data.get(name,[]),course[name]):
            entry['competencyIndices']=indices(raw.get('competencyIndices',[]),count)
    course['references']=[dict(name=text(r.get('name'),'Название файла',200,True),text=text(r.get('text'),'Текст референса',60000,True)) for r in items(data.get('references',[]),'Референсы',10)]
    if sum(len(r['text']) for r in course['references'])>120000:raise Invalid('Суммарный текст референсов превышает 120 000 символов.')
    course['sources']=[]
    for source in items(data.get('sources',[]),'Источники',50):
        parsed={key:text(source.get(key,''),key,2000,key=='title') for key in ['title','url','evidence']}
        if parsed['url'] and (urlsplit(parsed['url']).scheme not in ['https','http'] or not urlsplit(parsed['url']).hostname):raise Invalid('Источник: требуется ссылка http(s).')
        parsed['status']=source.get('status','unverified')
        if parsed['status'] not in ['confirmed','unverified']:raise Invalid('Неверный статус источника.')
        if parsed['status']=='confirmed' and not parsed['evidence']:raise Invalid('Укажите, кем и как подтверждён источник.')
        course['sources'].append(parsed)
    return course


def checks(course):
    modules=course['modules'];count=len(course['competencies'])
    details={key:[] for key in ['topicHours','competencyMap','coverage','lecturePlans','sources']}
    mapped={x['competencyIndex'] for x in course.get('competencyMap',[]) if all(x.get(k) for k in ['knowledge','skills','abilities'])}
    taught={i for m in modules for t in m.get('topics',[]) for i in t.get('competencyIndices',[])}
    missing=[]
    for i in range(count):
        if i not in mapped:details['competencyMap'].append(f'РО-{i+1}: заполните знания, умения и навыки.')
        if i not in taught:details['competencyMap'].append(f'РО-{i+1}: укажите раскрывающую его тему.')
    for mi,module in enumerate(modules):
        label=f"Модуль {mi+1} «{module['title']}»"
        topics=module.get('topics',[])
        total=sum(sum(t[k] for k in HOUR_FIELDS) for t in topics)
        if not topics or total!=module['hours']:details['topicHours'].append(f"{label}: темы — {total} ч, модуль — {module['hours']} ч. Распределите часы тем.")
        if not topics or (any(t.get('lectureHours',0) for t in topics) and not module.get('lecturePlan')):details['lecturePlans'].append(label+': добавьте темы и план лекции.')
        local={i for t in topics for i in t.get('competencyIndices',[])}
        for i in sorted(local):
            absent=[name for key,name in [('tests','тест'),('tasks','задание')] if not any(x['moduleIndex']==mi and i in x.get('competencyIndices',[]) for x in course[key])]
            if absent:
                missing.append(i)
                details['coverage'].append(f"{label}, РО-{i+1}: добавьте {' и '.join(absent)} со связью с результатом.")
    for i in range(count):
        if i not in mapped&taught:
            missing.append(i);details['coverage'].append(f'РО-{i+1}: не заполнена карта или нет темы.')
    counts=[]
    for i,module in enumerate(modules):
        for key,label,minimum,maximum in [('tests','тестов',3,20),('tasks','заданий',1,10),('slides','слайдов',4,8)]:
            count_items=sum(x['moduleIndex']==i for x in course[key])
            if not minimum<=count_items<=maximum:counts.append(f"Модуль {i+1} «{module['title']}»: {label} — {count_items}, ориентир {minimum}–{maximum}.")
    depth=[f"Модуль {i+1} «{m['title']}»: {len(m.get('content','').split())} слов; ориентир учебного текста — не менее 600 слов. Это проверка объёма, предметное качество оценивает эксперт." for i,m in enumerate(modules) if len(m.get('content','').split())<600]
    sources=course.get('sources',[])
    if not sources:details['sources'].append('Добавьте источники и сведения об их проверке.')
    for source in sources:
        if source['status']!='confirmed':details['sources'].append(f"НЕ ПОДТВЕРЖДЁН: {source['title']}. Проверьте первоисточник и укажите свидетельство проверки.")
    return dict(materialCounts=dict(valid=bool(modules) and not counts,details=counts),contentDepth=dict(valid=bool(modules) and not depth,details=depth),topicHours=dict(valid=bool(modules) and not details['topicHours'],details=details['topicHours']),
                competencyMap=dict(valid=bool(count) and not details['competencyMap'],details=details['competencyMap']),
                coverage=dict(valid=bool(count) and not missing,missing=sorted(set(missing)),details=details['coverage']),
                lecturePlans=dict(valid=bool(modules) and not details['lecturePlans'],details=details['lecturePlans']),
                sources=dict(valid=bool(sources) and not details['sources'],unverified=sum(s['status']!='confirmed' for s in sources),details=details['sources']))


def schema(stage,course):
    def obj(properties):return dict(type='object',properties=properties,required=list(properties),additionalProperties=False)
    def array(item,minimum=0,maximum=50):return dict(type='array',items=item,minItems=minimum,maxItems=maximum)
    string={'type':'string','minLength':1}
    link=array({'type':'integer','minimum':0,'maximum':19},1,20)
    topic=obj(dict(title=string,**{k:{'type':'integer','minimum':0,'maximum':500} for k in HOUR_FIELDS},competencyIndices=link))
    module=dict(title=string,hours={'type':'integer','minimum':1,'maximum':500},topics=array(topic,1,20))
    if stage!='skeleton':module.update(content=string,lecturePlan=string)
    properties=dict(modules=array(obj(module),1,10))
    if stage!='materials':
        properties.update(goal=string,competencies=array(string,1,20),competencyMap=array(obj(dict(competencyIndex={'type':'integer','minimum':0,'maximum':19},**{k:array(string,1,10) for k in ['knowledge','skills','abilities']})),1,20))
    if stage!='skeleton':
        for name,fields in [('tests',['question','answer']),('tasks',['text','criteria']),('slides',['title','body'])]:
            properties[name]=array(obj(dict(moduleIndex={'type':'integer','minimum':0,'maximum':max(0,len(course['modules'])-1)},competencyIndices=link,**{field:string for field in fields})),1,100)
    return obj(properties)


def skeleton_identity(course):
    fields=['title','goal','competencies','competencyMap','references','audience','level','hours','duration','type','format','assessment']
    return dict(**{k:course.get(k) for k in fields},modules=[{k:m.get(k) for k in ['title','hours','topics']} for m in course['modules']])
