import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { creatureName, mountCreature } from '../../public/creatures.mjs';

const promptLabels = { choice: 'CHOICE', text: 'WRITTEN RESPONSE', code: 'CODE WORKBENCH' };
const hintLabels = { hint1: 'Hint one', hint2: 'Hint two', debrief: 'Debrief' };
const rustZones = [
  { name: 'Borrowed Citadel', first: 1, last: 8 },
  { name: 'Trait Foundry', first: 9, last: 18 },
  { name: 'Clockwork Wilds', first: 19, last: 28 },
  { name: 'Unsafe Depths', first: 29, last: 36 },
  { name: 'Endgame', first: 37, last: 42 },
];

const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value : '';
const enabled = (value) => value === true || value === 1 || value === '1';
const pageNumber = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const responseKey = (page, promptId) => `${page}:${promptId}`;
const hardMode = (game, level) => game.workbenchModes?.get(Number(level))?.mode === 'hard';
const findQuest = (game, level) => list(game.campaign?.quests).find((quest) => Number(quest.level) === Number(level));
const levelExercises = (game, level) => list(game.campaign?.exercises).filter((exercise) => Number(exercise.level) === Number(level));

function levelPage(game, level) {
  const quest = findQuest(game, level);
  return pageNumber(quest?.page ?? quest?.startPage ?? game.campaign?.levelPages?.[level]);
}

function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

function BookLink({ page, className, children }) {
  return <a className={className} href={`#page=${page}`}>{children}</a>;
}

function FieldCard({ title, children }) {
  return <section className="field-card"><h2>{title}</h2>{children}</section>;
}

function GuideNotes({ data, game }) {
  const notes = typeof data.notes === 'string' ? [data.notes] : list(data.notes);
  const paragraphs = notes.map((note) => text(note) || text(note?.body)).filter(Boolean);
  const zones = list(game.campaign?.zones);
  const zone = (zones.length ? zones : rustZones).find(({ first, last }) => data.level >= first && data.level <= last);
  const first = data.page === 1 && levelPage(game, 1);
  return <section className="field-card note-card">
    <p className="eyebrow">{zone ? `LEVEL ${data.level} · ${zone.name.toUpperCase()}` : 'CAMPAIGN FIELD NOTES'}</p>
    {paragraphs.length ? paragraphs.map((copy, index) => <p key={index}>{copy}</p>) : <p>{data.level
      ? 'Read this page, then follow an encounter or jump to another level from the world map.'
      : 'The book is your campaign map. Turn a page to continue, or open a level from the world map.'}</p>}
    {first ? <div className="hint-actions"><BookLink page={first} className="button button-primary">Begin Level 01</BookLink></div> : null}
  </section>;
}

function RouteSuggestion({ data, game, correct, prompt, value }) {
  const quest = findQuest(game, data.level);
  let level;
  let prefix;
  if (!quest) {
    const room = list(game.campaign?.rooms).find((item) => `room-${item.id}` === prompt?.id);
    const optionIndex = list(prompt?.options).findIndex((option) => String(option.id) === String(value));
    level = list(room?.choices)[optionIndex]?.level;
    prefix = 'Explore the consequence';
  } else {
    const earlier = list(quest.loadout).filter((candidate) => levelPage(game, candidate));
    const later = list(quest.route_choices).find((route) => Number(route.level) > Number(data.level) && levelPage(game, route.level));
    level = correct === false ? earlier.at(-1) : later?.level;
    prefix = correct === false ? 'Review' : text(later?.label) || 'Continue';
  }
  const page = levelPage(game, level);
  return page ? <BookLink page={page} className="recommendation">{prefix} · Level {level}</BookLink> : null;
}

