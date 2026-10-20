from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'outputs/Metodist-final.pdf'
pdfmetrics.registerFont(TTFont('Arial','/System/Library/Fonts/Supplemental/Arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialB','/System/Library/Fonts/Supplemental/Arial Bold.ttf'))
W,H=1600,900
PAGE_W,PAGE_H=1440,900
SCALE=PAGE_W/W
OFFSET_Y=(PAGE_H-H*SCALE)/2
INK='#122820'; MUTED='#597067'; GREEN='#00B84A'; BG='#F7FAF8'; WHITE='#FFFFFF'
c=canvas.Canvas(str(OUT),pagesize=(PAGE_W,PAGE_H),pageCompression=1)
c.setTitle('Методист | Точка сборки | Команда Пхукетская')
c.setAuthor('Матвей Мусиенко, Захар Толошный')
c._doc.Catalog.PageMode='/FullScreen'
page=0
def text(t,x,y,size=32,color=INK,bold=False):
    c.setFillColor(HexColor(color)); c.setFont('ArialB' if bold else 'Arial',size)
    for i,line in enumerate(t.split('\n')):
        assert pdfmetrics.stringWidth(line,'ArialB' if bold else 'Arial',size)<=W-x-60, (page,line)
        c.drawString(x,H-y-size-i*size*1.22,line)
def line(y):
    c.setStrokeColor(HexColor('#D8E5DC'));c.setLineWidth(1);c.line(72,H-y,1528,H-y)
def start(q,title,dark=False):
    global page
    page+=1
    c.setFillColor(HexColor(INK if dark else BG));c.rect(0,0,PAGE_W,PAGE_H,fill=1,stroke=0)
    c.saveState()
    c.translate(0,OFFSET_Y)
    c.scale(SCALE,SCALE)
    text(q,72,40,21,GREEN,True)
    if title:text(title,72,95,62,WHITE if dark else INK,True)
    text('Методист / Пхукетская',72,854,18,'#A5BDAF' if dark else MUTED)
    text(f'{page:02d} / 08',1438,854,18,'#A5BDAF' if dark else MUTED)
def end():
    c.restoreState()
    c.showPage()
def link(label,url,x,y,size=17):
    text(label,x,y,size,MUTED)
    c.linkURL(url,(x,H-y-size*1.2,x+pdfmetrics.stringWidth(label,'Arial',size),H-y),relative=1,thickness=0)

# 01. Team at top, product and hackathon at the centre.
start('КОМАНДА «ПХУКЕТСКАЯ»','',True)
text('Матвей Мусиенко, капитан\nЗахар Толошный, участник',1040,40,23,WHITE)
text('Продуктовый хакатон «Точка сборки»',300,255,38,GREEN)
text('Методист',300,320,140,WHITE,True)
text('ИИ-помощник для подготовки\nобразовательных программ',310,510,48,WHITE)
text('Кейс АЦР и GigaCowork',310,733,25,'#A5BDAF')
text('Продуктовый чекпоинт / 15.10.2026',1040,785,21,'#A5BDAF')
end()

# 02. Business problem and actual actors.
start('ВОПРОС 1 / ЗАДАЧА И ПОЛЬЗОВАТЕЛЬ','Подготовка курса занимает недели')
text('2–8',72,240,166,GREEN,True)
text('недель на одну программу',80,440,34,INK)
text('Оценка из описания кейса АЦР',80,496,22,MUTED)
text('Методист',790,250,46,INK,True)
text('Собирает программу, часы\nи учебные материалы',790,315,32,MUTED)
text('Эксперт проверяет содержание.\nРуководитель утверждает результат.',790,435,29,MUTED)
line(610)
text('Главная проблема',80,655,26,GREEN,True)
text('Разрозненные файлы, ошибки в часах\nи повторные согласования',500,640,39,INK)
link('Источник: кейс АЦР','https://hub.gigaschool.ru/events/tochka-sborki-2026/cases/sber-edu-agent',80,801)
end()

# 03. All boundaries retained, compressed into two clear columns.
start('ВОПРОС 2 / ТРЕБОВАНИЯ И ОГРАНИЧЕНИЯ','Полный комплект по правилам кейса')
text('Образовательная программа',72,230,34,INK,True)
text('Два шаблона АЦР: повышение квалификации\nи общеразвивающая программа. 16–500 часов.',72,292,27,MUTED)
text('Планы, компетенции, тесты, практика,\nпланы лекций и слайды всего курса.',72,395,29,INK)
text('Вход: DOCX, PDF, текст\nВыгрузка: DOCX, PPTX, JSON',72,508,28,MUTED)
text('Контроль и инфраструктура',850,230,34,INK,True)
text('Cloud.ru / Evolution Foundation Models\nЕдиный API, без зарубежных моделей',850,292,27,MUTED)
text('Методист утверждает каркас и правки.\nАвтопроверка часов, разделов и источников.',850,395,27,INK)
text('Подписи и реквизиты утверждения\nне заполняем автоматически.',850,508,27,MUTED)
line(638)
text('Законодательство РФ',72,671,28,GREEN,True)
text('152-ФЗ: минимизация и защита персональных данных.\n273-ФЗ, приказ № 266 для ДПО и № 629 для общеразвивающих программ.',490,664,25,INK)
link('152-ФЗ','https://mintrud.gov.ru/docs/laws/130',72,787)
link('273-ФЗ','https://minjust.gov.ru/ru/documents/7629/',232,787)
link('Приказ № 266','https://publication.pravo.gov.ru/document/0001202504230011',392,787)
link('Приказ № 629','http://publication.pravo.gov.ru/Document/View/0001202209270013',610,787)
end()

