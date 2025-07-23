# gemini-cli-nexus

这是一个基于 `gemini-cli` 的多 API 支持版本，与 `gemini-cli` 保持完全兼容， 用户可以无缝切换使用不同的大语言模型服务, 我给他取名为 `gemini-cli-nexus`。

`nexus` 的意思是“连接点”或“核心”，这个名字强调了本工具作为与各种 AI 大模型交互的中心枢纽的角色。

> 这个名字是 gemini 推荐的😄

包括：

- **Google Gemini** (默认)
- **OpenAI GPT 系列**
- **Anthropic Claude 系列**
- DeepSeek
- Kimi2
- 其他兼容以上 API 的模型

## 核心特性

### 1. 自动提供商检测
- 根据环境变量自动检测可用的API密钥
- 智能选择最优的提供商
- 支持提供商回退机制

### 2. 统一API接口
- 所有提供商使用相同的调用接口
- 无需修改现有代码即可切换提供商
- 保持向后兼容性

## 安装
安装前请先确认安装了 `Node.js 20` 以上版本。

安装方式与 gemini-cli 一致, 推荐在项目目录下使用 npx 运行。
```shell
$ npx https://github.com/ai-embedded/gemini-cli-nexus
```
> 注意：如果使用 npx 运行，请先设置环境变量后再运行 gemini-cli-nexus, 如未设置环境变量，gemini-cli-nexus 会使用默认的 gemini 模型。

全局安装先需要确认未安装 gemini-cli, 已安装 gemini-cli 请先卸载: 
```shell
$ sudo npm uninstall -g gemini-cli
$ sudo npm install -g https://github.com/ai-embedded/gemini-cli-nexus
```


## 配置方法

启动 gemini-cli-nexus 时，会自动检测环境变量和 .env 文件中的 API 密钥，并根据可用的密钥自动选择提供商。
启动后会比 gemini-cli 多 2 个登录选项, 选择不同的提供商即可使用不同的 API 服务。

```bash
How would you like to authenticate for this project?

● 1. Login with Google
  2. Use Gemini API Key
  3. Vertex AI
  4. Use OpenAI API Key
  5. Use Anthropic API Key
```


### 1. 环境变量配置

#### 推荐方式：使用统一的 MODEL 环境变量

```bash
export OPENAI_API_KEY="sk-your-openai-key-here"
export OPENAI_BASE_URL=https://api.openai.com/v1 
# or
export ANTHROPIC_API_KEY="sk-ant-your-anthropic-key-here"
export ANTHROPIC_BASE_URL=https://api.anthropic.com


# 设置模型（统一配置方式）
export MODEL="gpt-4o-mini"
```

### 2. .env 文件配置

在项目根目录创建 `.env` 文件：

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

> 可参考项目目录下 .env.example 文件配置, 请注意不要提交 .env 以免泄露密钥


## 认证方式重置

如果需要重新选择认证方式：

```bash
# 方法 1：删除认证配置
rm ~/.gemini/settings.json

# 方法 2：编辑设置文件，删除 selectedAuthType 字段
# 编辑 ~/.gemini/settings.json

# 方法 3：完全重置
rm -rf ~/.gemini/
```

或登录命令行后是用 `/logout` 命令退出登录后重新登录

gemini-cli 详细使用说明请参考 [gemini-cli](gemini-cli.md)

## 同类型项目
- [qwen-code](https://github.com/QwenLM/qwen-code)

## 致谢
本项目在 gemini-cli 的基础上进行二次开发，感谢 [gemini-cli](https://github.com/google-gemini/gemini-cli)。

## License

基于原版 gemini-cli 开发，遵循相同许可证。