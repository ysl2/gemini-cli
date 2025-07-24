/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useReducer, useEffect } from 'react';
import type { Key } from './useKeypress.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { useVimMode } from '../contexts/VimModeContext.js';

export type VimMode = 'NORMAL' | 'INSERT';

// Constants
const DIGIT_MULTIPLIER = 10;
const DEFAULT_COUNT = 1;
const LINE_SEPARATOR = '\n';
const WHITESPACE_CHARS = /\s/;
const WORD_CHARS = /\w/;
const DIGIT_1_TO_9 = /^[1-9]$/;

// Command types
const CMD_TYPES = {
  DELETE_WORD_FORWARD: 'dw',
  DELETE_WORD_BACKWARD: 'db',
  DELETE_WORD_END: 'de',
  CHANGE_WORD_FORWARD: 'cw',
  CHANGE_WORD_BACKWARD: 'cb',
  CHANGE_WORD_END: 'ce',
  DELETE_CHAR: 'x',
  DELETE_LINE: 'dd',
  CHANGE_LINE: 'cc',
  DELETE_TO_EOL: 'D',
  CHANGE_TO_EOL: 'C',
  CHANGE_MOVEMENT: {
    LEFT: 'ch',
    DOWN: 'cj',
    UP: 'ck',
    RIGHT: 'cl',
  },
} as const;

// Utility functions moved outside the hook to avoid unnecessary useCallback usage
const findNextWordStart = (text: string, currentOffset: number): number => {
  let i = currentOffset;

  if (i >= text.length) return i;

  const currentChar = text[i];

  // Skip current word/sequence based on character type
  if (WORD_CHARS.test(currentChar)) {
    // Skip current word characters
    while (i < text.length && WORD_CHARS.test(text[i])) {
      i++;
    }
  } else if (!WHITESPACE_CHARS.test(currentChar)) {
    // Skip current non-word, non-whitespace characters (like "/", ".", etc.)
    while (
      i < text.length &&
      !WORD_CHARS.test(text[i]) &&
      !WHITESPACE_CHARS.test(text[i])
    ) {
      i++;
    }
  }

  // Skip whitespace
  while (i < text.length && WHITESPACE_CHARS.test(text[i])) {
    i++;
  }

  // If we reached the end of text and there's no next word,
  // vim behavior for dw is to delete to the end of the current word
  if (i >= text.length) {
    // Go back to find the end of the last word
    let endOfLastWord = text.length - 1;
    while (endOfLastWord >= 0 && WHITESPACE_CHARS.test(text[endOfLastWord])) {
      endOfLastWord--;
    }
    // For dw on last word, return position AFTER the last character to delete entire word
    return Math.max(currentOffset + 1, endOfLastWord + 1);
  }

  return i;
};

const findPrevWordStart = (text: string, currentOffset: number): number => {
  let i = currentOffset;

  // If at beginning of text, return current position
  if (i <= 0) {
    return currentOffset;
  }

  // Move back one character to start searching
  i--;

  // Skip whitespace moving backwards
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n')) {
    i--;
  }

  if (i < 0) {
    return 0; // Reached beginning of text
  }

  const charAtI = text[i];

  if (WORD_CHARS.test(charAtI)) {
    // We're in a word, move to its beginning
    while (i >= 0 && WORD_CHARS.test(text[i])) {
      i--;
    }
    return i + 1; // Return first character of word
  } else {
    // We're in punctuation, move to its beginning
    while (
      i >= 0 &&
      !WORD_CHARS.test(text[i]) &&
      text[i] !== ' ' &&
      text[i] !== '\t' &&
      text[i] !== LINE_SEPARATOR
    ) {
      i--;
    }
    return i + 1; // Return first character of punctuation sequence
  }
};

const findWordEnd = (text: string, currentOffset: number): number => {
  let i = currentOffset;

  // If we're not on a word character, find the next word
  if (!WORD_CHARS.test(text[i])) {
    while (i < text.length && !WORD_CHARS.test(text[i])) {
      i++;
    }
  }

  // Move to end of current word
  while (i < text.length && WORD_CHARS.test(text[i])) {
    i++;
  }

  // Move back one to be on the last character of the word
  return Math.max(currentOffset, i - 1);
};

// Helper function to clear pending state
const createClearPendingState = () => ({
  count: 0,
  pendingG: false,
  pendingD: false,
  pendingC: false,
});

// State and action types for useReducer
type VimState = {
  mode: VimMode;
  count: number;
  pendingG: boolean;
  pendingD: boolean;
  pendingC: boolean;
  lastCommand: { type: string; count: number } | null;
};