# 04. Scenario stays on one slide, with no separate change-proposal slide.
start('ВОПРОС 3 / ОСНОВНОЙ СЦЕНАРИЙ','От исходных материалов к комплекту')
rows=[('01','Задать курс','Загрузить файлы, подтвердить извлечённые данные\nи уточнить недостающие параметры.'),('02','Утвердить каркас','Согласовать цель, компетенции, темы и часы\nодним решением до генерации содержания.'),('03','Проверить комплект','Получить материалы всего курса\nс автоматической проверкой согласованности.'),('04','Доработать и выгрузить','Редактировать вручную или через ИИ.\nСвязанные правки применять после подтверждения.')]
for i,(n,t,b) in enumerate(rows):
    y=230+i*140
    text(n,72,y,48,GREEN,True);text(t,190,y+4,34,INK,True);text(b,780,y,28,MUTED)
text('Пример: анализ данных на Python для сотрудников банка, 72 часа',190,803,23,MUTED)
end()

# 05. Existing ImageGen prototype, used once and with explicit concept label.
start('ВОПРОС 3 / РАБОЧЕЕ ПРОСТРАНСТВО','Один курс в одном окне')
text('Программа\nи материалы',72,270,31,INK,True)
text('Редактирование\nи предпросмотр',72,365,24,MUTED)
text('Параметры\nи диалог с ИИ',72,525,31,GREEN,True)
text('Всегда рядом\nс документом',72,620,24,MUTED)
c.drawImage(str(ROOT/'outputs/interface-main.png'),480,H-190-655,width=1048,height=655,preserveAspectRatio=True,anchor='nw',mask='auto')
text('Концепт интерфейса',72,795,19,MUTED)
end()

# 06. The ratio refers to calendar duration; money is measured separately.
start('ВОПРОС 4 / ЦЕННОСТЬ И ЭКОНОМИКА','Быстрее подготовить пригодный курс',True)
text('2–8 недель',72,260,73,WHITE,True)
text('текущий срок по данным АЦР',80,362,26,'#A5BDAF')
text('1–2 дня',840,260,88,GREEN,True)
text('цель с проверкой человеком',850,375,26,'#A5BDAF')
text('≥7×',72,510,126,GREEN,True)
text('целевое ускорение календарного цикла\n14 дней / 2 дня. Гипотеза для пилота.',440,551,32,WHITE)
text('Генерация комплекта на 72 часа: цель до 20 минут.',80,735,28,WHITE)
text('Экономию считаем по трудозатратам специалистов с учётом стоимости ИИ.',80,785,23,'#A5BDAF')
end()

# 07. No measured results invented.
start('ВОПРОС 5 / МЕТРИКИ УСПЕХА','Готовность к работе после первой генерации')
text('≥90%',72,245,130,GREEN,True)
text('материалов без существенной переработки',80,412,31,INK)
text('Ориентир пилота. Эксперт оценивает качество,\nмы измеряем объём и время ручных правок.',80,476,26,MUTED)
text('Скорость и стоимость',900,255,33,INK,True)
text('Каркас ≤3 мин, комплект ≤20 мин.\nТрудозатраты и расход на генерацию.',900,312,26,MUTED)
text('Согласованность',900,425,33,INK,True)
text('Ноль расхождений часов. Каждый результат\nобучения связан с темами и проверкой.',900,482,26,MUTED)
line(650)
text('Достоверность',80,690,28,GREEN,True)
text('Только подтверждённые источники, полные обязательные разделы.\nНужны точечные правки, а не переписывание всего курса.',490,682,27,INK)
text('Все показатели целевые. Результаты проверим на пилоте.',80,800,22,MUTED)
end()

# 08. Short close.
start('МЕТОДИСТ','',True)
text('Программа курса\nи учебные материалы\nв одном рабочем окне',150,225,76,WHITE,True)
text('Методист принимает решения.\nИИ готовит комплект и проверяет согласованность.',155,565,34,'#A5BDAF')
text('Спасибо за внимание',155,745,32,GREEN,True)
end()
c.save()
doc=PdfReader(OUT)
assert len(doc.pages)==8
assert all(float(p.mediabox.width)==PAGE_W and float(p.mediabox.height)==PAGE_H for p in doc.pages)
print(OUT, len(doc.pages), 'pages', OUT.stat().st_size, 'bytes')
