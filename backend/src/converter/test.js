const { convertToEPlaner } = require('./eplanerConverter');

console.log('==================================================');
console.log('Запуск тестов конвертера EPlaner (eplanerConverter)');
console.log('==================================================\n');

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

console.log('Тест 1: Базовая цепочка (Шаг 1 -> Переход 1 -> Шаг 2)');
const mockData1 = {
  procedureName: "Test_Procedure",
  nodes: [
    { id: "step_1", type: "technologicalStep", data: { title: "Слив", actionType: "CIP" }, position: { x: 100, y: 200 } },
    { id: "trans_1", type: "logicalTransition", data: { condition: "Level == 0" }, position: { x: 100, y: 300 } },
    { id: "step_2", type: "technologicalStep", data: { title: "Нагрев", actionType: "HEAT" }, position: { x: 100, y: 400 } }
  ],
  edges: [
    { source: "step_1", target: "trans_1" },
    { source: "trans_1", target: "step_2" }
  ]
};

const result1 = convertToEPlaner(mockData1);
assert(result1.schemaVersion === "2026.1", "Версия схемы соответствует 2026.1");
assert(result1.procedureCode === "Test_Procedure", "Название процедуры корректно");
assert(result1.algorithm.type === "SEQUENTIAL_FLOW", "Тип алгоритма SEQUENTIAL_FLOW");
assert(result1.algorithm.steps.length === 3, "Сформировано ровно 3 шага");
assert(result1.algorithm.steps[0].id === "step_1" && result1.algorithm.steps[0].type === "STEP", "Первый элемент - STEP (step_1)");
assert(result1.algorithm.steps[0].position === undefined, "Визуальные координаты отброшены");
assert(result1.algorithm.steps[0].config.action === "CIP", "Конфигурация шага 1 содержит action = CIP");
assert(result1.algorithm.steps[0].nextElementId === "trans_1", "step_1 ссылается на trans_1");
assert(result1.algorithm.steps[1].id === "trans_1" && result1.algorithm.steps[1].type === "TRANSITION", "Второй элемент - TRANSITION (trans_1)");
assert(result1.algorithm.steps[1].rules.expression === "Level == 0", "Правило перехода содержит выражение 'Level == 0'");
assert(result1.algorithm.steps[2].id === "step_2" && result1.algorithm.steps[2].nextElementId === null, "Последний шаг ссылается на null");
assert(result1.validation.isValid === true, "Схема валидна, ошибок нет");

console.log('\nТест 2: Поддержка вложенной операции (nestedOperation)');
const mockData2 = {
  procedureName: "Nested_Procedure",
  nodes: [
    { id: "op_1", type: "nestedOperation", data: { title: "Пастеризация", subGraphId: "sub_101" } },
    { id: "trans_2", type: "logicalTransition", data: { condition: "Temp >= 72" } },
    { id: "step_3", type: "technologicalStep", data: { title: "Охлаждение", actionType: "COOL" } }
  ],
  edges: [
    { source: "op_1", target: "trans_2" },
    { source: "trans_2", target: "step_3" }
  ]
};

const result2 = convertToEPlaner(mockData2);
assert(result2.validation.isValid === true, "Схема с вложенной операцией валидна");
assert(result2.algorithm.steps[0].type === "NESTED_OPERATION", "Тип первого узла - NESTED_OPERATION");
assert(result2.algorithm.steps[0].referenceSubGraphId === "sub_101", "Ссылка на под-граф sub_101 сохранена");
assert(result2.algorithm.steps[0].name === "Пастеризация", "Имя вложенной операции передано");

console.log('\nТест 3: Ветвление (альтернативные ветви со структурой и условиями)');
const mockData3 = {
  procedureName: "Branching_Procedure",
  nodes: [
    { id: "step_start", type: "technologicalStep", data: { title: "Старт", actionType: "INIT" } },
    { id: "trans_a", type: "logicalTransition", data: { condition: "SensorA == 1" } },
    { id: "step_a", type: "technologicalStep", data: { title: "Ветка A", actionType: "A" } },
    { id: "trans_b", type: "logicalTransition", data: { condition: "SensorB == 1" } },
    { id: "step_b", type: "technologicalStep", data: { title: "Ветка B", actionType: "B" } }
  ],
  edges: [
    { source: "step_start", target: "trans_a" },
    { source: "trans_a", target: "step_a" },
    { source: "step_start", target: "trans_b" },
    { source: "trans_b", target: "step_b" }
  ]
};

