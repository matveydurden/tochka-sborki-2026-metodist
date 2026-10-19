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
    topic_hours=bool(modules) and all(m.get('topics') and sum(sum(t[k] for k in HOUR_FIELDS) for t in m['topics'])==m['hours'] for m in modules)
    mapped={x['competencyIndex'] for x in course.get('competencyMap',[]) if all(x.get(k) for k in ['knowledge','skills','abilities'])}
    taught={i for m in modules for t in m.get('topics',[]) for i in t.get('competencyIndices',[])}
    tested={i for t in course['tests'] for i in t.get('competencyIndices',[])}
    practised={i for t in course['tasks'] for i in t.get('competencyIndices',[])}
    missing=[i for i in range(count) if i not in mapped&taught&tested&practised]
    skeleton_coverage=bool(count) and set(range(count))<=mapped&taught
    sources=course.get('sources',[])
    return dict(topicHours=dict(valid=bool(topic_hours)),competencyMap=dict(valid=skeleton_coverage),
                coverage=dict(valid=bool(count) and not missing,missing=missing),
                lecturePlans=dict(valid=bool(modules) and all(m.get('lecturePlan') for m in modules if any(t.get('lectureHours',0) for t in m.get('topics',[]))) and all(m.get('topics') for m in modules)),
                sources=dict(valid=bool(sources) and all(s['status']=='confirmed' for s in sources),unverified=sum(s['status']!='confirmed' for s in sources)))


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
    fields=['title','goal','competencies','competencyMap','references','audience','level','hours','type','format','assessment']
    return dict(**{k:course.get(k) for k in fields},modules=[{k:m.get(k) for k in ['title','hours','topics']} for m in course['modules']])
