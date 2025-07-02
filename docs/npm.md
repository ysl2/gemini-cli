# NPM Workspaces

This project uses [NPM Workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces) to manage the packages within this monorepo. This simplifies development by allowing us to manage dependencies and run scripts across multiple packages from the root of the project.

## How it Works

The root `package.json` file defines the workspaces for this project:

```json
{
  "workspaces": ["packages/*"]
}
```

This tells NPM that any folder inside the `packages` directory is a separate package that should be managed as part of the workspace.

## Benefits of Workspaces

- **Simplified Dependency Management**: Running `npm install` from the root of the project will install all dependencies for all packages in the workspace and link them together. This means you don't need to run `npm install` in each package's directory.
- **Automatic Linking**: Packages within the workspace can depend on each other. When you run `npm install`, NPM will automatically create symlinks between the packages. This means that when you make changes to one package, the changes are immediately available to other packages that depend on it.
- **Simplified Script Execution**: You can run scripts in any package from the root of the project using the `--workspace` flag. For example, to run the `build` script in the `cli` package, you can run `npm run build --workspace @google/gemini-cli`.

## Package Overview

This monorepo contains two main packages: `@google/gemini-cli` and `@google/gemini-cli-core`.

### `@google/gemini-cli`

This is the main package for the Gemini CLI. It is responsible for the user interface, command parsing, and all other user-facing functionality.

When this package is published, it is bundled into a single executable file. This bundle includes all of the package's dependencies, including `@google/gemini-cli-core`. This means that whether a user installs the package with `npm install -g @google/gemini-cli` or runs it directly with `npx @google/gemini-cli`, they are using this single, self-contained executable.

### `@google/gemini-cli-core`

This package contains the core logic for interacting with the Gemini API. It is responsible for making API requests, handling authentication, and managing the local cache.

This package is not bundled. When it is published, it is published as a standard Node.js package with its own dependencies. This allows it to be used as a standalone package in other projects, if needed. All transpiled js code in the `dist` folder is included in the package.

## Versioning and Publishing

All packages in this monorepo are versioned together from the root `package.json` file. When a new version is released, the version number in the root `package.json` is updated, and all packages are published with that version.

### NPX Installation

When a user runs `npx @google/gemini-cli`, npm downloads the `@google/gemini-cli` package and its dependencies from the npm registry. Because the `workspace:*` dependencies were replaced with the actual version numbers during publishing, npm is able to resolve and download the correct versions of all the required packages.

## Release Process

This project follows a structured release process to ensure that all packages are versioned and published correctly. The process is designed to be as automated as possible.

The high level process is

- check out a branch from the trunk you want to release from (for now this will be main, as we build out a larger release process, this will likely be release specific branches)
- run the required commands to tag, update and push
- create pr for your branch with the package version changes
- the release will automatically run and publish both npm and docker for your versions
- when the release is successful merge the pr

Releases are done via a [Github Action named Release](../.github/workflows/release.yml). This process is automated and is started via the following:

```bash
git checkout main
git pull
git checkout -b release-<identifier of your choice>
npm run release:version <release tag>
npm run check:versions
npm run push-release
```

#### `npm run relase:version <release tag>`