const result3 = convertToEPlaner(mockData3);
assert(result3.validation.isValid === true, "Схема с ветвлением валидна");
assert(result3.algorithm.type === "BRANCHED_FLOW", "Тип алгоритма определен как BRANCHED_FLOW");
assert(result3.algorithm.steps.length === 1, "В корневом потоке только узел ветвления, ветки не смешаны");
assert(result3.algorithm.steps[0].nextElementId === null, "У узла ветвления без схождения nextElementId равен null");
assert(Array.isArray(result3.algorithm.steps[0].branches) && result3.algorithm.steps[0].branches.length === 2, "Сформировано ровно 2 ветки");
assert(result3.algorithm.steps[0].branches[0].targetElementId === "trans_a", "Первая ветка начинается с trans_a");
assert(result3.algorithm.steps[0].branches[0].condition === "SensorA == 1", "Условие первой ветки сохранено");
assert(result3.algorithm.steps[0].branches[0].steps.length === 2, "В первой ветке 2 элемента (trans_a -> step_a)");
assert(result3.algorithm.steps[0].branches[0].steps[0].nextElementId === "step_a", "В первой ветке trans_a ссылается на step_a");
assert(result3.algorithm.steps[0].branches[1].targetElementId === "trans_b", "Вторая ветка начинается с trans_b");
assert(result3.algorithm.steps[0].branches[1].condition === "SensorB == 1", "Условие второй ветки сохранено");
assert(result3.algorithm.steps[0].branches[1].steps[0].nextElementId === "step_b", "Во второй ветке trans_b ссылается на step_b");

console.log('\nТест 4: Ветвление со схождением в общий узел');
const mockDataMerge = {
  procedureName: "Merge_Procedure",
  nodes: [
    { id: "step_start", type: "technologicalStep", data: { title: "Старт" } },
    { id: "trans_a", type: "logicalTransition", data: { condition: "A == 1" } },
    { id: "trans_b", type: "logicalTransition", data: { condition: "B == 1" } },
    { id: "step_end", type: "technologicalStep", data: { title: "Финиш" } }
  ],
  edges: [
    { source: "step_start", target: "trans_a" },
    { source: "step_start", target: "trans_b" },
    { source: "trans_a", target: "step_end" },
    { source: "trans_b", target: "step_end" }
  ]
};

const resultMerge = convertToEPlaner(mockDataMerge);
assert(resultMerge.validation.isValid === true, "Схема со схождением валидна");
assert(resultMerge.algorithm.steps.length === 2, "В главном потоке узел ветвления и общий узел схождения");
assert(resultMerge.algorithm.steps[0].nextElementId === "step_end", "Узел ветвления указывает на точку схождения step_end");
assert(resultMerge.algorithm.steps[1].id === "step_end", "Точка схождения идет после ветвления");

console.log('\nТест 5: Изолированный блок среди рабочих (ERR_DISCONNECTED_NODE)');
const mockData4 = {
  procedureName: "Broken_Procedure",
  nodes: [
    { id: "step_1", type: "technologicalStep", data: { title: "Шаг 1" } },
    { id: "trans_1", type: "logicalTransition", data: { condition: "Ok == 1" } },
    { id: "step_2", type: "technologicalStep", data: { title: "Шаг 2" } },
    { id: "isolated_node", type: "technologicalStep", data: { title: "Потерянный блок" } }
  ],
  edges: [
    { source: "step_1", target: "trans_1" },
    { source: "trans_1", target: "step_2" }
  ]
};

const result4 = convertToEPlaner(mockData4);
assert(result4.validation.isValid === false, "Валидация отклонила схему с висячим блоком");
assert(result4.validation.errors.some(e => e.code === "ERR_DISCONNECTED_NODE" && e.nodeId === "isolated_node"),
  "Обнаружена ошибка ERR_DISCONNECTED_NODE для isolated_node");