function AnswerFeedback({ response, data, prompt, game, actions }) {
  const [busy, setBusy] = useState(false);
  const [example, setExample] = useState(null);
  const mounted = useMounted();
  if (!response) return null;
  if (prompt.assessment || prompt.exampleAnswer) {
    const assessment = response.assessment;
    const scored = assessment?.status === 'scored' && Number.isInteger(assessment.score);
    const hard = hardMode(game, data.level);
    const canReveal = !hard || assessment?.score === 100;
    const feedback = !hard || !assessment ? assessment?.feedback
      : scored ? 'Hard Mode review complete.' : assessment.status === 'unavailable'
        ? 'The review is unavailable. Your answer is saved.' : 'The GM could not verify this answer.';
    async function reveal() {
      setBusy(true);
      try {
        const result = await actions.api('/api/answers/reveal', {
          hero: game.hero, method: 'POST', body: { page: data.page, promptId: prompt.id },
        });
        if (mounted.current) setExample(text(result.text));
      } catch (error) {
        if (mounted.current) actions.toast(error.message);
      } finally {
        if (mounted.current) setBusy(false);
      }
    }
    return <div className="prompt-feedback" aria-live="polite" data-verdict={scored ? 'correct' : 'saved'}>
      <strong className="feedback-heading">{scored ? `${assessment.score}% of rubric points verified` : 'Response saved'}</strong>
      {text(feedback) && <p>{feedback}</p>}
      {canReveal && (example === null
        ? <button type="button" className="button button-quiet" disabled={busy} onClick={reveal}>Show example answer</button>
        : <p className="example-answer">{example}</p>)}
    </div>;
  }
  const correct = response.correct == null ? null : enabled(response.correct);
  return <div className="prompt-feedback" aria-live="polite" data-verdict={correct === null ? 'saved' : correct ? 'correct' : 'incorrect'}>
    <strong className="feedback-heading">{correct === null ? 'Response saved' : correct ? 'Correct' : 'Revisit this choice'}</strong>
    {text(response.feedback) && <p>{response.feedback}</p>}
    {prompt.type === 'choice' && <RouteSuggestion data={data} game={game} correct={correct} prompt={prompt} value={response.value} />}
  </div>;
}

function testPassed(result) {
  return ['pass', 'passed', 'success', 'accepted'].includes(text(result.verdict).toLowerCase());
}

function testRecorded(result) {
  return testPassed(result) || ['fail', 'compile_error', 'timeout'].includes(text(result.verdict));
}

export function WorkbenchReport({ result, data, game }) {
  if (!result) return null;
  const passed = testPassed(result);
  const recorded = testRecorded(result);
  const verdict = text(result.verdict).replaceAll('_', ' ').replaceAll('-', ' ');
  const title = passed ? (result.purpose === 'examples' ? 'Examples passed' : 'Tests passed')
    : !recorded ? 'Code draft saved' : verdict ? `Runner result · ${verdict}` : 'Tests did not pass';
  const timings = [Number.isFinite(result.compileMs) ? `Compile and check ${result.compileMs} ms` : '',
    Number.isFinite(result.runtimeMs) ? `Test runtime ${result.runtimeMs} ms` : '',
    Number.isFinite(result.elapsedMs) ? `Total runner time ${result.elapsedMs} ms` : ''].filter(Boolean);
  return <div className="prompt-feedback" aria-live="polite" data-verdict={passed ? 'correct' : recorded ? 'failed' : 'saved'}>
    <strong className="feedback-heading">{title}</strong>
    {recorded && typeof result.passed === 'number' && typeof result.failed === 'number' &&
      <p>{result.passed} passed · {result.failed} failed</p>}
    {timings.length > 0 && <p className="fine-print">{timings.join(' · ')}</p>}
    {list(result.groups).length > 0 && <ul className="workbench-wards" aria-label="Test wards">
      {result.groups.map(({ group, passed, required }) =>
        <li key={group} data-done={passed === required}>{group} · {passed}/{required}{passed === required ? ' cleared' : ''}</li>)}
    </ul>}
    {list(result.cases).map((item) => <p className="fine-print" key={item.id}>{text(item.id)} · {text(item.status)}
      {Number.isFinite(item.durationMs) && ` · ${item.durationMs} ms`}{item.message && ` · ${item.message}`}</p>)}
    {result.hardClear && <span className="badge" data-done="true">Hard Clear</span>}
    {text(result.output) && (recorded ? <details className="details-block" open={!passed}>
      <summary>Compiler and test output</summary><pre className="test-output">{result.output}</pre>
    </details> : <p>{result.output}</p>)}
    {data && passed && result.purpose !== 'examples' && !hardMode(game, data.level) && <RouteSuggestion data={data} game={game} correct />}
  </div>;
}

