import fs from 'node:fs';
import path from 'node:path';
import prettier from 'prettier';

const root = path.resolve('.github/workflows');
const files = fs.existsSync(root)
  ? fs
      .readdirSync(root)
      .filter((name) => /\.(ya?ml)$/.test(name))
      .map((name) => path.join(root, name))
  : [];

const problems = [];
if (!files.length) problems.push('No CI workflow definitions were collected.');
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    await prettier.format(source, { parser: 'yaml' });
  } catch (error) {
    problems.push(`${file}: invalid workflow YAML: ${error.message}`);
  }
  for (const [index, line] of source.split('\n').entries()) {
    const match = line.match(/\buses:\s*([^\s#]+)/);
    const reference = match?.[1].split('@').at(-1);
    if (match && !/^[\da-f]{40}$/i.test(reference || '')) {
      problems.push(
        `${path.relative(process.cwd(), file)}:${index + 1}: action must use a full commit SHA: ${match[1]}`,
      );
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Workflow action references are pinned (${files.length} file${files.length === 1 ? '' : 's'} checked).`,
  );
}
