import assert from 'node:assert/strict';
import {readFile, readdir, stat} from 'node:fs/promises';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const kit = fileURLToPath(new URL('../',import.meta.url));
const repo = resolve(kit,'..');
const catalog = JSON.parse(await readFile(resolve(kit,'catalog.json'),'utf8'));
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const inside = (root,path) => path === root || path.startsWith(root + sep);
async function file(root,path) {
  const target = resolve(root,path);
  assert.ok(inside(resolve(root),target),`Path escapes catalog root: ${path}`);
  assert.ok((await stat(target)).isFile(),`Missing file: ${path}`);
  return target;
}
assert.equal(catalog.schemaVersion,1);
for (const path of catalog.references) await file(kit,path);
for (const path of catalog.repositoryFiles) await file(repo,path);
const skills = new Set();
for (const skill of catalog.skills) {
  assert.ok(namePattern.test(skill.name) && skill.name.length < 64,skill.name);
  assert.ok(!skills.has(skill.name),`Duplicate skill: ${skill.name}`);
  skills.add(skill.name);
  const path = await file(kit,skill.path);
  const source = await readFile(path,'utf8');
  const frontmatter = /^---\r?\n([\s\S]+?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
  assert.ok(frontmatter,`Missing frontmatter: ${skill.path}`);
  const name = /^name:\s*["']?([a-z0-9-]+)["']?\s*$/m.exec(frontmatter)?.[1];
  assert.equal(name,skill.name,skill.path);
  assert.match(frontmatter,/^description:\s*\S.+$/m,skill.path);
  assert.equal(relative(kit,dirname(path)).split(sep).at(-1),skill.name);
}
const agents = new Set();
for (const agent of catalog.agents) {
  assert.ok(namePattern.test(agent.name),agent.name);
  assert.ok(!agents.has(agent.name),`Duplicate agent: ${agent.name}`);
  agents.add(agent.name);
  await file(kit,agent.path);
  for (const name of agent.skills) assert.ok(skills.has(name),`Unknown skill ${name} for ${agent.name}`);
}
const actualSkills = (await readdir(resolve(kit,'skills'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name);
assert.deepEqual(actualSkills.sort(),[...skills].sort(),'Uncataloged skill folder');
const actualAgents = (await readdir(resolve(kit,'agents'))).filter(name=>name.endsWith('.md')).map(name=>name.slice(0,-3));
assert.deepEqual(actualAgents.sort(),[...agents].sort(),'Uncataloged agent brief');
const documents = ['README.md',...catalog.references,...catalog.skills.map(item=>item.path),...catalog.agents.map(item=>item.path)];
let links=0;
for (const document of documents) {
  const path = resolve(kit,document);
  const source = await readFile(path,'utf8');
  assert.ok(!source.includes('[TODO') && !source.includes('[INSERT'),`Unfinished scaffold: ${document}`);
  for (const match of source.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
    const target = match[1] ?? match[2];
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    const local = decodeURIComponent(target.split('#')[0]);
    const resolved = resolve(dirname(path),local);
    assert.ok(inside(repo,resolved),`Link escapes repository: ${document} -> ${target}`);
    await stat(resolved);
    links++;
  }
}
console.log(`Validated ${skills.size} skills, ${agents.size} agent briefs, ${links} local links, and ${catalog.repositoryFiles.length} repository targets.`);