function CodeSuggestion({ data, prompt, input, game, actions, updateValue, disabled }) {
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [applied, setApplied] = useState(null);
  const mounted = useMounted();
  async function show() {
    setBusy(true);
    try {
      const result = await actions.api('/api/workbench/suggestion', {
        hero: game.hero, method: 'POST', body: { page: data.page, promptId: prompt.id, exerciseId: prompt.exerciseId },
      });
      if (mounted.current) setSuggestion(result);
    } catch (error) {
      if (mounted.current) actions.toast(error.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function apply() {
    const editor = input.current;
    const { value, selectionStart, selectionEnd } = editor;
    const snippet = text(suggestion.snippet);
    const result = value.slice(0, selectionStart) + snippet + value.slice(selectionEnd);
    updateValue(result);
    setApplied({ previous: value, result });
    editor.focus();
    requestAnimationFrame(() => editor.setSelectionRange(selectionStart + snippet.length, selectionStart + snippet.length));
  }
  function undo() {
    const editor = input.current;
    if (editor.value !== applied.result) return actions.toast('The draft changed. Use the editor to adjust the snippet.');
    updateValue(applied.previous);
    setApplied(null);
    editor.focus();
  }
  return <div className="hint-actions">{suggestion ? <>
    <p className="fine-print">{text(suggestion.text)}</p><pre className="test-output">{text(suggestion.snippet)}</pre>
    <button type="button" className="button button-quiet" disabled={disabled || Boolean(applied)} onClick={apply}>Apply suggestion</button>
    {applied && <button type="button" className="button button-quiet" disabled={disabled} onClick={undo}>Undo suggestion</button>}
  </> : <button type="button" className="button button-quiet" disabled={disabled || busy} onClick={show}>Show code suggestion</button>}</div>;
}

function ReviewList({ title, items }) {
  return items.length ? <details className="details-block"><summary>{title}</summary>
    <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
  </details> : null;
}

function Prompt({ data, prompt, index, game, actions }) {
  const code = prompt.type === 'code';
  const choice = prompt.type === 'choice';
  const runnable = code && prompt.exerciseId != null;
  const graded = runnable || choice || Boolean(prompt.assessment);
  const runnerUnavailable = runnable && text(game.runner).toLowerCase() === 'unavailable';
  const exercise = runnable && list(game.campaign?.exercises).find(({ id }) => String(id) === String(prompt.exerciseId));
  const key = responseKey(data.page, prompt.id);
  const saved = game.responses?.get(key);
  const initial = game.drafts?.get(key) ?? saved?.value ?? (code ? text(prompt.starter) || text(exercise?.starter) : '');
  const [value, setValue] = useState(String(initial));
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState({ copy: '', error: false });
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const input = useRef(null);
  const submitButton = useRef(null);
  const run = useRef(null);
  const operation = useRef(false);
  const mounted = useMounted();
  const hard = hardMode(game, data.level);
  const submitDisabled = busy || game.switchingHero || runnerUnavailable || (graded && game.combat?.fallen);
  const titleId = `prompt-title-${data.page}-${index}`;
  const title = text(prompt.title) || 'Encounter';
  const setMessage = (copy, error = false) => setStatus({ copy, error });
  const attempt = runnable && list(game.attempts).find((item) => String(item.exerciseId) === String(prompt.exerciseId)
    && (!item.page || Number(item.page) === data.page));
  const result = report || attempt;
  const testNames = list(exercise?.testNames).map(text);

  function updateValue(next) {
    setValue(next);
    setMessage(actions.persistDraft(key, next) ? 'Draft kept on this device' : 'Draft kept in this tab');
  }

  async function save(purpose) {
    const practice = purpose === 'examples';
    const draft = purpose === 'draft';
    if (operation.current || game.switchingHero || (!draft && !practice && submitDisabled)
      || (practice && runnerUnavailable)) return;
    if (!draft && !value.trim()) {
      setMessage(choice ? 'Choose an answer first.' : 'Enter a response first.', true);
      return;
    }
    const hero = game.hero;
    const body = { page: data.page, promptId: prompt.id };
    operation.current = true;
    setBusy(true);
    if (!draft) actions.persistDraft(key, value);
    setMessage(draft ? 'Saving…' : runnable ? 'Compiling and testing…' : prompt.assessment ? 'The GM is reviewing…' : 'Saving response…');
    const current = () => actions.isCurrentHero ? actions.isCurrentHero(hero) : mounted.current;
    let controller;
    try {
      if (runnable && !draft) {
        controller = new AbortController();
        run.current = controller;
        setRunning(true);
        const request = practice ? actions.api : actions.submitExpedition;
        const outcome = await request('/api/grade', {
          hero, method: 'POST', signal: controller.signal,
          body: { ...body, exerciseId: prompt.exerciseId, code: value, purpose },
        });
        if (!current()) return;
        actions.clearDraft(key, value);
        const recorded = testRecorded(outcome);
        if (mounted.current) {
          setReport(outcome);
          setMessage(practice && recorded ? 'Practice run complete' : recorded ? 'Test run recorded' : 'Draft saved. No result was recorded.');
        }
        const animateForgeLevel = !practice && testPassed(outcome) && outcome.newClear !== false ? Number(data.level) : null;
        try {
          await actions.refreshProgress({ animateForgeLevel });
        } catch {
          if (recorded && mounted.current) setMessage('Test run recorded. Refresh the quest log to update your badges.');
        }
      } else {
        const request = !draft && graded ? actions.submitExpedition : actions.api;
        const outcome = await request('/api/answers', { hero, method: 'POST', body: { ...body, value } });
        if (!current()) return;
        actions.clearDraft(key, value);
        actions.recordResponse(hero, { ...outcome, ...body, value });
        if (mounted.current) {
          setMessage(draft ? 'Draft saved' : 'Saved to your quest log');
        }
        actions.refreshProgress().catch(() => {});
      }
    } catch (error) {
      if (mounted.current) setMessage(controller?.signal.aborted ? 'Run canceled. Your draft is kept.' : error.message, !controller?.signal.aborted);
    } finally {
      operation.current = false;
      run.current = null;
      if (mounted.current) {
        setBusy(false);
        setRunning(false);
      }
    }
  }

  return <form className="field-card prompt-form" aria-labelledby={titleId}
    onSubmit={(event) => { event.preventDefault(); save(event.nativeEvent.submitter?.value || 'submit'); }}
    onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !submitDisabled) {
        event.preventDefault();
        event.currentTarget.requestSubmit(submitButton.current);
      }
    }}>
    <div className="prompt-heading"><h2 id={titleId}>{title}</h2><span className="prompt-type">{promptLabels[prompt.type]}</span></div>
    {text(prompt.body) && <p className="prompt-copy">{prompt.body}</p>}
    {text(exercise?.description) && exercise.description !== prompt.body && <p className="prompt-copy">{exercise.description}</p>}
    {text(exercise?.signature) && <pre className="signature">{exercise.signature}</pre>}
    {choice ? <fieldset className="choice-group" disabled={busy}>
      <legend className="visually-hidden">Select one answer</legend>
      {list(prompt.options).map((option, optionIndex) => {
        const id = String(option.id ?? optionIndex);
        return <label className="choice-option" key={id}>
          <span className="choice-letter" aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span>
          <span>{text(option.text)}</span>
          <input type="radio" name={`choice-${data.page}-${index}`} value={id} required
            checked={value === id} onChange={() => updateValue(id)} />
        </label>;
      })}
    </fieldset> : <textarea ref={input} className={code ? 'code-editor' : 'answer-editor'}
      aria-label={code ? `${game.world.name} code` : 'Your written response'}
      rows={code ? 12 : 4} maxLength={code ? 49152 : 12000}
      placeholder={code ? `Write your ${game.world.name} solution here` : 'Explain your reasoning and the rule you rely on.'}
      spellCheck={!code} autoCapitalize={code ? 'off' : undefined} autoComplete={code ? 'off' : undefined}
      autoCorrect={code ? 'off' : undefined} disabled={busy} value={value} onChange={(event) => updateValue(event.target.value)} />}
    {runnable && prompt.suggestion && !hard && <CodeSuggestion {...{ data, prompt, input, game, actions, updateValue }} disabled={busy} />}
    <ReviewList title="Review criteria" items={list(prompt.criteria).filter(text)} />
    <ReviewList title={`What the runner checks · ${testNames.length}`} items={testNames} />
    <div className="form-actions">
      <button ref={submitButton} type="submit" value="submit" className="button button-primary"
        data-expedition-submit={graded ? '' : undefined} disabled={submitDisabled}>
        {runnable ? 'Submit solution' : code ? 'Save code notes' : choice ? 'Check answer' : prompt.assessment ? 'Ask the GM' : 'Submit response'}
      </button>
      {runnable && <>
        <button type="submit" value="examples" className="button button-quiet" disabled={runnerUnavailable || busy}>Run Examples</button>
        {running && <button type="button" className="button button-quiet" onClick={() => run.current?.abort()}>Cancel run</button>}
        <button type="button" className="button button-quiet" disabled={busy} onClick={() => save('draft')}>Save draft</button>
      </>}
      <span className="inline-status" aria-live="polite" data-error={status.error}>{status.copy}</span>
    </div>
    {code && !runnable && <p className="fine-print">This is a code notebook. Your notes are saved for this page.</p>}
    {runnerUnavailable && <p className="fine-print">The local {game.world.name} runner is unavailable. You can still save your code draft.</p>}
    {result ? <WorkbenchReport result={result} data={data} game={game} />
      : <AnswerFeedback key={hard ? 'hard' : 'guided'} {...{ data, prompt, game, actions }} response={saved} />}
  </form>;
}

