/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'node:os';
import {
  loadSandboxConfig,
  SANDBOX_OPTIONS,
  SandboxOption,
} from './sandboxConfig.js';

// Mock dependencies before importing the module under test
const commandExistsSyncMock = vi.hoisted(() => vi.fn());
vi.mock('command-exists', () => ({
  default: {
    sync: commandExistsSyncMock,
  },
}));

const osPlatformMock = vi.hoisted(() => vi.fn());
vi.mock('node:os', () => ({
  default: {
    platform: osPlatformMock,
  },
}));

const getPackageJsonMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/package.js', () => ({
  getPackageJson: getPackageJsonMock,
}));

describe('loadSandboxConfig', () => {
  beforeEach(() => {
    // Reset env vars that are read by the module
    delete process.env.SANDBOX;
    delete process.env.GEMINI_SANDBOX;
    delete process.env.GEMINI_SANDBOX_IMAGE;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should return undefined if already in a sandbox (SANDBOX env var is set)', async () => {
    process.env.SANDBOX = '1';
    const config = await loadSandboxConfig({}, {});
    expect(config).toBeUndefined();
  });

  it('should return undefined if no sandbox option is provided', async () => {
    const config = await loadSandboxConfig({}, {});
    expect(config).toBeUndefined();
  });

  it('should throw an error if an invalid sandbox option is provided', async () => {
    const argv = { sandbox: 'invalid-option' as SandboxOption };
    await expect(loadSandboxConfig({}, argv)).rejects.toThrow(
      `invalid sandbox command 'invalid-option'. Must be one of ${SANDBOX_OPTIONS.join(
        ',',
      )}`,
    );
  });

  describe('Sandbox Option Precedence', () => {
    beforeEach(() => {
      commandExistsSyncMock.mockReturnValue(true);
      getPackageJsonMock.mockResolvedValue({
        config: { sandboxImageUri: 'default/image' },
      });
    });

    it('should use sandbox option from argv first', async () => {
      const settings = { sandbox: 'docker' as SandboxOption };
      const argv = { sandbox: 'podman' as SandboxOption };
      process.env.GEMINI_SANDBOX = 'sandbox-exec';

      const config = await loadSandboxConfig(settings, argv);
      expect(config?.command).toBe('podman');
    });

    it('should use sandbox option from settings if argv is not present', async () => {
      const settings = { sandbox: 'docker' as SandboxOption };
      process.env.GEMINI_SANDBOX = 'sandbox-exec';

      const config = await loadSandboxConfig(settings, {});
      expect(config?.command).toBe('docker');
    });

    it('should use sandbox option from env var if settings and argv are not present', async () => {
      process.env.GEMINI_SANDBOX = 'sandbox-exec';

      const config = await loadSandboxConfig({}, {});
      expect(config?.command).toBe('sandbox-exec');
    });
  });

  describe('getSandboxCommand logic', () => {
    beforeEach(() => {
      getPackageJsonMock.mockResolvedValue({
        config: { sandboxImageUri: 'default/image' },
      });
    });

    it.each(['none', '0', 'false'])(
      'should return undefined for sandbox option "%s"',
      async (option) => {
        const config = await loadSandboxConfig(
          { sandbox: option as SandboxOption },
          {},
        );
        expect(config).toBeUndefined();
      },
    );

    it.each(['docker', 'podman', 'sandbox-exec'])(
      'should return command "%s" if it exists',
      async (command) => {
        commandExistsSyncMock.mockImplementation((cmd) => cmd === command);
        const config = await loadSandboxConfig(
          { sandbox: command as SandboxOption },
          {},
        );
        expect(config?.command).toBe(command);
      },
    );

    it.each(['docker', 'podman', 'sandbox-exec'])(
      'should throw an error if command "%s" does not exist',
      async (command) => {
        commandExistsSyncMock.mockReturnValue(false);
        await expect(
          loadSandboxConfig({ sandbox: command as SandboxOption }, {}),
        ).rejects.toThrow(
          `provided sandbox command '${command}' was not found on the device`,
        );
      },
    );

    describe('auto detection', () => {
      it.each(['auto', '1', 'true'])(
        'should detect sandbox-exec on darwin for option "%s"',
        async (option) => {
          osPlatformMock.mockReturnValue('darwin');
          commandExistsSyncMock.mockImplementation(
            (cmd) => cmd === 'sandbox-exec',
          );
          const config = await loadSandboxConfig(
            { sandbox: option as SandboxOption },
            {},
          );
          expect(config?.command).toBe('sandbox-exec');
        },
      );

      it.each(['auto', '1', 'true'])(
        'should detect docker if sandbox-exec is not available for option "%s"',
        async (option) => {
          osPlatformMock.mockReturnValue('linux');
          commandExistsSyncMock.mockImplementation((cmd) => cmd === 'docker');
          const config = await loadSandboxConfig(
            { sandbox: option as SandboxOption },
            {},
          );
          expect(config?.command).toBe('docker');
        },
      );

      it.each(['auto', '1', 'true'])(
        'should detect podman if docker is not available for option "%s"',
        async (option) => {
          osPlatformMock.mockReturnValue('linux');
          commandExistsSyncMock.mockImplementation((cmd) => cmd === 'podman');
          const config = await loadSandboxConfig(
            { sandbox: option as SandboxOption },
            {},
          );
          expect(config?.command).toBe('podman');
        },
      );

      it.each(['auto', '1', 'true'])(
        'should throw an error if no sandbox command is found for option "%s"',
        async (option) => {
          osPlatformMock.mockReturnValue('linux');
          commandExistsSyncMock.mockReturnValue(false);
          await expect(
            loadSandboxConfig({ sandbox: option as SandboxOption }, {}),
          ).rejects.toThrow(
            `Unable to automatically detect the sandbox container command. Options include docker,podman,sandbox-exec;
          install docker or podman or specify command with --sandbox CLI arg, GEMINI_SANDBOX env var, or .gemini/settings.json`,
          );
        },
      );
    });
  });

  describe('Image selection logic', () => {
    beforeEach(() => {
      commandExistsSyncMock.mockReturnValue(true);
    });

    it('should use image from argv first', async () => {
      const argv = {
        sandbox: 'docker' as SandboxOption,
        'sandbox-image': 'argv/image',
      };
      process.env.GEMINI_SANDBOX_IMAGE = 'env/image';
      getPackageJsonMock.mockResolvedValue({
        config: { sandboxImageUri: 'pkg/image' },
      });

      const config = await loadSandboxConfig({}, argv);
      expect(config?.image).toBe('argv/image');
    });

    it('should use image from env var if argv is not present', async () => {
      const argv = { sandbox: 'docker' as SandboxOption };
      process.env.GEMINI_SANDBOX_IMAGE = 'env/image';
      getPackageJsonMock.mockResolvedValue({
        config: { sandboxImageUri: 'pkg/image' },
      });

      const config = await loadSandboxConfig({}, argv);
      expect(config?.image).toBe('env/image');
    });

    it('should use image from package.json if argv and env var are not present', async () => {
      const argv = { sandbox: 'docker' as SandboxOption };
      getPackageJsonMock.mockResolvedValue({
        config: { sandboxImageUri: 'pkg/image' },
      });

      const config = await loadSandboxConfig({}, argv);
      expect(config?.image).toBe('pkg/image');
    });

    it('should return undefined if command is resolved but image is not found', async () => {
      const argv = { sandbox: 'docker' as SandboxOption };
      getPackageJsonMock.mockResolvedValue({}); // no image in package.json

      const config = await loadSandboxConfig({}, argv);
      expect(config).toBeUndefined();
    });
  });
});
