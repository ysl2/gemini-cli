/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { isGitRepository } from './git.js';
import * as fsPromises from 'fs/promises';
import path from 'path';
import { Stats } from 'fs';

const stat = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    stat,
  };
});

describe('isGitRepository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return true if .git directory exists in current directory', async () => {
    const cwd = '/test/repo';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.mocked(fsPromises.stat).mockImplementation(async (p) => {
      if (p === path.join(cwd, '.git')) {
        return { isDirectory: () => true } as Stats;
      }
      throw new Error('File not found');
    });

    const result = await isGitRepository();
    expect(result).toBe(true);
  });

  it('should return true if .git directory exists in parent directory', async () => {
    const cwd = '/test/repo/subdir';
    const repoRoot = '/test/repo';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.mocked(fsPromises.stat).mockImplementation(async (p) => {
      if (p === path.join(repoRoot, '.git')) {
        return { isDirectory: () => true } as Stats;
      }
      throw new Error('File not found');
    });

    const result = await isGitRepository();
    expect(result).toBe(true);
  });

  it('should return false if no .git directory is found', async () => {
    const cwd = '/test/no-repo';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.mocked(stat).mockRejectedValue(new Error('File not found'));

    const result = await isGitRepository();
    expect(result).toBe(false);
  });

  it('should handle errors during stat checks gracefully', async () => {
    const cwd = '/test/error-repo';
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.mocked(stat).mockRejectedValue(new Error('Permission denied'));

    const result = await isGitRepository();
    expect(result).toBe(false);
  });
});
