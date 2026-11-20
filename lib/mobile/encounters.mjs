import { definitions, diamondChoiceStage, diamondChoices, diamondDescription, encounterId, evaluateDiamondChoice,
  evaluateDiamondCode, exerciseDescription, exerciseTitle, pageBlockSize, rewardDiamonds, stages, title } from '../diamond-content.mjs';
import { workbenchSummary } from '../workbench-report.mjs';
import {compatibleBookResponse} from '../book-revisions.mjs';
import { codeInput } from './input.mjs';
import { checkAlive, combat, combatResult, receipt, responseKey, saveResponse, settle, submission } from './hero-state.mjs';

const evaluated = ['pass', 'fail', 'compile_error'];

function resultsFor(record, id) {
  return record.encounters[id] ?? {};
}

function recordStage(record, id, stageId, result) {
  (record.encounters[id] ??= {})[stageId] = result;
}

function completedStages(catalog, results) {
  return catalog.stages.filter(({id}) => Object.hasOwn(results, id)).map(({id}) => id);
}

function checkStage(catalog, record, stage) {
  const results = resultsFor(record, catalog.id);
  if (results[stage.id]) return results[stage.id];
  if (catalog.stages.find(({id}) => !Object.hasOwn(results, id)) !== stage) {
    throw new Error('Finish the earlier stages first.');
  }
}

function sideView(record, {catalog, slug, page}, worldId) {
  const results = resultsFor(record, catalog.id);
  const completed = completedStages(catalog, results);
  const draftFor = id => compatibleBookResponse(worldId, page, `${slug}-${id}`,
    (savedPage, promptId) => record.responses[responseKey(savedPage, promptId)])?.value;
  const stageViews = catalog.stages.map(({id, kind, title, prompt, options, exercise, carryFrom}) => {
    if (kind === 'choice') return {id, kind, title, prompt, options};
    const {signature, starter, testNames, requiredCases} = workbenchSummary(exercise);
    const priorCode = carryFrom && results[carryFrom] ? draftFor(carryFrom) : undefined;
    return {id, kind, title, prompt, signature, testNames, requiredCases, draft:draftFor(id),
      starter:priorCode ? `${priorCode.trimEnd()}\n\n${starter}` : starter};
  });
  const {title, description, legacyCode, brief, debrief, standardReward} = catalog;
  const finished = completed.length === stageViews.length;
  const reward = finished ? (record.hero.oneLife ? 'The guild awarded you one healing potion.' : standardReward) : undefined;
  return {title, description, brief, legacyCode, debrief:finished ? debrief : undefined, stages:stageViews, completed, reward};
}

async function sparkle(heroId, worldId, page, pageCount) {
  const first = page - ((page - 1) % pageBlockSize);
  const length = Math.min(pageBlockSize, pageCount - first + 1);
  const seed = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([heroId, worldId, first]))));
  if (page !== first + seed[0] % length) return null;
  return {x:10 + seed[1] % 81, y:8 + seed[2] % 85};
}

export function earnedDiamonds(record) {
  const results = resultsFor(record, encounterId);
  return record.diamond && stages.every(stage => results[stage]?.correct === true) ? rewardDiamonds : 0;
}

function diamondView(record, diamondStages, description, found = null) {
  if (!record.diamond) return {sparkle:record.hp === 0 ? null : found, encounter:null, completed:[], diamonds:0, draft:''};
  const results = resultsFor(record, encounterId);
  const completed = stages.filter(stage => Object.hasOwn(results, stage));
  const diamonds = earnedDiamonds(record);
  return {sparkle:null, encounter:{id:encounterId, title, description, page:record.diamond.page, rewardDiamonds,
    stages:diamondStages}, completed, diamonds, draft:record.diamond.draft};
}

function checkDiamond(record, stage) {
  if (!record.diamond) throw new Error('Find a diamond to start this fight.');
  const results = resultsFor(record, encounterId);
  if (stage === 'choice' && !results.code) throw new Error('Crack the sack lock before answering the riddle.');
  return results[stage];
}

