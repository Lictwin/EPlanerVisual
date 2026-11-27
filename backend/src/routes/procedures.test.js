const { PrismaClient } = require('@prisma/client');
const app = require('../index');

const prisma = new PrismaClient();

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${testName}`);
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('Запуск интеграционных тестов API и SQLite');
  console.log('==================================================\n');

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const { port } = server.address();
  const baseUrl = `http://localhost:${port}/api/procedures`;
  const createdIds = [];

  try {
    console.log('1. Проверка валидации входных параметров и CRUD процедур');

    const badParentQuery = await fetch(`${baseUrl}?parentId=abc`);
    assert(badParentQuery.status === 400, 'GET ?parentId=abc возвращает HTTP 400');

    const badIdGet = await fetch(`${baseUrl}/abc`);
    assert(badIdGet.status === 400, 'GET /api/procedures/abc возвращает HTTP 400');

    const notFoundGet = await fetch(`${baseUrl}/999999`);
    assert(notFoundGet.status === 404, 'GET несуществующей процедуры возвращает HTTP 404');

    const badPostId = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'abc', name: 'Test', raw_canvas_data: {} })
    });
    assert(badPostId.status === 400, 'POST с нечисловым id="abc" возвращает HTTP 400');

    const badPostName = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ', raw_canvas_data: {} })
    });
    assert(badPostName.status === 400, 'POST с пустым именем возвращает HTTP 400');

    const badPostCanvas = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', raw_canvas_data: '{bad json' })
    });
    assert(badPostCanvas.status === 400, 'POST с битым JSON в raw_canvas_data возвращает HTTP 400');

    const validCanvas = {
      procedureName: 'CIP_Flow',
      nodes: [
        { id: 's1', type: 'technologicalStep', data: { title: 'Мойка', actionType: 'CIP' } },
        { id: 't1', type: 'logicalTransition', data: { condition: 'Time > 10' } },
        { id: 's2', type: 'technologicalStep', data: { title: 'Стоп', actionType: 'STOP' } }
      ],
      edges: [
        { source: 's1', target: 't1' },
        { source: 't1', target: 's2' }
      ]
    };

    const createRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Основная процедура', raw_canvas_data: validCanvas })
    });
    const createBody = await createRes.json();
    assert(createRes.status === 201, 'Создание процедуры возвращает HTTP 201');
    assert(createBody.procedure && typeof createBody.procedure.id === 'number', 'Возвращен числовой ID созданной процедуры');
    const procId = createBody.procedure.id;
    createdIds.push(procId);
    const initialUpdatedAt = createBody.procedure.updated_at;

    const listRes = await fetch(baseUrl);
    const listBody = await listRes.json();
    assert(listRes.status === 200 && Array.isArray(listBody), 'GET /api/procedures возвращает массив');
    assert(listBody.some(p => p.id === procId), 'Созданная процедура присутствует в общем списке');

    const getRes = await fetch(`${baseUrl}/${procId}`);
    const getBody = await getRes.json();
    assert(getRes.status === 200 && getBody.name === 'Основная процедура', 'GET по ID возвращает процедуру');
    assert(getBody.raw_canvas_data.nodes.length === 3, 'Исходный граф сохранен корректно');
    assert(getBody.eplaner_ready_data.algorithm.steps.length === 3, 'EPlaner JSON сохранен согласованно');

    await new Promise(r => setTimeout(r, 20));
    const partialUpdateRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: procId, name: 'Обновленная процедура' })
    });
    const partialUpdateBody = await partialUpdateRes.json();
    assert(partialUpdateRes.status === 200, 'Обновление существующей процедуры возвращает HTTP 200');
    assert(partialUpdateBody.procedure.name === 'Обновленная процедура', 'Имя процедуры обновлено');
    assert(partialUpdateBody.procedure.updated_at !== initialUpdatedAt, 'Поле updated_at обновилось');

    const afterPartialGet = await (await fetch(`${baseUrl}/${procId}`)).json();
    assert(afterPartialGet.raw_canvas_data.nodes.length === 3, 'Частичное обновление не затерло raw_canvas_data');

    console.log('\n2. Проверка вложенности (parent_id, циклы, каскадное удаление)');

    const childRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Дочерняя процедура',
        parent_id: procId,
        raw_canvas_data: validCanvas
      })
    });
    const childBody = await childRes.json();
    assert(childRes.status === 201 && childBody.procedure.parent_id === procId, 'Дочерняя процедура создана с parent_id');
    const childId = childBody.procedure.id;
    createdIds.push(childId);

    const childrenList = await (await fetch(`${baseUrl}?parentId=${procId}`)).json();
    assert(childrenList.length === 1 && childrenList[0].id === childId, 'Фильтр ?parentId возвращает дочерние процедуры');

    const parentWithSubs = await (await fetch(`${baseUrl}/${procId}`)).json();
    assert(Array.isArray(parentWithSubs.sub_procedures) && parentWithSubs.sub_procedures.length === 1,
      'Загрузка родителя включает список sub_procedures');

    const selfParentRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: procId, parent_id: procId })
    });
    assert(selfParentRes.status === 400, 'Запрет назначения процедуры родителем самой себя');

    const cycleParentRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: procId, parent_id: childId })
    });
    assert(cycleParentRes.status === 400, 'Запрет циклической иерархии вложенных процедур');

    const missingParentRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Осиротевшая', parent_id: 999999 })
    });
    assert(missingParentRes.status === 400, 'Запрет ссылки на несуществующего родителя');

    const unlinkRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: childId, parent_id: null })
    });
    const unlinkBody = await unlinkRes.json();
    assert(unlinkRes.status === 200 && unlinkBody.procedure.parent_id === null, 'Передача parent_id: null удаляет родительскую связь');

    const relinkRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: childId, parent_id: procId })
    });
    assert(relinkRes.status === 200 && (await relinkRes.json()).procedure.parent_id === procId, 'Повторная привязка к родителю работает');

    console.log('\n3. Проверка экспорта (/export)');

    const exportRes = await fetch(`${baseUrl}/${procId}/export`);
    const exportBody = await exportRes.json();
    assert(exportRes.status === 200 && exportBody.algorithm.steps.length === 3, 'Экспорт валидной процедуры возвращает алгоритм');

    const downloadRes = await fetch(`${baseUrl}/${procId}/export?download=true`);
    const contentDisp = downloadRes.headers.get('content-disposition') || '';
    const downloadText = await downloadRes.text();
    assert(downloadRes.status === 200 && contentDisp.includes('attachment'), 'Экспорт с download=true отдает файл');
    assert(JSON.parse(downloadText).schemaVersion === '2026.1', 'Скачанный файл содержит валидный JSON EPlaner');

    const invalidGraphRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Схема с ошибкой',
        raw_canvas_data: {
          nodes: [
            { id: 'n1', type: 'technologicalStep' },
            { id: 'n2', type: 'technologicalStep' }
          ],
          edges: []
        }
      })
    });
    const invalidProcId = (await invalidGraphRes.json()).procedure.id;
    createdIds.push(invalidProcId);

    const exportInvalidRes = await fetch(`${baseUrl}/${invalidProcId}/export`);
    const exportInvalidBody = await exportInvalidRes.json();
    assert(exportInvalidRes.status === 400 && exportInvalidBody.code === 'ERR_VALIDATION_FAILED',
      'Экспорт схемы с ошибками валидации возвращает HTTP 400 и ERR_VALIDATION_FAILED');

    const corruptedProc = await prisma.procedure.create({
      data: {
        name: 'Поврежденная запись',
        raw_canvas_data: '{broken json'
      }
    });
    createdIds.push(corruptedProc.id);

    const exportCorruptedRes = await fetch(`${baseUrl}/${corruptedProc.id}/export`);
    const exportCorruptedBody = await exportCorruptedRes.json();
    assert(exportCorruptedRes.status === 422 && exportCorruptedBody.code === 'ERR_INVALID_CANVAS_DATA',
      'Экспорт поврежденных данных в БД возвращает HTTP 422 и ERR_INVALID_CANVAS_DATA');

    console.log('\n4. Проверка DELETE и каскадного удаления');

    const badDeleteRes = await fetch(`${baseUrl}/abc`, { method: 'DELETE' });
    assert(badDeleteRes.status === 400, 'DELETE с некорректным ID возвращает HTTP 400');

    const notFoundDeleteRes = await fetch(`${baseUrl}/999999`, { method: 'DELETE' });
    assert(notFoundDeleteRes.status === 404, 'DELETE несуществующей процедуры возвращает HTTP 404');

    const deleteParentRes = await fetch(`${baseUrl}/${procId}`, { method: 'DELETE' });
    assert(deleteParentRes.status === 200, 'DELETE существующей процедуры возвращает HTTP 200');

    const checkChildAfterDelete = await fetch(`${baseUrl}/${childId}`);
    assert(checkChildAfterDelete.status === 404, 'Дочерняя процедура удалена каскадно вместе с родителем');
  } finally {
    for (const id of createdIds) {
      await prisma.procedure.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n==================================================');
  console.log(`Итоги API тестов: ${passedTests} из ${totalTests} пройдено успешно.`);
  if (passedTests !== totalTests) {
    console.log('Есть ошибки в API тестах.');
    process.exitCode = 1;
  } else {
    console.log('Все API тесты пройдены успешно.');
  }
  console.log('==================================================\n');
}

runTests().catch((err) => {
  console.error('Критическая ошибка запуска тестов:', err);
  process.exitCode = 1;
});
