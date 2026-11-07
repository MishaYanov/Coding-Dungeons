import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.mjs';
import { grade, runnerStatus } from './lib/grader.mjs';
import { encounters, evaluateStage, publicEncounter } from './lib/encounters.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT.');
const bodyLimit = 128 * 1024;
const codeLimit = 48 * 1024;
const textLimit = 20 * 1024;
const worldSpecs = [
  {id:'javascript', name:'JavaScript', title:'JavaScript Fundamentals', subtitle:'World 1'},
  {id:'typescript', name:'TypeScript', title:'TypeScript Fundamentals', subtitle:'World 2'},
  {id:'rust', name:'Rust', title:'Understanding Rust', subtitle:'The Ferrum Expedition'},
  {id:'go', name:'Go', title:'Understanding Go', subtitle:'World 4'},
];
const rustDatabase = resolve(root, process.env.FERRUM_DB ?? 'state/ferrum.sqlite');

async function loadWorld(spec, number) {
  const {id} = spec;
  const rust = id === 'rust';
  const dataDir = rust ? join(root, 'data') : join(root, 'data', 'worlds', id);
  const jsonFile = async name => JSON.parse((await readFile(join(dataDir, name), 'utf8')).replace(/^\uFEFF/, ''));
  const [campaign, pages, exercises] = await Promise.all([
    jsonFile('campaign.json'), jsonFile('pages.json'), jsonFile('exercises.json'),
  ]);
  const bookUrl = rust ? '/book/ferrum-expedition.pdf' : `/book/${id}/book.pdf`;
  const kitPath = rust ? '/book/ferrum-field-kit.zip' : `/book/${id}/field-kit.zip`;
  const kit = await stat(join(publicDir, kitPath.slice(1))).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const info = {
    ...spec, number, title:campaign.world?.title ?? spec.title,
    subtitle:campaign.world?.subtitle ?? spec.subtitle,
    bookUrl, kitUrl:kit?.isFile() ? kitPath : null,
  };
  const database = parse(rustDatabase);
  const worldEncounters = encounters.filter(encounter => encounter.world === id);
  const exercisePages = new Map(pages.flatMap(page => page.prompts
    .filter(prompt => prompt.exerciseId)
    .map(prompt => [prompt.exerciseId, page.page])));
  return {
    info, pages, rust,
    cookie:rust ? 'ferrum_hero' : `ferrum_hero_${id}`,
    database:rust ? rustDatabase : join(database.dir, `${database.name}.${id}${database.ext}`),
    pathIds:new Set(['all', '', ...campaign.paths.map(path => path.id)]),
    questMap:new Map(campaign.quests.map(quest => [quest.level, quest])),
    exerciseMap:new Map(exercises.map(exercise => [exercise.id, exercise])),
    encounterMap:new Map(worldEncounters.map(encounter => [encounter.id, encounter])),
    gradedLevels:new Set(rust ? exercises.map(exercise => exercise.level) : []),
    publicCampaign:{
      world:info, zones:campaign.zones ?? [],
      paths:campaign.paths,
      quests:campaign.quests.map(({hint1, hint2, debrief, ...quest}) => quest),
      rooms:campaign.rooms.map(room => ({...room, choices:room.choices.map(({result,...choice}) => choice)})),
      specialEncounters:worldEncounters.map(publicEncounter),
      exercises:exercises.map(({tests, solution, ...exercise}) =>
        ({...exercise, page:exercisePages.get(exercise.id)})),
      levelPages:Object.fromEntries(campaign.quests.map(quest => [quest.level, quest.page])),
      total:pages.length,
    },
    publicPages:pages.map(page => ({...page, prompts:page.prompts.map(
      ({feedback, feedbackByOption, correctOption, ...prompt}) => prompt)})),
  };
}

const worlds = await Promise.all(worldSpecs.map((spec, index) => loadWorld(spec, index + 1)));
const worldMap = new Map(worlds.map(world => [world.info.id, world]));
try {
  for (const world of worlds) world.store = await openStore({file:world.database});
} catch (error) {
  for (const world of worlds) world.store?.close();
  throw error;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(body)});
  response.end(body);
}

async function readJson(request) {
  const mediaType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'Send a JSON request.');
  }
  if (Number(request.headers['content-length']) > bodyLimit) throw new HttpError(413, 'Request is too large.');
  const chunks = [];
  let size = 0;
  // Avoid destroying the HTTP socket when rejecting a chunked body.
  for await (const chunk of request.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > bodyLimit) {
      request.resume();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new HttpError(400, 'Expected a JSON object.');
  return data;
}

