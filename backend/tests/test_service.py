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
                competencyMap=[dict(competencyIndex=0,knowledge=['Типы'],skills=['Очистка'],abilities=['Проверка'])],
                modules=[dict(title=title,hours=8,topics=[dict(title=title,lectureHours=2,practiceHours=4,labHours=0,selfStudyHours=1,assessmentHours=1,competencyIndices=[0])]) for title in ['Основы','Данные']])


def materials():
    return dict(modules=[dict(m,content='Объяснение с примером',lecturePlan='Цель; показ; практика; вывод') for m in skeleton()['modules']],
                tests=[dict(moduleIndex=i,competencyIndices=[0],question='Вопрос по модулю',answer='Ответ') for i in range(2)],
                tasks=[dict(moduleIndex=i,competencyIndices=[0],text='Практическое задание',criteria='Корректное решение') for i in range(2)],
                slides=[dict(moduleIndex=i,competencyIndices=[0],title='Заголовок',body='Содержание') for i in range(2)])


def assessment_response(user,*,lecture_plan='План',question='Вопрос',answer='Ключ',task_text='Задание',criteria='Критерии',slide_title='Слайд',slide_body='Текст',test_count=3,slide_count=4):
    """A format fixture for the model's named assessment blocks."""
    return dict(lecturePlan=lecture_plan,assessments={group['key']:dict(tests=[dict(question=question,answerLines=answer.split('\n'))]*test_count,tasks=[dict(text=task_text,criteria=criteria)]) for group in user['assessmentGroups']},
                slides=[dict(title=slide_title,body=slide_body,competencyIndices=[x['competencyIndex'] for x in user['requiredOutcomes']])]*slide_count)


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

    def test_unexpected_generation_failure_is_diagnosed_and_retry_recovers(self):
        record=self.store.create(draft())
        def failed_generator(*args):
            raise RuntimeError('secret-provider-body')
        self.app.generator=failed_generator
        with self.assertLogs('backend.service',level='ERROR') as logs:
            failed=self.generate(record,request_id='diagnostic-failed')
        diagnostic='\n'.join(logs.output)
        self.assertIn('RuntimeError',diagnostic)
        self.assertIn(failed['id'],diagnostic)
        self.assertIn('failed_generator',diagnostic)
        self.assertNotIn('secret-provider-body',diagnostic+json.dumps(failed))
        self.assertEqual(failed['status'],'failed')
        self.assertEqual(self.store.get(record['id'])['course'],record['course'])
        self.assertIsNone(self.store.get(record['id'])['proposal'])
        self.app.generator=lambda *args:skeleton()
        recovered=self.generate(record,request_id='diagnostic-retry')
        self.assertEqual(recovered['status'],'completed')
        self.assertIsNotNone(recovered['proposalId'])

    def test_worker_start_failure_is_terminal_and_allows_manual_retry(self):
        # ERR-01: creating a job must not imply that its worker started.
        from unittest.mock import patch,Mock
        record=self.store.create(draft())
        generator=Mock(return_value=skeleton());self.app.generator=generator
        body=dict(revision=0,stage='skeleton',prompt='',requestId='worker-start-failure')
        caught=None
        with patch('threading.Thread.start',side_effect=RuntimeError('private-thread-details')):
            try:self.app.generate(record['id'],body)
            except Exception as error:caught=error
        self.assertIsInstance(caught,service.Unavailable)
        generator.assert_not_called()
        failed=self.store.get(record['id'])
        self.assertEqual(failed['job']['status'],'failed')
        self.assertEqual(failed['course'],record['course'])
        self.assertNotIn('private-thread-details',failed['job']['error'])
        self.assertEqual(self.generate(record,request_id='worker-manual-retry')['status'],'completed')

    def test_failed_status_write_recovers_without_repeating_generation(self):
        # ERR-02: storage recovery may retry status writes, never the model call.
        from unittest.mock import patch,Mock
        import sqlite3
        record=self.store.create(draft())
        job,_=self.store.start_job(record['id'],0,'skeleton','','status-write-failure')
        generator=Mock(side_effect=RuntimeError('private-model-details'));self.app.generator=generator
        escaped=None
        with patch.object(self.store,'connect',side_effect=sqlite3.OperationalError('private-db-details')):
            try:self.app._run(job['id'],record['id'],0,'skeleton',record['course'],'')
            except Exception as error:escaped=error
        self.assertIsNone(escaped,'An error while recording failure must not escape the worker.')
        recovered=self.store.get(record['id'])
        self.assertEqual(recovered['job']['status'],'failed')
        self.assertEqual(recovered['course'],record['course'])
        self.assertIsNone(recovered['proposal'])
        self.assertNotIn('private-',recovered['job']['error'])
        self.assertEqual(generator.call_count,1)
        self.assertEqual(service.Store(self.db).get(record['id'])['job']['status'],'failed')

    def test_deferred_failure_survives_a_rolled_back_recovery_transaction(self):
        # ERR-02: an unrelated failed write must not discard a pending failure.
        from unittest.mock import patch
        import sqlite3
        record=self.store.create(draft())
        job,_=self.store.start_job(record['id'],0,'skeleton','','rolled-back-recovery')
        self.app.generator=lambda *args:(_ for _ in ()).throw(RuntimeError('model unavailable'))
        with patch.object(self.store,'connect',side_effect=sqlite3.OperationalError('storage unavailable')):
            try:self.app._run(job['id'],record['id'],0,'skeleton',record['course'],'')
            except sqlite3.Error:pass
        with self.assertRaises(RuntimeError):
            with self.store.connect():raise RuntimeError('rollback')
        self.assertEqual(self.store.job(job['id'])['status'],'failed')

    def test_lost_response_reuses_job_after_requirements_or_configuration_change(self):
        # ERR-03: recovery is lookup of the original request, not a new generation.
        record=self.store.create(draft())
        body=dict(revision=0,stage='skeleton',prompt='Запрос',requestId='response-lost-after-completion')
        first=self.wait(self.app.generate(record['id'],body))
        self.store.save(record['id'],0,dict(record['course'],audience=''))
        self.app.generator=None;self.app.config=service.Config(key='')
        recovered=None
        try:recovered=self.app.generate(record['id'],body)
        except (service.Invalid,service.Unavailable):pass
        self.assertIsNotNone(recovered)
        self.assertEqual(recovered['id'],first['id'])
        with self.assertRaises(service.Conflict):self.app.generate(record['id'],dict(body,prompt='Другой запрос'))

    def test_failure_reporting_cannot_overwrite_a_completed_job(self):
        record=self.store.create(draft());completed=self.generate(record)
        self.store.fail_job(completed['id'],'Запоздалый отказ',None)
        self.assertEqual(self.store.job(completed['id']),completed)

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
            if 'explanation' in schema['properties']:return {key:('Подробное объяснение темы '*34) for key in schema['properties']}
            return assessment_response(user,lecture_plan='План лекции',answer='Ответ',criteria='Критерий',slide_body='Текст слайда')
        result=cfg.material_bundle(course,'Практический курс',complete)
        patch=service.proposal_patch('materials',course,result)
        self.assertEqual(len(seen),4)
        self.assertEqual([m['hours'] for m in patch['modules']],[8,8])
        self.assertEqual([t['moduleIndex'] for t in patch['tests']],[0,0,0,1,1,1])

    def test_restart_recovers_interrupted_job(self):
        record=self.store.create(draft())
        self.store.start_job(record['id'],0,'skeleton','','interrupted')
        self.store.recover_jobs()
        self.assertEqual(self.store.get(record['id'])['job']['status'],'failed')
        self.assertEqual(self.store.get(record['id'])['course']['modules'],[])

    def test_generation_reports_duration_tokens_and_estimated_gateway_cost(self):
        class MeasuredConfig(service.Config):
            def generate(self,stage,course,prompt):
                self.usage.append(dict(prompt_tokens=1000,completion_tokens=2000))
                return skeleton()
        self.app=service.Application(self.store,config=MeasuredConfig(key='test',model='GigaChat/GigaChat-3-Pro',base_url='https://hub.gigaschool.ru/api/v1/llm/v1'))
        record=self.store.create(draft());job=self.generate(record)
        self.assertEqual(job['status'],'completed')
        self.assertEqual(job.get('metrics',{}).get('inputTokens'),1000)
        self.assertEqual(job['metrics']['outputTokens'],2000)
        self.assertGreaterEqual(job['metrics']['seconds'],0)
        self.assertAlmostEqual(job['metrics']['estimatedRub'],.42581,places=5)

    def test_material_edit_preserves_skeleton_approval_and_does_not_stale_itself(self):
        record=self.accepted();record=self.app.approve(record['id'],record['revision'])
        job=self.generate(record,'materials','manual-material');record=self.app.accept(job['proposalId'],record['revision'])
        modules=[dict(m) for m in record['course']['modules']];modules[0]['content']='Исправленное объяснение'
        saved=self.store.save(record['id'],record['revision'],dict(record['course'],modules=modules))
        self.assertTrue(saved['course']['approved'])
        self.assertFalse(saved['course']['materialsStale'])
        self.assertTrue(saved['checks']['materials']['valid'])

    def test_revision_preserves_stale_marker_until_full_material_regeneration(self):
        record=self.accepted();record=self.app.approve(record['id'],record['revision'])
        job=self.generate(record,'materials','first-full');record=self.app.accept(job['proposalId'],record['revision'])
        modules=[dict(m) for m in record['course']['modules']];modules[0]['title']='Другая тема'
        record=self.store.save(record['id'],record['revision'],dict(record['course'],modules=modules))
        record=self.app.approve(record['id'],record['revision'])
        self.app.generator=lambda stage,course,prompt:{k:course[k] for k in ['goal','competencies','competencyMap','modules','tests','tasks','slides']}
        job=self.generate(record,'revision','stale-chat');self.assertEqual(job['status'],'completed')
        saved=self.app.accept(job['proposalId'],record['revision'])
        self.assertTrue(saved['course']['materialsStale'])
        self.assertFalse(saved['checks']['materials']['valid'])

    def test_material_only_revision_preserves_approval(self):
        record=self.accepted();record=self.app.approve(record['id'],record['revision'])
        job=self.generate(record,'materials','full-before-revise');record=self.app.accept(job['proposalId'],record['revision'])
        def revise(stage,course,prompt):
            course['modules'][0]['content']='Исправленный пример'
            return {k:course[k] for k in ['goal','competencies','competencyMap','modules','tests','tasks','slides']}
        self.app.generator=revise
        job=self.generate(record,'revision','only-content');self.assertEqual(job['status'],'completed')
        saved=self.app.accept(job['proposalId'],record['revision'])
        self.assertTrue(saved['course']['approved'])

