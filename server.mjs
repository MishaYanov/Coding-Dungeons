import { createServer } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './lib/store.mjs';
import { grade, runnerStatus } from './lib/grader.mjs';
import { encounters, evaluateStage, publicEncounter } from './lib/encounters.mjs';
import { createWrittenGm } from './lib/written-gm.mjs';
import { fixtureMetadata, presentWorkbenchRun, runCourseExercise, runLegacyRust, workbenchSummary } from './lib/workbench-service.mjs';
import { createStandaloneRunner } from './lib/standalone-runner.mjs';
import javascriptSuites from './data/workbench/javascript.mjs';
import typescriptSuites from './data/workbench/typescript.mjs';
import goSuites from './data/workbench/go.mjs';
import rustSuites, { rustBossCoverage } from './data/workbench/rust.mjs';
import refactoringQuest from './data/workbench/refactoring.mjs';
import { suggestions } from './data/workbench/suggestions.mjs';
import { evaluateTrial, trialsFor } from './lib/trials.mjs';
import { diamondExercise, diamondStage, diamondView, evaluateDiamondChoice, evaluateDiamondCode,
  refreshDiamondOutcome, settleDiamond, startDiamond } from './lib/diamond-encounter.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const desktopToken = process.env.FERRUM_DESKTOP_TOKEN;
if (desktopToken !== undefined && !/^[a-f0-9]{64}$/.test(desktopToken)) throw new Error('Invalid desktop token.');
const desktopSecret = desktopToken ? Buffer.from(desktopToken, 'hex') : null;
const desktopPublicDir = process.env.FERRUM_PUBLIC_DIR;
const rendererDir = desktopPublicDir ? resolve(root, desktopPublicDir) : join(root, 'dist', 'renderer');
const publicDir = desktopPublicDir ? rendererDir : join(root, 'public');
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
const courseSuites = {javascript:javascriptSuites, typescript:typescriptSuites, go:goSuites, rust:rustSuites};
const rustDatabase = resolve(root, process.env.FERRUM_DB ?? 'state/ferrum.sqlite');
const writtenGm = createWrittenGm();
const standalone = createStandaloneRunner();

let queueTail = Promise.resolve();
let queuedJobs = 0;
const activeRequests = new Set();
async function runLocalJob(action, busy, signal) {
  if (queuedJobs >= 3 || signal.aborted) return busy;
  queuedJobs += 1;
  const previous = queueTail;
  const next = Promise.withResolvers();
  queueTail = next.promise;
  await previous;
  try {
    return signal.aborted ? busy : await action();
  } finally {
    queuedJobs -= 1;
    next.resolve();
  }
}

function authoredTrainingAnswer(worldId, prompt) {
  return worldId === 'rust' && ['text','code'].includes(prompt.type) && /^training-\d+-\d+$/.test(prompt.id)
    ? prompt.feedback : null;
}

