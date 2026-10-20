import copy
import unittest
from backend import service
from test_service import draft, skeleton


def curriculum():
    course=dict(draft(),**skeleton())
    course['competencyMap']=[dict(competencyIndex=0,knowledge=['Типы данных'],skills=['Очищать таблицы'],abilities=['Проверять результат'])]
    for module in course['modules']:
        module['topics']=[dict(title=module['title'],lectureHours=2,practiceHours=4,labHours=0,selfStudyHours=1,assessmentHours=1,competencyIndices=[0])]
        module['lecturePlan']='Цель; демонстрация; вопросы; закрепление'
    course['references']=[dict(name='Требования.txt',text='Нужен курс для новичков')]
    return course


class CurriculumTests(unittest.TestCase):
    def test_rich_fields_survive_normalization_and_old_courses_still_open(self):
        course=service.normalize(curriculum())
        self.assertEqual(course.get('references'),curriculum()['references'])
        self.assertEqual(course.get('competencyMap'),curriculum()['competencyMap'])
        self.assertEqual(course['modules'][0].get('topics'),curriculum()['modules'][0]['topics'])
        self.assertEqual(service.normalize(draft())['modules'],[])

    def test_nested_hours_and_coverage_are_checked_separately(self):
        course=service.normalize(curriculum())
        self.assertTrue(service.checks(course).get('topicHours',{}).get('valid'))
        self.assertFalse(service.checks(course).get('coverage',{}).get('valid',True))
        for name,fields in [('tests',dict(question='Вопрос',answer='Ключ')),('tasks',dict(text='Задание',criteria='Критерий'))]:
            course[name]=[dict(moduleIndex=i,competencyIndices=[0],**fields) for i in range(len(course['modules']))]
        self.assertTrue(service.checks(course)['coverage']['valid'])
        course['modules'][0]['topics'][0]['practiceHours']=5
        self.assertFalse(service.checks(course)['topicHours']['valid'])

    def test_dangling_links_and_invalid_hours_are_rejected(self):
        for patch in [dict(competencyIndices=[9]),dict(lectureHours=-1),dict(practiceHours=True)]:
            course=curriculum();course['modules'][0]['topics'][0].update(patch)
            with self.subTest(patch=patch),self.assertRaises(service.Invalid):service.normalize(course)

    def test_schema_requires_competencies_and_structured_topics(self):
        schema=service.output_schema('skeleton',service.normalize(draft()))
        self.assertGreaterEqual(schema['properties']['competencies'].get('minItems',0),1)
        self.assertIn('competencyMap',schema['properties'])
        module=schema['properties']['modules']['items']
        self.assertIn('topics',module['required'])

    def test_sources_cannot_claim_confirmation_without_evidence(self):
        course=curriculum();course['sources']=[dict(title='Книга',url='https://example.com',status='confirmed',evidence='')]
        with self.assertRaises(service.Invalid):service.normalize(course)

class GenerationContractTests(unittest.TestCase):
    def test_generated_skeleton_cannot_omit_traceability(self):
        with self.assertRaises(service.Invalid):service.proposal_patch('skeleton',service.normalize(draft()),{k:v for k,v in skeleton().items() if k!='competencyMap'})

    def test_material_package_must_preserve_topics_and_cover_outcomes(self):
        from test_service import materials
        course=service.normalize(curriculum());course['approved']=True
        broken=materials();broken['modules'][0]['topics']=[]
        with self.assertRaises(service.Invalid):service.proposal_patch('materials',course,broken)