function string(value, limit, name) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > limit) {
    throw new HttpError(400, `${name} must be a string of at most ${limit} bytes.`);
  }
  return value;
}

function pageAt({pages}, number) {
  if (!Number.isInteger(number) || number < 1 || number > pages.length) throw new HttpError(404, 'Book page not found.');
  return pages[number-1];
}

function promptAt(page, id) {
  const prompt = page.prompts.find(p => p.id === id);
  if (!prompt) throw new HttpError(404, 'This prompt is not on the selected page.');
  return prompt;
}

function heroName(value) {
  const name = string(value, 60, 'Hero name').normalize('NFC').trim();
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, 'Enter a hero name.');
  return string(name, 60, 'Hero name');
}

const heroIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireHero(request, {cookie, store}) {
  const id = request.headers['x-ferrum-hero'] ??
    new RegExp(`(?:^|;\\s*)${cookie}=([a-f0-9-]{36})(?:;|$)`, 'i').exec(request.headers.cookie ?? '')?.[1];
  if (typeof id !== 'string' || !heroIdPattern.test(id) || !(await store.hero(id))) {
    throw new HttpError(401, 'Create or load a hero to save your expedition.');
  }
  return id;
}

function selectHero(response, {cookie}, hero, status = 200) {
  response.setHeader('Set-Cookie', `${cookie}=${hero.id}; Path=/; HttpOnly; SameSite=Strict`);
  json(response, {hero}, status);
}

async function createHero(request, response, world) {
  const data = await readJson(request);
  const name = heroName(data.name);
  const path = data.path ?? 'all';
  if (!world.pathIds.has(path)) throw new HttpError(400, 'Unknown route.');
  const hero = await world.store.createHero({id:randomUUID(), name, path:path || 'all'});
  selectHero(response, world, hero, 201);
}

async function loadHero(request, response, world) {
  const {id} = await readJson(request);
  if (typeof id !== 'string' || !heroIdPattern.test(id)) throw new HttpError(400, 'Choose a saved hero.');
  const hero = await world.store.hero(id);
  if (!hero) throw new HttpError(404, 'Hero not found.');
  selectHero(response, world, hero);
}

async function profilePatch(request, response, world, heroId) {
  const {pathIds, store} = world;
  const data = await readJson(request);
  const changes = {};
  if ('callsign' in data) changes.callsign = heroName(data.callsign);
  if ('path' in data) {
    if (!pathIds.has(data.path)) throw new HttpError(400, 'Unknown route.');
    changes.path = data.path || 'all';
  }
  if ('lastPage' in data) changes.last_page = pageAt(world, data.lastPage).page;
  if (!Object.keys(changes).length) throw new HttpError(400, 'Provide a profile change.');
  await store.saveProfile(heroId, changes);
  json(response, {ok:true, hero:await store.hero(heroId)});
}

async function levelPatch(request, response, {questMap, gradedLevels, store}, heroId, level) {
  const quest = questMap.get(level);
  if (!quest) throw new HttpError(404, 'Level not found.');
  const data = await readJson(request);
  const changes = {};
  for (const key of ['scout', 'explain', 'side', 'forge']) {
    if (!(key in data)) continue;
    if (typeof data[key] !== 'boolean') throw new HttpError(400, `${key} must be true or false.`);
    changes[key === 'explain' ? 'explained' : key] = Number(data[key]);
  }
  if ('forge' in changes) {
    if (gradedLevels.has(level)) throw new HttpError(409, 'Passing the code exercise earns Forge on this level.');
    if (changes.forge && !(await store.response(heroId, quest.bossPage, `boss-${level}`))?.value.trim()) {
      throw new HttpError(409, 'Save your boss encounter draft before marking Forge.');
    }
  }
  if ('answer' in data) changes.answer = string(data.answer, textLimit, 'Answer');
  if ('code' in data) changes.code = string(data.code, codeLimit, 'Code');
  if (!Object.keys(changes).length) throw new HttpError(400, 'Provide a quest log change.');
  await store.saveLevel(heroId, level, changes);
  json(response, {ok:true});
}

async function saveAnswer(request, response, world, heroId) {
  const data = await readJson(request);
  const page = pageAt(world, data.page);
  const prompt = promptAt(page, data.promptId);
  const value = string(data.value, prompt.type === 'code' ? codeLimit : textLimit, 'Answer');
  let correct = null;
  let feedback = prompt.feedback;
  if (prompt.type === 'choice') {
    if (!prompt.options.some(option => option.id === value)) throw new HttpError(400, 'Choose one of the listed options.');
    correct = prompt.correctOption === value;
    feedback = prompt.feedbackByOption?.[value] ?? prompt.feedback;
  }
  await world.store.saveResponse(heroId, page.page, prompt.id, value, feedback, correct == null ? null : Number(correct));
  json(response, {feedback, correct});
}