async function loadWorld(spec, number) {
  const {id} = spec;
  const rust = id === 'rust';
  const dataDir = rust ? join(root, 'data') : join(root, 'data', 'worlds', id);
  const jsonFile = async name => JSON.parse((await readFile(join(dataDir, name), 'utf8')).replace(/^\uFEFF/, ''));
  const [campaign, pages, exercises] = await Promise.all([
    jsonFile('campaign.json'), jsonFile('pages.json'), jsonFile('exercises.json'),
  ]);
  for (const exercise of courseSuites[id] ?? []) {
    const quest = campaign.quests.find(quest => quest.level === exercise.level);
    const prompt = pages[quest?.bossPage - 1]?.prompts.find(prompt => prompt.id === `boss-${exercise.level}`);
    if (prompt?.type !== 'code') throw new Error(`Workbench suite ${exercise.id} is missing its boss card.`);
    prompt.exerciseId = exercise.id;
    exercises.push({...exercise, title:exercise.title ?? quest.title, description:exercise.description ?? prompt.body,
      starter:exercise.starter ?? prompt.starter});
  }
  for (const exercise of exercises) {
    const definition = JSON.stringify([exercise.tests, exercise.testNames, exercise.typeTests]);
    exercise.suiteRevision = createHash('sha256').update(definition).digest('hex').slice(0, 12);
  }
  const projectReviews = new Map(rust ? rustBossCoverage.filter(entry => entry.status === 'authored-review')
    .map(entry => [campaign.quests.find(quest => quest.level === entry.level)?.bossPage, entry.reason]) : []);
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
  const refactoring = id === 'javascript' ? {page:campaign.quests.at(-1).sidePage,
    title:refactoringQuest.title, description:refactoringQuest.description} : null;
  const exercisePages = new Map(pages.flatMap(page => page.prompts
    .filter(prompt => prompt.exerciseId)
    .map(prompt => [prompt.exerciseId, page.page])));
  return {
    info, pages, rust, refactoring,
    cookie:rust ? 'ferrum_hero' : `ferrum_hero_${id}`,
    database:rust ? rustDatabase : join(database.dir, `${database.name}.${id}${database.ext}`),
    pathIds:new Set(['all', '', ...campaign.paths.map(path => path.id)]),
    questMap:new Map(campaign.quests.map(quest => [quest.level, {
      ...quest, bossExerciseId:pages[quest.bossPage - 1]?.prompts.find(prompt => prompt.id === `boss-${quest.level}`)?.exerciseId,
    }])),
    exerciseMap:new Map(exercises.map(exercise => [exercise.id, exercise])),
    encounterMap:new Map(worldEncounters.map(encounter => [encounter.id, encounter])),
    gradedLevels:new Set(exercises.map(exercise => exercise.level)),
    publicCampaign:{
      world:info, zones:campaign.zones ?? [],
      paths:campaign.paths,
      quests:campaign.quests.map(({hint1, hint2, debrief, ...quest}) => quest),
      rooms:campaign.rooms.map(room => ({...room, choices:room.choices.map(({result,...choice}) => choice)})),
      specialEncounters:worldEncounters.map(publicEncounter),
      ...(refactoring ? {refactoring} : {}),
      exercises:exercises.map(exercise => ({...workbenchSummary(exercise), page:exercisePages.get(exercise.id)})),
      levelPages:Object.fromEntries(campaign.quests.map(quest => [quest.level, quest.page])),
      total:pages.length,
    },
    publicPages:pages.map(page => ({...page, ...(projectReviews.has(page.page) ? {projectReview:projectReviews.get(page.page)} : {}), prompts:page.prompts.map(
      ({feedback, feedbackByOption, correctOption, ...prompt}) => {
        const assessment = prompt.type === 'text' ? writtenGm.getPrompt(id, prompt.id, prompt.body) : null;
        if (assessment) return {...prompt, assessment};
        if (authoredTrainingAnswer(id, {...prompt, feedback})) return {...prompt, exampleAnswer:true};
        return suggestions.has(prompt.exerciseId) ? {...prompt, suggestion:true} : prompt;
      })})),
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
  if (data.oneLife !== undefined && typeof data.oneLife !== 'boolean') throw new HttpError(400, 'Choose whether to enable One Life.');
  const hero = await world.store.createHero({id:randomUUID(), name, path:path || 'all', oneLife:data.oneLife});
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
  if (store.combatState(heroId).fallen && ['scout','forge','explained','side'].some(key => key in changes)) {
    throw new HttpError(409, 'This hero has fallen. Choose another hero to keep submitting.');
  }
  await store.saveLevel(heroId, level, changes);
  json(response, {ok:true});
}

function publicCombat(state) {
  return {...state, oneLife:state.mode === 'one-life'};
}

function prepareSubmission(store, heroId, data, identity, requireId = false) {
  const combat = store.combatState(heroId);
  const id = data.submissionId ?? (requireId || combat.mode === 'one-life' ? null : randomUUID());
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new HttpError(400, 'Send a valid submission ID.');
  }
  const ticket = {id, fingerprint:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
  const prior = store.combatReceipt(heroId, ticket);
  if (!prior && combat.fallen) throw new HttpError(409, 'This hero has fallen. Choose another hero to keep submitting.');
  return {ticket, prior};
}

function submissionResult(outcome, includeStandard = false) {
  const result = outcome.replayed && outcome.result?.newClear ? {...outcome.result, newClear:false} : outcome.result;
  if (!includeStandard && outcome.combat.mode === 'standard') return result;
  return {...result, combat:publicCombat(outcome.combat), combatEvent:outcome.combatEvent};
}

function visibleAssessment(world, heroId, level, assessment) {
  const {status, score, rubricVersion} = assessment;
  if (world.store.workbenchMode(heroId, level).mode !== 'hard') {
    return {status, score, rubricVersion, feedback:assessment.feedback};
  }
  const feedback = status === 'scored' ? 'Hard Mode review complete.'
    : status === 'unavailable' ? 'The review is unavailable. Your answer is saved.'
      : 'The GM could not verify this answer.';
  return {status, score, rubricVersion, feedback};
}

function disconnectSignal(response) {
  const controller = new AbortController();
  activeRequests.add(controller);
  response.once('close', () => {
    activeRequests.delete(controller);
    if (!response.writableEnded) controller.abort();
  });
  return controller.signal;
}

async function saveAnswer(request, response, world, heroId) {
  const data = await readJson(request);
  const page = pageAt(world, data.page);
  const prompt = promptAt(page, data.promptId);
  const value = string(data.value, prompt.type === 'code' ? codeLimit : textLimit, 'Answer');
  const {store, info:{id:worldId}} = world;
  const rubric = prompt.type === 'text' ? writtenGm.getPrompt(worldId, prompt.id, prompt.body) : null;
  if (rubric) {
    const {ticket, prior} = prepareSubmission(store, heroId, data, ['written', page.page, prompt.id, value]);
    const writeResult = outcome => {
      const result = submissionResult(outcome);
      return json(response, {...result, assessment:visibleAssessment(world, heroId, page.level, result.assessment)});
    };
    if (prior) return writeResult(prior);
    const revision = store.startAssessment(heroId, page.page, prompt.id, value);
    const signal = disconnectSignal(response);
    const result = await runLocalJob(() => writtenGm.assess(worldId, prompt.id, prompt.body, value, {signal}), {
      status:'unavailable', score:null, feedbackId:'busy', feedback:'The local workbench is busy. Try again in a moment.',
      criteria:[], rubricVersion:rubric.version,
    }, signal);
    if (signal.aborted) return;
    // Model feedback is advisory. Keep the receipt for retries, but never deal damage.
    const outcome = store.settleCombat(heroId, ticket, () => {
      if (!store.completeAssessment(heroId, page.page, prompt.id, revision, result)) {
        throw new HttpError(409, 'A newer version of this answer was saved.');
      }
      return {feedback:'Your response is saved.', correct:null, assessment:result};
    });
    return writeResult(outcome);
  }
  let correct = null;
  let feedback = prompt.feedback;
  if (prompt.type === 'choice') {
    if (!prompt.options.some(option => option.id === value)) throw new HttpError(400, 'Choose one of the listed options.');
    correct = prompt.correctOption === value;
    feedback = prompt.feedbackByOption?.[value] ?? prompt.feedback;
    const {ticket, prior} = prepareSubmission(store, heroId, data, ['choice', page.page, prompt.id, value]);
    const outcome = prior ?? store.settleCombat(heroId, {...ticket, wrong:!correct}, () => {
      store.saveResponse(heroId, page.page, prompt.id, value, feedback, correct);
      return {feedback, correct};
    });
    return json(response, submissionResult(outcome));
  } else if (authoredTrainingAnswer(worldId, prompt) || store.workbenchMode(heroId, page.level).mode === 'hard') {
    feedback = 'Your response is saved.';
  }
  store.saveResponse(heroId, page.page, prompt.id, value, feedback, correct);
  json(response, {feedback, correct});
}

async function revealAnswer(request, response, world, heroId) {
  const data = await readJson(request);
  const page = pageAt(world, data.page);
  const prompt = promptAt(page, data.promptId);
  const rubric = prompt.type === 'text' ? writtenGm.getPrompt(world.info.id, prompt.id, prompt.body) : null;
  const reference = rubric ? writtenGm.reveal(world.info.id, prompt.id, prompt.body) : authoredTrainingAnswer(world.info.id, prompt);
  if (!reference) throw new HttpError(404, 'No example answer is available.');
  if (!world.store.revealWorkbenchAid(heroId, page.level)) {
    const prior = world.store.progress(heroId).responses.find(answer => answer.page === page.page && answer.promptId === prompt.id);
    if (!rubric || prior?.assessment?.score !== 100 || prior.assessment.rubricVersion !== rubric.version) {
      throw new HttpError(403, 'Hard Mode locks the example answer.');
    }
    world.store.revealWorkbenchAid(heroId, page.level, true);
  }
  json(response, {text:reference});
}

function currentProgress(world, heroId) {
  const progress = world.store.progress(heroId);
  progress.workbench = world.store.workbenchState(heroId);
  progress.combat = publicCombat(world.store.combatState(heroId));
  for (const answer of progress.responses) {
    const page = world.pages[answer.page - 1];
    const prompt = page?.prompts.find(item => item.id === answer.promptId);
    if (!prompt) continue;
    if (prompt.exerciseId) {
      if (authoredTrainingAnswer(world.info.id, prompt) || world.store.workbenchMode(heroId, page.level).mode === 'hard') {
        answer.feedback = 'Your response is saved.';
      }
      continue;
    }
    if (prompt.type === 'choice') {
      if (!prompt.options.some(option => option.id === answer.value)) continue;
      answer.correct = prompt.correctOption === answer.value;
      answer.feedback = prompt.feedbackByOption?.[answer.value] ?? prompt.feedback ?? answer.feedback;
    } else if (prompt.type === 'text' && writtenGm.getPrompt(world.info.id, prompt.id, prompt.body)) {
      answer.feedback = 'Your response is saved.';
      if (answer.assessment) answer.assessment = visibleAssessment(world, heroId, page.level, answer.assessment);
    } else if (authoredTrainingAnswer(world.info.id, prompt) || world.store.workbenchMode(heroId, page.level).mode === 'hard') {
      answer.feedback = 'Your response is saved.';
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
  if (Object.keys(data).some(key => !['stageId','optionId','submissionId'].includes(key))) {
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
  const {ticket, prior} = prepareSubmission(store, heroId, data, ['encounter', encounter.id, stageId, optionId]);
  if (prior) return json(response, submissionResult(prior));

  const before = store.encounterResults(heroId, encounter.id);
  if (before.has(stageId)) {
    return json(response, {completed:completedStages(encounter, before), result:before.get(stageId)});
  }
  if (encounter.stages.find(item => !before.has(item.id)) !== stage) {
    throw new HttpError(409, 'Finish the earlier stages first.');
  }

  const attempt = await evaluateStage(encounter, stage, optionId);
  const current = store.encounterResults(heroId, encounter.id);
  if (current.has(stageId)) return json(response, {completed:completedStages(encounter, current), result:current.get(stageId)});
  const finalStage = encounter.stages.at(-1) === stage;
  const outcome = store.settleCombat(heroId, {...ticket, wrong:!attempt.correct,
    rewardKey:attempt.correct && finalStage ? `encounter:${encounter.id}` : undefined}, () => {
    if (attempt.correct) store.recordEncounterStage(heroId, encounter.id, stageId, attempt);
    const after = store.encounterResults(heroId, encounter.id);
    return {completed:completedStages(encounter, after), result:after.get(stageId) ?? attempt};
  });
  json(response, submissionResult(outcome));
}

function codeSubmission(data) {
  const purpose = data.purpose ?? 'submit';
  if (!['examples','submit'].includes(purpose)) throw new HttpError(400, 'Choose Run Examples or Submit.');
  const code = string(data.code, codeLimit, 'Code');
  if (!code.trim()) throw new HttpError(400, 'Enter code before running tests.');
  return {purpose, code};
}

function runWorldExercise(world, exercise, code, purpose, signal) {
  const noRun = (verdict, output) => ({verdict, output, passed:0, failed:0, passedTests:[], failedTests:[], cases:[], groups:[]});
  return runLocalJob(async () => {
    const language = world.info.id;
    if (language === 'javascript' || language === 'typescript') {
      return runCourseExercise(language, code, exercise, purpose, signal);
    }
    const diagnostics = await standalone.diagnostics(language);
    if (diagnostics.available) {
      const fixtures = fixtureMetadata(exercise).filter(fixture => purpose === 'submit' || fixture.visibility === 'public');
      const raw = await standalone.grade({language, source:code, exercise, tests:exercise.tests,
        caseIds:fixtures.map(({id}) => id), signal});
      return presentWorkbenchRun(raw, fixtures);
    }
    if (world.rust && !desktopToken) return runLegacyRust(grade, code, exercise, purpose, signal);
    return noRun('unavailable', desktopToken ? diagnostics.detail
      : `The local ${world.info.name} sandbox is unavailable. Your draft is saved.`);
  }, noRun('busy', 'The local evaluation queue is full. Try again in a moment.'), signal);
}

async function submitCode(request, response, world, heroId) {
  const {exerciseMap, store} = world;
  if (!exerciseMap.size) throw new HttpError(409, 'Save a draft and use the guided Forge review for this world.');
  const data = await readJson(request);
  const page = pageAt(world, data.page);
  const prompt = promptAt(page, data.promptId);
  const exercise = exerciseMap.get(data.exerciseId);
  if (!exercise || prompt.exerciseId !== exercise.id || page.level !== exercise.level) {
    throw new HttpError(400, 'The exercise does not belong to this page and prompt.');
  }
  const {purpose, code} = codeSubmission(data);
  const submission = purpose === 'submit' ? prepareSubmission(store, heroId, data, ['workbench', exercise.id, code]) : null;
  if (submission?.prior) return json(response, submissionResult(submission.prior));
  const {mode} = store.workbenchMode(heroId, page.level);
  store.saveResponse(heroId, page.page, prompt.id, code, 'Your submission is saved.');
  const signal = disconnectSignal(response);
  const result = await runWorldExercise(world, exercise, code, purpose, signal);
  if (signal.aborted) return;
  const runId = submission?.ticket.id ?? randomUUID();
  const {suiteRevision} = exercise;
  const report = {...result, purpose, mode, runId, suiteRevision, newClear:false, hardClear:false};
  if (submission && ['pass','fail','compile_error','timeout'].includes(result.verdict)) {
    const outcome = store.settleCombat(heroId, {...submission.ticket,
      wrong:result.verdict === 'fail' || result.verdict === 'compile_error',
      rewardKey:result.verdict === 'pass' ? `forge:${exercise.id}` : undefined}, () => {
      const completion = store.recordAttempt(heroId, {page:page.page, promptId:prompt.id, level:page.level,
        exerciseId:exercise.id, code, purpose, mode, runId, suiteRevision, ...result});
      return {...report, ...completion};
    });
    return json(response, submissionResult(outcome));
  }
  json(response, report);
}

function refactoringView(world, heroId) {
  const {store} = world;
  const {page} = world.refactoring;
  const results = store.encounterResults(heroId, refactoringQuest.id);
  const completed = completedStages(refactoringQuest, results);
  const draftFor = id => store.response(heroId, page, `refactoring-${id}`)?.value;
  const boundary = results.has('extract-boundary') ? draftFor('extract-boundary') : undefined;
  const stages = refactoringQuest.stages.map(({id, kind, title, prompt, options, exercise}) => {
    if (kind === 'choice') return {id, kind, title, prompt, options};
    const {signature, starter, testNames, requiredCases} = workbenchSummary(exercise);
    return {id, kind, title, prompt, signature, testNames, requiredCases, draft:draftFor(id),
      starter:id === 'refactor-policy' && boundary ? `${boundary.trimEnd()}\n\n${starter}` : starter};
  });
  const {title, description, legacyCode} = refactoringQuest;
  const oneLife = store.combatState(heroId).mode === 'one-life';
  const reward = completed.length === stages.length
    ? (oneLife ? 'The guild awarded you one healing potion.' : 'The Relay Ledger is ready for a staged rollout.')
    : undefined;
  return {title, description, legacyCode, stages, completed, reward};
}

async function submitRefactoring(request, response, world, heroId) {
  const {store} = world;
  const {page} = world.refactoring;
  const data = await readJson(request);
  const stage = refactoringQuest.stages.find(item => item.id === data.stageId);
  if (!stage) throw new HttpError(400, 'Choose a stage of the refactoring quest.');

  const isCode = stage.kind === 'code';
  const allowed = isCode ? ['stageId', 'code', 'purpose', 'submissionId'] : ['stageId', 'optionId', 'submissionId'];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new HttpError(400, 'Send an answer for this quest stage.');
  if (!isCode && !stage.options.some(({id}) => id === data.optionId)) throw new HttpError(400, 'Choose one of the listed answers.');
  const {code, purpose} = isCode ? codeSubmission(data) : {purpose:'submit'};
  const examples = purpose === 'examples';
  const submission = examples ? null : prepareSubmission(store, heroId, data,
    [refactoringQuest.id, stage.id, isCode ? code : data.optionId], true);
  const view = result => ({...refactoringView(world, heroId), result});
  const respond = outcome => json(response, submissionResult({...outcome, result:view(outcome.result.result)}, true));
  const currentOutcome = result => ({result:{result}, combat:store.combatState(heroId),
    combatEvent:{damage:0, healing:0, potionsEarned:0}});
  if (submission?.prior) return respond(submission.prior);

  const progress = () => store.encounterResults(heroId, refactoringQuest.id);
  const draftKey = `refactoring-${stage.id}`;
  const previous = store.withEncounter(() => {
    const results = progress();
    if (results.has(stage.id)) return results.get(stage.id);
    if (refactoringQuest.stages.find(item => !results.has(item.id)) !== stage) {
      throw new HttpError(409, 'Finish the earlier stages first.');
    }
    if (isCode) store.saveResponse(heroId, page, draftKey, code, 'Your refactoring draft is saved.');
  });
  if (previous) return examples ? json(response, view(previous)) : respond(currentOutcome(previous));

  let attempt;
  if (isCode) {
    const signal = disconnectSignal(response);
    const run = await runWorldExercise(world, stage.exercise, code, purpose, signal);
    if (signal.aborted) return;
    attempt = {...run, purpose, correct:run.verdict === 'pass',
      feedback:run.verdict === 'pass'
        ? (examples ? 'The examples passed. Submit the refactor to run the full suite.' : 'The refactor passed the full regression suite.')
        : 'Your draft is saved. Review the workbench result and try again.'};
    if (examples || !['pass', 'fail', 'compile_error'].includes(run.verdict)) return json(response, view(attempt));
  } else {
    const correct = data.optionId === stage.answer;
    attempt = {correct, feedback:correct ? stage.success : stage.retry};
  }

  const outcome = store.withEncounter(() => {
    const prior = store.combatReceipt(heroId, submission.ticket);
    if (prior) return prior;
    const completed = progress().get(stage.id);
    if (completed) return currentOutcome(completed);
    const rewardKey = attempt.correct && refactoringQuest.stages.at(-1) === stage
      ? `encounter:${refactoringQuest.id}` : undefined;
    return store.settleCombat(heroId, {...submission.ticket, wrong:!attempt.correct, rewardKey}, () => {
      if (attempt.correct) {
        if (isCode) store.saveResponse(heroId, page, draftKey, code, 'The refactor passed.');
        store.recordEncounterStage(heroId, refactoringQuest.id, stage.id, attempt);
      }
      return {result:attempt};
    });
  });
  respond(outcome);
}

async function submitDiamond(request, response, world, heroId) {
  const {store, info:{id:worldId}} = world;
  const data = await readJson(request);
  const {stageId} = data;
  const view = result => ({...diamondView(store, heroId, worldId), result});
  const combatView = result => ({...view(result), combat:publicCombat(store.combatState(heroId))});
  const respond = outcome => json(response, submissionResult(refreshDiamondOutcome(store, heroId, worldId, outcome), true));
  if (stageId !== 'code' && stageId !== 'choice') throw new HttpError(400, 'Choose a goblin challenge.');
  const allowedKeys = stageId === 'code' ? ['stageId','submissionId','code','purpose'] : ['stageId','submissionId','optionId'];
  if (Object.keys(data).some(key => !allowedKeys.includes(key))) throw new HttpError(400, 'Send an answer for this challenge.');
  if (stageId === 'choice') {
    const attempt = evaluateDiamondChoice(worldId, data.optionId);
    if (!attempt) throw new HttpError(400, 'Choose one of the listed answers.');
    const {ticket, prior} = prepareSubmission(store, heroId, data, ['diamond', stageId, data.optionId], true);
    if (prior) return respond(prior);
    const completed = diamondStage(store, heroId, worldId, stageId);
    if (completed) return json(response, combatView(completed));
    return respond(settleDiamond(store, heroId, worldId, stageId, ticket, attempt));
  }
  const {purpose, code} = codeSubmission(data);
  const submission = purpose === 'submit' ? prepareSubmission(store, heroId, data, ['diamond', stageId, code], true) : null;
  if (submission?.prior) return respond(submission.prior);
  const completed = diamondStage(store, heroId, worldId, stageId);
  if (completed) return json(response, combatView(completed));
  if (store.combatState(heroId).fallen) throw new HttpError(409, 'This hero has fallen. Choose another hero to keep submitting.');
  store.saveDiamondDraft(heroId, code);
  const signal = disconnectSignal(response);
  const run = await runWorldExercise(world, diamondExercise(worldId), code, purpose, signal);
  if (signal.aborted) return;
  const attempt = evaluateDiamondCode({...run, purpose});
  if (purpose === 'examples' || !['pass','fail','compile_error'].includes(run.verdict)) {
    return json(response, combatView(attempt));
  }
  return respond(settleDiamond(store, heroId, worldId, stageId, submission.ticket, attempt));
}

async function submitTrial(request, response, world, heroId, trialId) {
  const trial = trialsFor(world.info.id).find(item => item.id === trialId);
  if (!trial) throw new HttpError(404, 'Trial not found in this world.');
  const data = await readJson(request);
  const result = evaluateTrial(world.info.id, trialId, data.answers);
  if (!result) throw new HttpError(400, 'Choose an answer for each trial question.');
  const identity = ['trial', trialId, trial.questions.map(({id}) => data.answers[id])];
  const {store} = world;
  const {ticket, prior} = prepareSubmission(store, heroId, data, identity, true);
  if (prior) return json(response, submissionResult(prior, true));
  const outcome = store.settleCombat(heroId, {...ticket, wrong:!result.correct, trialId:result.correct ? trialId : undefined}, () => {
    if (store.combatState(heroId).completedTrials.includes(trialId)) throw new HttpError(409, 'This trial is already cleared.');
    return result;
  });
  json(response, submissionResult(outcome, true));
}

async function drinkPotion(request, response, store, heroId) {
  const data = await readJson(request);
  const {ticket, prior} = prepareSubmission(store, heroId, data, ['potion'], true);
  json(response, submissionResult(prior ?? store.consumePotion(heroId, ticket), true));
}

async function revealSuggestion(request, response, world, heroId) {
  const data = await readJson(request);
  const page = pageAt(world, data.page);
  const prompt = promptAt(page, data.promptId);
  const suggestion = prompt.exerciseId === data.exerciseId ? suggestions.get(prompt.exerciseId) : null;
  if (!suggestion) throw new HttpError(404, 'No code suggestion is available.');
  if (!world.store.revealWorkbenchAid(heroId, page.level)) {
    throw new HttpError(403, 'Hard Mode locks code suggestions.');
  }
  json(response, suggestion);
}

const types = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.webp':'image/webp', '.pdf':'application/pdf', '.zip':'application/zip'};
const publicFiles = new Set(['/index.html', '/styles.css',
  ...worlds.flatMap(({info}) => [info.bookUrl, info.kitUrl].filter(Boolean))]);
const pageAsset = /^\/book\/(?:(?:javascript|typescript|go)\/)?pages\/[1-9]\d{0,2}\.webp$/;

async function staticFile(request, response, path) {
  const named = path === '/' ? '/index.html' : path;
  const builtAsset = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(named);
  if (!publicFiles.has(named) && !pageAsset.test(named) && !builtAsset) throw new HttpError(404, 'Page not found.');
  const file = join(named.startsWith('/book/') ? publicDir : rendererDir, named.slice(1));
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
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const activePort = server.address().port;
    const host = request.headers.host;
    const allowedHosts = [`127.0.0.1:${activePort}`, `localhost:${activePort}`];
    if (!allowedHosts.includes(host)) throw new HttpError(403, 'Use the local Ferrum URL.');
    if (desktopSecret) {
      const token = request.headers['x-ferrum-desktop-token'];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
          || !timingSafeEqual(Buffer.from(token, 'hex'), desktopSecret)) {
        throw new HttpError(403, 'Open Coding Dungeons from its desktop window.');
      }
    }
    const {pathname:path, searchParams} = new URL(request.url, `http://${host}`);
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
    if (path === '/api/refactoring' && (method === 'GET' || method === 'POST')) {
      if (!world.refactoring) throw new HttpError(404, 'The refactoring quest is in JavaScript World 1.');
      const heroId = await requireHero(request, world);
      if (method === 'POST') return await submitRefactoring(request, response, world, heroId);
      return json(response, refactoringView(world, heroId));
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
      if (path === '/api/trials') return json(response, {trials:trialsFor(world.info.id)});
      if (path === '/api/diamond') {
        const heroId = await requireHero(request, world);
        const page = pageAt(world, Number(searchParams.get('page'))).page;
        return json(response, diamondView(store, heroId, world.info.id, page, world.pages.length));
      }
      if (path === '/api/heroes') return json(response, {heroes:await store.heroes()});
      if (path === '/api/progress') return json(response, currentProgress(world, await requireHero(request, world)));
      if (path === '/api/status') {
        const language = world.info.id;
        const native = language === 'rust' || language === 'go';
        const diagnostics = native ? await standalone.diagnostics(language) : null;
        const available = diagnostics?.available ?? world.exerciseMap.size > 0;
        const runner = available ? 'available' : world.rust && !desktopToken ? await runnerStatus() : 'unavailable';
        return json(response, {
          storage:store.label, runner,
          ...(desktopToken && diagnostics?.detail ? {runnerDetail:diagnostics.detail} : {}),
        });
      }
      const match = path.match(/^\/api\/pages\/(\d+)$/);
      if (match) return json(response, world.publicPages[pageAt(world, Number(match[1])).page-1]);
    }
    if (method === 'POST') {
      const hintRoute = path.match(/^\/api\/levels\/(\d+)\/reveal\/(hint1|hint2|debrief)$/);
      if (hintRoute) {
        const quest = world.questMap.get(Number(hintRoute[1]));
        if (!quest) throw new HttpError(404, 'Level not found.');
        const heroId = await requireHero(request, world);
        await readJson(request);
        if (!store.revealWorkbenchAid(heroId, quest.level)) {
          if (!quest.bossExerciseId || !store.workbenchState(heroId).hardExerciseClears.includes(quest.bossExerciseId)) {
            throw new HttpError(403, 'Hard Mode locks the guide kit.');
          }
          store.revealWorkbenchAid(heroId, quest.level, true);
        }
        return json(response, {text:quest[hintRoute[2]]});
      }
    }
    if (method === 'PATCH') {
      if (path === '/api/profile') return await profilePatch(request, response, world, await requireHero(request, world));
      const modeRoute = path.match(/^\/api\/workbench\/(\d+)\/mode$/);
      if (modeRoute) {
        const level = Number(modeRoute[1]);
        if (!world.questMap.has(level)) throw new HttpError(404, 'Level not found.');
        const heroId = await requireHero(request, world);
        const {mode} = await readJson(request);
        if (!['guided','hard'].includes(mode)) throw new HttpError(400, 'Choose Guided or Hard Mode.');
        return json(response, store.setWorkbenchMode(heroId, level, mode));
      }
      const match = path.match(/^\/api\/progress\/(\d+)$/);
      if (match) return await levelPatch(request, response, world, await requireHero(request, world), Number(match[1]));
    }
    if (method === 'POST') {
      const trialRoute = path.match(/^\/api\/trials\/([a-z0-9-]{1,64})$/);
      if (trialRoute) return await submitTrial(request, response, world, await requireHero(request, world), trialRoute[1]);
      if (path === '/api/diamond/start') {
        const heroId = await requireHero(request, world);
        const data = await readJson(request);
        const page = pageAt(world, data.page).page;
        return json(response, startDiamond(store, heroId, world.info.id, page, world.pages.length));
      }
      if (path === '/api/diamond/submit') return await submitDiamond(request, response, world, await requireHero(request, world));
      if (path === '/api/combat/potion') return await drinkPotion(request, response, store, await requireHero(request, world));
      if (path === '/api/heroes') return await createHero(request, response, world);
      if (path === '/api/heroes/load') return await loadHero(request, response, world);
      if (path === '/api/answers') return await saveAnswer(request, response, world, await requireHero(request, world));
      if (path === '/api/answers/reveal') return await revealAnswer(request, response, world, await requireHero(request, world));
      if (path === '/api/workbench/suggestion') return await revealSuggestion(request, response, world, await requireHero(request, world));
      if (path === '/api/grade') return await submitCode(request, response, world, await requireHero(request, world));
    }
    throw new HttpError(404, 'Route not found.');
  } catch (error) {
    if (response.headersSent) return response.destroy();
    if (error.code === 'HERO_EXISTS') return json(response, {error:'A hero with that name already exists. Load it or choose another name.'}, 409);
    if (error.code === 'DIAMOND_NOT_FOUND') return json(response, {error:error.message}, 404);
    if (error.code === 'DIAMOND_STAGE_INVALID') return json(response, {error:error.message}, 400);
    if (error.code === 'DIAMOND_STAGE_LOCKED') return json(response, {error:error.message}, 409);
    if (['HERO_FALLEN','COMBAT_SUBMISSION_CONFLICT','POTION_UNAVAILABLE','HEALTH_FULL'].includes(error.code)) {
      return json(response, {error:error.message}, 409);
    }
    if (!(error instanceof HttpError)) console.error(error.message);
    json(response, {error:error instanceof HttpError ? error.message : 'Ferrum could not complete this request.'}, error.status ?? 500);
  }
});

server.requestTimeout = 20000;
server.listen(port, '127.0.0.1', () => {
  console.log(`Ferrum at http://127.0.0.1:${server.address().port} (${worldMap.get('rust').store.label})`);
  process.parentPort?.postMessage({type:'ferrum-ready', port:server.address().port});
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const controller of activeRequests) controller.abort();
  server.close(() => {
    for (const {store} of worlds) store.close();
  });
  server.closeAllConnections();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.parentPort?.on('message', event => {
  if (event.data?.type === 'ferrum-shutdown') {
    shutdown();
    process.parentPort.close();
  }
});