if __name__ == '__main__': unittest.main()

class ClarificationTests(unittest.TestCase):
    setUp=ServiceTests.setUp
    tearDown=ServiceTests.tearDown
    generate=ServiceTests.generate
    wait=ServiceTests.wait
    def test_incomplete_request_lists_all_questions_before_any_job_or_model_call(self):
        record=self.store.create(dict(draft(),audience='',level='не задан',duration=''))
        with self.assertRaises(service.Invalid) as caught:self.generate(record)
        for word in ['аудитория','уровень','срок']:self.assertIn(word,str(caught.exception).lower())
        self.assertIsNone(self.store.get(record['id'])['job'])

class DeadlineTests(unittest.TestCase):
    setUp=ServiceTests.setUp
    tearDown=ServiceTests.tearDown
    generate=ServiceTests.generate
    wait=ServiceTests.wait
    def test_late_success_is_discarded_and_course_preserved(self):
        from unittest.mock import patch
        record=self.store.create(draft())
        def slow(*args):time.sleep(.03);return skeleton()
        self.app.generator=slow
        with patch.dict(service.GENERATION_BUDGETS,{'skeleton':.01}):
            job=self.generate(record)
        self.assertEqual(job['status'],'failed')
        self.assertIn('время',job['error'].lower())
        self.assertEqual(self.store.get(record['id'])['course']['modules'],[])
        self.assertIsNone(self.store.get(record['id'])['proposal'])