function Hints({ data, game, actions }) {
  const [selected, setSelected] = useState('');
  const [copy, setCopy] = useState('');
  const request = useRef(0);
  const mounted = useMounted();
  const kinds = (data.hintKinds === undefined ? ['hint1', 'hint2'] : list(data.hintKinds))
    .filter((kind) => Object.hasOwn(hintLabels, kind));
  if (!kinds.length) return null;
  async function reveal(kind) {
    const id = ++request.current;
    const next = selected === kind ? '' : kind;
    setSelected(next);
    if (!next) return;
    setCopy('Opening the guide kit…');
    try {
      const result = await actions.api(`/api/levels/${data.level}/reveal/${kind}`, { hero: game.hero });
      if (mounted.current && request.current === id) setCopy(text(result.text) || 'No guide note is available here.');
    } catch (error) {
      if (mounted.current && request.current === id) setCopy(error.message);
    }
  }
  return <FieldCard title="Guide kit">
    <div className="hint-actions">{kinds.map((kind) => <button key={kind} type="button" className="button button-quiet"
      aria-expanded={selected === kind} aria-controls="hint-panel" onClick={() => reveal(kind)}>{hintLabels[kind]}</button>)}</div>
    <div className="hint-body" hidden={!selected} id="hint-panel" aria-live="polite"><p>{copy}</p></div>
  </FieldCard>;
}

