import React, { useLayoutEffect, useRef, useState } from 'react';
import { rustDocsIndexUrl, rustDocsLicense, rustDocsVersion } from '../../data/rust-docs.mjs';
import { lookupRustDocs, RUST_DOC_QUERY_LIMIT } from '../../lib/rust-docs-search.mjs';

function ReferenceCard({ item }) {
  return <article className="rust-doc-card">
    <h3 id={'rust-doc-' + item.id}><code>{item.title}</code></h3>
    <p>{item.summary}</p>
    <details className="rust-doc-detail">
      <summary aria-describedby={'rust-doc-' + item.id}>
        <span className="rust-doc-open-label">Open offline docs</span>
        <span className="rust-doc-close-label">Close offline docs</span>
      </summary>
      <code className="rust-doc-signature">{item.signature}</code>
      <p>{item.detail}</p>
      <blockquote>{item.excerpt}<cite>Rust {rustDocsVersion} standard library</cite></blockquote>
      <div className="rust-doc-source">
        <span>Stable since Rust {item.since}</span>
        <a className="rust-docs-source" href={item.url} target="_blank" rel="noopener noreferrer">Official Rust documentation (online)</a>
      </div>
      <details className="rust-doc-license">
        <summary>Documentation license</summary>
        <p>{rustDocsLicense}</p>
      </details>
    </details>
  </article>;
}

export default function RustReferencePanel({ compact }) {
  const [expanded, setExpanded] = useState({ desktop: true, phone: false });
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(null);
  const results = useRef(null);
  const layout = compact ? 'phone' : 'desktop';
  const open = expanded[layout];

  // Move focus from the soft keyboard (or a disappearing receiver button) to the reply.
  useLayoutEffect(() => {
    if (answer) {
      results.current.scrollTop = 0;
      results.current.focus({ preventScroll: true });
    }
  }, [answer]);

  function submit(event) {
    event.preventDefault();
    if (query.trim()) setAnswer(lookupRustDocs(query));
  }

  return <section className="rust-reference" aria-labelledby="rust-reference-title">
    <h2 id="rust-reference-title">
      <button className="rust-reference-toggle" type="button" aria-controls="rust-reference-body"
        aria-expanded={open} onClick={() => setExpanded({ ...expanded, [layout]: !open })}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14" />
        </svg>
        Ask the Rust GM
        <span className="rust-reference-chevron" aria-hidden="true" />
      </button>
    </h2>
    <div id="rust-reference-body" hidden={!open}>
      <form role="search" aria-label="Offline Rust documentation" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="rust-reference-query">Rust documentation question</label>
        <input id="rust-reference-query" type="search" enterKeyHint="search" maxLength={RUST_DOC_QUERY_LIMIT}
          autoComplete="off" placeholder="What do you want to do in Rust?" value={query}
          onChange={event => { setQuery(event.target.value); setAnswer(null); }} />
        <button type="submit" className="button button-primary" disabled={!query.trim()}>Ask</button>
      </form>
      {answer && <div className="rust-reference-results" ref={results} role="region"
        aria-label="Rust documentation results" aria-describedby="rust-reference-reply" tabIndex={-1}>
        {answer.kind === 'clarify' ? <>
          <p id="rust-reference-reply">Which type or module are you working with?</p>
          <div className="rust-doc-receivers">{answer.receivers.map(receiver =>
            <button key={receiver} type="button" className="button button-quiet"
              onClick={() => setAnswer(lookupRustDocs(query, receiver))}>{receiver}</button>)}</div>
        </> : answer.kind === 'results' ? <>
          <span className="visually-hidden" id="rust-reference-reply">First match, {answer.items[0].title}.</span>
          {answer.items.map(item => <ReferenceCard key={item.id} item={item} />)}
        </> : <>
          <p id="rust-reference-reply">No match in the offline reference. Try a type and method, such as <code>Vec::retain</code>.</p>
          <a className="rust-docs-source" href={rustDocsIndexUrl} target="_blank" rel="noopener noreferrer">
            Browse the full Rust standard library (online)
          </a>
        </>}
      </div>}
    </div>
  </section>;
}
