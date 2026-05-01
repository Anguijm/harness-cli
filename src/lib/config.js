import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Load harness.yml relative to `cwd` and return a structured result.
 *
 * Used by every command/library that reads harness.yml: recall, reindex,
 * recall_corpus, synthesize, check. Council R1 PR #7 asked for a single
 * helper so the file I/O and parse logic don't drift across modules; the
 * per-caller behavior on parse failure (warn vs fatal vs silent fallback)
 * stays at the caller because each command has different correctness
 * implications when its config block is missing.
 *
 * Shape:
 *   { ok: true,  parsed: null, exists: false }       — no harness.yml
 *   { ok: true,  parsed: <object>, exists: true }   — parsed cleanly
 *   { ok: false, parsed: null, exists: true, error } — present but unparseable
 *
 * @param {string} cwd
 * @returns {{ok: boolean, parsed: any, exists: boolean, error?: Error}}
 */
export function loadHarnessConfig(cwd) {
  const cfgPath = path.join(cwd, 'harness.yml');
  if (!fs.existsSync(cfgPath)) {
    return { ok: true, parsed: null, exists: false };
  }
  try {
    const parsed = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    return { ok: true, parsed, exists: true };
  } catch (e) {
    return { ok: false, parsed: null, exists: true, error: e };
  }
}

/**
 * Legacy loader retained for plan.js / recipe.js / learn.js, which
 * predate the js-yaml migration and use a hand-rolled parser. Migrating
 * them is its own PR — until then, new callers should use
 * loadHarnessConfig above (which uses js-yaml and returns a structured
 * result rather than papering over absence with defaults).
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
      default_model: 'claude-sonnet-4-6',
      model_overrides: {}
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
