import io
import unittest
from backend import service
from test_curriculum import curriculum
from test_service import materials


class ProgramProfileTests(unittest.TestCase):
    def course(self, kind='Повышение квалификации'):
        course=service.normalize(dict(curriculum(), **materials()))
        course['type']=kind
        return course

    def test_normative_check_is_separate_from_ordinary_confirmed_literature(self):
        course=self.course()
        course['sources']=[dict(title='Учебник Python',url='https://example.org/book',status='confirmed',evidence='Методист проверил книгу')]
        report=service.checks(course)
        self.assertIn('normativeBasis',report)
        self.assertFalse(report['normativeBasis']['valid'])
        self.assertTrue(any('273-ФЗ' in x for x in report['normativeBasis']['details']))
        self.assertTrue(any('266' in x for x in report['normativeBasis']['details']))

    def test_selected_basis_is_type_specific_and_requires_manual_evidence(self):
        for kind,order,link in [('Повышение квалификации','266','https://publication.pravo.gov.ru/document/0001202504230011'),('Стажировка','266','https://publication.pravo.gov.ru/document/0001202504230011'),('Общеразвивающая','629','https://publication.pravo.gov.ru/Document/View/0001202209270013')]:
            with self.subTest(kind=kind):
                course=self.course(kind)
                course['sources']=[dict(title='Федеральный закон 273-ФЗ',url='https://publication.pravo.gov.ru/Document/View/0001201212300007',status='confirmed',evidence='Методист: сверил применимость по официальной публикации'),dict(title='Приказ №'+order,url=link,status='unverified',evidence='')]
                report=service.checks(course)
                self.assertIn('normativeBasis',report)
                self.assertFalse(report['normativeBasis']['valid'])
                course['sources'][1].update(status='confirmed',evidence='Методист: сверил документ и его применимость')
                self.assertTrue(service.checks(course)['normativeBasis']['valid'])

    def test_forged_title_or_wrong_document_does_not_confirm_normative_basis(self):
        course=self.course()
        course['sources']=[dict(title='273-ФЗ; Приказ №266; профстандарт',url='https://example.org/fake',status='confirmed',evidence='Проверено')]
        report=service.checks(course)
        self.assertIn('normativeBasis',report)
        self.assertFalse(report['normativeBasis']['valid'])

    def test_draft_export_contains_selected_basis_legacy_conflict_and_remaining_fields(self):
        from docx import Document
        for kind,order in [('Повышение квалификации','266'),('Общеразвивающая','629'),('Стажировка','266')]:
            with self.subTest(kind=kind):
                course=self.course(kind)
                doc=Document(io.BytesIO(service.export_docx(course)))
                text='\n'.join(p.text for p in doc.paragraphs)
                self.assertIn('273-ФЗ',text)
                self.assertIn('№ '+order,text)
                self.assertIn('НЕ ПОДТВЕРЖДЁН',text)
                self.assertIn('Полнота оформления программы',text)
                if kind!='Общеразвивающая':
                    self.assertIn('499',text)
                    self.assertIn('утратил силу',text)
                else:self.assertNotIn('№ 266',text)
