import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { indentationHelp, useCodeIndentation } from './code-editor.mjs';

const presentations = {
  refactoring: {
    slug: 'refactoring', codeLabel: 'Refactoring JavaScript code', submitLabel: 'Submit refactor',
    stepsLabel: 'Refactoring quest steps', completion: 'The Relay Ledger is ready for rollout. This quest is saved to your hero.',
  },
  systemDesign: {
    slug: 'system-design', codeLabel: 'System design JavaScript code', submitLabel: 'Submit solution',
    stepsLabel: 'System design quest steps', completion: 'You completed the URL shortener design. This quest is saved to your hero.',
  },
};
const verdictLabels = {
  fail: 'Tests did not pass',
  compile_error: 'Compilation failed',
  timeout: 'Run timed out',
  unavailable: 'Runner unavailable',
  busy: 'Runner busy',
  canceled: 'Run canceled',
  error: 'Runner error',
};

function SideQuestResult({ result }) {
  if (!result) return null;
  const code = typeof result.verdict === 'string';
  const passed = code ? result.verdict === 'pass' : result.correct === true;
  const label = code ? passed ? result.purpose === 'examples' ? 'Examples passed' : 'Tests passed'
    : verdictLabels[result.verdict] ?? 'Test result' : passed ? 'Correct' : 'Revisit your choice';
  return <div className="prompt-feedback" role="status" data-verdict={passed ? 'correct' : 'failed'}>
    <strong className="feedback-heading">{label}</strong>
    {code && Number.isInteger(result.passed) && Number.isInteger(result.failed)
      && <p>{result.passed} passed · {result.failed} failed</p>}
    {result.groups?.length > 0 && <ul className="workbench-wards" aria-label="Test wards">
      {result.groups.map(({ group, passed, required }) => (
        <li key={group} data-done={passed === required}>{group} · {passed}/{required}</li>
      ))}
    </ul>}
    {code && result.cases?.filter(item => item.message).map(({ id, message }) => (
      <p key={id}>{id} · {message}</p>
    ))}
    {result.feedback && <p>{result.feedback}</p>}
    {code && result.output && <details className="details-block" open={!passed}>
      <summary>Compiler and test output</summary>
      <pre className="test-output">{result.output}</pre>
    </details>}
  </div>;
}

function SideQuestStage({ stage, draft, saveDraft, pending, blocked, fallen, unavailable, focusTarget, submit, presentation }) {
  const code = stage.kind === 'code';
  const [value, setValue] = useState(code ? draft ?? stage.starter ?? '' : '');
  const indentationId = useId();
  const optionName = useId();
  const indentation = useCodeIndentation((next) => {
    setValue(next);
    saveDraft(next);
  });
  const practiceDisabled = blocked || Boolean(unavailable);
  const submitDisabled = practiceDisabled || fallen;

  return <form className="special-form" onSubmit={(event) => {
    event.preventDefault();
    const practice = code && event.nativeEvent.submitter?.value === 'examples';
    if (practice ? !practiceDisabled : !submitDisabled) submit(value, practice);
  }}>
    <h3 ref={focusTarget} tabIndex={-1}>{stage.title}</h3>
    <fieldset className="special-controls" disabled={pending}>
      <legend>{stage.prompt}</legend>
      {code ? <>
        {stage.signature && <pre className="signature">{stage.signature}</pre>}
        <textarea className="code-editor" aria-label={presentation.codeLabel} aria-describedby={indentationId}
          rows={12} maxLength={49152} value={value} required spellCheck={false}
          autoCapitalize="off" autoComplete="off" autoCorrect="off" {...indentation} />
        <p id={indentationId} className="fine-print">{indentationHelp}</p>
        {stage.testNames?.length > 0 && <details className="details-block">
          <summary>What the runner checks</summary>
          <ul>{stage.testNames.map((name) => <li key={name}>{name}</li>)}</ul>
        </details>}
      </> : stage.options.map((option) => <label key={option.id} className="special-option">
        <input type="radio" name={optionName} value={option.id} checked={value === option.id}
          onChange={() => setValue(option.id)} required />
        <span>{option.label}</span>
      </label>)}
      {unavailable && <p className="fine-print">{unavailable} You can keep editing your draft.</p>}
      <div className="form-actions">
        <button type="submit" value="submit" className="button button-primary" data-expedition-submit=""
          disabled={submitDisabled}>{code ? presentation.submitLabel : 'Check answer'}</button>
        {code && <button type="submit" value="examples" className="button button-quiet"
          disabled={practiceDisabled}>Run Examples</button>}
      </div>
    </fieldset>
  </form>;
}

