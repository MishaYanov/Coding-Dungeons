import { suggestions } from '../../data/workbench/suggestions.mjs';
import {compatibleBookResponse, findBookResponse, remapBookResponses} from '../book-revisions.mjs';
import { evaluateStage } from '../encounters.mjs';
import { emptyMerchant, equipMerchant, merchantView, purchaseMerchant, submitMerchantChallenge } from '../merchant.mjs';
import { evaluateTrial, trialsFor } from '../trials.mjs';
import { fixtureMetadata, presentWorkbenchRun } from '../workbench-report.mjs';
import { localCatalog, mobileWorlds } from './catalog.mjs';
import { createMobileRepository } from './repository.mjs';
import { checkAlive, combat, combatResult, createHeroRecord, heroIdPattern, maxPotions, modeFor, nameKey, receipt,
  responseKey, revealAid, saveResponse, setMode, settle, submission } from './hero-state.mjs';
import { reviewWritten, visibleWritten } from './written-review.mjs';
import { mobileBackup } from './backup.mjs';
import { earnedDiamonds, mobileEncounters } from './encounters.mjs';
import { checkedText, codeInput, codeLimit, textLimit } from './input.mjs';

const graded = ['pass', 'fail', 'compile_error', 'timeout'];
const responseSaved = 'Your response is saved.';
const merchantFields = new Map([
  ['purchase', ['itemId', 'submissionId']],
  ['equip', ['itemId', 'equipped']],
  ['challenge', ['answers', 'submissionId']],
]);