class TargetedGenerationTests(unittest.TestCase):
    def test_only_requested_module_is_regenerated(self):
        from test_service import materials
        course=service.normalize(dict(curriculum(),**materials()));course['approved']=True
        config=service.Config(key='test');seen=[]
        def complete(system,user,schema):
            seen.append(user)
            if 'explanation' in schema['properties']:return {key:'Подробное объяснение темы' for key in schema['properties']}
            return dict(content='Новое объяснение',lecturePlan='Новый план',tests=[dict(question='Новый вопрос',answer='Ключ',competencyIndices=[0])]*3,tasks=[dict(text='Новое задание',criteria='Критерии',competencyIndices=[0])],slides=[dict(title='Новый слайд',body='Текст',competencyIndices=[0])]*4)
        config._complete=complete
        import json
        result=config.generate('module',course,json.dumps(dict(moduleIndex=1,prompt='Усложни')))
        self.assertEqual(len(seen),2)
        self.assertEqual(result['modules'][0],course['modules'][0])
        self.assertEqual(result['tests'][0],course['tests'][0])
        self.assertEqual(result['tests'][1]['moduleIndex'],1)
        self.assertEqual(course['modules'][1]['content'],'Объяснение с примером')

class SkeletonPlanningTests(unittest.TestCase):
    def test_outcomes_and_maps_share_one_source_and_hours_are_allocated_exactly(self):
        config=service.Config(key='test');calls=[]
        def complete(system,user,schema):
            calls.append(schema)
            if 'outcomes' in schema['properties']:
                return dict(goal='Анализ данных',outcomes=[dict(title='Очистить таблицу',knowledge=['Типы'],skills=['Очистка'],abilities=['Контроль'])])
            return dict(modules=[dict(title='Практика',topics=[dict(title='Очистка',lectureHours=2,practiceHours=5,labHours=0,selfStudyHours=2,assessmentHours=1,competencyIndices=[0])])])
        config._complete=complete
        course=service.normalize(draft());course['hours']=17
        result=config.generate('skeleton',course,'')
        self.assertEqual(len(calls),2)
        self.assertEqual(result['competencies'],['Очистить таблицу'])
        self.assertEqual(result['competencyMap'][0]['competencyIndex'],0)
        self.assertEqual(sum(m['hours'] for m in result['modules']),17)
        self.assertTrue(service.checks(service.normalize(dict(course,**result)))['topicHours']['valid'])

class InfrastructureConfigTests(unittest.TestCase):
    def test_vm_environment_is_recognized_without_local_env_file(self):
        import os,tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'OPENAI_API_KEY':'test-vm','OPENAI_BASE_URL':'https://hub.gigaschool.ru/api/v1/llm/v1'},clear=True):
            config=service.Config.load(root)
            self.assertEqual(config.key,'test-vm')
            self.assertEqual(config.model,'GigaChat/GigaChat-3-Pro')
            config.ready()

class DetailedChecksTests(unittest.TestCase):
    def test_each_module_must_assess_its_own_outcomes(self):
        from test_service import materials
        course=service.normalize(dict(curriculum(),**materials()))
        course['tests']=[course['tests'][0]]
        report=service.checks(course)
        self.assertFalse(report['coverage']['valid'])
        self.assertTrue(any('Модуль 2' in x and 'РО-1' in x for x in report['coverage']['details']))

    def test_report_identifies_mismatched_hours_and_unverified_sources(self):
        course=service.normalize(curriculum())
        course['modules'][0]['hours']=9
        course['sources']=[dict(title='Книга без проверки',url='',status='unverified',evidence='')]
        report=service.checks(course)
        self.assertTrue(any('Модуль 1' in x for x in report['topicHours']['details']))
        self.assertTrue(any('Книга без проверки' in x for x in report['sources']['details']))

class ProviderBoundaryTests(unittest.TestCase):
    def test_only_issued_provider_and_model_pairs_are_accepted(self):
        pairs=[
            ('https://api.openai.com/v1','GigaChat/GigaChat-3-Pro',False),
            ('https://hub.gigaschool.ru/api/v1/llm/v1','Qwen/Qwen3.6-35B-A3B',False),
            ('https://hub.gigaschool.ru/api/v1/llm/v1','GigaChat/GigaChat-3-Pro',True),
            ('https://foundation-models.api.cloud.ru/v1','Qwen/Qwen3.6-35B-A3B',True),
        ]
        for base,model,allowed in pairs:
            with self.subTest(base=base,model=model):
                config=service.Config(key='validation-only',base_url=base,model=model)
                if allowed:config.ready()
                else:
                    with self.assertRaises(service.Unavailable):config.ready()

    def test_expired_budget_never_starts_another_paid_call(self):
        from unittest.mock import patch
        config=service.Config(key='validation-only');config.deadline=0
        with patch('urllib.request.build_opener') as opener:
            with self.assertRaises(service.Unavailable):config._complete('','',{})
            opener.assert_not_called()