function QuestPanel({ game, actions, entry, presentation }) {
  const { hero } = game;
  const { slug } = presentation;
  const endpoint = `/api/${slug}`;
  const titleId = `${slug}-title`;
  const { api, isCurrentHero, submitExpedition, persistDraft, clearDraft } = actions;
  const [quest, setQuest] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pendingSubmission = useRef(false);
  const mounted = useRef(false);
  const focusTarget = useRef(null);
  const focusAfterStage = useRef(false);
  const current = quest?.stages.find(({ id }) => !quest.completed.includes(id));
  const finished = Boolean(quest && !current);
  const draftKey = current?.kind === 'code' ? `${entry.page}:${slug}-${current.id}` : null;
  const unavailable = draftKey && game.runner?.toLowerCase() === 'unavailable'
    ? game.runnerDetail || 'The local JavaScript runner is unavailable.' : '';
  const blocked = pending || game.switchingHero;
  const fallen = Boolean(game.combat?.fallen);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api(endpoint, { hero, signal: controller.signal }).then((saved) => {
      if (!controller.signal.aborted && isCurrentHero(hero)) setQuest(saved);
    }, (failure) => {
      if (!controller.signal.aborted && isCurrentHero(hero)) setLoadError(failure.message);
    });
    return () => controller.abort();
  }, [api, endpoint, hero, isCurrentHero, retry]);
  useLayoutEffect(() => {
    if (focusAfterStage.current) {
      focusAfterStage.current = false;
      focusTarget.current?.focus({ preventScroll: true });
    }
  }, [current?.id, finished]);

  async function submit(value, practice) {
    if (!current || blocked || pendingSubmission.current || unavailable || (!practice && fallen)) return;
    if (!value.trim()) {
      setError(draftKey ? 'Enter some code first.' : 'Choose an answer first.');
      return;
    }
    pendingSubmission.current = true;
    setPending(true);
    setError('');
    if (draftKey) persistDraft(draftKey, value);
    const answer = draftKey ? { code: value, purpose: practice ? 'examples' : 'submit' } : { optionId: value };
    const body = { stageId: current.id, ...answer };
    try {
      const next = practice ? await api(endpoint, { hero, method: 'POST', body })
        : await submitExpedition(endpoint, { body });
      if (!mounted.current || !isCurrentHero(hero)) return;
      if (!practice && next.completed.includes(current.id)) {
        if (draftKey) clearDraft(draftKey, value);
        focusAfterStage.current = true;
      }
      const result = next.result && practice ? { ...next.result, purpose: 'examples' } : next.result;
      setQuest({ ...next, result });
    } catch (failure) {
      if (mounted.current && isCurrentHero(hero)) setError(failure.message);
    } finally {
      pendingSubmission.current = false;
      if (mounted.current && isCurrentHero(hero)) setPending(false);
    }
  }

  const status = loadError ? 'Quest unavailable' : finished ? 'Quest complete'
    : quest ? `${quest.completed.length} / ${quest.stages.length} steps complete` : 'Loading side quest…';
  return <section id={`${slug}-quest`} className="field-card special-encounter coding-side-quest" aria-labelledby={titleId}>
    <div className="special-heading">
      <div><p className="eyebrow">SIDE QUEST</p><h2 id={titleId}>{quest?.title ?? entry.title}</h2></div>
      <p className="special-status" role="status">{status}</p>
    </div>
    {loadError && <div className="special-body">
      <p className="muted">{loadError}</p>
      <button type="button" className="button button-quiet" onClick={() => {
        setLoadError('');
        setRetry((attempt) => attempt + 1);
      }}>Retry side quest</button>
    </div>}
    {quest && <>
      <p className="special-description">{quest.description}</p>
      {quest.brief && <p className="side-quest-notes">{quest.brief}</p>}
      {quest.legacyCode && <details className="details-block">
        <summary>Original ledger code</summary>
        <pre className="test-output">{quest.legacyCode}</pre>
      </details>}
      <ol className="special-steps" aria-label={presentation.stepsLabel}>
        {quest.stages.map((stage) => {
          const cleared = quest.completed.includes(stage.id);
          const active = current === stage;
          return <li key={stage.id} data-step={cleared ? 'cleared' : active ? 'current' : 'waiting'}
            aria-current={active ? 'step' : undefined}>
            {cleared && <><span aria-hidden="true">✓ </span><span className="visually-hidden">Complete. </span></>}
            {stage.title}
          </li>;
        })}
      </ol>
      <SideQuestResult result={quest.result} />
      <div className="special-body">
        {current && <SideQuestStage key={current.id} stage={current} presentation={presentation}
          draft={draftKey ? game.drafts.get(draftKey) ?? current.draft : undefined}
          saveDraft={(value) => {
            if (isCurrentHero(hero)) persistDraft(draftKey, value);
          }} {...{ pending, blocked, fallen, unavailable, focusTarget, submit }} />}
        {error ? <p className="inline-status" role="alert" data-error="true">{error}</p> : pending
          && <p className="inline-status" role="status">{draftKey ? 'Running JavaScript tests…' : 'The GM is checking your answer…'}</p>}
        {finished && <>
          <p className="special-victory" ref={focusTarget} tabIndex={-1}>{presentation.completion}</p>
          {quest.reward && <p className="fine-print">{quest.reward}</p>}
          {quest.debrief && <details className="details-block">
            <summary>Worked design</summary>
            <p className="side-quest-notes">{quest.debrief}</p>
          </details>}
        </>}
      </div>
    </>}
  </section>;
}

export function SideQuest({ game, actions, questKey, entry }) {
  const presentation = presentations[questKey];
  if (!game.hero || !presentation) return null;
  return <QuestPanel key={`${game.hero.id}:${questKey}`} {...{ game, actions, entry, presentation }} />;
}
