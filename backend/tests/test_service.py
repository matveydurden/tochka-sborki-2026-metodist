import io
import json
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path
from backend import service


def draft():
    return dict(title='Основы Python', type='Повышение квалификации', hours=16,
                audience='Начинающие аналитики', level='Без опыта', format='Очно',
                duration='2 недели', group=12, assessment='Защита проекта', goal='',
                modules=[], competencies=[], tests=[], tasks=[], slides=[],
                question='', answer='', task='', slide=dict(title='', body=''), isDemo=False)


def skeleton():
    return dict(goal='Обрабатывать данные на Python', competencies=['Читать и обрабатывать таблицы'],
                modules=[dict(title='Основы', hours=8), dict(title='Данные', hours=8)])


def materials():
    return dict(modules=[dict(title='Основы', hours=8, content='Переменные и циклы'),
                         dict(title='Данные', hours=8, content='Чтение таблиц и очистка')],
                tests=[dict(moduleIndex=i, question='Вопрос по модулю', answer='Ответ') for i in range(2)],
                tasks=[dict(moduleIndex=i, text='Практическое задание', criteria='Корректное решение') for i in range(2)],
                slides=[dict(moduleIndex=i, title='Заголовок', body='Содержание') for i in range(2)])


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / 'courses.sqlite3'
        self.store = service.Store(self.db)
        self.app = service.Application(self.store, generator=lambda stage, course, prompt: skeleton() if stage == 'skeleton' else materials())

    def tearDown(self):
        self.tmp.cleanup()

    def wait(self, job):
        for _ in range(200):
            result = self.store.job(job['id'])
            if result['status'] != 'running': return result
            time.sleep(.01)
        self.fail('job did not finish')

    def generate(self, record, stage='skeleton', request_id='request-1'):
        return self.wait(self.app.generate(record['id'], dict(revision=record['revision'], stage=stage, prompt='Подготовь курс', requestId=request_id)))

    def accepted(self):
        record = self.store.create(draft())
        job = self.generate(record)
        self.assertEqual(job['status'], 'completed')
        return self.app.accept(job['proposalId'], record['revision'])

    def test_persist_reopen_and_stale_save(self):
        record = self.store.create(draft())
        changed = dict(record['course'], audience='Школьники')
        saved = self.store.save(record['id'], record['revision'], changed)
        self.assertEqual(service.Store(self.db).get(record['id'])['course']['audience'], 'Школьники')
        with self.assertRaises(service.Conflict): self.store.save(record['id'], record['revision'], changed)
        self.assertEqual(saved['revision'], record['revision'] + 1)

    def test_skeleton_is_proposal_not_automatic_mutation(self):
        record = self.store.create(draft())
        job = self.generate(record)
        self.assertEqual(job['status'], 'completed')
        self.assertEqual(self.store.get(record['id'])['course']['modules'], [])
        accepted = self.app.accept(job['proposalId'], record['revision'])
        self.assertEqual(sum(m['hours'] for m in accepted['course']['modules']), 16)
        self.assertFalse(accepted['course']['approved'])
        again = self.app.accept(job['proposalId'], record['revision'])
        self.assertEqual(again['revision'], accepted['revision'])

    def test_stale_proposal_does_not_overwrite_manual_edit(self):
        record = self.store.create(draft())
        job = self.generate(record)
        self.store.save(record['id'], record['revision'], dict(record['course'], goal='Ручная цель'))
        with self.assertRaises(service.Conflict): self.app.accept(job['proposalId'], record['revision'])
        self.assertEqual(self.store.get(record['id'])['course']['goal'], 'Ручная цель')

    def test_model_failure_and_bad_hours_preserve_course(self):
        record = self.store.create(draft())
        def bad(*args): return dict(skeleton(), modules=[dict(title='Модуль', hours=15)])
        self.app.generator = bad
        job = self.generate(record)
        self.assertEqual(job['status'], 'failed')
        self.assertEqual(self.store.get(record['id'])['revision'], record['revision'])
        self.assertIsNone(self.store.get(record['id'])['proposal'])

    def test_materials_require_approval_then_apply_atomically(self):
        record = self.accepted()
        with self.assertRaises(service.Conflict): self.app.generate(record['id'], dict(revision=record['revision'],stage='materials',prompt='',requestId='mat1'))
        approved = self.app.approve(record['id'], record['revision'])
        job = self.generate(approved, 'materials', 'mat2')
        self.assertEqual(job['status'], 'completed')
        self.assertEqual(self.store.get(record['id'])['course']['tests'], [])
        completed = self.app.accept(job['proposalId'], approved['revision'])
        self.assertEqual(len(completed['course']['tests']), 2)
        self.assertEqual(len(completed['course']['tasks']), 2)
        self.assertTrue(completed['course']['approved'])
        modified = self.store.save(completed['id'], completed['revision'], dict(completed['course'], hours=20))
        self.assertFalse(modified['course']['approved'])
        self.assertFalse(modified['checks']['hours']['valid'])

    def test_concurrent_request_reuse_and_late_response(self):
        record = self.store.create(draft())
        started, release = threading.Event(), threading.Event()
        def slow(*args):
            started.set(); release.wait(2); return skeleton()
        self.app.generator = slow
        body=dict(revision=record['revision'],stage='skeleton',prompt='Запрос',requestId='same')
        first = self.app.generate(record['id'], body); started.wait(1)
        self.assertEqual(self.app.generate(record['id'], body)['id'], first['id'])
        with self.assertRaises(service.Conflict): self.app.generate(record['id'], dict(body,requestId='other'))
        self.store.save(record['id'], record['revision'], dict(record['course'], goal='Новая цель'))
        release.set()
        self.assertEqual(self.wait(first)['status'], 'failed')
        self.assertEqual(self.store.get(record['id'])['course']['goal'], 'Новая цель')

    def test_server_validation_and_approval_cannot_be_forged(self):
        for patch in [dict(hours=True), dict(hours=15), dict(group=0),dict(title=' '),dict(goal='bad\x00text')]:
            with self.subTest(patch=patch), self.assertRaises(service.Invalid): self.store.create(dict(draft(),**patch))
        record=self.store.create(dict(draft(),approved=True))
        self.assertFalse(record['course']['approved'])
        with self.assertRaises(service.Invalid): self.app.approve(record['id'],record['revision'])

    def test_docx_is_real_ooxml_and_escapes_text(self):
        record = self.accepted()
        data = service.export_docx(record['course'])
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertIn('word/document.xml', archive.namelist())
            from xml.etree import ElementTree as ET
            doc = ET.fromstring(archive.read('word/document.xml'))
            text=' '.join(doc.itertext())
            self.assertIn('Основы Python', text)
            self.assertIn('16', text)
            self.assertIn('Результаты обучения', text)

    def test_missing_key_is_explicit_and_does_not_create_job(self):
        app=service.Application(self.store, generator=None, config=service.Config(key=''))
        record=self.store.create(draft())
        with self.assertRaises(service.Unavailable): app.generate(record['id'],dict(revision=0,stage='skeleton',prompt='',requestId='no-key'))
        self.assertIsNone(self.store.get(record['id'])['job'])

    def test_structural_edit_marks_materials_stale_without_deleting_them(self):
        record=self.accepted();record=self.app.approve(record['id'],record['revision'])
        job=self.generate(record,'materials','stale-materials')
        record=self.app.accept(job['proposalId'],record['revision'])
        modules=[dict(m) for m in record['course']['modules']];modules[0]['title']='Новая тема'
        changed=self.store.save(record['id'],record['revision'],dict(record['course'],modules=modules))
        self.assertTrue(changed['course']['materialsStale'])
        self.assertFalse(changed['checks']['materials']['valid'])
        self.assertEqual(changed['course']['tests'],record['course']['tests'])

    def test_material_proposal_contains_full_view_contract(self):
        record=self.accepted();record=self.app.approve(record['id'],record['revision'])
        job=self.generate(record,'materials','full-view')
        patch=self.store.get(record['id'])['proposal']['patch']
        self.assertEqual(patch['goal'],record['course']['goal'])
        self.assertEqual(patch['competencies'],record['course']['competencies'])
        self.assertIn('tests',patch)

    def test_revision_cannot_generate_materials_before_approval(self):
        record=self.accepted()
        self.app.generator=lambda *args:dict(materials(),goal=record['course']['goal'],competencies=record['course']['competencies'])
        job=self.generate(record,'revision','unapproved-content')
        self.assertEqual(job['status'],'failed')
        self.assertEqual(self.store.get(record['id'])['course']['tests'],[])

    def test_module_generation_assembles_one_complete_package(self):
        cfg=service.Config(key='test')
        course=service.normalize(dict(draft(),**skeleton()));course['approved']=True
        seen=[]
        def complete(system,user,schema):
            seen.append(user)
            return dict(content='Подробное объяснение темы',tests=[dict(question='Вопрос',answer='Ответ')],task=dict(text='Задание',criteria='Критерий'),slide=dict(title='Слайд',body='Текст слайда'))
        result=cfg.material_bundle(course,'Практический курс',complete)
        patch=service.proposal_patch('materials',course,result)
        self.assertEqual(len(seen),2)
        self.assertEqual([m['hours'] for m in patch['modules']],[8,8])
        self.assertEqual([t['moduleIndex'] for t in patch['tests']],[0,1])

    def test_restart_recovers_interrupted_job(self):
        record=self.store.create(draft())
        self.store.start_job(record['id'],0,'skeleton','','interrupted')
        self.store.recover_jobs()
        self.assertEqual(self.store.get(record['id'])['job']['status'],'failed')
        self.assertEqual(self.store.get(record['id'])['course']['modules'],[])

if __name__ == '__main__': unittest.main()
