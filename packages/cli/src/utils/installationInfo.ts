/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

export enum PackageManager {
  NPM = 'npm',
  YARN = 'yarn',
  PNPM = 'pnpm',
  BUN = 'bun',
  HOMEBREW = 'homebrew',
  NPX = 'npx',
  UNKNOWN = 'unknown',
}

export interface InstallationInfo {
  packageManager: PackageManager;
  isGlobal: boolean;
  updateCommand?: string;
  updateMessage?: string;
}

function findProjectRoot(startDir: string): {
  root: string | null;
  isGit: boolean;
} {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const isGit = fs.existsSync(path.join(dir, '.git'));
      return { root: dir, isGit };
    }
    dir = path.dirname(dir);
  }
  return { root: null, isGit: false };
}

export function getInstallationInfo(
  isAutoUpdateDisabled: boolean,
): InstallationInfo {
  const cliPath = process.argv[1];
  if (!cliPath) {
    return { packageManager: PackageManager.UNKNOWN, isGlobal: false };
  }

  try {
    const realPath = fs.realpathSync(cliPath);
    const { root: projectRoot, isGit } = findProjectRoot(process.cwd());

    // Check for local git clone first
    if (
      isGit &&
      projectRoot &&
      realPath.startsWith(projectRoot) &&
      !realPath.includes('node_modules')
    ) {
      return {
        packageManager: PackageManager.UNKNOWN, // Not managed by a package manager in this sense
        isGlobal: false,
        updateMessage:
          'Running from a local git clone. Please update with "git pull".',
      };
    }

    // Check for npx/pnpx/bunx
    if (
      realPath.includes(path.join('.npm', '_npx')) ||
      realPath.includes(path.join('npm', '_npx'))
    ) {
      return {
        packageManager: PackageManager.NPX,
        isGlobal: false,
        updateMessage: 'Running via npx, update not applicable.',
      };
    }
    if (realPath.includes(path.join('.pnpm', '_pnpx'))) {
      return {
        packageManager: PackageManager.NPX,
        isGlobal: false,
        updateMessage: 'Running via pnpx, update not applicable.',
      };
    }
    if (realPath.includes(path.join('.bun', 'install', 'cache'))) {
      return {
        packageManager: PackageManager.NPX,
        isGlobal: false,
        updateMessage: 'Running via bunx, update not applicable.',
      };
    }

    // Check for Homebrew
    if (realPath.includes(path.join('Homebrew', 'Cellar'))) {
      return {
        packageManager: PackageManager.HOMEBREW,
        isGlobal: true,
        updateMessage:
          'Installed via Homebrew. Please update with "brew upgrade".',
      };
    }

    // Check for pnpm
    if (realPath.includes(path.join('.pnpm', 'global'))) {
      const updateCommand = 'pnpm add -g @google/gemini-cli@latest';
      return {
        packageManager: PackageManager.PNPM,
        isGlobal: true,
        updateCommand,
        updateMessage: isAutoUpdateDisabled
          ? `Please run ${updateCommand} to update`
          : 'Installed with pnpm. Attempting to automatically update now...',
      };
    }

    // Check for yarn
    if (realPath.includes(path.join('.yarn', 'global'))) {
      const updateCommand = 'yarn global add @google/gemini-cli@latest';
      return {
        packageManager: PackageManager.YARN,
        isGlobal: true,
        updateCommand,
        updateMessage: isAutoUpdateDisabled
          ? `Please run ${updateCommand} to update`
          : 'Installed with yarn. Attempting to automatically update now...',
      };
    }

    // Check for bun
    if (realPath.includes(path.join('.bun', 'bin'))) {
      const updateCommand = 'bun add -g @google/gemini-cli@latest';
      return {
        packageManager: PackageManager.BUN,
        isGlobal: true,
        updateCommand,
        updateMessage: isAutoUpdateDisabled
          ? `Please run ${updateCommand} to update`
          : 'Installed with bun. Attempting to automatically update now...',
      };
    }

    // Check for local install
    const { root: localProjectRoot } = findProjectRoot(process.cwd());
    if (
      localProjectRoot &&
      realPath.startsWith(path.join(localProjectRoot, 'node_modules'))
    ) {
      let pm = PackageManager.NPM;
      if (fs.existsSync(path.join(localProjectRoot, 'yarn.lock'))) {
        pm = PackageManager.YARN;
      } else if (fs.existsSync(path.join(localProjectRoot, 'pnpm-lock.yaml'))) {
        pm = PackageManager.PNPM;
      } else if (fs.existsSync(path.join(localProjectRoot, 'bun.lockb'))) {
        pm = PackageManager.BUN;
      }
      return {
        packageManager: pm,
        isGlobal: false,
        updateMessage:
          "Locally installed. Please update via your project's package.json.",
      };
    }

    // Assume global npm
    const updateCommand = 'npm install -g @google/gemini-cli@latest';
    return {
      packageManager: PackageManager.NPM,
      isGlobal: true,
      updateCommand,
      updateMessage: isAutoUpdateDisabled
        ? `Please run ${updateCommand} to update`
        : 'Installed with npm. Attempting to automatically update now...',
    };
  } catch (error) {
    console.log(error);
    return { packageManager: PackageManager.UNKNOWN, isGlobal: false };
  }
}
