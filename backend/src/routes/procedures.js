const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { convertToEPlaner } = require('../converter/eplanerConverter');

function parsePositiveInt(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function parseCanvasInput(rawInput) {
  let parsed = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      return { error: 'Некорректный формат JSON в raw_canvas_data' };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'Поле raw_canvas_data должно быть объектом' };
  }
  if (parsed.nodes !== undefined && !Array.isArray(parsed.nodes)) {
    return { error: 'Поле raw_canvas_data.nodes должно быть массивом' };
  }
  if (parsed.edges !== undefined && !Array.isArray(parsed.edges)) {
    return { error: 'Поле raw_canvas_data.edges должно быть массивом' };
  }
  return { data: parsed };
}

async function hasHierarchyCycle(targetId, newParentId) {
  let currentParentId = newParentId;
  const visited = new Set([targetId]);
  while (currentParentId !== null && currentParentId !== undefined) {
    if (visited.has(currentParentId)) {
      return true;
    }
    visited.add(currentParentId);
    const parentRecord = await prisma.procedure.findUnique({
      where: { id: currentParentId },
      select: { parent_id: true }
    });
    if (!parentRecord) break;
    currentParentId = parentRecord.parent_id;
  }
  return false;
}

router.get('/', async (req, res) => {
  try {
    let whereClause;
    if (req.query.parentId !== undefined) {
      if (req.query.parentId === 'null') {
        whereClause = { parent_id: null };
      } else {
        const parsedParentId = parsePositiveInt(req.query.parentId);
        if (parsedParentId === null) {
          return res.status(400).json({ error: 'Некорректный parentId' });
        }
        whereClause = { parent_id: parsedParentId };
      }
    }

    const procedures = await prisma.procedure.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        parent_id: true,
        created_at: true,
        updated_at: true
      },
      orderBy: { updated_at: 'desc' }
    });

    res.json(procedures);
  } catch (err) {
    console.error('Ошибка при получении списка процедур:', err);
    res.status(500).json({ error: 'Не удалось получить список процедур' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Некорректный ID процедуры' });
    }

    const procedure = await prisma.procedure.findUnique({
      where: { id },
      include: {
        sub_procedures: {
          select: { id: true, name: true, updated_at: true }
        }
      }
    });

    if (!procedure) {
      return res.status(404).json({ error: 'Процедура не найдена' });
    }

    let rawCanvas = null;
    let eplanerReady = null;

    try {
      rawCanvas = JSON.parse(procedure.raw_canvas_data);
    } catch {
      rawCanvas = procedure.raw_canvas_data;
    }

    try {
      if (procedure.eplaner_ready_data) {
        eplanerReady = JSON.parse(procedure.eplaner_ready_data);
      }
    } catch {
      eplanerReady = procedure.eplaner_ready_data;
    }

    res.json({
      id: procedure.id,
      name: procedure.name,
      parent_id: procedure.parent_id,
      raw_canvas_data: rawCanvas,
      eplaner_ready_data: eplanerReady,
      sub_procedures: procedure.sub_procedures,
      created_at: procedure.created_at,
      updated_at: procedure.updated_at
    });
  } catch (err) {
    console.error('Ошибка при загрузке процедуры:', err);
    res.status(500).json({ error: 'Не удалось загрузить процедуру' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Некорректное тело запроса' });
    }

    const { id, name, raw_canvas_data } = req.body;
    const hasParentField = Object.prototype.hasOwnProperty.call(req.body, 'parent_id');
    const rawParentId = req.body.parent_id;

    let numericId = null;
    if (id !== undefined && id !== null) {
      numericId = parsePositiveInt(id);
      if (numericId === null) {
        return res.status(400).json({ error: 'Некорректный ID процедуры' });
      }
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Имя процедуры должно быть непустой строкой' });
      }
    }

    let parsedParentId;
    if (hasParentField && rawParentId !== undefined) {
      if (rawParentId === null) {
        parsedParentId = null;
      } else {
        parsedParentId = parsePositiveInt(rawParentId);
        if (parsedParentId === null) {
          return res.status(400).json({ error: 'Некорректный parent_id' });
        }
      }
    }

    let parsedCanvas = null;
    if (raw_canvas_data !== undefined) {
      const canvasResult = parseCanvasInput(raw_canvas_data);
      if (canvasResult.error) {
        return res.status(400).json({ error: canvasResult.error });
      }
      parsedCanvas = canvasResult.data;
    }

    const existing = numericId !== null
      ? await prisma.procedure.findUnique({ where: { id: numericId } })
      : null;

    if (!existing && (name === undefined || typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({ error: 'Имя процедуры обязательно' });
    }

    if (parsedParentId !== undefined && parsedParentId !== null) {
      if (numericId !== null && parsedParentId === numericId) {
        return res.status(400).json({ error: 'Процедура не может быть родителем самой себя' });
      }

      const parentProc = await prisma.procedure.findUnique({
        where: { id: parsedParentId }
      });
      if (!parentProc) {
        return res.status(400).json({ error: 'Родительская процедура не найдена' });
      }

      if (existing) {
        const cycle = await hasHierarchyCycle(existing.id, parsedParentId);
        if (cycle) {
          return res.status(400).json({ error: 'Обнаружена циклическая вложенность процедур' });
        }
      }
    }

    if (existing) {
      let effectiveCanvas = parsedCanvas;
      if (effectiveCanvas === null) {
        try {
          effectiveCanvas = JSON.parse(existing.raw_canvas_data);
        } catch {
          return res.status(422).json({
            error: 'Сохраненные данные схемы повреждены',
            code: 'ERR_INVALID_CANVAS_DATA'
          });
        }
      }

      const effectiveName = name !== undefined ? name.trim() : existing.name;
      const rawDataString = JSON.stringify(effectiveCanvas);
      const converted = convertToEPlaner({
        ...effectiveCanvas,
        procedureName: effectiveCanvas.procedureName || effectiveName
      });
      const convertedString = JSON.stringify(converted);

      const updateData = {
        name: effectiveName,
        raw_canvas_data: rawDataString,
        eplaner_ready_data: convertedString
      };

      if (hasParentField && rawParentId !== undefined) {
        updateData.parent_id = parsedParentId;
      }

      const updatedProcedure = await prisma.procedure.update({
        where: { id: existing.id },
        data: updateData
      });

      return res.status(200).json({
        message: 'Процедура успешно обновлена',
        procedure: {
          id: updatedProcedure.id,
          name: updatedProcedure.name,
          parent_id: updatedProcedure.parent_id,
          updated_at: updatedProcedure.updated_at,
          validation: converted.validation
        }
      });
    }

    const effectiveCanvas = parsedCanvas !== null ? parsedCanvas : { nodes: [], edges: [] };
    const effectiveName = name.trim();
    const rawDataString = JSON.stringify(effectiveCanvas);
    const converted = convertToEPlaner({
      ...effectiveCanvas,
      procedureName: effectiveCanvas.procedureName || effectiveName
    });
    const convertedString = JSON.stringify(converted);

    const createData = {
      name: effectiveName,
      raw_canvas_data: rawDataString,
      eplaner_ready_data: convertedString,
      parent_id: parsedParentId !== undefined ? parsedParentId : null
    };
    if (numericId !== null) {
      createData.id = numericId;
    }

    const createdProcedure = await prisma.procedure.create({
      data: createData
    });

    return res.status(201).json({
      message: 'Процедура успешно сохранена',
      procedure: {
        id: createdProcedure.id,
        name: createdProcedure.name,
        parent_id: createdProcedure.parent_id,
        updated_at: createdProcedure.updated_at,
        validation: converted.validation
      }
    });
  } catch (err) {
    console.error('Ошибка при сохранении процедуры:', err);
    res.status(500).json({ error: 'Не удалось сохранить процедуру' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Некорректный ID процедуры' });
    }

    const existing = await prisma.procedure.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Процедура не найдена' });
    }

    await prisma.procedure.delete({
      where: { id }
    });

    res.status(200).json({ message: 'Процедура успешно удалена' });
  } catch (err) {
    console.error('Ошибка при удалении процедуры:', err);
    res.status(500).json({ error: 'Не удалось удалить процедуру' });
  }
});

