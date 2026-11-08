import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { mountCreature } from '../../public/creatures.mjs';
import { indentationHelp, useCodeIndentation } from './code-editor.mjs';
import { WorkbenchReport } from './guide.jsx';
export { diamondPosition } from './diamond-placement.mjs';

const diamondDraftKey = 'diamond-goblin:code';
const diamondEndpoint = '/api/diamond/submit';

export function encounterKind(encounter) {
  return encounter.kind === 'elite' ? 'Elite boss' : 'Bug Hunt';
}

function Arena({ world, level, elite = false, goblin = false, defeated }) {
  const canvas = useRef(null);
  const sprite = useRef(null);
  const initiallyDefeated = useRef(defeated);
  useLayoutEffect(() => {
    const renderer = mountCreature(canvas.current, { world, level, elite, goblin, defeated: initiallyDefeated.current });
    sprite.current = renderer;
    return () => renderer.destroy();
  }, [world, level, elite, goblin]);
  useLayoutEffect(() => {
    sprite.current.update(defeated, { animate: true });
  }, [defeated]);
  return <canvas ref={canvas} className={`special-arena${goblin ? ' diamond-arena' : ''}`}
    width="320" height="116" aria-hidden="true" />;
}

function Steps({ stages, completed, current, label, diamond = false }) {
  return <ol className={`special-steps${diamond ? ' diamond-steps' : ''}`} aria-label={label}>
    {stages.map((stage, index) => {
      const cleared = completed.includes(stage.id);
      const state = cleared ? 'cleared' : stage === current ? 'current' : 'waiting';
      const prefix = diamond ? cleared ? '✓ ' : '' : `${cleared ? '✓' : index + 1} · `;
      return <li key={stage.id} data-step={state} aria-current={state === 'current' ? 'step' : undefined}>
        {prefix}{stage.title}{cleared && !diamond && <span className="visually-hidden"> (complete)</span>}
      </li>;
    })}
  </ol>;
}

function SpecialFeedback({ result }) {
  if (!result) return <div className="special-feedback" role="status" hidden />;
  return <div className="special-feedback" role="status" data-correct={String(result.correct)}>
    <p>{result.feedback}</p>
    {Boolean(result.trace?.length) && <ol className="special-trace">
      {result.trace.map((entry, index) => <li key={index}>{entry}</li>)}
    </ol>}
    {Boolean(result.checks?.length) && <ul className="special-checks">
      {result.checks.map(({ label, passed }) => <li key={label}>
        <span className="badge" data-done={String(passed)}>{passed ? 'Pass' : 'Fail'}</span><span>{label}</span>
      </li>)}
    </ul>}
  </div>;
}

function SpecialStage({ stage, busy, disabled, focusTarget, submit }) {
  const [selected, setSelected] = useState(null);
  const options = stage.options ?? [];
  const choice = options.length > 0;
  return <form className="special-form" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && (!choice || selected)) submit(stage.id, selected?.id);
  }}>
    <h3 ref={focusTarget} tabIndex={-1}>{stage.title}</h3>
    {stage.code && <pre className="signature special-code">{stage.code}</pre>}
    <fieldset className="special-controls" disabled={busy}>
      {choice ? <>
        <legend>{stage.prompt}</legend>
        {options.map((option) => <label key={option.id} className="special-option">
          <input type="radio" name="optionId" value={option.id} required
            checked={selected?.id === option.id} onChange={() => setSelected(option)} />
          <span>{option.label}</span>
        </label>)}
        <pre className="signature special-code" hidden={!selected?.code}>{selected?.code}</pre>
      </> : <p>{stage.prompt}</p>}
      <button type="submit" className="button button-primary" data-expedition-submit="" disabled={disabled}>
        {stage.actionLabel}
      </button>
    </fieldset>
  </form>;
}

