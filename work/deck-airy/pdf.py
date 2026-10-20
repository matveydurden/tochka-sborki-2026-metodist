from reportlab.pdfgen import canvas
from pathlib import Path
from pypdf import PdfReader
root=Path.cwd()
out=root/'outputs/Metodist-checkpoint.pdf'
c=canvas.Canvas(str(out),pagesize=(1600,900),pageCompression=1)
c.setTitle('Методист — продуктовый бриф команды Пхукетская')
c.setAuthor('Матвей Мусиенко, Захар Толошный')
links=[('https://www.consultant.ru/document/cons_doc_LAW_61801/',88,110),('https://minjust.gov.ru/ru/documents/7629/',220,110),('https://publication.pravo.gov.ru/document/0001202504230011',352,180),('http://publication.pravo.gov.ru/Document/View/0001202209270013',554,180)]
for n in range(1,9):
 c.drawImage(str(root/f'work/deck-airy/renders/slide-{n:02}.png'),0,0,1600,900)
 if n==3:
  for url,x,w in links:c.linkURL(url,(x,900-841,x+w,900-817),relative=0,thickness=0)
 if n==2:c.linkURL('https://hub.gigaschool.ru/events/tochka-sborki-2026/cases/sber-edu-agent',(72,900-841,772,900-817),relative=0,thickness=0)
 c.showPage()
c.save()
r=PdfReader(out)
assert len(r.pages)==8
assert all(tuple(map(float,p.mediabox[2:]))==(1600.,900.) for p in r.pages)
print(out, out.stat().st_size,'bytes',len(r.pages),'pages')
