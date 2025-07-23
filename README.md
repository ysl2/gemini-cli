# Gemini CLI Nexus

A multi-API provider support version based on `gemini-cli`, maintaining full compatibility with `gemini-cli`. Users can seamlessly switch between different large language model services. I named it `gemini-cli-nexus`.

`nexus` means "connection point" or "core", this name emphasizes the tool's role as a central hub for interacting with various AI large models.

> This name was recommended by Gemini 😄

Supported models include:

- **Google Gemini** (default)
- **OpenAI GPT series**
- **Anthropic Claude series**
- DeepSeek
- Kimi2
- Other models compatible with the above APIs

## Core Features

### 1. Automatic Provider Detection
- Automatically detects available API keys from environment variables
- Intelligently selects the optimal provider
- Supports provider fallback mechanism

### 2. Unified API Interface
- All providers use the same calling interface
- No need to modify existing code when switching providers
- Maintains backward compatibility

## Installation

Please ensure you have `Node.js 20` or higher installed before installation.

The installation method is consistent with gemini-cli. It's recommended to use npx in the project directory.

```shell
$ npx https://github.com/ai-embedded/gemini-cli-nexus
```

> Note: If using npx, please set environment variables before running gemini-cli-nexus. If environment variables are not set, gemini-cli-nexus will use the default gemini model.

For global installation, first ensure gemini-cli is not installed. If gemini-cli is already installed, please uninstall it first:

```shell
$ sudo npm uninstall -g gemini-cli
$ sudo npm install -g https://github.com/ai-embedded/gemini-cli-nexus
```

## Configuration

When starting gemini-cli-nexus, it will automatically detect API keys in environment variables and .env files, and automatically select providers based on available keys.
After startup, you'll have 2 more login options compared to gemini-cli. Select different providers to use different API services.

```bash
How would you like to authenticate for this project?

● 1. Login with Google
  2. Use Gemini API Key
  3. Vertex AI
  4. Use OpenAI API Key
  5. Use Anthropic API Key
```

### 1. Environment Variable Configuration

#### Recommended: Using unified MODEL environment variable

```bash
export OPENAI_API_KEY="sk-your-openai-key-here"
export OPENAI_BASE_URL=https://api.openai.com/v1 
# or
export ANTHROPIC_API_KEY="sk-ant-your-anthropic-key-here"
export ANTHROPIC_BASE_URL=https://api.anthropic.com

# Set model (unified configuration method)
export MODEL="gpt-4o-mini"
```

### 2. .env File Configuration

Create a `.env` file in the project root directory:

```bash
# Option 1: OpenAI
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1  # Optional, defaults to OpenAI

# Option 2: Anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
ANTHROPIC_BASE_URL=https://api.anthropic.com  # Optional, defaults to Anthropic

# Option 3: Gemini (original/default)
# GEMINI_API_KEY=AIza-your-gemini-key-here

# Option 4: Vertex AI (Google Cloud)
# GOOGLE_CLOUD_PROJECT=your-project-id
# GOOGLE_CLOUD_LOCATION=us-central1
# GOOGLE_API_KEY=your-google-api-key  # Optional for express mode

# Model selection (optional)
# MODEL=gpt-4o-mini
# MODEL=claude-3-5-sonnet-20241022
# MODEL=gemini-2.5-pro
MODEL=claude-sonnect-4-20250514
```

> You can refer to the .env.example file in the project directory for configuration. Please be careful not to commit .env to avoid key leakage.

## Authentication Reset

If you need to re-select authentication method:

```bash
# Method 1: Delete authentication configuration
rm ~/.gemini/settings.json

# Method 2: Edit settings file, delete selectedAuthType field
# Edit ~/.gemini/settings.json

# Method 3: Complete reset
rm -rf ~/.gemini/
```

Or use the `/logout` command after logging into the command line to log out and log in again.

For detailed usage instructions of gemini-cli, please refer to [gemini-cli](gemini-cli.md)

## Similar Projects
- [qwen-code](https://github.com/QwenLM/qwen-code)

## Acknowledgments
This project is developed based on gemini-cli. Thanks to [gemini-cli](https://github.com/google-gemini/gemini-cli).

## License

Developed based on the original gemini-cli, following the same license.