router.get('/:id/export', async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Некорректный ID процедуры' });
    }

    const procedure = await prisma.procedure.findUnique({
      where: { id }
    });

    if (!procedure) {
      return res.status(404).json({ error: 'Процедура не найдена' });
    }

    let rawCanvas;
    try {
      rawCanvas = JSON.parse(procedure.raw_canvas_data);
    } catch {
      return res.status(422).json({
        error: 'Не удалось экспортировать процедуру',
        code: 'ERR_INVALID_CANVAS_DATA'
      });
    }

    if (!rawCanvas || typeof rawCanvas !== 'object' || Array.isArray(rawCanvas)) {
      return res.status(422).json({
        error: 'Не удалось экспортировать процедуру',
        code: 'ERR_INVALID_CANVAS_DATA'
      });
    }

    const eplanerData = convertToEPlaner({
      ...rawCanvas,
      procedureName: rawCanvas.procedureName || procedure.name
    });

    if (!eplanerData.validation.isValid) {
      return res.status(400).json({
        error: 'Схема содержит ошибки валидации',
        code: 'ERR_VALIDATION_FAILED',
        validation: eplanerData.validation
      });
    }

    const asFile = req.query.download === 'true';
    if (asFile) {
      const filename = `${procedure.name.replace(/[^a-zA-Z0-9_\u0400-\u04FF]/g, '_')}_eplaner.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return res.send(JSON.stringify(eplanerData, null, 2));
    }

    res.json(eplanerData);
  } catch (err) {
    console.error('Ошибка при экспорте процедуры:', err);
    res.status(500).json({ error: 'Не удалось экспортировать процедуру' });
  }
});

module.exports = router;