export function SpecialEncounter({ encounter, game, actions }) {
  const [completed, setCompleted] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const focusTarget = useRef(null);
  const focusAfterStage = useRef(false);
  const { hero } = game;
  const { api, isCurrentHero, submitExpedition } = actions;
  const { id, stages } = encounter;
  const endpoint = `/api/encounters/${encodeURIComponent(id)}`;
  const elite = encounter.kind === 'elite';
  const current = completed && stages.find((stage) => !completed.includes(stage.id));
  const finished = completed !== null && !current;
  const disabled = busy || !hero || game.switchingHero || game.combat?.fallen;
  const titleId = `special-title-${id}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    api(endpoint, { hero }).then((saved) => {
      if (active) setCompleted(saved.completed);
    }, (error) => {
      if (active) setLoadError(error.message);
    });
    return () => { active = false; };
  }, [api, endpoint, hero, retry]);
  useLayoutEffect(() => {
    if (focusAfterStage.current) {
      focusAfterStage.current = false;
      focusTarget.current?.focus({ preventScroll: true });
    }
  }, [current?.id, finished]);

  async function submit(stageId, optionId) {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const next = await submitExpedition(endpoint, { body: { stageId, ...(optionId && { optionId }) } });
      if (!mounted.current || !isCurrentHero(hero)) return;
      setFeedback(next.result);
      if (next.completed.includes(stageId)) {
        focusAfterStage.current = true;
        setCompleted(next.completed);
      }
    } catch (error) {
      if (mounted.current && isCurrentHero(hero)) setFeedback({ correct: false, feedback: error.message });
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  let status = 'Loading encounter…';
  if (loadError) status = 'Encounter unavailable';
  else if (finished) status = elite ? 'Elite defeated' : 'Case closed';
  else if (completed) status = `${completed.length} / ${stages.length} ${elite ? 'locks broken' : 'steps complete'}`;

  return <section className="field-card special-encounter" data-kind={encounter.kind}
    data-completed={completed?.length} aria-labelledby={titleId}>
    <div className="special-heading">
      <div><p className="eyebrow">{encounterKind(encounter)}</p><h2 id={titleId}>{encounter.title}</h2></div>
      <p className="special-status" role="status">{status}</p>
    </div>
    <p className="special-description">{encounter.description}</p>
    {elite && completed && <Arena world={encounter.world} level={encounter.level} elite defeated={finished} />}
    <Steps stages={completed ? stages : []} completed={completed ?? []} current={current}
      label={elite ? 'Armor locks' : 'Investigation steps'} />
    <SpecialFeedback result={feedback} />
    <div className="special-body">
      {loadError && <><p className="muted">{loadError}</p><button type="button" className="button button-primary" onClick={() => {
        setLoadError(null);
        setRetry((attempt) => attempt + 1);
      }}>Retry encounter</button></>}
      {current && <SpecialStage key={current.id} stage={current} busy={busy} disabled={disabled}
        focusTarget={focusTarget} submit={submit} />}
      {finished && <p className="special-victory" ref={focusTarget} tabIndex={-1}>
        {elite ? 'All three locks are open. Your victory is saved to this hero.'
          : 'You reproduced the bug and verified the fix. This case is saved to your hero.'}
      </p>}
    </div>
  </section>;
}

export function DiamondGem({ position, onClick, disabled }) {
  return <button type="button" className="page-diamond" aria-label="Inspect hidden diamond" title="Inspect hidden diamond"
    style={{ '--diamond-x': `${position.x}%`, '--diamond-y': `${position.y}%` }} onClick={onClick} disabled={disabled}>
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 12h17l6 7-14.5 15L4 19z" fill="#60e8ff" stroke="#14334e" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4 19h29L18.5 34 13 19l3-7m11 0-3 7-5.5 15" fill="none" stroke="#2889ab" strokeWidth="1.2" />
      <path d="m10 12-6 7h9l3-7zm6 0-3 7h11l-3-7z" fill="#e5fcff" />
      <path d="m33 3 1.2 4.8L39 9l-4.8 1.2L33 15l-1.2-4.8L27 9l4.8-1.2z" fill="#fff8cd" />
    </svg>
  </button>;
}

function DiamondStage({ stage, draft, saveDraft, unavailable, busy, disabled, focusTarget, submit, error }) {
  const code = stage.kind === 'code';
  const [value, setValue] = useState(code ? draft ?? stage.starter ?? '' : '');
  const indentation = useCodeIndentation((next) => {
    setValue(next);
    saveDraft(next);
  });
  return <form className="special-form" onSubmit={(event) => {
    event.preventDefault();
    if (disabled) return;
    const practice = event.nativeEvent.submitter?.value === 'examples';
    submit(stage, value, practice);
  }}>
    <h3 ref={focusTarget} tabIndex={-1}>{stage.title}</h3>
    <fieldset className="special-controls" disabled={busy}>
      <legend>{stage.prompt}</legend>
      {code ? <>
        {stage.signature && <pre className="signature">{stage.signature}</pre>}
        <textarea className="code-editor" aria-label="Goblin code" aria-describedby="goblin-indent-help"
          rows={9} maxLength={49152} value={value} required spellCheck={false} autoCapitalize="off" autoComplete="off"
          {...indentation} />
        <p id="goblin-indent-help" className="fine-print">{indentationHelp}</p>
      </> : stage.options.map((option) => <label className="special-option" key={option.id}>
        <input type="radio" name="goblin-choice" required value={option.id} checked={value === option.id}
          onChange={() => setValue(option.id)} /><span>{option.label ?? option.text}</span>
      </label>)}
      {unavailable && <p className="fine-print">{unavailable}</p>}
      <div className="form-actions">
        <button type="submit" className="button button-primary" data-expedition-submit="" disabled={disabled}>
          {code ? 'Submit code' : 'Submit answer'}
        </button>
        {code && <button type="submit" className="button button-quiet" value="examples" disabled={disabled}>Run Examples</button>}
      </div>
    </fieldset>
    <p className="inline-status" role="status" data-error={error ? 'true' : undefined}>
      {error || (busy ? code ? 'Compiling and testing…' : 'The GM is checking your answer…' : '')}
    </p>
  </form>;
}

function DiamondFeedback({ feedback }) {
  if (!feedback) return <div className="prompt-feedback" aria-live="polite" hidden />;
  const { code, result } = feedback;
  if (code) return <div aria-live="polite">
    <WorkbenchReport result={result} />
    {result.feedback && <p className="fine-print">{result.feedback}</p>}
  </div>;
  return <div className="prompt-feedback" aria-live="polite" data-verdict={result.correct ? 'correct' : 'incorrect'}>
    <p>{result.feedback}</p>
  </div>;
}

function DiamondBattle({ game, actions }) {
  const { diamond: view, hero } = game;
  const { encounter, completed } = view;
  const current = encounter.stages.find((stage) => !completed.includes(stage.id));
  const finished = !current;
  const [open, setOpen] = useState(!finished || Boolean(game.diamondFocus));
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const focusTarget = useRef(null);
  const focusAfterStage = useRef(false);
  const summary = useRef(null);
  const unavailable = current?.kind === 'code' && game.runner?.toLowerCase() === 'unavailable'
    ? `${game.runnerDetail || `The local ${game.world.name} runner is unavailable.`} You can keep editing your draft.` : '';
  const disabled = busy || !hero || game.switchingHero || game.combat?.fallen || Boolean(unavailable);

  useLayoutEffect(() => {
    if (game.diamondFocus) summary.current?.focus();
  }, [game.diamondFocus]);
  useLayoutEffect(() => {
    if (focusAfterStage.current) {
      focusAfterStage.current = false;
      focusTarget.current?.focus();
    }
  }, [current?.id]);

  async function submit(stage, value, practice) {
    if (disabled || pending.current) return;
    const code = stage.kind === 'code';
    if (!value.trim()) {
      setError(code ? 'Enter some code first.' : 'Choose an answer first.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    setFeedback(null);
    const answer = code ? { code: value, purpose: practice ? 'examples' : 'submit' } : { optionId: value };
    const body = { stageId: stage.id, ...answer };
    try {
      const next = practice ? await actions.api(diamondEndpoint, { hero, method: 'POST', body })
        : await actions.submitExpedition(diamondEndpoint, { body });
      if (!actions.isCurrentHero(hero)) return;
      setFeedback({ code, result: next.result });
      if (next.completed.includes(stage.id)) {
        if (code) actions.clearDraft(diamondDraftKey, value);
        focusAfterStage.current = true;
      }
      actions.setDiamond(next);
    } catch (failure) {
      if (actions.isCurrentHero(hero)) setError(failure.message);
    } finally {
      pending.current = false;
      if (actions.isCurrentHero(hero)) setBusy(false);
    }
  }

  return <section className="field-card special-encounter diamond-encounter" aria-labelledby="diamond-encounter-title">
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary ref={summary} className="diamond-heading">
        <div><p className="eyebrow">HIDDEN AMBUSH</p><h2 id="diamond-encounter-title">{encounter.title}</h2></div>
        <p className="special-status" role="status">
          {finished ? 'Goblin defeated' : `${completed.length} / ${encounter.stages.length} strikes landed`}
        </p>
      </summary>
      <p className="special-description">{encounter.description}</p>
      <Arena goblin defeated={finished} />
      <Steps stages={encounter.stages} completed={completed} current={current} label="Goblin fight stages" diamond />
      <DiamondFeedback feedback={feedback} />
      <div className="special-body diamond-body">
        {finished ? <p className="special-victory" ref={focusTarget} tabIndex={-1}>
          You recovered the goblin’s bag. +{encounter.rewardDiamonds} diamonds
        </p> : <DiamondStage key={current.id} stage={current} draft={game.drafts.get(diamondDraftKey) ?? (view.draft || undefined)}
          saveDraft={(value) => actions.persistDraft(diamondDraftKey, value)} unavailable={unavailable} busy={busy}
          disabled={disabled} focusTarget={focusTarget} submit={submit} error={error} />}
      </div>
    </details>
  </section>;
}

export function DiamondEncounter({ game, actions }) {
  return <div id="diamond-encounter" className="guide-content diamond-slot">
    {game.diamond?.encounter && <DiamondBattle game={game} actions={actions} />}
  </div>;
}