This command will use the npm [version command](https://docs.npmjs.com/cli/v8/commands/npm-version) to update the package versions. `<release tag>` can be either 'patch' or simlar which will auto increment the version or a strongly typed package name `0.1.10-dev.0`, `0.2.0` or simlar. This command will update all the package files, create a gitcommit and a git tag locally.

#### `npm run check:versions`

This command is optional but will verify that all the versions are correct.

#### `npm run push-release`

This command will push both the git commit for the package changes as well as safely push the git tags

Pushing a new tag will trigger the [release workflow](https://github.com/google-gemini/gemini-cli/actions/workflows/release.yml), which will automatically build and publish the packages to the npm registry and create a new GitHub release.

We also run a Gooogle cloud build called [release-docker.yml](../.gcp/release-docker.yaml). Which publishes the sandbox docker to match your release. This will also be moved to GH and combined with the main relase file once service account permissions are sorted out.

### 2. Monitor the Release Workflow

You can monitor the progress of the release workflow in the [GitHub Actions tab](https://github.com/google-gemini/gemini-cli/actions/workflows/release.yml). If the workflow fails, you will need to investigate the cause of the failure, fix the issue, and then create a new tag to trigger a new release.

## Local Testing and Validation

It is crucial to test any changes to the packaging and publishing process locally before committing them. This ensures that the packages will be published correctly and that they will work as expected when installed by a user.

To validate your changes, you can perform a dry run of the publishing process. This will simulate the publishing process without actually publishing the packages to the npm registry.

```bash
npm_package_version=9.9.9 SANDBOX_IMAGE_REGISTRY="registry" SANDBOX_IMAGE_NAME="thename" npm run publish:npm --dry-run
```

This command will do the following:

1.  Build all the packages.
2.  Run all the prepublish scripts.
3.  Create the package tarballs that would be published to npm.
4.  Print a summary of the packages that would be published.

You can then inspect the generated tarballs to ensure that they contain the correct files and that the `package.json` files have been updated correctly. The tarballs will be created in the root of each package's directory (e.g., `packages/cli/google-gemini-cli-0.1.6.tgz`).

By performing a dry run, you can be confident that your changes to the packaging process are correct and that the packages will be published successfully.

## Release Deep Dive

The main goal of the release process is to take the source code from the packages/ directory, build it, and assemble a
clean, self-contained package in a temporary `bundle` directory at the root of the project. This `bundle` directory is what
actually gets published to NPM.

Here are the key stages:

Stage 1: Pre-Release Sanity Checks and Versioning

- What happens: Before any files are moved, the process ensures the project is in a good state. This involves running tests,
  linting, and type-checking (npm run preflight). The version number in the root package.json and packages/cli/package.json
  is updated to the new release version.
- Why: This guarantees that only high-quality, working code is released. Versioning is the first step to signify a new
  release.

Stage 2: Building the Source Code

- What happens: The TypeScript source code in packages/core/src and packages/cli/src is compiled into JavaScript.
- File movement:
  - packages/core/src/\*_/_.ts -> compiled to -> packages/core/dist/
  - packages/cli/src/\*_/_.ts -> compiled to -> packages/cli/dist/
- Why: The TypeScript code written during development needs to be converted into plain JavaScript that can be run by
  Node.js. The core package is built first as the cli package depends on it.

Stage 3: Assembling the Final Publishable Package

This is the most critical stage where files are moved and transformed into their final state for publishing. A temporary
`bundle` folder is created at the project root to house the final package contents.

1.  The `package.json` is Transformed:
    - What happens: The package.json from packages/cli/ is read, modified, and written into the root `bundle`/ directory. The
      script scripts/prepare-cli-packagejson.js is responsible for this.
    - File movement: packages/cli/package.json -> (in-memory transformation) -> `bundle`/package.json
    - Why: The final package.json must be different from the one used in development. Key changes include:
      - Removing devDependencies.
      - Removing workspace-specific "dependencies": { "@gemini-cli/core": "workspace:\*" } and ensuring the core code is
        bundled directly into the final JavaScript file.
      - Ensuring the bin, main, and files fields point to the correct locations within the final package structure.

2.  The JavaScript Bundle is Created:
    - What happens: The built JavaScript from both packages/core/dist and packages/cli/dist are bundled into a single,
      executable JavaScript file.
    - File movement: packages/cli/dist/index.js + packages/core/dist/index.js -> (bundled by esbuild) -> `bundle`/gemini.js (or a
      similar name).
    - Why: This creates a single, optimized file that contains all the necessary application code. It simplifies the package
      by removing the need for the core package to be a separate dependency on NPM, as its code is now included directly.

3.  Static and Supporting Files are Copied:
    - What happens: Essential files that are not part of the source code but are required for the package to work correctly
      or be well-described are copied into the `bundle` directory.
    - File movement:
      - README.md -> `bundle`/README.md
      - LICENSE -> `bundle`/LICENSE
      - packages/cli/src/utils/\*.sb (sandbox profiles) -> `bundle`/
    - Why:
      - The README.md and LICENSE are standard files that should be included in any NPM package.
      - The sandbox profiles (.sb files) are critical runtime assets required for the CLI's sandboxing feature to
        function. They must be located next to the final executable.

Stage 4: Publishing to NPM

- What happens: The npm publish command is run from inside the root `bundle` directory.
- Why: By running npm publish from within the `bundle` directory, only the files we carefully assembled in Stage 3 are uploaded
  to the NPM registry. This prevents any source code, test files, or development configurations from being accidentally
  published, resulting in a clean and minimal package for users.

Summary of File Flow

    1 [Project Root]
    2 ├── packages/core/src/*.ts  ───────┐
    3 └── packages/cli/src/*.ts   ───────┼──(Build)──> [Bundled JS] ─────┐
    4                                   │                               │
    5 ├── packages/cli/package.json ──(Transform)──> [Final package.json] │
    6                                   │                               │
    7 ├── README.md ────────────────────┤                               ├─(Assemble)─> `bundle`/
    8 ├── LICENSE ─────────────────────┤                               │
    9 └── packages/cli/src/utils/*.sb ─┴───────────────────────────────>│

10 │
11 └─(Publish)─> NPM Registry

This process ensures that the final published artifact is a purpose-built, clean, and efficient representation of the
project, rather than a direct copy of the development workspace.
