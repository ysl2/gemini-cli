import { TextBufferState, TextBufferAction } from './text-buffer.js';
import {
  findNextWordStart,
  findPrevWordStart,
  findWordEnd,
  getOffsetFromPosition,
  getPositionFromOffsets,
  getLineRangeOffsets,
  replaceRangeInternal,
  pushUndo,
} from './text-buffer.js';
import { cpLen, cpSlice } from '../../utils/textUtils.js';

export type VimAction = Extract<
  TextBufferAction,
  | { type: 'vim_delete_word_forward' }
  | { type: 'vim_delete_word_backward' }
  | { type: 'vim_delete_word_end' }
  | { type: 'vim_change_word_forward' }
  | { type: 'vim_change_word_backward' }
  | { type: 'vim_change_word_end' }
  | { type: 'vim_delete_line' }
  | { type: 'vim_change_line' }
  | { type: 'vim_delete_to_end_of_line' }
  | { type: 'vim_change_to_end_of_line' }
  | { type: 'vim_change_movement' }
>;

export function handleVimAction(
  state: TextBufferState,
  action: VimAction,
): TextBufferState {
  const { lines, cursorRow, cursorCol } = state;
  const text = lines.join('\n');

  switch (action.type) {
    case 'vim_delete_word_forward': {
      const { count } = action.payload;
      const currentOffset = getOffsetFromPosition(
        cursorRow,
        cursorCol,
        lines,
      );

      let endOffset = currentOffset;
      let searchOffset = currentOffset;

      for (let i = 0; i < count; i++) {
        const nextWordOffset = findNextWordStart(text, searchOffset);
        if (nextWordOffset > searchOffset) {
          searchOffset = nextWordOffset;
          endOffset = nextWordOffset;
        } else {
          // If no next word, delete to end of current word
          const wordEndOffset = findWordEnd(text, searchOffset);
          endOffset = Math.min(wordEndOffset + 1, text.length);
          break;
        }
      }

      if (endOffset > currentOffset) {
        const nextState = pushUndo(state);
        const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
          currentOffset,
          endOffset,
          nextState.lines,
        );
        return replaceRangeInternal(
          nextState,
          startRow,
          startCol,
          endRow,
          endCol,
          '',
        );
      }
      return state;
    }

    case 'vim_delete_word_backward': {
      const { count } = action.payload;
      const currentOffset = getOffsetFromPosition(
        cursorRow,
        cursorCol,
        lines,
      );

      let startOffset = currentOffset;
      let searchOffset = currentOffset;

      for (let i = 0; i < count; i++) {
        const prevWordOffset = findPrevWordStart(text, searchOffset);
        if (prevWordOffset < searchOffset) {
          searchOffset = prevWordOffset;
          startOffset = prevWordOffset;
        } else {
          break;
        }
      }

      if (startOffset < currentOffset) {
        const nextState = pushUndo(state);
        const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
          startOffset,
          currentOffset,
          nextState.lines,
        );
        const newState = replaceRangeInternal(
          nextState,
          startRow,
          startCol,
          endRow,
          endCol,
          '',
        );
        // Cursor is already at the correct position after deletion
        return newState;
      }
      return state;
    }

    case 'vim_delete_word_end': {
      const { count } = action.payload;
      const currentOffset = getOffsetFromPosition(
        cursorRow,
        cursorCol,
        lines,
      );

      let offset = currentOffset;
      let endOffset = currentOffset;

      for (let i = 0; i < count; i++) {
        const wordEndOffset = findWordEnd(text, offset);
        if (wordEndOffset >= offset) {
          endOffset = wordEndOffset + 1; // Include the character at word end
          // For next iteration, move to start of next word
          if (i < count - 1) {
            const nextWordStart = findNextWordStart(text, wordEndOffset + 1);
            offset = nextWordStart;
            if (nextWordStart <= wordEndOffset) {
              break; // No more words
            }
          }
        } else {
          break;
        }
      }

      endOffset = Math.min(endOffset, text.length);

      if (endOffset > currentOffset) {
        const nextState = pushUndo(state);
        const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
          currentOffset,
          endOffset,
          nextState.lines,
        );
        return replaceRangeInternal(
          nextState,
          startRow,
          startCol,
          endRow,
          endCol,
          '',
        );
      }
      return state;
    }

    case 'vim_change_word_forward': {
      const { count } = action.payload;
      const currentOffset = getOffsetFromPosition(
        cursorRow,
        cursorCol,
        lines,
      );

      let searchOffset = currentOffset;
      let endOffset = currentOffset;

      for (let i = 0; i < count; i++) {
        const nextWordOffset = findNextWordStart(text, searchOffset);
        if (nextWordOffset > searchOffset) {
          searchOffset = nextWordOffset;
          endOffset = nextWordOffset;
        } else {
          // If no next word, change to end of current word
          const wordEndOffset = findWordEnd(text, searchOffset);
          endOffset = Math.min(wordEndOffset + 1, text.length);
          break;
        }
      }

      if (endOffset > currentOffset) {
        const nextState = pushUndo(state);
        const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
          currentOffset,
          endOffset,
          nextState.lines,
        );
        return replaceRangeInternal(
          nextState,
          startRow,
          startCol,
          endRow,
          endCol,
          '',
        );
      }
      return state;
    }

    case 'vim_change_word_backward': {
      const { count } = action.payload;
      const currentOffset = getOffsetFromPosition(
        cursorRow,
        cursorCol,
        lines,
      );

      let startOffset = currentOffset;
      let searchOffset = currentOffset;

      for (let i = 0; i < count; i++) {
        const prevWordOffset = findPrevWordStart(text, searchOffset);
        if (prevWordOffset < searchOffset) {
          searchOffset = prevWordOffset;
          startOffset = prevWordOffset;
        } else {
          break;
        }
      }

      if (startOffset < currentOffset) {
        const nextState = pushUndo(state);
        const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
          startOffset,
          currentOffset,
          nextState.lines,
        );
        return replaceRangeInternal(
          nextState,
          startRow,
          startCol,
          endRow,
          endCol,
          '',
        );
      }
      return state;
    }

    case 'vim_change_word_end': {
      const { count } = action.payload;
      const currentOffset = getOffsetFromPosition(
        cursorRow,
        cursorCol,
        lines,
      );

      let offset = currentOffset;
      let endOffset = currentOffset;

      for (let i = 0; i < count; i++) {
        const wordEndOffset = findWordEnd(text, offset);
        if (wordEndOffset >= offset) {
          endOffset = wordEndOffset + 1; // Include the character at word end
          // For next iteration, move to start of next word
          if (i < count - 1) {
            const nextWordStart = findNextWordStart(text, wordEndOffset + 1);
            offset = nextWordStart;
            if (nextWordStart <= wordEndOffset) {
              break; // No more words
            }
          }
        } else {
          break;
        }
      }

      endOffset = Math.min(endOffset, text.length);

      if (endOffset !== currentOffset) {
        const nextState = pushUndo(state);
        const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
          Math.min(currentOffset, endOffset),
          Math.max(currentOffset, endOffset),
          nextState.lines,
        );
        return replaceRangeInternal(
          nextState,
          startRow,
          startCol,
          endRow,
          endCol,
          '',
        );
      }
      return state;
    }

    case 'vim_delete_line': {
      const { count } = action.payload;
      if (lines.length === 0) return state;

      const linesToDelete = Math.min(count, lines.length - cursorRow);
      const totalLines = lines.length;

      if (totalLines === 1 || linesToDelete >= totalLines) {
        // If there's only one line, or we're deleting all remaining lines,
        // clear the content but keep one empty line (text editors should never be completely empty)
        const nextState = pushUndo(state);
        return {
          ...nextState,
          lines: [''],
          cursorRow: 0,
          cursorCol: 0,
          preferredCol: null,
        };
      }

      const nextState = pushUndo(state);
      const newLines = [...nextState.lines];
      newLines.splice(cursorRow, linesToDelete);

      // Adjust cursor position
      const newCursorRow = Math.min(cursorRow, newLines.length - 1);
      const newCursorCol = 0; // Vim places cursor at beginning of line after dd

      return {
        ...nextState,
        lines: newLines,
        cursorRow: newCursorRow,
        cursorCol: newCursorCol,
        preferredCol: null,
      };
    }

    case 'vim_change_line': {
      const { count } = action.payload;
      if (lines.length === 0) return state;

      const linesToChange = Math.min(count, lines.length - cursorRow);
      const nextState = pushUndo(state);

      const { startOffset, endOffset } = getLineRangeOffsets(
        cursorRow,
        linesToChange,
        nextState.lines,
      );
      const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
        startOffset,
        endOffset,
        nextState.lines,
      );
      return replaceRangeInternal(
        nextState,
        startRow,
        startCol,
        endRow,
        endCol,
        '',
      );
    }

    case 'vim_delete_to_end_of_line': {
      const currentLine = lines[cursorRow] || '';
      if (cursorCol < currentLine.length) {
        const nextState = pushUndo(state);
        return replaceRangeInternal(
          nextState,
          cursorRow,
          cursorCol,
          cursorRow,
          currentLine.length,
          '',
        );
      }
      return state;
    }

    case 'vim_change_to_end_of_line': {
      const currentLine = lines[cursorRow] || '';
      if (cursorCol < currentLine.length) {
        const nextState = pushUndo(state);
        return replaceRangeInternal(
          nextState,
          cursorRow,
          cursorCol,
          cursorRow,
          currentLine.length,
          '',
        );
      }
      return state;
    }

    case 'vim_change_movement': {
      const { movement, count } = action.payload;
      let endRow = cursorRow;
      let endCol = cursorCol;
      const totalLines = lines.length;

      switch (movement) {
        case 'h': // Left
          // Change N characters to the left
          const startCol = Math.max(0, cursorCol - count);
          return replaceRangeInternal(
            pushUndo(state),
            cursorRow,
            startCol,
            cursorRow,
            cursorCol,
            '',
          );

        case 'j': // Down
          const linesToChange = Math.min(count, totalLines - cursorRow);
          if (linesToChange > 0) {
            if (totalLines === 1) {
              const currentLine = state.lines[0] || '';
              return replaceRangeInternal(
                pushUndo(state),
                0,
                0,
                0,
                cpLen(currentLine),
                '',
              );
            } else {
              const nextState = pushUndo(state);
              const { startOffset, endOffset } = getLineRangeOffsets(
                cursorRow,
                linesToChange,
                nextState.lines,
              );
              const { startRow, startCol, endRow, endCol } =
                getPositionFromOffsets(startOffset, endOffset, nextState.lines);
              return replaceRangeInternal(
                nextState,
                startRow,
                startCol,
                endRow,
                endCol,
                '',
              );
            }
          }
          return state;

        case 'k': // Up
          const upLines = Math.min(count, cursorRow + 1);
          if (upLines > 0) {
            if (state.lines.length === 1) {
              const currentLine = state.lines[0] || '';
              return replaceRangeInternal(
                pushUndo(state),
                0,
                0,
                0,
                cpLen(currentLine),
                '',
              );
            } else {
              const startRow = Math.max(0, cursorRow - count + 1);
              const linesToChange = cursorRow - startRow + 1;
              const nextState = pushUndo(state);
              const { startOffset, endOffset } = getLineRangeOffsets(
                startRow,
                linesToChange,
                nextState.lines,
              );
              const {
                startRow: newStartRow,
                startCol,
                endRow,
                endCol,
              } = getPositionFromOffsets(startOffset, endOffset, nextState.lines);
              const resultState = replaceRangeInternal(
                nextState,
                newStartRow,
                startCol,
                endRow,
                endCol,
                '',
              );
              return {
                ...resultState,
                cursorRow: startRow,
                cursorCol: 0,
              };
            }
          }
          return state;

        case 'l': // Right
          // Change N characters to the right
          return replaceRangeInternal(
            pushUndo(state),
            cursorRow,
            cursorCol,
            cursorRow,
            Math.min(
              cpLen(lines[cursorRow] || ''),
              cursorCol + count,
            ),
            '',
          );

        default:
          return state;
      }
    }

    default:
      // This should never happen if TypeScript is working correctly
      const _exhaustiveCheck: never = action;
      return state;
  }
}