console.log('\nТест 6: Пустой граф');
const resultEmpty = convertToEPlaner({ procedureName: "Empty", nodes: [], edges: [] });
assert(resultEmpty.validation.isValid === true, "Пустой граф валиден");
assert(resultEmpty.algorithm.steps.length === 0, "Список шагов пуст");

console.log('\nТест 7: Один изолированный рабочий узел');
const resultSingle = convertToEPlaner({
  procedureName: "Single",
  nodes: [{ id: "only_step", type: "technologicalStep", data: { title: "Единственный шаг" } }],
  edges: []
});
assert(resultSingle.validation.isValid === true, "Схема из одного шага валидна");
assert(resultSingle.algorithm.steps.length === 1 && resultSingle.algorithm.steps[0].nextElementId === null,
  "Единственный шаг сформирован с nextElementId = null");

console.log('\nТест 8: Некорректный JSON на входе');
const resultInvalidJson = convertToEPlaner("{ invalid json");
assert(resultInvalidJson.validation.isValid === false, "Некорректный JSON отклонен");
assert(resultInvalidJson.validation.errors.some(e => e.code === "ERR_INVALID_JSON"), "Код ошибки ERR_INVALID_JSON");

console.log('\nТест 9: Отсутствующий исходный и целевой узлы ребра');
const resultMissingNodes = convertToEPlaner({
  procedureName: "Missing_Edge_Nodes",
  nodes: [{ id: "step_1", type: "technologicalStep" }],
  edges: [
    { id: "e1", source: "step_1", target: "step_999" },
    { id: "e2", source: "step_888", target: "step_1" }
  ]
});
assert(resultMissingNodes.validation.isValid === false, "Схема с битыми ребрами отклонена");
assert(resultMissingNodes.validation.errors.some(e => e.code === "ERR_MISSING_TARGET_NODE" && e.targetId === "step_999"),
  "Обнаружена ошибка ERR_MISSING_TARGET_NODE");
assert(resultMissingNodes.validation.errors.some(e => e.code === "ERR_MISSING_SOURCE_NODE" && e.sourceId === "step_888"),
  "Обнаружена ошибка ERR_MISSING_SOURCE_NODE");

console.log('\nТест 10: Некорректное или пустое ребро');
const resultInvalidEdge = convertToEPlaner({
  procedureName: "Invalid_Edge",
  nodes: [{ id: "step_1", type: "technologicalStep" }],
  edges: [null, { source: "step_1" }]
});
assert(resultInvalidEdge.validation.isValid === false, "Некорректные ребра отклонены");
assert(resultInvalidEdge.validation.errors.filter(e => e.code === "ERR_INVALID_EDGE").length === 2,
  "Обнаружены ошибки ERR_INVALID_EDGE");

console.log('\nТест 11: Повторяющиеся ID узлов');
const resultDuplicate = convertToEPlaner({
  procedureName: "Duplicate_Nodes",
  nodes: [
    { id: "step_1", type: "technologicalStep", data: { title: "Первый" } },
    { id: "step_1", type: "technologicalStep", data: { title: "Дубль" } }
  ],
  edges: []
});
assert(resultDuplicate.validation.isValid === false, "Схема с дублирующимися ID отклонена");
assert(resultDuplicate.validation.errors.some(e => e.code === "ERR_DUPLICATE_NODE_ID" && e.nodeId === "step_1"),
  "Обнаружена ошибка ERR_DUPLICATE_NODE_ID");

console.log('\nТест 12: Несколько начальных узлов');
const resultMultiStart = convertToEPlaner({
  procedureName: "Multi_Start",
  nodes: [
    { id: "s1", type: "technologicalStep" },
    { id: "t1", type: "logicalTransition" },
    { id: "s2", type: "technologicalStep" },
    { id: "t2", type: "logicalTransition" }
  ],
  edges: [
    { source: "s1", target: "t1" },
    { source: "s2", target: "t2" }
  ]
});
assert(resultMultiStart.validation.isValid === false, "Несколько независимых точек входа отклонены");
assert(resultMultiStart.validation.errors.some(e => e.code === "ERR_MULTIPLE_ENTRY_POINTS"),
  "Обнаружена ошибка ERR_MULTIPLE_ENTRY_POINTS");

