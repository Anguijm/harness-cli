import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, '..', '..', 'templates');

export async function init(options) {
  const cwd = process.cwd();
  const harnessDir = path.join(cwd, '.harness');

  if (fs.existsSync(path.join(cwd, 'harness.yml'))) {
    console.log(chalk.yellow('harness.yml already exists. Skipping init.'));
    return;
  }

  // Create .harness directory
  for (const dir of ['council', 'memory', 'logs', 'plans']) {
    fs.mkdirSync(path.join(harnessDir, dir), { recursive: true });
  }

  // Copy harness.yml template
  let config = fs.readFileSync(path.join(TEMPLATES, 'harness.yml'), 'utf8');
  config = config.replace('name: my-project', `name: ${path.basename(cwd)}`);
  if (options.stack) config = config.replace('stack: node', `stack: ${options.stack}`);
  if (options.framework) config = config.replace('framework: ""', `framework: ${options.framework}`);
  fs.writeFileSync(path.join(cwd, 'harness.yml'), config);

  // Copy council persona templates
  const councilDir = path.join(TEMPLATES, 'council');
  for (const file of fs.readdirSync(councilDir)) {
    fs.copyFileSync(
      path.join(councilDir, file),
      path.join(harnessDir, 'council', file)
    );
  }

  // Initialize memory
  fs.writeFileSync(path.join(harnessDir, 'memory', 'decisions.json'), '[]');
  fs.writeFileSync(path.join(harnessDir, 'memory', 'context.md'), `# ${path.basename(cwd)}\n\nProject context and architectural decisions.\n`);

  // Add .harness/logs to .gitignore if it exists
  const gitignore = path.join(cwd, '.gitignore');
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, 'utf8');
    if (!content.includes('.harness/logs')) {
      fs.appendFileSync(gitignore, '\n# Harness\n.harness/logs/\n');
    }
  }

  console.log(chalk.green('Harness initialized.'));
  console.log();
  console.log(chalk.dim('Created:'));
  console.log(chalk.dim('  harness.yml              — project config'));
  console.log(chalk.dim('  .harness/council/         — expert persona prompts'));
  console.log(chalk.dim('  .harness/memory/          — cross-session decisions'));
  console.log(chalk.dim('  .harness/logs/            — build audit trail'));
  console.log(chalk.dim('  .harness/plans/           — generated plans'));
  console.log();
  console.log(chalk.cyan('Next: harness plan "your feature description"'));
}