function heroName(value) {
  const name = checkedText(value, 60, 'Hero name').normalize('NFC').trim();
  if (!nameKey(name) || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Enter a hero name.');
  return checkedText(name, 60, 'Hero name');
}

function checkNames(records) {
  const names = records.map(({hero}) => nameKey(hero.name));
  if (new Set(names).size !== names.length) throw new Error('A hero with that name already exists. Load it or choose another name.');
}

function verifyId(id) {
  if (typeof id !== 'string' || !heroIdPattern.test(id)) throw new Error('Choose a saved hero.');
  return id;
}

function requiredPrompt(page, id) {
  const prompt = page.prompts.find(item => item.id === id);
  if (!prompt) throw new Error('Prompt not found on this page.');
  return prompt;
}

function choiceFeedback(prompt, value) {
  return prompt.feedbackByOption?.[value] ?? prompt.feedback ?? responseSaved;
}

function merchantContext(record) {
  return {earned:earnedDiamonds(record), oneLife:record.hero.oneLife === true, fallen:record.hp === 0};
}

function publicMerchant(worldId, record) {
  return merchantView(worldId, record.merchant ?? emptyMerchant(), merchantContext(record));
}

function publicProgress(record, pages, rubricFor, exampleAnswerFor, worldId) {
  const {hero} = record;
  const modes = Object.entries(record.modes).map(([level, mode]) => ({level:Number(level), ...mode}));
  const clears = Object.entries(record.clears);
  const hard = clears.filter(([, clear]) => clear.hard);
  const responses = remapBookResponses(worldId, Object.values(record.responses)).map(answer => {
    const page = pages[answer.page - 1];
    const prompt = page?.prompts.find(item => item.id === answer.promptId);
    if (!prompt) return answer;
    if (prompt.type === 'choice') {
      return {...answer, correct:prompt.correctOption === answer.value, feedback:choiceFeedback(prompt, answer.value)};
    }
    const {mode} = modeFor(record, page.level);
    return {...answer, ...(mode === 'hard' || rubricFor(prompt) || exampleAnswerFor(prompt) ? {feedback:responseSaved} : {}),
      ...(answer.assessment ? {assessment:visibleWritten(answer.assessment, mode)} : {})};
  });
  return {
    profile:{id:hero.id, callsign:hero.name, path:hero.path, lastPage:hero.lastPage},
    levels:Object.values(record.levels), responses, attempts:record.attempts,
    workbench:{modes, clears:clears.map(([id]) => id), hardExerciseClears:hard.map(([id]) => id),
      hardClears:[...new Set(hard.map(([, value]) => value.level))]},
    combat:combat(record),
    merchant:publicMerchant(worldId, record),
  };
}

function saveLevel(record, level, body, quest, gradedLevels, worldId) {
  if (!quest) throw new Error('Level not found.');
  const changes = {};
  for (const key of ['scout', 'explain', 'side', 'forge']) {
    if (!Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
    if (key === 'forge') {
      if (gradedLevels.has(level)) throw new Error('Passing the code exercise earns Forge on this level.');
      if (body.forge && !compatibleBookResponse(worldId, quest.bossPage, `boss-${level}`,
        (page, id) => record.responses[responseKey(page, id)])?.value.trim()) {
        throw new Error('Save your boss encounter draft before marking Forge.');
      }
    }
    checkAlive(record);
    changes[key] = body[key];
  }
  if ('answer' in body) changes.answer = checkedText(body.answer, textLimit, 'Answer');
  if ('code' in body) changes.code = checkedText(body.code, codeLimit, 'Code');
  if (!Object.keys(changes).length) throw new Error('Provide a quest log change.');
  record.levels[level] = {level, ...record.levels[level], ...changes};
  return {ok:true};
}

function updateProfile(record, body, pageAt, routes) {
  const changes = {};
  if ('callsign' in body) changes.name = heroName(body.callsign);
  if ('path' in body) {
    if (!routes.has(body.path)) throw new Error('Unknown route.');
    changes.path = body.path || 'all';
  }
  if ('lastPage' in body) changes.lastPage = pageAt(body.lastPage).page;
  if (!Object.keys(changes).length) throw new Error('Provide a profile change.');
  Object.assign(record.hero, changes);
  return {ok:true, hero:record.hero};
}

async function defaultGrade(request) {
  const {runBrowserWorkbench} = await import('./runner.mjs');
  return runBrowserWorkbench(request);
}

function readerStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function createMobileEngine({worldId = 'javascript', assetUrl = value => value,
  repository = createMobileRepository(undefined, worldId), grade = defaultGrade, storage = readerStorage(),
  goRunnerAvailable = false, rustRunnerAvailable = false, rustRunnerVersion = ''} = {}) {
  const catalog = localCatalog(worldId, assetUrl);
  const {campaign, pages, world, bossByLevel, encounterMap, exerciseMap, questMap, routes, rubricFor,
    sideQuestMap, visiblePage, exampleAnswerFor = () => null} = catalog;
  const gradedLevels = new Set([...exerciseMap.values()].map(({level}) => level));
  const nativeRunner = worldId === 'go' && goRunnerAvailable === true
    || worldId === 'rust' && rustRunnerAvailable === true;
  const runnerAvailable = worldId === 'javascript' || worldId === 'typescript' || nativeRunner;
  const rustVersion = typeof rustRunnerVersion === 'string' && rustRunnerVersion.trim();
  const runnerDetail = runnerAvailable ? worldId === 'rust'
    ? `Experimental Rust${rustVersion ? ` ${rustVersion}` : ' (compiler version unavailable)'} workbench. Newer language features may be unavailable.`
    : `Offline ${world.name} workbench`
    : worldId === 'csharp' ? 'Save a C# draft here. Run it on a computer with the .NET 10 SDK and use the debrief to review it.'
      : `${world.name} code tests are unavailable in this mobile build.`;
  const pageAt = number => {
    if (!Number.isSafeInteger(number) || number < 1 || number > pages.length) throw new Error('Page not found.');
    return pages[number - 1];
  };
  const getHero = async id => {
    const record = await repository.get(verifyId(id));
    if (!record) throw new Error('Hero not found.');
    return record;
  };
  const edit = (id, action, check) => repository.mutate(id, record => {
    const result = action(record);
    record.hero.updatedAt = new Date().toISOString();
    return result;
  }, check);
  const run = async (exercise, code, purpose, signal) => {
    signal?.throwIfAborted();
    if (!runnerAvailable) return {verdict:'unavailable', output:runnerDetail,
      passed:0, failed:0, passedTests:[], failedTests:[], cases:[], groups:[]};
    const fixtures = fixtureMetadata(exercise).filter(fixture => purpose === 'submit' || fixture.visibility === 'public');
    const suite = worldId === 'rust' ? {exercise, caseIds:fixtures.map(fixture => fixture.id)}
      : {tests:exercise.tests.filter(fixture => purpose === 'submit' || fixture.visibility === 'public'),
        typeTests:purpose === 'submit' ? exercise.typeTests : undefined};
    const raw = await grade({language:worldId, source:code, ...suite, signal});
    signal?.throwIfAborted();
    return presentWorkbenchRun(raw, fixtures);
  };
  const side = mobileEncounters({worldId, runnerAvailable, edit, run, pageAt, pageCount:pages.length});

  async function answer(id, body, signal) {
    const page = pageAt(body.page);
    const prompt = requiredPrompt(page, body.promptId);
    const value = checkedText(body.value, prompt.type === 'code' ? codeLimit : textLimit, 'Answer');
    const rubric = rubricFor(prompt);
    if (prompt.type === 'choice' || rubric) {
      if (prompt.type === 'choice' && !prompt.options.some(option => option.id === value)) {
        throw new Error('Choose one of the listed options.');
      }
      const current = await getHero(id);
      const ticket = await submission(current, body.submissionId, [rubric ? 'written' : 'choice', page.page, prompt.id, value]);
      signal?.throwIfAborted();
      return edit(id, record => {
        const correct = rubric ? null : prompt.correctOption === value;
        const outcome = settle(record, ticket, () => {
          const feedback = rubric ? responseSaved : choiceFeedback(prompt, value);
          const assessment = rubric ? reviewWritten(rubric, value) : undefined;
          saveResponse(record, page.page, prompt.id, value, feedback, correct, assessment);
          return {feedback, correct, ...(assessment ? {assessment} : {})};
        }, {wrong:correct === false});
        const result = combatResult(record, outcome);
        if (result.assessment) result.assessment = visibleWritten(result.assessment, modeFor(record, page.level).mode);
        return result;
      });
    }
    return edit(id, record => {
      const feedback = modeFor(record, page.level).mode === 'hard' || exampleAnswerFor(prompt)
        ? responseSaved : prompt.feedback ?? responseSaved;
      saveResponse(record, page.page, prompt.id, value, feedback);
      return {feedback, correct:null};
    });
  }

  async function gradeBoss(record, body, signal) {
    const {id} = record.hero;
    const page = pageAt(body.page);
    const prompt = requiredPrompt(page, body.promptId);
    const exercise = exerciseMap.get(body.exerciseId);
    if (!exercise || prompt.exerciseId !== exercise.id || page.level !== exercise.level) {
      throw new Error('The exercise does not belong to this page and prompt.');
    }
    const {code, purpose} = codeInput(body);
    const ticket = runnerAvailable && purpose === 'submit'
      ? await submission(record, body.submissionId, ['workbench', exercise.id, code]) : null;
    if (ticket) {
      const previous = receipt(record, ticket);
      if (previous) return combatResult(record, previous);
      checkAlive(record);
    }
    const {mode} = await edit(id, saved => {
      if (ticket) checkAlive(saved);
      saveResponse(saved, page.page, prompt.id, code, 'Your submission is saved.');
      return modeFor(saved, page.level);
    });
    const result = await run(exercise, code, purpose, signal);
    const report = {...result, purpose, mode, runId:ticket?.id ?? crypto.randomUUID(), suiteRevision:exercise.suiteRevision,
      newClear:false, hardClear:false};
    if (!ticket || !graded.includes(result.verdict)) return report;
    return edit(id, saved => combatResult(saved, settle(saved, ticket, () => {
      const clear = saved.clears[exercise.id];
      const pass = result.verdict === 'pass';
      const current = modeFor(saved, page.level);
      const hardClear = !!clear?.hard || pass && mode === 'hard' && current.mode === 'hard' && !current.assisted;
      saved.attempts = [{...report, hardClear, page:page.page, promptId:prompt.id, level:page.level,
        exerciseId:exercise.id, createdAt:new Date().toISOString()}, ...saved.attempts].slice(0, 100);
      if (pass) {
        saved.clears[exercise.id] = {level:page.level, hard:hardClear};
        saved.levels[page.level] = {level:page.level, ...saved.levels[page.level], forge:true};
      }
      return {...report, newClear:pass && !clear, hardClear};
    }, {wrong:['fail', 'compile_error'].includes(result.verdict), rewardKey:result.verdict === 'pass' ? `forge:${exercise.id}` : null})));
  }

  async function updateMerchant(record, action, body, signal) {
    const fields = merchantFields.get(action);
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== fields.length || !fields.every(field => Object.hasOwn(body, field))) {
      throw Object.assign(new Error('Send the fields for this merchant action.'), {status:400});
    }
    const {id} = record.hero;
    const {itemId, equipped} = body;
    if (action === 'equip') {
      return edit(id, saved => {
        signal?.throwIfAborted();
        saved.merchant = equipMerchant(saved.merchant ?? emptyMerchant(), itemId, equipped);
        return {merchant:publicMerchant(worldId, saved)};
      });
    }

    let entries;
    if (action === 'challenge') {
      const {answers} = body;
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)
        || !Object.values(answers).every(answer => typeof answer === 'string')) {
        throw Object.assign(new Error('Choose an answer for every vault question.'), {status:400});
      }
      entries = Object.entries(answers).sort(([left], [right]) => left.localeCompare(right));
    } else if (typeof itemId !== 'string') {
      throw Object.assign(new Error('Choose an item from the merchant.'), {status:400});
    }
    const ticket = await submission(record, body.submissionId, ['merchant', action, entries ?? itemId], true);
    return edit(id, saved => {
      signal?.throwIfAborted();
      const potionsBefore = saved.potions;
      const {result:report, combatEvent} = settle(saved, ticket, () => {
        const current = saved.merchant ?? emptyMerchant();
        if (action === 'purchase') {
          const {state, potion} = purchaseMerchant(current, itemId, merchantContext(saved));
          if (potion && saved.potions >= maxPotions) {
            throw Object.assign(new Error('Your potion bag is full.'), {status:409});
          }
          saved.merchant = state;
          if (potion) saved.potions++;
          return null;
        }
        const result = submitMerchantChallenge(worldId, current, Object.fromEntries(entries));
        saved.merchant = result.state;
        return result.report;
      });
      return {merchant:publicMerchant(worldId, saved), combat:combat(saved),
        combatEvent:{...combatEvent, potionsEarned:saved.potions - potionsBefore}, ...(report ? {report} : {})};
    });
  }

  async function api(path, {method = 'GET', body = {}, hero, signal} = {}) {
    signal?.throwIfAborted();
    if (method === 'GET') {
      if (path === '/api/worlds') return {worlds:mobileWorlds(assetUrl)};
      if (path === '/api/campaign') return campaign;
      if (path === '/api/status') return {storage:'Saved on this device', runner:runnerAvailable ? 'available' : 'unavailable',
        runnerDetail, capabilities:{offline:true, writtenReview:'rule-based', nativeRunner}};
      if (path === '/api/heroes') {
        const heroes = (await repository.list()).map(record => record.hero)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name));
        return {heroes};
      }
      const page = path.match(/^\/api\/pages\/(\d+)$/);
      if (page) return visiblePage(pageAt(Number(page[1])));
    }
    if (method === 'POST' && path === '/api/heroes') {
      const name = heroName(body.name);
      const selectedPath = body.path ?? 'all';
      if (!routes.has(selectedPath)) throw new Error('Unknown route.');
      if (body.oneLife !== undefined && typeof body.oneLife !== 'boolean') throw new Error('Choose whether to enable One Life.');
      const hero = {id:crypto.randomUUID(), name, path:selectedPath || 'all', lastPage:1,
        updatedAt:new Date().toISOString(), ...(body.oneLife ? {oneLife:true} : {})};
      await repository.create(createHeroRecord(hero), records => checkNames([...records, {hero}]));
      return {hero};
    }
    if (method === 'POST' && path === '/api/heroes/load') return {hero:(await getHero(body.id)).hero};
    const deleteRoute = method === 'DELETE' && path.match(/^\/api\/heroes\/([^/]+)$/);
    if (deleteRoute) return {deleted:await repository.remove(verifyId(deleteRoute[1])), clearReaderData:true};
    if (!hero) throw new Error('Choose a hero to save your expedition.');
    const {id} = hero;
    const record = await getHero(id);
    if (method === 'GET' && path === '/api/progress') return publicProgress(record, pages, rubricFor, exampleAnswerFor, worldId);
    if (method === 'GET' && path === '/api/merchant') return publicMerchant(worldId, record);
    if (method === 'GET' && path === '/api/trials') return {trials:trialsFor(worldId)};
    if (method === 'PATCH') {
      if (path === '/api/profile') return edit(id, saved => updateProfile(saved, body, pageAt, routes),
        'callsign' in body ? checkNames : undefined);
      const level = path.match(/^\/api\/progress\/(\d+)$/);
      if (level) {
        const number = Number(level[1]);
        return edit(id, saved => saveLevel(saved, number, body, questMap.get(number), gradedLevels, worldId));
      }
      const mode = path.match(/^\/api\/workbench\/(\d+)\/mode$/);
      if (mode) {
        if (!questMap.has(Number(mode[1]))) throw new Error('Level not found.');
        if (!['guided','hard'].includes(body.mode)) throw new Error('Choose Guided or Hard Mode.');
        return edit(id, saved => ({level:Number(mode[1]), ...setMode(saved, Number(mode[1]), body.mode)}));
      }
    }
    if (method === 'POST') {
      const merchantAction = path.match(/^\/api\/merchant\/(purchase|equip|challenge)$/);
      if (merchantAction) return updateMerchant(record, merchantAction[1], body, signal);
      if (path === '/api/answers') return answer(id, body, signal);
      if (path === '/api/grade') return gradeBoss(record, body, signal);
      if (path === '/api/combat/potion') {
        const ticket = await submission(record, body.submissionId, ['potion'], true);
        return edit(id, saved => combatResult(saved, settle(saved, ticket, () => null, {potion:true}), true));
      }
      const trialRoute = path.match(/^\/api\/trials\/([a-z0-9-]+)$/);
      if (trialRoute) {
        const trial = trialsFor(worldId).find(item => item.id === trialRoute[1]);
        if (!trial) throw new Error('Trial not found in this world.');
        const result = evaluateTrial(worldId, trial.id, body.answers);
        if (!result) throw new Error('Choose an answer for each trial question.');
        const ticket = await submission(record, body.submissionId, ['trial', trial.id, trial.questions.map(({id}) => body.answers[id])], true);
        return edit(id, saved => combatResult(saved, settle(saved, ticket, () => {
          if (saved.trialIds.includes(trial.id)) throw new Error('This trial is already cleared.');
          return result;
        }, {wrong:!result.correct, trialId:result.correct ? trial.id : null}), true));
      }
      if (path === '/api/answers/reveal' || path === '/api/workbench/suggestion') {
        const page = pageAt(body.page);
        const prompt = requiredPrompt(page, body.promptId);
        if (path === '/api/answers/reveal') {
          const rubric = rubricFor(prompt);
          const reference = rubric?.reference ?? exampleAnswerFor(prompt);
          if (!reference) throw new Error('No example answer is available.');
          return edit(id, saved => {
            const assessment = findBookResponse(worldId, Object.values(saved.responses), page.page, prompt.id)?.assessment;
            revealAid(saved, page.level, rubric && assessment?.score === 100 && assessment.rubricVersion === 'mobile-1',
              'Hard Mode locks the example answer.');
            return {text:reference};
          });
        }
        const suggestion = prompt.exerciseId === body.exerciseId && suggestions.get(body.exerciseId);
        if (!suggestion) throw new Error('No code suggestion is available.');
        return edit(id, saved => {
          revealAid(saved, page.level, false, 'Hard Mode locks code suggestions.');
          return suggestion;
        });
      }
      const hint = path.match(/^\/api\/levels\/(\d+)\/reveal\/(hint1|hint2|debrief)$/);
      if (hint) {
        const level = Number(hint[1]);
        const quest = questMap.get(level);
        if (!quest) throw new Error('Level not found.');
        return edit(id, saved => {
          revealAid(saved, level, saved.clears[bossByLevel.get(level)]?.hard, 'Hard Mode locks the guide kit.');
          return {text:quest[hint[2]]};
        });
      }
    }
    const encounterRoute = path.match(/^\/api\/encounters\/([a-z0-9-]+)$/);
    if (encounterRoute && encounterMap.has(encounterRoute[1])) return side.special(record, encounterMap.get(encounterRoute[1]), method, body, evaluateStage);
    if (sideQuestMap.has(path)) return side.quest(record, sideQuestMap.get(path), method, body, signal);
    if (/^\/api\/diamond(?:[/?]|$)/.test(path)) return side.diamond(record, path, method, body, signal);
    throw new Error('Route not found.');
  }

  return {api, ...mobileBackup(repository, storage, catalog)};
}