function currentProgress(world, heroId) {
  const progress = world.store.progress(heroId);
  for (const answer of progress.responses) {
    const prompt = world.pages[answer.page - 1]?.prompts.find(item => item.id === answer.promptId);
    if (!prompt || prompt.exerciseId) continue;
    if (prompt.type === 'choice') {
      if (!prompt.options.some(option => option.id === answer.value)) continue;
      answer.correct = prompt.correctOption === answer.value;
      answer.feedback = prompt.feedbackByOption?.[answer.value] ?? prompt.feedback ?? answer.feedback;
    } else if (prompt.feedback) {
      answer.feedback = prompt.feedback;
    }
  }
  return progress;
}

function completedStages(encounter, results) {
  return encounter.stages.filter(stage => results.has(stage.id)).map(stage => stage.id);
}

async function submitEncounterStage(request, response, store, heroId, encounter) {
  const data = await readJson(request);
  if (Object.keys(data).some(key => key !== 'stageId' && key !== 'optionId')) {
    throw new HttpError(400, 'Send a stage and its listed option when required.');
  }
  const stageId = string(data.stageId, 64, 'Stage ID');
  const stage = encounter.stages.find(item => item.id === stageId);
  if (!stage) throw new HttpError(400, 'Choose a stage from this encounter.');
  let optionId;
  if (stage.options?.length) {
    optionId = string(data.optionId, 64, 'Option ID');
    if (!stage.options.some(option => option.id === optionId)) {
      throw new HttpError(400, 'Choose one of the listed options.');
    }
  } else if (Object.hasOwn(data, 'optionId')) {
    throw new HttpError(400, 'This stage does not take an option.');
  }

  const before = store.encounterResults(heroId, encounter.id);
  if (before.has(stageId)) {
    return json(response, {completed:completedStages(encounter, before), result:before.get(stageId)});
  }
  if (encounter.stages.find(item => !before.has(item.id)) !== stage) {
    throw new HttpError(409, 'Finish the earlier stages first.');
  }

  const attempt = await evaluateStage(encounter, stage, optionId);
  if (attempt.correct) store.recordEncounterStage(heroId, encounter.id, stageId, attempt);
  const after = store.encounterResults(heroId, encounter.id);
  json(response, {completed:completedStages(encounter, after), result:after.get(stageId) ?? attempt});
}

async function submitCode(request, response, world, heroId) {
  if (!world.rust) throw new HttpError(409, 'Save a draft and use the guided Forge review for this world.');
  const {exerciseMap, store} = world;
  const data = await readJson(request);
  const page = pageAt(world, data.page);
  const prompt = promptAt(page, data.promptId);
  const exercise = exerciseMap.get(data.exerciseId);
  if (!exercise || prompt.exerciseId !== exercise.id || page.level !== exercise.level) {
    throw new HttpError(400, 'The exercise does not belong to this page and prompt.');
  }
  const code = string(data.code, codeLimit, 'Code');
  if (!code.trim()) throw new HttpError(400, 'Enter Rust code before running tests.');
  await store.saveResponse(heroId, page.page, prompt.id, code, 'Your submission is saved.');
  const run = await grade({code, tests:exercise.tests, testNames:exercise.testNames});
  const result = { verdict:run.verdict, output:run.output,
    passed:run.passed.length, failed:run.failed.length,
    passedTests:run.passed, failedTests:run.failed };
  if (['pass', 'fail', 'compile_error', 'timeout'].includes(result.verdict)) {
    await store.recordAttempt(heroId, {page:page.page, promptId:prompt.id, level:page.level,
      exerciseId:exercise.id, code, ...result});
  }
  json(response, result);
}

const types = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.webp':'image/webp', '.pdf':'application/pdf', '.zip':'application/zip'};
const publicFiles = new Set(['/index.html', '/styles.css', '/app.js', '/progression.mjs', '/creatures.mjs',
  '/special-encounters.mjs',
  ...worlds.flatMap(({info}) => [info.bookUrl, info.kitUrl].filter(Boolean))]);
const pageAsset = /^\/book\/(?:(?:javascript|typescript|go)\/)?pages\/[1-9]\d{0,2}\.webp$/;

