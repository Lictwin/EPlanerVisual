function isCommentNode(node) {
  return Boolean(node && (node.type === 'comment' || node.type === 'CommentNode'));
}

function getNodeCategory(node) {
  if (!node) return 'OTHER';
  const t = node.type || '';
  if (
    t === 'technologicalStep' ||
    t === 'step' ||
    t === 'StepNode' ||
    t === 'nestedOperation' ||
    t === 'operation' ||
    t === 'OperationNode'
  ) {
    return 'STEP';
  }
  if (t === 'logicalTransition' || t === 'transition' || t === 'TransitionNode') {
    return 'TRANSITION';
  }
  if (isCommentNode(node)) {
    return 'COMMENT';
  }
  return 'OTHER';
}

function getNodeLabel(node) {
  if (!node) return '';
  if (node.data && (node.data.title || node.data.label || node.data.name)) {
    return node.data.title || node.data.label || node.data.name;
  }
  return node.id || '';
}

function formatNode(node, order, nextElementId, branches = null) {
  if (!node) return null;

  const nodeType = node.type || '';
  const data = node.data || {};

  if (nodeType === 'technologicalStep' || nodeType === 'step' || nodeType === 'StepNode') {
    const item = {
      id: node.id,
      sequenceOrder: order,
      name: data.title || data.label || data.name || `Шаг ${order}`,
      type: "STEP",
      config: {
        action: data.actionType || data.action || "DEFAULT"
      },
      nextElementId: nextElementId
    };
    if (branches && branches.length > 0) {
      item.branches = branches;
    }
    return item;
  }

  if (nodeType === 'logicalTransition' || nodeType === 'transition' || nodeType === 'TransitionNode') {
    const item = {
      id: node.id,
      sequenceOrder: order,
      type: "TRANSITION",
      rules: {
        expression: data.condition || (data.rules && data.rules.expression) || "true"
      },
      nextElementId: nextElementId
    };
    if (branches && branches.length > 0) {
      item.branches = branches;
    }
    return item;
  }

  if (nodeType === 'nestedOperation' || nodeType === 'operation' || nodeType === 'OperationNode') {
    const item = {
      id: node.id,
      sequenceOrder: order,
      name: data.title || data.label || data.name || `Операция ${order}`,
      type: "NESTED_OPERATION",
      referenceSubGraphId: data.subGraphId || data.referenceSubGraphId || node.id,
      nextElementId: nextElementId
    };
    if (branches && branches.length > 0) {
      item.branches = branches;
    }
    return item;
  }

  if (isCommentNode(node)) {
    return null;
  }

  const item = {
    id: node.id,
    sequenceOrder: order,
    name: data.title || data.label || node.id,
    type: (data.type || nodeType || "STEP").toUpperCase(),
    nextElementId: nextElementId
  };
  if (branches && branches.length > 0) {
    item.branches = branches;
  }
  return item;
}

function collectReachable(startId, outgoingMap) {
  const reachable = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const curr = stack.pop();
    if (reachable.has(curr)) continue;
    reachable.add(curr);
    const out = outgoingMap.get(curr) || [];
    for (const edgeObj of out) {
      if (!reachable.has(edgeObj.target)) {
        stack.push(edgeObj.target);
      }
    }
  }
  return reachable;
}