function Difficulty({ level, game, actions }) {
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();
  const hard = hardMode(game, level);
  async function toggle() {
    setBusy(true);
    try {
      await actions.setMode(level, hard ? 'guided' : 'hard');
      await actions.refreshProgress();
    } catch (error) {
      if (mounted.current) actions.toast(error.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return <FieldCard title="Encounter difficulty">
    <p className="fine-print">{hard ? 'Coaching is locked for this encounter.' : 'Hints and example answers are available on request.'}</p>
    <button type="button" className="button button-quiet" onClick={toggle} disabled={busy}>{hard ? 'Switch to Guided' : 'Hard Mode'}</button>
  </FieldCard>;
}

function CreatureEncounter({ active, drillPage, exerciseId, level, game }) {
  const world = game.world.id;
  const defeated = exerciseId && game.exerciseClears ? game.exerciseClears.has(exerciseId) : enabled(game.levels?.get(level)?.forge);
  const [phase, setPhase] = useState(defeated ? 'defeated' : 'ready');
  const canvas = useRef(null);
  const card = useRef(null);
  const renderer = useRef(null);
  const current = useRef(defeated);
  current.current = defeated;
  useLayoutEffect(() => {
    renderer.current = mountCreature(canvas.current, {
      world, level, defeated: current.current, onStateChange(next) {
        setPhase(next);
        if (next === 'defeating') card.current?.scrollIntoView({ block: 'nearest' });
      },
    });
    return () => { renderer.current.destroy(); renderer.current = null; };
  }, [world, level, exerciseId]);
  useEffect(() => {
    renderer.current?.update(defeated, { animate: !game.loading && game.forgeAnimation === level });
  }, [defeated, game.forgeAnimation, game.loading, level]);
  return <section className="field-card creature-encounter" data-state={phase} ref={card}>
    <div className="creature-heading">
      <div><p className="eyebrow">DUNGEON ENCOUNTER</p><h2>{creatureName(world)}</h2></div>
      <p className="creature-status" role="status">{phase === 'ready' ? 'Awaiting Forge' : 'Defeated · Forge earned'}</p>
    </div>
    <canvas ref={canvas} width={320} height={116} aria-hidden="true" />
    {active ? <p className="fine-print">Pass the challenge tests to defeat this creature.</p>
      : drillPage ? <p className="fine-print"><BookLink page={drillPage}>Open the graded drill</BookLink> to defeat this creature.</p> : null}
  </section>;
}

function Checkpoint({ data, quest, game, actions }) {
  const level = Number(quest.level);
  const record = game.levels?.get(level) || {};
  const [pending, setPending] = useState({});
  const mounted = useMounted();
  const hasTests = levelExercises(game, level).length > 0;
  const fields = [['scout', 'Scouted'], ['explain', 'Explained'], ['side', 'Side quest done']];
  if (!hasTests && !game.campaignError) fields.push(['forge', 'Forge self-review']);
  async function change(field, checked) {
    setPending((previous) => ({ ...previous, [field]: checked }));
    try {
      await actions.api(`/api/progress/${level}`, { hero: game.hero, method: 'PATCH', body: { [field]: checked } });
      if (!actions.isCurrentHero || actions.isCurrentHero(game.hero)) {
        await actions.refreshProgress({ animateForgeLevel: field === 'forge' ? level : null });
        actions.toast('Quest log updated');
      }
    } catch (error) {
      if (mounted.current) actions.toast(error.message);
    } finally {
      if (mounted.current) setPending(({ [field]: removed, ...remaining }) => remaining);
    }
  }
  const forged = enabled(record.forge);
  const routes = list(quest.route_choices);
  return <FieldCard title="Level checkpoint">
    <div className="checkpoint-list">{fields.map(([field, label]) => <label key={field}>
      <input type="checkbox" checked={pending[field] ?? enabled(record[field])} data-expedition-submit=""
        disabled={game.combat?.fallen || Object.hasOwn(pending, field)} onChange={(event) => change(field, event.target.checked)} />
      <span>{label}</span>
    </label>)}
      {hasTests && <span id="forge-marker" className="badge" data-done={forged}>{forged ? 'Forge earned' : 'Forge · pass the tests'}</span>}
    </div>
    {(text(quest.side_quest) || routes.length > 0) && <details className="details-block hint-actions"
      style={{ display: 'block' }} open={Number(quest.sidePage) === data.page || data.kind === 'side'}>
      <summary>Side quest and exits</summary>
      {text(quest.side_quest) && <p>{quest.side_quest}</p>}
      <div className="route-links">{routes.map((route) => {
        const page = levelPage(game, route.level);
        return page ? <BookLink key={route.level} page={page} className="route-link">
          {text(route.label)} · Level {route.level}{text(route.reason) && <span>{route.reason}</span>}
        </BookLink> : null;
      })}</div>
    </details>}
  </FieldCard>;
}

function ProgressConnection({ actions }) {
  const [busy, setBusy] = useState(false);
  const mounted = useMounted();
  async function retry() {
    setBusy(true);
    try {
      await actions.refreshProgress();
    } catch (error) {
      if (mounted.current) actions.toast(error.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return <FieldCard title="Quest log connection">
    <p className="muted">Saved progress could not be loaded. Your current draft stays available in this tab.</p>
    <button type="button" className="button" disabled={busy} onClick={retry}>Refresh progress</button>
  </FieldCard>;
}

export function Guide({ game, actions, SpecialEncounter, DiamondEncounter }) {
  const data = game.page;
  const key = `${game.world?.id}:${game.hero?.id ?? game.hero}`;
  const scroll = useRef(null);
  useLayoutEffect(() => {
    scroll.current?.scrollTo(0, 0);
  }, [key, data?.page]);
  const level = pageNumber(data?.level);
  const quest = findQuest(game, level);
  const prompts = list(data?.prompts);
  const special = list(game.campaign?.specialEncounters).find((encounter) => encounter.page === data?.page);
  const active = prompts.find((prompt) => prompt.exerciseId);
  const drill = quest && levelExercises(game, quest.level)[0];
  const exerciseId = active?.exerciseId ?? drill?.id;
  const hasCreature = quest && exerciseId && (active || data.page === Number(quest.bossPage));
  const hintsAvailable = level && (!hardMode(game, level) || game.hardClears?.has(level));
  return <div className="guide-scroll" id="guide-scroll" ref={scroll}>
    {game.hero && DiamondEncounter && <DiamondEncounter key={key} game={game} actions={actions} />}
    <div id="guide-content" className="guide-content" aria-busy={game.loading || undefined}>
      {data && game.hero ? <React.Fragment key={`${key}:${data.page}`}>
        <GuideNotes data={data} game={game} />
        {game.progressError && <ProgressConnection actions={actions} />}
        {special && SpecialEncounter && <SpecialEncounter key={special.id} encounter={special} game={game} actions={actions} />}
        {hasCreature && <CreatureEncounter active={active} drillPage={pageNumber(drill?.page)} exerciseId={exerciseId} level={Number(quest.level)} game={game} />}
        {text(data.projectReview) && <FieldCard title="Project review"><p className="fine-print">{data.projectReview}</p></FieldCard>}
        {level && prompts.some((prompt) => prompt.exerciseId || prompt.assessment) && <Difficulty level={level} game={game} actions={actions} />}
        {prompts.map((prompt, index) => Object.hasOwn(promptLabels, prompt.type) && prompt.id != null
          ? <Prompt key={prompt.id} {...{ data, prompt, index, game, actions }} /> : null)}
        {hintsAvailable ? <Hints key={hardMode(game, level) ? 'hard' : 'guided'} data={data} game={game} actions={actions} /> : null}
        {quest && <Checkpoint data={data} quest={quest} game={game} actions={actions} />}
      </React.Fragment> : <p className="muted">{game.loading ? 'Opening your expedition…' : 'Your guide will follow your hero through the book.'}</p>}
    </div>
  </div>;
}
