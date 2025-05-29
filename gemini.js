import dotenv from 'dotenv';
dotenv.config();
import { CreateTodo, GetTodos, UpdateTodo, DeleteTodo } from './index.js';

const API_KEY = process.env.GEMINI_API_KEY;

export async function handleAiPrompt(req, res) {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

    const body = {
      contents: [
        {
          parts: [
            {
              text: `
You are a todo list assistant. Analyze the user request and determine the intent and required parameters.

User request: "${prompt}"

Possible intents:
- create: Add a new task
- read: List all tasks
- update: Modify a task (mark as done/undone or update text)
- delete: Remove a task

Return a JSON response with only the fields needed for the operation. Follow these rules:

For CREATE:
{
  "intent": "create",
  "task": "task description"
}

For READ:
{
  "intent": "read"
}

For UPDATE:
{
  "intent": "update",
  "id": number,           // if known
  "position": number,     // if using position (1st, 2nd, last, etc.)
  "task": "partial text", // if identifying by text
  "newTask": string,      // if renaming task
  "done": boolean         // if changing status
}

For DELETE:
{
  "intent": "delete",
  "id": number,           // if known
  "position": number,     // if using position (1st, 2nd, last, etc.)
  "task": "partial text"  // if identifying by text
}

Special cases:
- "delete last task" => {"intent":"delete","position":-1}
- "update first to done" => {"intent":"update","position":1,"done":true}
- "change 'read book' to 'read novel'" => {"intent":"update","task":"read book","newTask":"read novel"}
- "mark task 3 as not done" => {"intent":"update","id":3,"done":false}

Only return the JSON object, no additional text or explanation.
              `
            }
          ]
        }
      ]
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return res.status(500).json({ error: 'No response from Gemini' });

    const cleanedText = cleanJsonString(rawText);

    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to parse Gemini response as JSON' });
    }

    switch (parsed.intent) {
      case 'create':
        if (!parsed.task) return res.status(400).json({ error: 'Task description required for create' });
        req.body.task = parsed.task;
        return CreateTodo(req, res);

      case 'read':
        return GetTodos(req, res);

      case 'update':
        return handleUpdateIntent(parsed, req, res);

      case 'delete':
        return handleDeleteIntent(parsed, req, res);

      default:
        return res.status(400).json({ error: 'Unknown intent from AI' });
    }
  } catch (err) {
    console.error('AI Error:', err);
    return res.status(500).json({ error: 'Failed to process AI request' });
  }
}

async function handleUpdateIntent(parsed, req, res) {
  // First try to find by ID if provided
  if (typeof parsed.id === 'number') {
    req.params.id = parsed.id;
    if (typeof parsed.done === 'boolean') {
      req.body.done = parsed.done;
    }
    if (parsed.newTask) {
      req.body.task = parsed.newTask;
    }
    return UpdateTodo(req, res);
  }

  // Then try to find by position if provided
  if (typeof parsed.position === 'number') {
    const id = await findTodoIdByPosition(parsed.position);
    if (!id) return res.status(404).json({ error: `No task found at position ${parsed.position}` });
    req.params.id = id;
    if (typeof parsed.done === 'boolean') {
      req.body.done = parsed.done;
    }
    if (parsed.newTask) {
      req.body.task = parsed.newTask;
    }
    return UpdateTodo(req, res);
  }

  // Finally try to find by task text if provided
  if (typeof parsed.task === 'string') {
    const id = await findTodoIdByPartialTaskName(parsed.task);
    if (!id) return res.status(404).json({ error: `No task found matching "${parsed.task}"` });
    req.params.id = id;
    if (typeof parsed.done === 'boolean') {
      req.body.done = parsed.done;
    }
    if (parsed.newTask) {
      req.body.task = parsed.newTask;
    }
    return UpdateTodo(req, res);
  }

  return res.status(400).json({ error: 'Need either id, position, or task text for update' });
}

async function handleDeleteIntent(parsed, req, res) {
  // First try to find by ID if provided
  if (typeof parsed.id === 'number') {
    req.params.id = parsed.id;
    return DeleteTodo(req, res);
  }

  // Then try to find by position if provided
  if (typeof parsed.position === 'number') {
    const id = await findTodoIdByPosition(parsed.position);
    if (!id) return res.status(404).json({ error: `No task found at position ${parsed.position}` });
    req.params.id = id;
    return DeleteTodo(req, res);
  }

  // Finally try to find by task text if provided
  if (typeof parsed.task === 'string') {
    const id = await findTodoIdByPartialTaskName(parsed.task);
    if (!id) return res.status(404).json({ error: `No task found matching "${parsed.task}"` });
    req.params.id = id;
    return DeleteTodo(req, res);
  }

  return res.status(400).json({ error: 'Need either id, position, or task text for delete' });
}

// Utility to clean markdown JSON code block
function cleanJsonString(str) {
  return str
    .trim()
    .replace(/^```json\s*/, '')   // remove ```json at start
    .replace(/```$/, '')           // remove ``` at end
    .trim();
}

// Helper to find todo id by position (1-based index, negative for from end)
async function findTodoIdByPosition(position) {
  const todos = await GetTodos();
  if (!todos || todos.length === 0) return null;

  // Handle negative positions (from end)
  const index = position > 0 ? position - 1 : todos.length + position;
  
  if (index < 0 || index >= todos.length) return null;
  return todos[index].id;
}

// Helper to find todo id by partial task name (case insensitive)
async function findTodoIdByPartialTaskName(taskText) {
  const todos = await GetTodos();
  if (!todos || todos.length === 0) return null;

  const lowerTaskText = taskText.toLowerCase();
  const todo = todos.find(t => t.task.toLowerCase().includes(lowerTaskText));
  return todo ? todo.id : null;
}