function convertToEPlaner(rawCanvasData) {
  let data = rawCanvasData;

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      return {
        schemaVersion: "2026.1",
        procedureCode: "Invalid_Procedure",
        algorithm: {
          type: "SEQUENTIAL_FLOW",
          steps: []
        },
        validation: {
          isValid: false,
          errors: [{ code: "ERR_INVALID_JSON", message: "Некорректный формат JSON входных данных" }]
        }
      };
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      schemaVersion: "2026.1",
      procedureCode: "Invalid_Procedure",
      algorithm: {
        type: "SEQUENTIAL_FLOW",
        steps: []
      },
      validation: {
        isValid: false,
        errors: [{ code: "ERR_INVALID_CANVAS_DATA", message: "Данные схемы должны быть объектом" }]
      }
    };
  }

  if ((data.nodes !== undefined && !Array.isArray(data.nodes)) || (data.edges !== undefined && !Array.isArray(data.edges))) {
    return {
      schemaVersion: "2026.1",
      procedureCode: data.procedureName || data.procedureCode || data.name || "Invalid_Procedure",
      algorithm: {
        type: "SEQUENTIAL_FLOW",
        steps: []
      },
      validation: {
        isValid: false,
        errors: [{ code: "ERR_INVALID_CANVAS_DATA", message: "Поля nodes и edges должны быть массивами" }]
      }
    };
  }

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const errors = [];
  const procedureCode = data.procedureName || data.procedureCode || data.name || "New_Procedure";

  const nodeMap = new Map();
  const duplicateIds = new Set();

  nodes.forEach((node, index) => {
    if (!node || typeof node !== 'object' || !node.id || typeof node.id !== 'string') {
      errors.push({
        code: "ERR_INVALID_NODE",
        nodeIndex: index,
        message: `Узел с индексом ${index} не имеет корректного строкового ID`
      });
      return;
    }

    if (nodeMap.has(node.id)) {
      if (!duplicateIds.has(node.id)) {
        duplicateIds.add(node.id);
        errors.push({
          code: "ERR_DUPLICATE_NODE_ID",
          nodeId: node.id,
          message: `Обнаружен дублирующийся ID узла "${node.id}"`
        });
      }
      return;
    }

    nodeMap.set(node.id, node);
  });

  const outgoingMap = new Map();
  const incomingMap = new Map();

  edges.forEach((edge, index) => {
    if (!edge || typeof edge !== 'object' || !edge.source || !edge.target) {
      errors.push({
        code: "ERR_INVALID_EDGE",
        edgeId: edge && edge.id ? edge.id : `edge_${index}`,
        message: "Обнаружено некорректное или пустое ребро без source или target"
      });
      return;
    }

    const sourceExists = nodeMap.has(edge.source);
    const targetExists = nodeMap.has(edge.target);

    if (!sourceExists) {
      errors.push({
        code: "ERR_MISSING_SOURCE_NODE",
        edgeId: edge.id || `edge_${index}`,
        sourceId: edge.source,
        targetId: edge.target,
        message: `Ребро ссылается на несуществующий исходный узел "${edge.source}"`
      });
    }

    if (!targetExists) {
      errors.push({
        code: "ERR_MISSING_TARGET_NODE",
        edgeId: edge.id || `edge_${index}`,
        sourceId: edge.source,
        targetId: edge.target,
        message: `Ребро ссылается на несуществующий целевой узел "${edge.target}"`
      });
    }

    if (!sourceExists || !targetExists) {
      return;
    }

    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (isCommentNode(sourceNode) || isCommentNode(targetNode)) {
      errors.push({
        code: "ERR_COMMENT_CONNECTION",
        edgeId: edge.id || `edge_${index}`,
        sourceId: edge.source,
        targetId: edge.target,
        message: "Комментарий не может участвовать в логических связях алгоритма"
      });
      return;
    }

    const srcCat = getNodeCategory(sourceNode);
    const tgtCat = getNodeCategory(targetNode);

    if ((srcCat === 'STEP' && tgtCat === 'STEP') || (srcCat === 'TRANSITION' && tgtCat === 'TRANSITION')) {
      errors.push({
        code: "ERR_INVALID_CONNECTION",
        edgeId: edge.id || `edge_${index}`,
        sourceId: edge.source,
        targetId: edge.target,
        message: `Недопустимое соединение между блоками типа ${srcCat} ("${edge.source}" -> "${edge.target}")`
      });
    }

    if (!outgoingMap.has(edge.source)) outgoingMap.set(edge.source, []);
    outgoingMap.get(edge.source).push({ target: edge.target, edge });

    if (!incomingMap.has(edge.target)) incomingMap.set(edge.target, []);
    incomingMap.get(edge.target).push({ source: edge.source, edge });
  });

  const logicalNodes = Array.from(nodeMap.values()).filter(n => !isCommentNode(n));

  if (logicalNodes.length === 0) {
    return {
      schemaVersion: "2026.1",
      procedureCode: procedureCode,
      algorithm: {
        type: "SEQUENTIAL_FLOW",
        steps: []
      },
      validation: {
        isValid: errors.length === 0,
        errors: errors
      }
    };
  }

  logicalNodes.forEach(node => {
    const hasIn = (incomingMap.get(node.id) || []).length > 0;
    const hasOut = (outgoingMap.get(node.id) || []).length > 0;

    if (!hasIn && !hasOut && logicalNodes.length > 1) {
      errors.push({
        code: "ERR_DISCONNECTED_NODE",
        nodeId: node.id,
        message: `Узел "${getNodeLabel(node)}" не соединен со схемой`
      });
    }
  });

  const startNodes = logicalNodes.filter(node => {
    const incoming = incomingMap.get(node.id) || [];
    return incoming.length === 0;
  });

  if (startNodes.length === 0) {
    errors.push({
      code: "ERR_CYCLE_NO_ENTRY",
      message: "В схеме обнаружена циклическая зависимость без явной точки входа"
    });
  } else if (startNodes.length > 1) {
    const connectedStarts = startNodes.filter(node => {
      const hasOut = (outgoingMap.get(node.id) || []).length > 0;
      return hasOut;
    });
    if (connectedStarts.length > 1) {
      errors.push({
        code: "ERR_MULTIPLE_ENTRY_POINTS",
        nodeIds: connectedStarts.map(n => n.id),
        message: `Обнаружено несколько точек входа в процедуру: ${connectedStarts.map(n => n.id).join(', ')}`
      });
    }
  }

  const color = new Map();
  const reportedCycles = new Set();

  function detectCycles(nodeId) {
    color.set(nodeId, 1);
    const out = outgoingMap.get(nodeId) || [];
    for (const edgeObj of out) {
      const nextId = edgeObj.target;
      const state = color.get(nextId) || 0;
      if (state === 1) {
        const key = `${nodeId}->${nextId}`;
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push({
            code: "ERR_CYCLE_DETECTED",
            fromNodeId: nodeId,
            toNodeId: nextId,
            message: `Обнаружена циклическая связь от "${nodeId}" к "${nextId}"`
          });
        }
      } else if (state === 0) {
        detectCycles(nextId);
      }
    }
    color.set(nodeId, 2);
  }

  startNodes.forEach(n => {
    if (!color.has(n.id)) {
      detectCycles(n.id);
    }
  });
  logicalNodes.forEach(n => {
    if (!color.has(n.id)) {
      detectCycles(n.id);
    }
  });

  const reachableFromEntry = startNodes.length > 0
    ? collectReachable(startNodes[0].id, outgoingMap)
    : new Set();

  if (startNodes.length > 0) {
    logicalNodes.forEach(node => {
      if (!reachableFromEntry.has(node.id)) {
        const alreadyReported = errors.some(
          e => e.nodeId === node.id || (Array.isArray(e.nodeIds) && e.nodeIds.includes(node.id))
        );
        if (!alreadyReported) {
          errors.push({
            code: "ERR_UNREACHABLE_NODE",
            nodeId: node.id,
            message: `Узел "${getNodeLabel(node)}" недостижим из начальной точки`
          });
        }
      }
    });
  }

  let hasBranches = false;

  function findMergeNode(branchTargets) {
    if (branchTargets.length < 2) return null;
    const reachSets = branchTargets.map(t => collectReachable(t, outgoingMap));
    const firstSet = reachSets[0];
    for (const candidate of firstSet) {
      if (branchTargets.includes(candidate)) continue;
      if (reachSets.every(s => s.has(candidate))) {
        return candidate;
      }
    }
    return null;
  }

  function buildFlow(entryId, activePath = new Set(), stopAtId = null) {
    const flowSteps = [];
    let currentId = entryId;
    let order = 1;

    while (currentId) {
      if (stopAtId && currentId === stopAtId) {
        break;
      }
      if (activePath.has(currentId)) {
        break;
      }

      const currentNode = nodeMap.get(currentId);
      if (!currentNode) break;

      activePath.add(currentId);
      const outEdges = outgoingMap.get(currentId) || [];

      if (outEdges.length === 0) {
        const item = formatNode(currentNode, order, null);
        if (item) flowSteps.push(item);
        currentId = null;
      } else if (outEdges.length === 1) {
        const nextId = outEdges[0].target;
        const isCycleLink = activePath.has(nextId);
        const item = formatNode(currentNode, order, nextId);
        if (item) {
          if (isCycleLink) item.isCycleLink = true;
          flowSteps.push(item);
        }
        order++;
        if (isCycleLink || (stopAtId && nextId === stopAtId)) {
          currentId = null;
        } else {
          currentId = nextId;
        }
      } else {
        hasBranches = true;
        const targets = outEdges.map(e => e.target);
        const mergeNodeId = findMergeNode(targets);

        const branches = outEdges.map((edgeObj, idx) => {
          const targetNode = nodeMap.get(edgeObj.target);
          const edgeCondition =
            edgeObj.edge.label ||
            (edgeObj.edge.data && edgeObj.edge.data.condition) ||
            (targetNode && getNodeCategory(targetNode) === 'TRANSITION' && targetNode.data && targetNode.data.condition) ||
            null;

          const branchPath = new Set(activePath);
          const branchSteps = buildFlow(edgeObj.target, branchPath, mergeNodeId);

          const branchObj = {
            branchId: `branch_${idx + 1}`,
            targetElementId: edgeObj.target,
            steps: branchSteps
          };
          if (edgeCondition) {
            branchObj.condition = edgeCondition;
          }
          return branchObj;
        });

        const item = formatNode(currentNode, order, mergeNodeId, branches);
        if (item) {
          flowSteps.push(item);
        }
        order++;

        if (mergeNodeId && !activePath.has(mergeNodeId) && (!stopAtId || mergeNodeId !== stopAtId)) {
          currentId = mergeNodeId;
        } else {
          currentId = null;
        }
      }
    }

    return flowSteps;
  }

  let steps = [];
  if (startNodes.length > 0) {
    steps = buildFlow(startNodes[0].id);
  }

  return {
    schemaVersion: "2026.1",
    procedureCode: procedureCode,
    algorithm: {
      type: hasBranches ? "BRANCHED_FLOW" : "SEQUENTIAL_FLOW",
      steps: steps
    },
    validation: {
      isValid: errors.length === 0,
      errors: errors
    }
  };
}

module.exports = {
  convertToEPlaner
};
