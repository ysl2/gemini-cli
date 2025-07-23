/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import path from 'path';

async function findGitRoot(startDir: string): Promise<string | null> {
  let currentDir = startDir;
  while (currentDir !== path.parse(currentDir).root) {
    try {
      const gitPath = path.join(currentDir, '.git');
      const stats = await fs.stat(gitPath);
      if (stats.isDirectory()) {
        return currentDir;
      }
    } catch (_) {
      // Ignore errors (e.g., permission denied, file not found)
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

export async function isGitRepository(): Promise<boolean> {
  try {
    const gitRoot = await findGitRoot(process.cwd());
    return gitRoot !== null;
  } catch (_) {
    return false;
  }
}
