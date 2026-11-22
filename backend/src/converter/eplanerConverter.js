function formatNode(node, order, primaryNext, allTargets = []) {
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
      nextElementId: primaryNext
    };
    if (allTargets.length > 1) {
      item.branches = allTargets;
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
      nextElementId: primaryNext
    };
    if (allTargets.length > 1) {
      item.branches = allTargets;
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
      nextElementId: primaryNext
    };
    if (allTargets.length > 1) {
      item.branches = allTargets;
    }
    return item;
  }

  if (nodeType === 'comment' || nodeType === 'CommentNode') {
    return null;
  }

  const item = {
    id: node.id,
    sequenceOrder: order,
    name: data.title || data.label || node.id,
    type: (data.type || nodeType || "STEP").toUpperCase(),
    nextElementId: primaryNext
  };
  if (allTargets.length > 1) {
    item.branches = allTargets;
  }
  return item;
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

  data = data || {};
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const errors = [];

  if (nodes.length === 0) {
    return {
      schemaVersion: "2026.1",
      procedureCode: data.procedureName || data.name || "New_Procedure",
      algorithm: {
        type: "SEQUENTIAL_FLOW",
        steps: []
      },
      validation: {
        isValid: true,
        errors: []
      }
    };
  }

  const nodeMap = new Map();
  nodes.forEach(node => {
    if (node && node.id) {
      nodeMap.set(node.id, node);
    }
  });

  const outgoingMap = new Map();
  const incomingMap = new Map();

  edges.forEach(edge => {
    if (!edge || !edge.source || !edge.target) return;

    if (!outgoingMap.has(edge.source)) outgoingMap.set(edge.source, []);
    outgoingMap.get(edge.source).push(edge.target);

    if (!incomingMap.has(edge.target)) incomingMap.set(edge.target, []);
    incomingMap.get(edge.target).push(edge.source);
  });

  nodes.forEach(node => {
    if (node.type === 'comment' || node.type === 'CommentNode') return;

    const hasIn = incomingMap.has(node.id) && incomingMap.get(node.id).length > 0;
    const hasOut = outgoingMap.has(node.id) && outgoingMap.get(node.id).length > 0;

    if (!hasIn && !hasOut && nodes.length > 1) {
      errors.push({
        code: "ERR_DISCONNECTED_NODE",
        nodeId: node.id,
        message: `Узел "${node.data && (node.data.title || node.data.label) ? (node.data.title || node.data.label) : node.id}" не соединен со схемой`
      });
    }
  });

  const startNodes = nodes.filter(node => {
    if (node.type === 'comment' || node.type === 'CommentNode') return false;
    const incoming = incomingMap.get(node.id) || [];
    return incoming.length === 0;
  });

  if (startNodes.length === 0 && nodes.length > 0) {
    errors.push({
      code: "ERR_CYCLE_NO_ENTRY",
      message: "В схеме обнаружена циклическая зависимость без явной точки входа"
    });
  }

  const steps = [];
  const visited = new Set();
  const queue = [...startNodes.map(n => n.id)];
  let order = 1;

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentNode = nodeMap.get(currentId);
    if (!currentNode) continue;

    const targets = outgoingMap.get(currentId) || [];
    const primaryNext = targets.length > 0 ? targets[0] : null;

    const formatted = formatNode(currentNode, order, primaryNext, targets);
    if (formatted) {
      steps.push(formatted);
      order++;
    }

    for (const targetId of targets) {
      if (!visited.has(targetId)) {
        queue.push(targetId);
      }
    }
  }

  nodes.forEach(node => {
    if (node.type === 'comment' || node.type === 'CommentNode') return;
    if (!visited.has(node.id)) {
      const alreadyReported = errors.some(e => e.nodeId === node.id);
      if (!alreadyReported) {
        errors.push({
          code: "ERR_UNREACHABLE_NODE",
          nodeId: node.id,
          message: `Узел "${node.data && (node.data.title || node.data.label) ? (node.data.title || node.data.label) : node.id}" недостижим из начальной точки`
        });
      }
    }
  });

  return {
    schemaVersion: "2026.1",
    procedureCode: data.procedureName || data.procedureCode || data.name || "New_Procedure",
    algorithm: {
      type: "SEQUENTIAL_FLOW",
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