type VimAction =
  | { type: 'SET_MODE'; mode: VimMode }
  | { type: 'SET_COUNT'; count: number }
  | { type: 'INCREMENT_COUNT'; digit: number }
  | { type: 'CLEAR_COUNT' }
  | { type: 'SET_PENDING_G'; pending: boolean }
  | { type: 'SET_PENDING_D'; pending: boolean }
  | { type: 'SET_PENDING_C'; pending: boolean }
  | {
      type: 'SET_LAST_COMMAND';
      command: { type: string; count: number } | null;
    }
  | { type: 'CLEAR_PENDING_STATES' }
  | { type: 'ESCAPE_TO_NORMAL' };

const initialVimState: VimState = {
  mode: 'NORMAL',
  count: 0,
  pendingG: false,
  pendingD: false,
  pendingC: false,
  lastCommand: null,
};

// Reducer function
const vimReducer = (state: VimState, action: VimAction): VimState => {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'SET_COUNT':
      return { ...state, count: action.count };

    case 'INCREMENT_COUNT':
      return { ...state, count: state.count * DIGIT_MULTIPLIER + action.digit };

    case 'CLEAR_COUNT':
      return { ...state, count: 0 };

    case 'SET_PENDING_G':
      return { ...state, pendingG: action.pending };

    case 'SET_PENDING_D':
      return { ...state, pendingD: action.pending };

    case 'SET_PENDING_C':
      return { ...state, pendingC: action.pending };

    case 'SET_LAST_COMMAND':
      return { ...state, lastCommand: action.command };

    case 'CLEAR_PENDING_STATES':
      return {
        ...state,
        ...createClearPendingState(),
      };

    case 'ESCAPE_TO_NORMAL':
      // Handle escape - clear all pending states (mode is updated via context)
      return {
        ...state,
        ...createClearPendingState(),
      };

    default:
      return state;
  }
};

/**
 * React hook that provides vim-style editing functionality for text input.
 *
 * Features:
 * - Modal editing (INSERT/NORMAL modes)
 * - Navigation: h,j,k,l,w,b,e,0,$,^,gg,G with count prefixes
 * - Editing: x,a,i,o,O,A,I,d,c,D,C with count prefixes
 * - Complex operations: dd,cc,dw,cw,db,cb,de,ce
 * - Command repetition (.)
 * - Settings persistence
 *
 * @param buffer - TextBuffer instance for text manipulation
 * @param onSubmit - Optional callback for command submission
 * @returns Object with vim state and input handler
 */