export function mobileEncounters({worldId, runnerAvailable, edit, run, pageAt, pageCount}) {
  const {lock, riddle} = diamondChoices(worldId);
  const diamondExercise = lock ? null : {...definitions[worldId], id:`${worldId}-${encounterId}`,
    title:exerciseTitle, description:exerciseDescription};
  const diamondStages = [lock ?? {
    ...workbenchSummary(diamondExercise), id:'code', kind:'code', prompt:exerciseDescription,
  }, riddle];
  const description = diamondDescription(worldId);
  const showDiamond = (record, found) => diamondView(record, diamondStages, description, found);

  async function special(record, catalog, method, body, evaluateStage) {
    const {id} = record.hero;
    if (method === 'GET') return {completed:completedStages(catalog, resultsFor(record, catalog.id))};
    if (method !== 'POST') throw new Error('Route not found.');
    const stage = catalog.stages.find(candidate => candidate.id === body.stageId);
    if (!stage) throw new Error('Choose a stage from this encounter.');
    if (stage.options?.length ? !stage.options.some(option => option.id === body.optionId) : Object.hasOwn(body, 'optionId')) {
      throw new Error('Send a stage and its listed option when required.');
    }
    const ticket = await submission(record, body.submissionId, ['encounter', catalog.id, stage.id, body.optionId]);
    const prior = receipt(record, ticket);
    if (prior) return combatResult(record, prior);
    checkAlive(record);
    const previous = checkStage(catalog, record, stage);
    if (previous) return {completed:completedStages(catalog, resultsFor(record, catalog.id)), result:previous};
    const attempt = await evaluateStage(catalog, stage, body.optionId);
    return edit(id, saved => {
      const replayed = receipt(saved, ticket);
      if (replayed) return combatResult(saved, replayed);
      const current = checkStage(catalog, saved, stage);
      const view = result => ({completed:completedStages(catalog, resultsFor(saved, catalog.id)), result});
      if (current) return view(current);
      return combatResult(saved, settle(saved, ticket, () => {
        if (attempt.correct) recordStage(saved, catalog.id, stage.id, attempt);
        return view(attempt);
      }, {wrong:!attempt.correct,
        rewardKey:attempt.correct && catalog.stages.at(-1) === stage ? `encounter:${catalog.id}` : undefined}));
    });
  }

  async function quest(record, definition, method, body, signal) {
    const {catalog, slug, page} = definition;
    if (method === 'GET') return sideView(record, definition, worldId);
    if (method !== 'POST') throw new Error('Route not found.');
    const {id} = record.hero;
    const stage = catalog.stages.find(item => item.id === body.stageId);
    if (!stage) throw new Error('Choose a stage of the side quest.');
    const isCode = stage.kind === 'code';
    const {code, purpose} = isCode ? codeInput(body) : {purpose:'submit'};
    if (!isCode && !stage.options.some(option => option.id === body.optionId)) throw new Error('Choose one of the listed answers.');
    const ticket = purpose === 'submit'
      ? await submission(record, body.submissionId, [catalog.id, stage.id, isCode ? code : body.optionId], true) : null;
    const fmt = (saved, outcome) => combatResult(saved, {...outcome,
      result:{...sideView(saved, definition, worldId), result:outcome.result}}, true);
    if (ticket) {
      const prior = receipt(record, ticket);
      if (prior) return fmt(record, prior);
      checkAlive(record);
    }
    const priorStage = checkStage(catalog, record, stage);
    if (priorStage) return fmt(record, {result:priorStage});
    let attempt;
    if (isCode) {
      const draftResult = await edit(id, saved => {
        const current = checkStage(catalog, saved, stage);
        if (!current) {
          if (ticket) checkAlive(saved);
          saveResponse(saved, page, `${slug}-${stage.id}`, code, 'Your side quest draft is saved.');
        }
        return current ? {settled:fmt(saved, {result:current})} : {view:sideView(saved, definition, worldId)};
      });
      if (draftResult.settled) return draftResult.settled;
      const report = await run(stage.exercise, code, purpose, signal);
      const correct = report.verdict === 'pass';
      attempt = {...report, correct, purpose, feedback:correct
        ? (purpose === 'examples' ? 'The examples passed. Submit your solution to run the full suite.' : 'Your solution passed the full suite.')
        : 'Your draft is saved. Review the workbench result and try again.'};
      if (!ticket || !evaluated.includes(report.verdict)) return {...draftResult.view, result:attempt};
    } else {
      const correct = body.optionId === stage.answer;
      attempt = {correct, feedback:correct ? stage.success : stage.retry};
    }
    return edit(id, saved => {
      const prior = receipt(saved, ticket);
      if (prior) return fmt(saved, prior);
      const current = checkStage(catalog, saved, stage);
      if (current) return fmt(saved, {result:current});
      return fmt(saved, settle(saved, ticket, () => {
        if (attempt.correct) {
          if (isCode) saveResponse(saved, page, `${slug}-${stage.id}`, code, 'Your solution passed.');
          recordStage(saved, catalog.id, stage.id, attempt);
        }
        return attempt;
      }, {wrong:!attempt.correct,
        rewardKey:attempt.correct && catalog.stages.at(-1) === stage ? `encounter:${catalog.id}` : undefined}));
    });
  }

  async function diamond(record, path, method, body, signal) {
    const {id} = record.hero;
    if (method === 'GET') {
      const query = new URL(path, 'https://coding-dungeons.invalid').searchParams;
      const {page} = pageAt(Number(query.get('page')));
      return showDiamond(record, await sparkle(id, worldId, page, pageCount));
    }
    if (method === 'POST' && path === '/api/diamond/start') {
      const {page} = pageAt(body.page);
      const found = await sparkle(id, worldId, page, pageCount);
      return edit(id, saved => {
        if (saved.diamond) return showDiamond(saved);
        checkAlive(saved);
        if (!found) throw new Error('There is no diamond on this page.');
        saved.diamond = {page, draft:''};
        return showDiamond(saved);
      });
    }
    if (method !== 'POST' || path !== '/api/diamond/submit') throw new Error('Route not found.');
    const stage = body.stageId;
    if (!stages.includes(stage)) throw new Error('Choose a goblin challenge.');
    const asCode = !diamondChoiceStage(worldId, stage);
    const {code, purpose} = asCode ? codeInput(body) : {purpose:'submit'};
    let attempt = asCode ? null : evaluateDiamondChoice(worldId, body.optionId, stage);
    if (!asCode && !attempt) throw new Error('Choose one of the listed answers.');
    const ticket = purpose === 'submit' && (!asCode || runnerAvailable)
      ? await submission(record, body.submissionId, ['diamond', stage, asCode ? code : body.optionId], true) : null;
    const fmt = (saved, outcome) => combatResult(saved, {...outcome,
      result:{...showDiamond(saved), result:outcome.result}}, true);
    if (ticket) {
      const prior = receipt(record, ticket);
      if (prior) return fmt(record, prior);
    }
    const previous = checkDiamond(record, stage);
    if (previous) return fmt(record, {result:previous});
    if (runnerAvailable || !asCode) checkAlive(record);
    if (asCode) {
      const savedView = await edit(id, saved => {
        const current = checkDiamond(saved, stage);
        if (current) return fmt(saved, {result:current});
        if (runnerAvailable) checkAlive(saved);
        saved.diamond.draft = code;
        return null;
      });
      if (savedView) return savedView;
      const report = await run(diamondExercise, code, purpose, signal);
      attempt = evaluateDiamondCode({...report, purpose});
      if (!ticket || !evaluated.includes(report.verdict)) {
        return {...showDiamond(record), draft:code, result:attempt, combat:combat(record)};
      }
    }
    return edit(id, saved => {
      const prior = receipt(saved, ticket);
      if (prior) return fmt(saved, prior);
      const current = checkDiamond(saved, stage);
      if (current) return fmt(saved, {result:current});
      return fmt(saved, settle(saved, ticket, () => {
        if (attempt.correct) {
          if (asCode) saved.diamond.draft = code;
          recordStage(saved, encounterId, stage, attempt);
        }
        return attempt;
      }, {wrong:!attempt.correct, rewardKey:stage === 'choice' && attempt.correct ? `encounter:${encounterId}` : undefined}));
    });
  }
  return {special, quest, diamond};
}
