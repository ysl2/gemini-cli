
import path from "path";
import os from "os";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import * as pty from "node-pty";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = "/Users/sijiewang/Git/gcli-vim/packages/cli/dist/index.js";

describe("Vim Mode E2E", () => {
  let tempDir: string;
  let tempSettingsPath: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-cli-test-"));
    await fs.mkdir(path.join(tempDir, ".gemini"));
    tempSettingsPath = path.join(tempDir, ".gemini/settings.json");
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should start with vim mode disabled by default", async () => {
    const settings = {
      "cli.theme": "default",
      "user.acknowledgedUsageStrobing": true,
    };
    await fs.writeFile(tempSettingsPath, JSON.stringify(settings));

    const term = pty.spawn("node", [CLI_PATH], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: tempDir,
      env: {
        ...process.env,
        HOME: tempDir,
      },
    });

    let output = "";
    term.onData((data) => {
      output += data;
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    term.kill();

    expect(output).toContain(">");
    expect(output).not.toContain("[VIM NORMAL]");
  });

  it("should start with vim mode enabled when configured in settings", async () => {
    const settings = {
      "cli.theme": "default",
      "user.acknowledgedUsageStrobing": true,
      "cli.vimMode": true,
    };
    await fs.writeFile(tempSettingsPath, JSON.stringify(settings));

    const term = pty.spawn("node", [CLI_PATH], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: tempDir,
      env: {
        ...process.env,
        HOME: tempDir,
      },
    });

    let output = "";
    term.onData((data) => {
      output += data;
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    term.kill();

    expect(output).toContain("[VIM NORMAL]");
  });
});
