import jsBook from '../../data/worlds/javascript/campaign.json' with {type:'json'};
import jsPages from '../../data/worlds/javascript/pages.json' with {type:'json'};
import tsBook from '../../data/worlds/typescript/campaign.json' with {type:'json'};
import tsPages from '../../data/worlds/typescript/pages.json' with {type:'json'};
import rustBook from '../../data/campaign.json' with {type:'json'};
import rustPages from '../../data/pages.json' with {type:'json'};
import rustExercises from '../../data/exercises.json' with {type:'json'};
import goBook from '../../data/worlds/go/campaign.json' with {type:'json'};
import goPages from '../../data/worlds/go/pages.json' with {type:'json'};
import rubrics from '../../data/gm-rubrics.json' with {type:'json'};
import jsSuites from '../../data/workbench/javascript.mjs';
import tsSuites from '../../data/workbench/typescript.mjs';
import rustSuites, {rustBossCoverage} from '../../data/workbench/rust.mjs';
import goSuites from '../../data/workbench/go.mjs';
import refactoring from '../../data/workbench/refactoring.mjs';
import systemDesign from '../../data/workbench/system-design.mjs';
import rateLimiter from '../../data/workbench/rate-limiter.mjs';
import { suggestions } from '../../data/workbench/suggestions.mjs';
import { encounters, publicEncounter } from '../encounters.mjs';
import { workbenchSummary } from '../workbench-report.mjs';

const sources = new Map([
  ['javascript', {book:jsBook, chapters:jsPages, suites:jsSuites}],
  ['typescript', {book:tsBook, chapters:tsPages, suites:tsSuites}],
  ['rust', {book:rustBook, chapters:rustPages, suites:rustSuites, exercises:rustExercises}],
  ['go', {book:goBook, chapters:goPages, suites:goSuites}],
]);
const sideQuests = [
  ['/api/refactoring', {key:'refactoring', slug:'refactoring', level:14, catalog:refactoring}],
  ['/api/system-design', {key:'systemDesign', slug:'system-design', level:13, catalog:systemDesign}],
  ['/api/rate-limiter', {key:'rateLimiter', slug:'rate-limiter', level:12, catalog:rateLimiter}],
];

function worldInfo(id, book, assetUrl) {
  if (id === 'rust') return {id, number:3, name:'Rust', title:'Understanding Rust', subtitle:'The Ferrum Expedition',
    bookUrl:assetUrl('/book/ferrum-expedition.pdf'), kitUrl:assetUrl('/book/ferrum-field-kit.zip')};
  return {...book.world, bookUrl:assetUrl(`/book/${id}/book.pdf`), kitUrl:assetUrl(`/book/${id}/field-kit.zip`)};
}

export function mobileWorlds(assetUrl = value => value) {
  return [...sources].map(([id, {book}]) => worldInfo(id, book, assetUrl));
}

export function localCatalog(worldId = 'javascript', assetUrl = value => value) {
  const source = sources.get(worldId);
  if (!source) throw new Error('Unknown mobile world.');
  const {book, chapters, suites, exercises = []} = source;
  const world = worldInfo(worldId, book, assetUrl);
  const routes = new Set(['all', '', ...book.paths.map(path => path.id)]);
  const questMap = new Map(book.quests.map(quest => [quest.level, quest]));
  const encounterMap = new Map(encounters.filter(encounter => encounter.world === worldId)
    .map(encounter => [encounter.id, encounter]));
  const rubricMap = new Map(rubrics.filter(rubric => rubric.worldId === worldId).map(rubric => [rubric.promptId, rubric]));
  const exerciseMap = new Map(exercises.map(exercise => [exercise.id, exercise]));
  const addedBosses = new Map();
  for (const exercise of suites) {
    const quest = questMap.get(exercise.level);
    const prompt = chapters[quest?.bossPage - 1]?.prompts.find(item => item.id === `boss-${exercise.level}`);
    if (prompt?.type !== 'code') throw new Error(`Workbench suite ${exercise.id} is missing its boss card.`);
    addedBosses.set(quest.bossPage, exercise.id);
    exerciseMap.set(exercise.id, {...exercise, title:exercise.title ?? quest.title, description:exercise.description ?? prompt.body,
      starter:exercise.starter ?? prompt.starter});
  }
  const sideQuestMap = new Map((worldId === 'javascript' ? sideQuests : []).map(([path, definition]) => {
    const {level, catalog} = definition;
    return [path, {...definition, page:questMap.get(level).sidePage, title:catalog.title, description:catalog.description}];
  }));
  const projectReviews = new Map(worldId === 'rust' ? rustBossCoverage.filter(entry => entry.status === 'authored-review')
    .map(entry => [questMap.get(entry.level)?.bossPage, entry.reason]) : []);
  const exercisePages = new Map();
  const pages = chapters.map(chapter => ({...chapter, image:assetUrl(chapter.image),
    ...(projectReviews.has(chapter.page) ? {projectReview:projectReviews.get(chapter.page)} : {}),
    prompts:chapter.prompts.map(prompt => {
      const newExercise = prompt.id === `boss-${chapter.level}` ? addedBosses.get(chapter.page) : null;
      const exerciseId = newExercise ?? prompt.exerciseId;
      if (exerciseId) exercisePages.set(exerciseId, chapter.page);
      return exerciseId ? {...prompt, exerciseId} : prompt;
    })}));
  const bossByLevel = new Map(book.quests.flatMap(({level, bossPage}) => {
    const exercise = pages[bossPage - 1]?.prompts.find(prompt => prompt.id === `boss-${level}` && prompt.exerciseId);
    return exercise ? [[level, exercise.exerciseId]] : [];
  }));
  const campaign = {
    world, zones:book.zones ?? [], paths:book.paths,
    quests:book.quests.map(({hint1, hint2, debrief, ...quest}) => quest),
    rooms:book.rooms.map(room => ({...room, choices:room.choices.map(({result, ...choice}) => choice)})),
    specialEncounters:[...encounterMap.values()].map(publicEncounter),
    exercises:[...exerciseMap.values()].map(exercise => ({...workbenchSummary(exercise), page:exercisePages.get(exercise.id)})),
    levelPages:Object.fromEntries(book.quests.map(quest => [quest.level, quest.page])),
    total:pages.length,
    sideQuests:[...sideQuestMap.values()].map(({key, slug, page, title, description}) => ({key, slug, page, title, description})),
  };
  for (const quest of campaign.sideQuests) campaign[quest.key] = quest;

  function rubricFor(prompt) {
    const rubric = prompt.type === 'text' ? rubricMap.get(prompt.id) : null;
    return rubric?.question === prompt.body ? rubric : null;
  }

  function exampleAnswerFor(prompt) {
    return worldId === 'rust' && ['text', 'code'].includes(prompt.type) && /^training-\d+-\d+$/.test(prompt.id)
      ? prompt.feedback : null;
  }

  function visiblePage(page) {
    return {...page, prompts:page.prompts.map(item => {
      const {feedback, feedbackByOption, correctOption, ...prompt} = item;
      if (rubricFor(item)) return {...prompt, assessment:{version:'mobile-1', kind:'rule-based'}};
      if (exampleAnswerFor(item)) return {...prompt, exampleAnswer:true};
      return suggestions.has(prompt.exerciseId) ? {...prompt, suggestion:true} : prompt;
    })};
  }

  return {world, campaign, pages, bossByLevel, encounterMap, exerciseMap, questMap, routes, rubricFor,
    sideQuestMap, visiblePage, exampleAnswerFor};
}
