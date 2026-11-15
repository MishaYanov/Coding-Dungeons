import React, {useEffect, useState} from 'react';

const books = new Map();

function readBook(world, total) {
  if (!books.has(world)) {
    const directory = world === 'rust' ? '/book/' : `/book/${world}/`;
    books.set(world, fetch(directory + 'reader-text.json', {redirect:'error'}).then(async response => {
      if (!response.ok) throw new Error('The text edition could not load.');
      const data = await response.json();
      if (data?.version !== 1 || data.world !== world || !Array.isArray(data.pages) || data.pages.length !== total) {
        throw new Error('This text edition does not match the book.');
      }
      return data.pages;
    }).catch(error => {
      books.delete(world);
      throw error;
    }));
  }
  return books.get(world);
}

const validBlocks = blocks => Array.isArray(blocks) && blocks.length > 0 && blocks.every(block =>
  Array.isArray(block) && ['h','p','code'].includes(block[0]) && typeof block[1] === 'string');

export function TextReader({world, total, page, links, diamond, diamondStarting, onDiamond}) {
  const [book, setBook] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    readBook(world, total).then(pages => {
      if (current) setBook(pages);
    }).catch(() => {
      if (current) setError(true);
    });
    return () => { current = false; };
  }, [world, total, retry]);

  const blocks = book?.[page - 1];
  if (error || book && !validBlocks(blocks)) {
    return <div className="reader-placeholder" role="status">
      <p>This page’s text could not load. The page image is also available.</p>
      <button type="button" className="button" onClick={() => {
        books.delete(world);
        setBook(null);
        setError(false);
        setRetry(value => value + 1);
      }}>Retry text</button>
    </div>;
  }
  if (!blocks) return <p className="reader-placeholder" role="status">Opening text edition…</p>;

  return <article className="reader-text" aria-label={`Book text, page ${page}`}>
    {blocks.map(([kind, text], index) => {
      if (kind === 'h') return <h2 key={index}>{text}</h2>;
      if (kind === 'code') return <pre key={index}><code>{text}</code></pre>;
      return <p key={index}>{text}</p>;
    })}
    {diamond && <button type="button" className="button text-diamond" onClick={onDiamond}
      disabled={diamondStarting}>Inspect hidden diamond</button>}
    {links.length > 0 && <details className="details-block">
      <summary>Links on this page</summary>
      <ul>{links.map(({style, ...props}) => <li key={props.href}>
        <a {...props}>{props['aria-label']}</a>
      </li>)}</ul>
    </details>}
  </article>;
}
