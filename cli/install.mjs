import { cp, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { root, skill, freshDirectory, writePrivate } from './core.mjs';

export async function install(options) {
  const paths = { codex: '.agents/skills', claude: '.claude/skills', pi: options.user ? '.pi/agent/skills' : '.pi/skills' };
  if (!Object.hasOwn(paths, options.agent)) throw new Error('Choose --agent codex, claude or pi. Existing plugin installations also remain available.');
  if (options.user && options.project) throw new Error('Choose either --user or --project PATH.');
  const base = options.user ? homedir() : resolve(options.project || '.');
  const target = join(base, paths[options.agent], 'tracevista');
  return freshDirectory(target, async folder => {
    await writePrivate(join(folder, 'SKILL.md'), await readFile(join(root, 'cli/skill/SKILL.md')));
    await cp(skill, join(folder, 'references/conversion-skill'), { recursive: true,
      filter: source => !['__pycache__', '.DS_Store', 'tests'].includes(basename(source)) && !source.endsWith('.pyc') });
    return { agent: options.agent, directory: folder,
      invoke: options.agent === 'codex' ? '$tracevista /path/to/session.jsonl' : options.agent === 'pi' ? '/skill:tracevista /path/to/session.jsonl' : '/tracevista /path/to/session.jsonl' };
  });
}