class ProviderFailureTests(unittest.TestCase):
    def test_provider_failures_log_original_type_without_credentials_or_response(self):
        import urllib.error
        from unittest.mock import patch
        failures=[(urllib.error.HTTPError('https://example.org/?key=secret-provider',status,'secret-provider',{},io.BytesIO(b'secret-provider')),status)
                  for status in [401,403,429,503]]
        failures.extend([(TimeoutError('secret-provider'),None),(ValueError('secret-provider'),None)])
        for failure,status in failures:
            with self.subTest(failure=type(failure).__name__,status=status):
                config=service.Config(key='secret-provider')
                with self.assertLogs('backend.service',level='ERROR') as logs:
                    with patch('urllib.request.OpenerDirector.open',side_effect=failure):
                        with self.assertRaises(service.Unavailable) as caught:
                            config._complete('instruction',{'prompt':'secret-provider'},{})
                diagnostic='\n'.join(logs.output)
                self.assertIn(type(failure).__name__,diagnostic)
                if status:self.assertIn(str(status),diagnostic)
                self.assertNotIn('secret-provider',diagnostic+str(caught.exception))
                self.assertEqual(config.attempted_calls,1)

class DurationApprovalTests(unittest.TestCase):
    setUp=ServiceTests.setUp
    tearDown=ServiceTests.tearDown
    generate=ServiceTests.generate
    wait=ServiceTests.wait
    accepted=ServiceTests.accepted
    def test_duration_change_requires_reapproval(self):
        record=self.accepted();record=self.app.approve(record['id'],record['revision'])
        saved=self.store.save(record['id'],record['revision'],dict(record['course'],duration='8 недель'))
        self.assertFalse(saved['course']['approved'])