export function useVim(buffer: TextBuffer, onSubmit?: (value: string) => void) {
  const { vimEnabled, vimMode, setVimMode } = useVimMode();
  const [state, dispatch] = useReducer(vimReducer, initialVimState);

  // Sync vim mode from context to local state
  useEffect(() => {
    dispatch({ type: 'SET_MODE', mode: vimMode });
  }, [vimMode]);

  // Helper to update mode in both reducer and context
  const updateMode = useCallback(
    (mode: VimMode) => {
      setVimMode(mode);
      dispatch({ type: 'SET_MODE', mode });
    },
    [setVimMode],
  );

  // Helper functions using the reducer state
  const getCurrentCount = useCallback(
    () => state.count || DEFAULT_COUNT,
    [state.count],
  );

  const getCurrentOffset = useCallback(() => {
    const lines = buffer.lines;
    const [row, col] = buffer.cursor;
    let offset = 0;

    for (let i = 0; i < row; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += col;

    return offset;
  }, [buffer.lines, buffer.cursor]);

  const setOffsetPosition = useCallback(
    (offset: number) => {
      buffer.moveToOffset(offset);
    },
    [buffer],
  );

  /** Converts row/col position to absolute text offset */
  const getOffsetFromPosition = useCallback(
    (row: number, col: number) => {
      let offset = 0;
      for (let i = 0; i < row; i++) {
        offset += buffer.lines[i].length + 1; // +1 for newline
      }
      offset += col;
      return offset;
    },
    [buffer.lines],
  );

  /** Calculates start/end offsets for multi-line operations like dd, cc */
  const getLineRangeOffsets = useCallback(
    (startRow: number, lineCount: number) => {
      const totalLines = buffer.lines.length;
      const actualLineCount = Math.min(lineCount, totalLines - startRow);

      let startOffset = 0;
      for (let row = 0; row < startRow; row++) {
        startOffset += buffer.lines[row].length + 1;
      }

      let endOffset = startOffset;
      for (let i = 0; i < actualLineCount; i++) {
        const lineIndex = startRow + i;
        if (lineIndex < totalLines) {
          endOffset += buffer.lines[lineIndex].length;
          if (lineIndex < totalLines - 1) {
            endOffset += 1; // +1 for newline, except for last line
          } else if (startRow > 0) {
            // Last line - include the newline before it
            startOffset -= 1;
          }
        }
      }

      return { startOffset, endOffset, actualLineCount };
    },
    [buffer.lines],
  );

  /** Handles change operations for directional movement (ch, cj, ck, cl) */
  const handleChangeMovement = useCallback(
    (movementType: 'h' | 'j' | 'k' | 'l', count: number) => {
      const currentRow = buffer.cursor[0];
      const currentCol = buffer.cursor[1];

      switch (movementType) {
        case 'h': {
          // Change N characters to the left
          for (let i = 0; i < count; i++) {
            if (currentCol > 0) {
              buffer.move('left');
              buffer.del();
            }
          }
          break;
        }

        case 'j': {
          // Change from current line down N lines
          const totalLines = buffer.lines.length;
          const linesToChange = Math.min(count + 1, totalLines - currentRow);

          if (totalLines === 1) {
            const currentLine = buffer.lines[0] || '';
            buffer.replaceRangeByOffset(0, currentLine.length, '');
          } else {
            const { startOffset, endOffset } = getLineRangeOffsets(
              currentRow,
              linesToChange,
            );
            buffer.replaceRangeByOffset(startOffset, endOffset, '');
          }
          break;
        }

        case 'k': {
          // Change from current line up N lines
          const linesToChange = Math.min(count + 1, currentRow + 1);
          const startRow = currentRow - count;

          if (buffer.lines.length === 1) {
            const currentLine = buffer.lines[0] || '';
            buffer.replaceRangeByOffset(0, currentLine.length, '');
          } else {
            const { startOffset, endOffset } = getLineRangeOffsets(
              Math.max(0, startRow),
              linesToChange,
            );
            buffer.replaceRangeByOffset(startOffset, endOffset, '');
            buffer.moveToOffset(startOffset);
          }
          break;
        }

        case 'l': {
          // Change N characters to the right
          for (let i = 0; i < count; i++) {
            buffer.del();
          }
          break;
        }

        default:
          // This should never happen due to type constraints
          break;
      }

      updateMode('INSERT');
      const cmdTypeMap = {
        h: CMD_TYPES.CHANGE_MOVEMENT.LEFT,
        j: CMD_TYPES.CHANGE_MOVEMENT.DOWN,
        k: CMD_TYPES.CHANGE_MOVEMENT.UP,
        l: CMD_TYPES.CHANGE_MOVEMENT.RIGHT,
      } as const;

      dispatch({
        type: 'SET_LAST_COMMAND',
        command: { type: cmdTypeMap[movementType], count },
      });
      dispatch({ type: 'SET_PENDING_C', pending: false });
    },
    [buffer, getLineRangeOffsets, dispatch, updateMode],
  );

  /** Handles end-of-line operations (D, C) */
  const handleEndOfLineOperation = useCallback(
    (shouldEnterInsertMode: boolean) => {
      const currentRow = buffer.cursor[0];
      const currentCol = buffer.cursor[1];
      const currentLine = buffer.lines[currentRow] || '';

      if (currentCol < currentLine.length) {
        const startOffset = getOffsetFromPosition(currentRow, currentCol);
        const endOffset = startOffset + (currentLine.length - currentCol);
        buffer.replaceRangeByOffset(startOffset, endOffset, '');
      }

      if (shouldEnterInsertMode) {
        updateMode('INSERT');
      }
    },
    [buffer, getOffsetFromPosition, updateMode],
  );

  /** Executes common commands to eliminate duplication in dot (.) repeat command */
  const executeCommand = useCallback(
    (cmdType: string, count: number) => {
      switch (cmdType) {
        case CMD_TYPES.DELETE_WORD_FORWARD: {
          buffer.vimDeleteWordForward(count);
          break;
        }

        case CMD_TYPES.DELETE_WORD_BACKWARD: {
          buffer.vimDeleteWordBackward(count);
          break;
        }

        case CMD_TYPES.DELETE_WORD_END: {
          const text = buffer.text;
          const currentOffset = getCurrentOffset();
          let endOffset = currentOffset;
          let offset = currentOffset;

          for (let i = 0; i < count; i++) {
            const wordEndOffset = findWordEnd(text, offset);
            if (wordEndOffset > offset) {
              offset = wordEndOffset;
            } else {
              break;
            }
          }
          endOffset = Math.min(offset + 1, text.length);

          if (endOffset !== currentOffset) {
            buffer.replaceRangeByOffset(
              Math.min(currentOffset, endOffset),
              Math.max(currentOffset, endOffset),
              '',
            );
          }
          break;
        }

        case CMD_TYPES.CHANGE_WORD_FORWARD: {
          const text = buffer.text;
          const currentOffset = getCurrentOffset();
          let endOffset = currentOffset;
          let offset = currentOffset;

          for (let i = 0; i < count; i++) {
            const nextWordOffset = findNextWordStart(text, offset);
            if (nextWordOffset > offset) {
              offset = nextWordOffset;
            } else {
              const wordEndOffset = findWordEnd(text, offset);
              offset = Math.min(wordEndOffset + 1, text.length);
              break;
            }
          }
          endOffset = offset;

          if (endOffset !== currentOffset) {
            buffer.replaceRangeByOffset(
              Math.min(currentOffset, endOffset),
              Math.max(currentOffset, endOffset),
              '',
            );
          }
          updateMode('INSERT');
          break;
        }

        case CMD_TYPES.CHANGE_WORD_BACKWARD: {
          const text = buffer.text;
          const currentOffset = getCurrentOffset();
          let endOffset = currentOffset;
          let offset = currentOffset;

          for (let i = 0; i < count; i++) {
            const prevWordOffset = findPrevWordStart(text, offset);
            if (prevWordOffset < offset) {
              offset = prevWordOffset;
            } else {
              break;
            }
          }
          endOffset = offset;

          if (endOffset !== currentOffset) {
            buffer.replaceRangeByOffset(
              Math.min(currentOffset, endOffset),
              Math.max(currentOffset, endOffset),
              '',
            );
          }
          updateMode('INSERT');
          break;
        }

        case CMD_TYPES.CHANGE_WORD_END: {
          const text = buffer.text;
          const currentOffset = getCurrentOffset();
          let endOffset = currentOffset;
          let searchOffset = currentOffset;

          for (let i = 0; i < count; i++) {
            const wordEndOffset = findWordEnd(text, searchOffset);
            if (wordEndOffset <= searchOffset) break;

            endOffset = wordEndOffset + 1;

            if (i < count - 1) {
              const nextWordStart = findNextWordStart(text, wordEndOffset + 1);
              searchOffset = nextWordStart;
              if (nextWordStart <= wordEndOffset) break;
            }
          }

          if (endOffset > currentOffset) {
            buffer.replaceRangeByOffset(currentOffset, endOffset, '');
            updateMode('INSERT');
          }
          break;
        }

        case CMD_TYPES.DELETE_CHAR: {
          for (let i = 0; i < count; i++) {
            const currentRow = buffer.cursor[0];
            const currentCol = buffer.cursor[1];
            const currentLine = buffer.lines[currentRow] || '';

            if (currentCol < currentLine.length) {
              const isLastChar = currentCol === currentLine.length - 1;
              buffer.del();

              if (isLastChar && currentCol > 0) {
                buffer.move('left');
              }
            }
          }
          break;
        }

        case CMD_TYPES.DELETE_LINE: {
          const startRow = buffer.cursor[0];
          const totalLines = buffer.lines.length;

          if (totalLines === 1) {
            const currentLine = buffer.lines[0] || '';
            buffer.replaceRangeByOffset(0, currentLine.length, '');
          } else {
            const { startOffset, endOffset } = getLineRangeOffsets(
              startRow,
              count,
            );
            buffer.replaceRangeByOffset(startOffset, endOffset, '');
          }
          break;
        }

        case CMD_TYPES.CHANGE_LINE: {
          const startRow = buffer.cursor[0];
          const totalLines = buffer.lines.length;

          if (totalLines === 1) {
            const currentLine = buffer.lines[0] || '';
            buffer.replaceRangeByOffset(0, currentLine.length, '');
          } else {
            const { startOffset, endOffset } = getLineRangeOffsets(
              startRow,
              count,
            );
            buffer.replaceRangeByOffset(startOffset, endOffset, '');
          }
          updateMode('INSERT');
          break;
        }

        case CMD_TYPES.CHANGE_MOVEMENT.LEFT:
        case CMD_TYPES.CHANGE_MOVEMENT.DOWN:
        case CMD_TYPES.CHANGE_MOVEMENT.UP:
        case CMD_TYPES.CHANGE_MOVEMENT.RIGHT: {
          const movementType = cmdType[1] as 'h' | 'j' | 'k' | 'l';
          handleChangeMovement(movementType, count);
          break;
        }

        case CMD_TYPES.DELETE_TO_EOL: {
          handleEndOfLineOperation(false);
          break;
        }

        case CMD_TYPES.CHANGE_TO_EOL: {
          handleEndOfLineOperation(true);
          break;
        }

        default:
          return false;
      }
      return true;
    },
    [
      buffer,
      getCurrentOffset,
      getLineRangeOffsets,
      handleChangeMovement,
      handleEndOfLineOperation,
      updateMode,
    ],
  );

  const handleInput = useCallback(
    (key: Key): boolean => {
      if (!vimEnabled) {
        return false; // Let InputPrompt handle it
      }

      // Ensure key has all required properties for tests
      const normalizedKey: Key = {
        name: key.name || '',
        sequence: key.sequence || '',
        ctrl: key.ctrl || false,
        meta: key.meta || false,
        shift: key.shift || false,
        paste: key.paste || false,
      };

      // Handle INSERT mode
      if (state.mode === 'INSERT') {
        // Handle escape key immediately - switch to NORMAL mode on any escape
        if (normalizedKey.name === 'escape') {
          // Move cursor left if not at beginning of line (vim behavior)
          const currentCol = buffer.cursor[1];
          if (currentCol > 0) {
            buffer.move('left');
          }

          dispatch({ type: 'ESCAPE_TO_NORMAL' });
          updateMode('NORMAL');
          return true;
        }

        // In INSERT mode, let InputPrompt handle completion keys and special commands
        if (
          normalizedKey.name === 'tab' ||
          (normalizedKey.name === 'return' && !normalizedKey.ctrl) ||
          normalizedKey.name === 'up' ||
          normalizedKey.name === 'down'
        ) {
          return false; // Let InputPrompt handle completion
        }

        // Let InputPrompt handle Ctrl+V for clipboard image pasting
        if (normalizedKey.ctrl && normalizedKey.name === 'v') {
          return false; // Let InputPrompt handle clipboard functionality
        }

        // Special handling for Enter key to allow command submission (lower priority than completion)
        if (
          normalizedKey.name === 'return' &&
          !normalizedKey.ctrl &&
          !normalizedKey.meta
        ) {
          if (buffer.text.trim() && onSubmit) {
            // Handle command submission directly
            const submittedValue = buffer.text;
            buffer.setText('');
            onSubmit(submittedValue);
            return true;
          }
          return true; // Handled by vim (even if no onSubmit callback)
        }

        // useKeypress already provides the correct format for TextBuffer
        buffer.handleInput(normalizedKey);
        return true; // Handled by vim
      }

      // Handle NORMAL mode
      if (state.mode === 'NORMAL') {
        // Handle Escape key in NORMAL mode - clear all pending states
        if (normalizedKey.name === 'escape') {
          dispatch({ type: 'CLEAR_PENDING_STATES' });
          return true; // Handled by vim
        }

        // Handle count input (numbers 1-9, and 0 if count > 0)
        if (
          DIGIT_1_TO_9.test(normalizedKey.sequence) ||
          (normalizedKey.sequence === '0' && state.count > 0)
        ) {
          dispatch({
            type: 'INCREMENT_COUNT',
            digit: parseInt(normalizedKey.sequence, 10),
          });
          return true; // Handled by vim
        }

        const repeatCount = getCurrentCount();
        const text = buffer.text;
        const currentOffset = getCurrentOffset();

        switch (normalizedKey.sequence) {
          case 'h': {
            // Check if this is part of a change command (ch)
            if (state.pendingC) {
              const commandRepeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });
              handleChangeMovement('h', commandRepeatCount);
              return true;
            }

            // Normal left movement
            for (let i = 0; i < repeatCount; i++) {
              const currentRow = buffer.cursor[0];
              const currentCol = buffer.cursor[1];
              if (currentCol > 0) {
                buffer.move('left');
              } else if (currentRow > 0) {
                // Move to end of previous line
                buffer.move('up');
                buffer.move('end');
              }
            }
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'j': {
            // Check if this is part of a change command (cj)
            if (state.pendingC) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });
              handleChangeMovement('j', repeatCount);
              return true;
            }

            // Normal down movement
            for (let i = 0; i < repeatCount; i++) {
              buffer.move('down');
            }
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'k': {
            // Check if this is part of a change command (ck)
            if (state.pendingC) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });
              handleChangeMovement('k', repeatCount);
              return true;
            }

            // Normal up movement
            for (let i = 0; i < repeatCount; i++) {
              buffer.move('up');
            }
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'l': {
            // Check if this is part of a change command (cl)
            if (state.pendingC) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });
              handleChangeMovement('l', repeatCount);
              return true;
            }

            // Normal right movement
            for (let i = 0; i < repeatCount; i++) {
              const currentRow = buffer.cursor[0];
              const currentCol = buffer.cursor[1];
              const currentLine = buffer.lines[currentRow] || '';

              // Don't move past the last character of the line
              if (currentCol < currentLine.length - 1) {
                buffer.move('right');
              } else if (currentRow < buffer.lines.length - 1) {
                // Move to beginning of next line
                buffer.move('down');
                buffer.move('home');
              }
            }
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'w': {
            // Check if this is part of a delete command (dw)
            if (state.pendingD) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              buffer.vimDeleteWordForward(repeatCount);

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: {
                  type: CMD_TYPES.DELETE_WORD_FORWARD,
                  count: repeatCount,
                },
              });
              dispatch({ type: 'SET_PENDING_D', pending: false });
              return true;
            }

            // Check if this is part of a change command (cw)
            if (state.pendingC) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              buffer.vimChangeWordForward(repeatCount);

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: {
                  type: CMD_TYPES.CHANGE_WORD_FORWARD,
                  count: repeatCount,
                },
              });
              dispatch({ type: 'SET_PENDING_C', pending: false });
              updateMode('INSERT');
              return true;
            }

            // Normal word movement
            let offset = currentOffset;
            for (let i = 0; i < repeatCount; i++) {
              const nextWordOffset = findNextWordStart(text, offset);
              if (nextWordOffset > offset) {
                offset = nextWordOffset;
              } else {
                // No more words to move to
                break;
              }
            }
            setOffsetPosition(offset);
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'b': {
            // Check if this is part of a delete command (db)
            if (state.pendingD) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              const text = buffer.text;
              const currentOffset = getCurrentOffset();
              let endOffset = currentOffset;

              // Delete from cursor backward through N words
              let offset = currentOffset;
              for (let i = 0; i < repeatCount; i++) {
                const prevWordOffset = findPrevWordStart(text, offset);
                if (prevWordOffset < offset) {
                  offset = prevWordOffset;
                } else {
                  break;
                }
              }
              endOffset = offset;

              if (endOffset !== currentOffset) {
                buffer.replaceRangeByOffset(
                  Math.min(currentOffset, endOffset),
                  Math.max(currentOffset, endOffset),
                  '',
                );
              }

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: {
                  type: CMD_TYPES.DELETE_WORD_BACKWARD,
                  count: repeatCount,
                },
              });
              dispatch({ type: 'SET_PENDING_D', pending: false });
              return true;
            }

            // Check if this is part of a change command (cb)
            if (state.pendingC) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              const text = buffer.text;
              const currentOffset = getCurrentOffset();
              let endOffset = currentOffset;

              // Change from cursor backward through N words
              let offset = currentOffset;
              for (let i = 0; i < repeatCount; i++) {
                const prevWordOffset = findPrevWordStart(text, offset);
                if (prevWordOffset < offset) {
                  offset = prevWordOffset;
                } else {
                  break;
                }
              }
              endOffset = offset;

              if (endOffset !== currentOffset) {
                buffer.replaceRangeByOffset(
                  Math.min(currentOffset, endOffset),
                  Math.max(currentOffset, endOffset),
                  '',
                );
              }

              // Record this command for repeat and switch to INSERT mode
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: {
                  type: CMD_TYPES.CHANGE_WORD_BACKWARD,
                  count: repeatCount,
                },
              });
              dispatch({ type: 'SET_PENDING_C', pending: false });
              updateMode('INSERT');
              return true;
            }

            // Normal backward word movement
            let offset = currentOffset;
            for (let i = 0; i < repeatCount; i++) {
              offset = findPrevWordStart(text, offset);
            }
            setOffsetPosition(offset);
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'e': {
            // Check if this is part of a delete command (de)
            if (state.pendingD) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              const text = buffer.text;
              const currentOffset = getCurrentOffset();
              let endOffset = currentOffset;

              // Delete from cursor to end of N words
              let offset = currentOffset;
              for (let i = 0; i < repeatCount; i++) {
                const wordEndOffset = findWordEnd(text, offset);
                if (wordEndOffset > offset) {
                  offset = wordEndOffset;
                } else {
                  break;
                }
              }
              // Include the character at the end position for 'de'
              endOffset = Math.min(offset + 1, text.length);

              if (endOffset !== currentOffset) {
                buffer.replaceRangeByOffset(
                  Math.min(currentOffset, endOffset),
                  Math.max(currentOffset, endOffset),
                  '',
                );
              }

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: {
                  type: CMD_TYPES.DELETE_WORD_END,
                  count: repeatCount,
                },
              });
              dispatch({ type: 'SET_PENDING_D', pending: false });
              return true;
            }

            // Check if this is part of a change command (ce)
            if (state.pendingC) {
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              const text = buffer.text;
              const currentOffset = getCurrentOffset();
              let endOffset = currentOffset;

              // Change from cursor to end of N words
              let searchOffset = currentOffset;
              for (let i = 0; i < repeatCount; i++) {
                const wordEndOffset = findWordEnd(text, searchOffset);
                if (wordEndOffset > searchOffset) {
                  endOffset = wordEndOffset + 1; // +1 to include the character at end position for 'ce'

                  // For next iteration, move to start of next word
                  if (i < repeatCount - 1) {
                    // Only if there are more iterations
                    searchOffset = findNextWordStart(text, wordEndOffset + 1);
                    if (searchOffset <= wordEndOffset) {
                      break; // No next word found
                    }
                  }
                } else {
                  break;
                }
              }

              if (endOffset !== currentOffset) {
                buffer.replaceRangeByOffset(
                  Math.min(currentOffset, endOffset),
                  Math.max(currentOffset, endOffset),
                  '',
                );
              }

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: {
                  type: CMD_TYPES.CHANGE_WORD_END,
                  count: repeatCount,
                },
              });
              dispatch({ type: 'SET_PENDING_C', pending: false });
              updateMode('INSERT');
              return true;
            }

            // Normal word end movement
            let offset = currentOffset;
            for (let i = 0; i < repeatCount; i++) {
              offset = findWordEnd(text, offset);
            }
            setOffsetPosition(offset);
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'x': {
            // Delete character under cursor
            for (let i = 0; i < repeatCount; i++) {
              const currentRow = buffer.cursor[0];
              const currentCol = buffer.cursor[1];
              const currentLine = buffer.lines[currentRow] || '';

              if (currentCol < currentLine.length) {
                const isLastChar = currentCol === currentLine.length - 1;
                buffer.del();

                // In vim, when deleting the last character on a line,
                // the cursor moves to the previous position
                if (isLastChar && currentCol > 0) {
                  buffer.move('left');
                }
              }
            }

            // Record this command for repeat
            dispatch({
              type: 'SET_LAST_COMMAND',
              command: { type: CMD_TYPES.DELETE_CHAR, count: repeatCount },
            });
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'i': {
            // Enter INSERT mode at current position
            updateMode('INSERT');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'a': {
            // Enter INSERT mode after current position
            const currentRow = buffer.cursor[0];
            const currentCol = buffer.cursor[1];
            const currentLine = buffer.lines[currentRow] || '';

            if (currentCol < currentLine.length) {
              buffer.move('right');
            }
            updateMode('INSERT');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'o': {
            // Insert new line after current line and enter INSERT mode
            buffer.move('end');
            buffer.newline();
            updateMode('INSERT');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'O': {
            // Insert new line before current line and enter INSERT mode
            buffer.move('home');
            buffer.newline();
            buffer.move('up');
            updateMode('INSERT');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case '0': {
            // Move to start of line
            buffer.move('home');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case '$': {
            // Move to end of line
            buffer.move('end');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case '^': {
            // Move to first non-whitespace character
            const currentRow = buffer.cursor[0];
            const currentLine = buffer.lines[currentRow] || '';
            let col = 0;
            while (
              col < currentLine.length &&
              WHITESPACE_CHARS.test(currentLine[col])
            ) {
              col++;
            }
            const offset = getOffsetFromPosition(currentRow, col);
            buffer.moveToOffset(offset);
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'g': {
            if (state.pendingG) {
              // Second 'g' - go to first line (gg command)
              buffer.moveToOffset(0);
              dispatch({ type: 'SET_PENDING_G', pending: false });
            } else {
              // First 'g' - wait for second g
              dispatch({ type: 'SET_PENDING_G', pending: true });
            }
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'G': {
            if (state.count > 0) {
              // Go to specific line number (1-based) when a count was provided
              const lineNum = Math.min(
                state.count - 1,
                buffer.lines.length - 1,
              );
              const offset = getOffsetFromPosition(lineNum, 0);
              buffer.moveToOffset(offset);
            } else {
              // Go to last line when no count was provided
              const text = buffer.text;
              const lastLineStart = text.lastIndexOf('\n') + 1;
              buffer.moveToOffset(lastLineStart);
            }
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'I': {
            // Enter INSERT mode at start of line (first non-whitespace)
            const currentRow = buffer.cursor[0];
            const currentLine = buffer.lines[currentRow] || '';
            let col = 0;
            while (
              col < currentLine.length &&
              WHITESPACE_CHARS.test(currentLine[col])
            ) {
              col++;
            }
            const offset = getOffsetFromPosition(currentRow, col);
            buffer.moveToOffset(offset);
            updateMode('INSERT');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'A': {
            // Enter INSERT mode at end of line
            buffer.move('end');
            updateMode('INSERT');
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'd': {
            if (state.pendingD) {
              // Second 'd' - delete N lines (dd command)
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              const startRow = buffer.cursor[0];
              const totalLines = buffer.lines.length;

              if (totalLines === 1) {
                // Single line - clear the content but keep the line
                const currentLine = buffer.lines[0] || '';
                buffer.replaceRangeByOffset(0, currentLine.length, '');
              } else {
                // Multi-line - delete N lines including newlines
                const { startOffset, endOffset } = getLineRangeOffsets(
                  startRow,
                  repeatCount,
                );
                buffer.replaceRangeByOffset(startOffset, endOffset, '');
              }

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: { type: CMD_TYPES.DELETE_LINE, count: repeatCount },
              });
              dispatch({ type: 'SET_PENDING_D', pending: false });
            } else {
              // First 'd' - wait for movement command
              dispatch({ type: 'SET_PENDING_D', pending: true });
            }
            return true;
          }

          case 'c': {
            if (state.pendingC) {
              // Second 'c' - change N entire lines (cc command)
              const repeatCount = getCurrentCount();
              dispatch({ type: 'CLEAR_COUNT' });

              const startRow = buffer.cursor[0];
              const totalLines = buffer.lines.length;
              const linesToChange = Math.min(
                repeatCount,
                totalLines - startRow,
              );

              if (totalLines === 1) {
                // Single line - clear the content but keep the line
                const currentLine = buffer.lines[0] || '';
                buffer.replaceRangeByOffset(0, currentLine.length, '');
              } else {
                // Multi-line - change N lines including newlines
                let startOffset = 0;
                for (let row = 0; row < startRow; row++) {
                  startOffset += buffer.lines[row].length + 1; // +1 for newline
                }

                let endOffset = startOffset;
                for (let i = 0; i < linesToChange; i++) {
                  const lineIndex = startRow + i;
                  if (lineIndex < totalLines) {
                    endOffset += buffer.lines[lineIndex].length;
                    // Add newline except for the last line if we're changing to the end
                    if (lineIndex < totalLines - 1) {
                      endOffset += 1;
                    } else if (startRow > 0) {
                      // Last line - include the newline before it
                      startOffset -= 1;
                    }
                  }
                }

                buffer.replaceRangeByOffset(startOffset, endOffset, '');
              }

              updateMode('INSERT');

              // Record this command for repeat
              dispatch({
                type: 'SET_LAST_COMMAND',
                command: { type: CMD_TYPES.CHANGE_LINE, count: repeatCount },
              });
              dispatch({ type: 'SET_PENDING_C', pending: false });
            } else {
              // First 'c' - wait for movement command
              dispatch({ type: 'SET_PENDING_C', pending: true });
            }
            return true;
          }

          case 'D': {
            // Delete from cursor to end of line (equivalent to d$)
            handleEndOfLineOperation(false);
            dispatch({
              type: 'SET_LAST_COMMAND',
              command: { type: CMD_TYPES.DELETE_TO_EOL, count: 1 },
            });
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case 'C': {
            // Change from cursor to end of line (equivalent to c$)
            handleEndOfLineOperation(true);
            dispatch({
              type: 'SET_LAST_COMMAND',
              command: { type: CMD_TYPES.CHANGE_TO_EOL, count: 1 },
            });
            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          case '.': {
            // Repeat last command
            if (state.lastCommand) {
              const cmdData = state.lastCommand;

              // All repeatable commands are now handled by executeCommand
              executeCommand(cmdData.type, cmdData.count);
            }

            dispatch({ type: 'CLEAR_COUNT' });
            return true;
          }

          default: {
            // Unknown command, clear count and pending states
            dispatch({ type: 'CLEAR_PENDING_STATES' });
            return true; // Still handled by vim to prevent other handlers
          }
        }
      }

      return false; // Not handled by vim
    },
    [
      state,
      buffer,
      vimEnabled,
      onSubmit,
      getCurrentCount,
      getCurrentOffset,
      setOffsetPosition,
      executeCommand,
      getOffsetFromPosition,
      getLineRangeOffsets,
      handleChangeMovement,
      handleEndOfLineOperation,
      updateMode,
    ],
  );

  return {
    mode: state.mode,
    vimModeEnabled: vimEnabled,
    handleInput, // Expose the input handler for InputPrompt to use
  };
}