async function staticFile(request, response, path) {
  const named = path === '/' ? '/index.html' : path;
  if (!publicFiles.has(named) && !pageAsset.test(named)) throw new HttpError(404, 'Page not found.');
  const file = join(publicDir, named.slice(1));
  const meta = await stat(file).catch(() => null);
  if (!meta?.isFile()) throw new HttpError(404, 'Page asset not found.');
  const extension = named.slice(named.lastIndexOf('.'));
  response.writeHead(200, {'Content-Type':types[extension], 'Content-Length':meta.size,
    'Cache-Control':extension === '.webp' ? 'public, max-age=3600' : 'no-cache'});
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

const server = createServer(async (request,response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const activePort = server.address().port;
    const host = request.headers.host;
    const allowedHosts = [`127.0.0.1:${activePort}`, `localhost:${activePort}`];
    if (!allowedHosts.includes(host)) throw new HttpError(403, 'Use the local Ferrum URL.');
    const {pathname:path} = new URL(request.url, `http://${host}`);
    const method = request.method;
    if (method === 'GET' && path === '/api/worlds') return json(response, {worlds:worlds.map(({info}) => info)});
    if (!path.startsWith('/api/')) {
      if (method === 'GET' || method === 'HEAD') return await staticFile(request, response, path);
      throw new HttpError(404, 'Route not found.');
    }
    const world = worldMap.get(request.headers['x-ferrum-world'] ?? 'rust');
    if (!world) throw new HttpError(404, 'World not found.');
    const {store} = world;
    if (method === 'POST' || method === 'PATCH') {
      const origin = request.headers.origin;
      if (request.headers['x-ferrum-request'] !== '1' || (origin && origin !== `http://${host}`)) {
        throw new HttpError(403, 'Open Ferrum locally to make changes.');
      }
    }
    if (method === 'GET' || method === 'POST') {
      const match = path.match(/^\/api\/encounters\/([a-z0-9-]{1,64})$/);
      if (match) {
        const encounter = world.encounterMap.get(match[1]);
        if (!encounter) throw new HttpError(404, 'Encounter not found in this world.');
        const heroId = await requireHero(request, world);
        if (method === 'POST') return await submitEncounterStage(request, response, store, heroId, encounter);
        return json(response, {completed:completedStages(encounter, store.encounterResults(heroId, encounter.id))});
      }
    }
    if (method === 'GET') {
      if (path === '/api/campaign') return json(response, world.publicCampaign);
      if (path === '/api/heroes') return json(response, {heroes:await store.heroes()});
      if (path === '/api/progress') return json(response, currentProgress(world, await requireHero(request, world)));
      if (path === '/api/status') {
        return json(response, {storage:store.label, runner:world.rust ? await runnerStatus() : 'unavailable'});
      }
      let match = path.match(/^\/api\/pages\/(\d+)$/);
      if (match) return json(response, world.publicPages[pageAt(world, Number(match[1])).page-1]);
      match = path.match(/^\/api\/levels\/(\d+)\/reveal\/(hint1|hint2|debrief)$/);
      if (match) {
        const quest = world.questMap.get(Number(match[1]));
        if (!quest) throw new HttpError(404, 'Level not found.');
        return json(response, {text:quest[match[2]]});
      }
    }
    if (method === 'PATCH') {
      if (path === '/api/profile') return await profilePatch(request, response, world, await requireHero(request, world));
      const match = path.match(/^\/api\/progress\/(\d+)$/);
      if (match) return await levelPatch(request, response, world, await requireHero(request, world), Number(match[1]));
    }
    if (method === 'POST') {
      if (path === '/api/heroes') return await createHero(request, response, world);
      if (path === '/api/heroes/load') return await loadHero(request, response, world);
      if (path === '/api/answers') return await saveAnswer(request, response, world, await requireHero(request, world));
      if (path === '/api/grade') return await submitCode(request, response, world, await requireHero(request, world));
    }
    throw new HttpError(404, 'Route not found.');
  } catch (error) {
    if (response.headersSent) return response.destroy();
    if (error.code === 'HERO_EXISTS') return json(response, {error:'A hero with that name already exists. Load it or choose another name.'}, 409);
    if (!(error instanceof HttpError)) console.error(error.message);
    json(response, {error:error instanceof HttpError ? error.message : 'Ferrum could not complete this request.'}, error.status ?? 500);
  }
});

server.requestTimeout = 20000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Ferrum at http://127.0.0.1:${server.address().port} (${worldMap.get('rust').store.label})`);
});
function shutdown() {
  server.close(() => {
    for (const {store} of worlds) store.close();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
