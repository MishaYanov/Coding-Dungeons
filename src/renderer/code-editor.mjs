import { useRef } from 'react';
import { flushSync } from 'react-dom';

const indentation = '    ';
export const indentationHelp = 'Tab inserts four spaces. Press Escape, then Tab to leave the editor.';

export function useCodeIndentation(updateValue) {
  const leaveOnTab = useRef(false);
  const nativeEdit = useRef(null);

  return {
    onChange(event) {
      if (nativeEdit.current) nativeEdit.current.observed = true;
      updateValue(event.currentTarget.value);
    },
    onBlur() {
      leaveOnTab.current = false;
    },
    onKeyDown(event) {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        leaveOnTab.current = true;
        return;
      }
      const leaving = leaveOnTab.current;
      leaveOnTab.current = false;
      if (event.key !== 'Tab' || leaving || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;

      event.preventDefault();
      const editor = event.currentTarget;
      const { value, selectionStart, selectionEnd, maxLength, ownerDocument } = editor;
      const next = value.slice(0, selectionStart) + indentation + value.slice(selectionEnd);
      if (maxLength >= 0 && next.length > maxLength) return;

      // Chromium can insert text through its editing engine, which keeps native Undo.
      if (ownerDocument.activeElement === editor && typeof ownerDocument.execCommand === 'function') {
        const edit = { observed: false };
        nativeEdit.current = edit;
        try {
          ownerDocument.execCommand('insertText', false, indentation);
        } catch {
          // Browsers without this command still get the same controlled value.
        } finally {
          nativeEdit.current = null;
        }
        if (edit.observed && editor.value === next) return;
      }

      flushSync(() => updateValue(next));
      const cursor = selectionStart + indentation.length;
      editor.setSelectionRange(cursor, cursor);
    },
  };
}