console.log('\nТест 13: Циклические связи и недостижимые узлы');
const resultCycleFromStart = convertToEPlaner({
  procedureName: "Cycle_From_Start",
  nodes: [
    { id: "s1", type: "technologicalStep" },
    { id: "t1", type: "logicalTransition" },
    { id: "s2", type: "technologicalStep" },
    { id: "t2", type: "logicalTransition" }
  ],
  edges: [
    { source: "s1", target: "t1" },
    { source: "t1", target: "s2" },
    { source: "s2", target: "t2" },
    { source: "t2", target: "s2" }
  ]
});
assert(resultCycleFromStart.validation.isValid === false, "Достижимый цикл обнаружен");
assert(resultCycleFromStart.validation.errors.some(e => e.code === "ERR_CYCLE_DETECTED"),
  "Обнаружена ошибка ERR_CYCLE_DETECTED для цикла после старта");

const resultPureCycleAndUnreachable = convertToEPlaner({
  procedureName: "Cycle_And_Island",
  nodes: [
    { id: "s1", type: "technologicalStep" },
    { id: "t1", type: "logicalTransition" },
    { id: "c1", type: "technologicalStep" },
    { id: "c2", type: "logicalTransition" }
  ],
  edges: [
    { source: "s1", target: "t1" },
    { source: "c1", target: "c2" },
    { source: "c2", target: "c1" }
  ]
});
assert(resultPureCycleAndUnreachable.validation.isValid === false, "Изолированный цикл отклонен");
assert(resultPureCycleAndUnreachable.validation.errors.some(e => e.code === "ERR_CYCLE_DETECTED"),
  "Обнаружен цикл в изолированном фрагменте");
assert(resultPureCycleAndUnreachable.validation.errors.some(e => e.code === "ERR_UNREACHABLE_NODE"),
  "Обнаружены недостижимые узлы (ERR_UNREACHABLE_NODE)");

console.log('\nТест 14: Комментарии');
const resultComments = convertToEPlaner({
  procedureName: "With_Comments",
  nodes: [
    { id: "c1", type: "CommentNode", data: { text: "Пояснение" } },
    { id: "s1", type: "technologicalStep", data: { title: "Шаг" } },
    { id: "t1", type: "logicalTransition", data: { condition: "x > 0" } }
  ],
  edges: [
    { source: "s1", target: "t1" }
  ]
});
assert(resultComments.validation.isValid === true, "Свободный комментарий не ломает валидацию");
assert(resultComments.algorithm.steps.length === 2, "Комментарий не попадает в steps");

const resultOnlyComments = convertToEPlaner({
  procedureName: "Only_Comments",
  nodes: [{ id: "c1", type: "comment", data: { text: "Заметка" } }],
  edges: []
});
assert(resultOnlyComments.validation.isValid === true && resultOnlyComments.algorithm.steps.length === 0,
  "Схема только с комментариями не вызывает ложной ошибки цикла");

console.log('\nТест 15: Недопустимые соединения между типами блоков');
const resultBadConn = convertToEPlaner({
  procedureName: "Bad_Connection",
  nodes: [
    { id: "s1", type: "technologicalStep" },
    { id: "s2", type: "technologicalStep" }
  ],
  edges: [
    { source: "s1", target: "s2" }
  ]
});
assert(resultBadConn.validation.isValid === false, "Соединение Шаг -> Шаг отклонено");
assert(resultBadConn.validation.errors.some(e => e.code === "ERR_INVALID_CONNECTION"),
  "Код ошибки ERR_INVALID_CONNECTION");

console.log('\n==================================================');
console.log(`Итоги тестирования: ${passedTests} из ${totalTests} тестов пройдено успешно.`);
if (passedTests !== totalTests) {
  console.log('Есть ошибки, требуется доработка.');
  process.exitCode = 1;
} else {
  console.log('Все тесты пройдены успешно.');
}
console.log('==================================================\n');
