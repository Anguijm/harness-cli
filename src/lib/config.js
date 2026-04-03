import fs from 'fs';
import path from 'path';

/**
 * Load and parse harness.yml config.
 * Simple YAML parser — handles key: value, nested objects, and arrays.
 */
export function loadConfig(cwd) {
  const configPath = path.join(cwd, 'harness.yml');
  if (!fs.existsSync(configPath)) {
    return getDefaults();
  }

  const text = fs.readFileSync(configPath, 'utf8');
  return parseSimpleYaml(text);
}

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split('\n');
  const stack = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, '').trimEnd();
    if (!trimmed || trimmed.trim() === '') continue;

    const indent = line.search(/\S/);
    const content = trimmed.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (content.startsWith('- ')) {
      const val = content.slice(2).trim();
      const lastKey = Object.keys(parent).pop();
      if (lastKey && Array.isArray(parent[lastKey])) {
        parent[lastKey].push(parseValue(val));
      }
      continue;
    }

    // Key: value
    const colonIdx = content.indexOf(':');
    if (colonIdx > 0) {
      const key = content.slice(0, colonIdx).trim();
      const rawVal = content.slice(colonIdx + 1).trim();

      if (rawVal === '' || rawVal === '""') {
        // Could be object or empty
        parent[key] = {};
        stack.push({ obj: parent[key], indent });
      } else {
        parent[key] = parseValue(rawVal);
        // Check if next lines are array items
        const nextLine = lines[lines.indexOf(line) + 1];
        if (nextLine && nextLine.trim().startsWith('- ')) {
          parent[key] = [];
          stack.push({ obj: parent, indent });
        }
      }
    }
  }

  return result;
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '""' || val === "''") return '';
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  return val.replace(/^["']|["']$/g, '');
}

function getDefaults() {
  return {
    name: 'project',
    stack: 'node',
    language: 'typescript',
    council: {
      angles: ['security', 'architecture', 'product'],
      auto_approve_threshold: 0,
      model: 'claude-sonnet-4-6'
    },
    commands: {
      install: 'npm install',
      build: 'npm run build',
      test: 'npm test',
      lint: 'npm run lint'
    },
    cadence: 'tick-tock',
    memory: true,
    interactive: true
  };
}