class ContentGenerationTests(unittest.TestCase):
    def test_assessment_is_grounded_in_separately_generated_teaching_text(self):
        from test_service import materials
        course=service.normalize(dict(curriculum(),**materials()));course['modules']=course['modules'][:1]
        calls=[]
        def complete(system,user,schema):
            calls.append((user,schema))
            if 'explanation' in schema['properties']:
                return {key:'Подробный учебный текст с примером' for key in schema['properties']}
            self.assertIn('Подробный учебный текст с примером',user.get('teachingText',''))
            self.assertIn('Разобранный пример',user['teachingText'])
            return dict(lecturePlan='План',tests=[dict(question='Вопрос',answer='Ключ',competencyIndices=[0])]*3,tasks=[dict(text='Задание',criteria='Критерии',competencyIndices=[0])],slides=[dict(title='Слайд',body='Текст',competencyIndices=[0])]*4)
        result=service.Config().material_bundle(course,'',complete)
        self.assertIn('Подробный учебный текст с примером',result['modules'][0]['content'])
        self.assertEqual(len(calls),2)

    def test_material_schema_limits_titles_and_rejects_bad_module_before_next_call(self):
        calls=[]
        def complete(system,user,schema):
            calls.append(schema)
            if 'explanation' in schema['properties']:return {key:'Объяснение' for key in schema['properties']}
            self.assertEqual(schema['properties']['slides']['items']['properties']['title']['maxLength'],160)
            return dict(lecturePlan='План',tests=[dict(question='Вопрос',answer='Ключ',competencyIndices=[0])]*3,tasks=[dict(text='Задание',criteria='Критерии',competencyIndices=[0])],slides=[dict(title='Я'*161,body='Текст',competencyIndices=[0])]*4)
        with self.assertRaisesRegex(service.Invalid,'Модуль 1.*title'):
            service.Config().material_bundle(service.normalize(curriculum()),'',complete)
        self.assertEqual(len(calls),2)

class ContentDepthTests(unittest.TestCase):
    def test_short_text_is_a_warning_and_never_claims_subject_quality(self):
        from test_service import materials
        course=service.normalize(dict(curriculum(),**materials()))
        report=service.checks(course)
        self.assertFalse(report['contentDepth']['valid'])
        self.assertIn('Модуль 1',report['contentDepth']['details'][0])
        course['modules'][0]['content']='Объяснение '*600
        course['modules'][1]['content']='Практика '*600
        self.assertTrue(service.checks(course)['contentDepth']['valid'])

class MaterialCountTests(unittest.TestCase):
    def test_generator_rejects_package_below_question_or_slide_minimum(self):
        for count_tests,count_slides in [(2,4),(3,3)]:
            def complete(system,user,schema):
                if 'explanation' in schema['properties']:return {key:'Объяснение' for key in schema['properties']}
                return dict(lecturePlan='План',tests=[dict(question='Вопрос',answer='Ключ',competencyIndices=[0])]*count_tests,tasks=[dict(text='Задание',criteria='Критерии',competencyIndices=[0])],slides=[dict(title='Слайд',body='Текст',competencyIndices=[0])]*count_slides)
            with self.subTest(tests=count_tests,slides=count_slides),self.assertRaises(service.Invalid):
                service.Config().material_bundle(service.normalize(curriculum()),'',complete)

    def test_existing_thin_materials_are_reported_as_draft(self):
        from test_service import materials
        course=service.normalize(dict(curriculum(),**materials()))
        report=service.checks(course)['materialCounts']
        self.assertFalse(report['valid'])
        self.assertTrue(any('Модуль 1' in x for x in report['details']))
