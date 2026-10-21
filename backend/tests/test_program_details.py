import unittest
from backend import service
from test_curriculum import curriculum

class ProgramDetailsTests(unittest.TestCase):
    def test_legacy_has_explicit_final_readiness_gaps(self):
        course=service.normalize(curriculum())
        self.assertFalse(service.checks(course)['programSections']['valid'])
        self.assertFalse(service.checks(course)['professionalStandards']['valid'])
        course['type']='Общеразвивающая'
        self.assertTrue(service.checks(course)['professionalStandards']['valid'])

    def test_optional_metadata_roundtrip_and_bounds(self):
        raw=curriculum()
        raw['programDetails']={'calendarSchedule':'Неделя 1: 16 часов'}
        raw['competencyMap'][0]['professionalStandard']={'title':'Стандарт','status':'unverified'}
        course=service.normalize(raw)
        self.assertEqual(course['programDetails'],raw['programDetails'])
        self.assertEqual(course['competencyMap'][0]['professionalStandard']['title'],'Стандарт')
        raw['programDetails']['calendarSchedule']='x'*4001
        with self.assertRaises(service.Invalid):service.normalize(raw)

    def test_confirmed_standard_needs_official_identifiers_and_evidence(self):
        raw=curriculum()
        raw['competencyMap'][0]['professionalStandard']={'title':'Стандарт','status':'confirmed','url':'https://example.org/fake','evidence':'Да'}
        with self.assertRaises(service.Invalid):service.normalize(raw)

    def test_model_cannot_invent_manual_confirmation_or_erase_existing_mapping(self):
        import copy
        course=service.normalize(curriculum())
        course['programDetails']={'calendarSchedule':'Неделя 1'}
        course['competencyMap'][0]['professionalStandard']={'title':'Ручная запись','status':'unverified'}
        result=copy.deepcopy(course)
        result['competencyMap'][0]['professionalStandard']={'title':'Подмена','status':'confirmed'}
        patch=service.proposal_patch('skeleton',course,result)
        self.assertEqual(patch['competencyMap'][0]['professionalStandard']['title'],'Ручная запись')
        self.assertEqual(patch['programDetails'],course['programDetails'])

    def test_short_lesson_fails_before_second_paid_call(self):
        calls=[]
        def complete(system,user,schema):
            calls.append(1)
            return {key:'Очень кратко' for key in schema['properties']}
        with self.assertRaisesRegex(service.Invalid,'600'):
            service.Config().material_bundle(service.normalize(curriculum()),'',complete)
        self.assertEqual(len(calls),1)

    def test_changed_outcomes_cannot_bypass_manual_map_guard_by_omitting_map(self):
        course=service.normalize(curriculum())
        course['competencyMap'][0]['professionalStandard']={'title':'Ручная запись','status':'unverified'}
        result={key:course[key] for key in ['goal','modules']}
        result['competencies']=['Подменённый результат']
        with self.assertRaises(service.Invalid):service.proposal_patch('skeleton',course,result)

    def test_supported_hour_classes_and_profiles_keep_exact_sums(self):
        from backend.planning import allocate
        from backend.curriculum import HOUR_FIELDS
        for kind in ['Повышение квалификации','Общеразвивающая','Стажировка']:
            for hours in [16,24,72,248,500]:
                with self.subTest(kind=kind,hours=hours):
                    raw=curriculum();raw.update(type=kind,hours=hours)
                    for module,value in zip(raw['modules'],allocate(hours,[1,1])):
                        module['hours']=value
                        module['topics'][0].update(dict(zip(HOUR_FIELDS,allocate(value,[1,2,0,1,1]))))
                    course=service.normalize(raw)
                    self.assertTrue(service.checks(course)['hours']['valid'])
                    self.assertTrue(service.checks(course)['topicHours']['valid'])

    def test_malformed_metadata_is_rejected_without_migration(self):
        for details in [None,[],{'unknown':'value'},{'calendarSchedule':42}]:
            with self.subTest(details=details):
                raw=curriculum();raw['programDetails']=details
                with self.assertRaises(service.Invalid):service.normalize(raw)

    def test_manual_final_metadata_does_not_change_learning_skeleton(self):
        import copy
        from backend.curriculum import skeleton_identity
        course=service.normalize(curriculum());changed=copy.deepcopy(course)
        changed['programDetails']={'calendarSchedule':'Неделя 1'}
        changed['competencyMap'][0]['professionalStandard']={'title':'Заполняется позже','status':'unverified'}
        self.assertEqual(skeleton_identity(course),skeleton_identity(changed))

    def test_confirmed_standard_requires_concrete_document_and_identifier_shape(self):
        # Synthetic test data: passing structural validation never establishes legal truth.
        raw=curriculum();standard=dict(title='Синтетический стандарт для проверки структуры',code='06.001',functionCode='A/01.6',url='https://publication.pravo.gov.ru/document/test-only',evidence='Тестовое свидетельство ручной проверки',status='confirmed')
        raw['competencyMap'][0]['professionalStandard']=standard
        self.assertEqual(service.normalize(raw)['competencyMap'][0]['professionalStandard']['status'],'confirmed')
        for key,value in [('code','fake'),('functionCode','fake'),('url','https://publication.pravo.gov.ru/')]:
            broken=dict(standard,**{key:value});raw['competencyMap'][0]['professionalStandard']=broken
            with self.subTest(key=key):
                with self.assertRaises(service.Invalid):service.normalize(raw)

    def test_official_url_with_fake_book_title_is_not_normative_evidence(self):
        course=service.normalize(curriculum())
        course['sources']=[dict(title='Обычный учебник',url='https://publication.pravo.gov.ru/document/0001202504230011',status='confirmed',evidence='Проверил учебник')]
        self.assertFalse(service.checks(course)['normativeBasis']['valid'])
        self.assertTrue(any('266' in x for x in service.checks(course)['normativeBasis']['details']))
