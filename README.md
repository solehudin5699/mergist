# mergist

Generate merge request and pull request descriptions from your git diff.

## Usage

mergist can be used in two ways: **automated in CI** (generates description every MR/PR) or **manually from your terminal** (preview and optionally create a Draft MR/PR).

### CI

1. **Init with CI** — `npx mergist init` → answer Yes to "Configure CI pipeline?"
2. **Push** — commit generated files (.mergistrc, CI workflow, and optional standalone script)
3. **Setup secrets** — see [Setting up secrets](https://github.com/solehudin5699/mergist#setting-up-secrets)
4. **Create MR/PR** — CI triggers on merge request / pull request events and generates description automatically

### Manual (local)

1. **Init** — `npx mergist init` in your project, select a platform and configure settings
2. **Configure `.env`** — in your project root:

   ```
   AI_API_KEY=sk-...                # Required
   GITLAB_TOKEN=glpat-...           # Optional: for creating draft MRs
   GITHUB_TOKEN=github_pat_...      # Optional: for creating draft PRs
   ```

   **Where to get tokens:**

   *GitHub (fine-grained PAT):*
   - Go to https://github.com/settings/personal-access-tokens
   - Generate new fine-grained token → Repository access → select repos
   - Permissions: **Contents: Read** → **Pull requests: Read and write**
   - Add to `.env` as `GITHUB_TOKEN=github_pat_...`

   *GitLab (project access token):*
   - Go to your project → **Settings** → **Access Tokens**
   - Add new token: name `mergist`, role `Developer`, scope **api**
   - Add to `.env` as `GITLAB_TOKEN=glpat-...`

3. **Preview & create draft** — `npx mergist diff -f feature -t main`
   - Displays AI-generated description preview
   - Optionally create a Draft MR/PR after preview
   - Title auto-generated from branch name
   - Tokens not in `.env` prompted interactively

## Commands

```bash
# Interactive init (scaffold config, CI, templates)
npx mergist init

# Generate description in CI
npx mergist generate --platform gitlab
npx mergist generate --platform github

# Generate description locally and optionally create a Draft MR/PR
npx mergist diff -f feature -t main

# Manage config
npx mergist config show
npx mergist config set <key> <value>
```

| Command | Description | Options |
|---------|-------------|---------|
| `init` | Scaffold config, CI pipeline, and templates | — |
| `generate` | Generate MR/PR description in CI | `-p, --platform <gitlab\|github>` (optional, falls back to config) |
| `diff` | Preview description and optionally create a Draft MR/PR from local git diff | `-f, --from <branch>` (required), `-t, --to <branch>` (required) |
| `config show` | Display current configuration | — |
| `config get <key>` | Get a specific config value | `platform`, `maxDiffChars`, `maxTokens`, `lang`, `autoUpdate`, `templates`, `ciTargetBranches` |
| `config set <key> <value>` | Update a config key | e.g., `set lang en`, `set maxDiffChars 10000` |

### Init walkthrough

During `init` you will be prompted for:

| Prompt | Description |
|--------|-------------|
| **Platform** | GitLab or GitHub |
| **Use CI** | Configure CI pipeline (if No, CI prompts are skipped; run `npx mergist diff` locally with `.env`) |
| **Standalone script** | *(only if CI enabled)* Generate a no-dependency script (useful for environments without npx) |
| **Target branches** | *(only if CI enabled)* Limit CI to specific target branches (e.g. `main,develop`) |
| **AI Provider** | OpenAI, DeepSeek, Groq, or Custom |
| **Model** | AI model name |
| **Max diff chars** | Max diff characters sent to AI |
| **Max output tokens** | Maximum tokens for AI response (default: 4096) |
| **Language** | Indonesian (`id`) or English (`en`) |
| **Sections** | Choose which template sections to include |
| **Auto-update** | *(only if CI enabled)* Regenerate AI sections when new commits are pushed |

After init completes, **detailed platform-specific next steps** are displayed with step-by-step instructions for setting up CI secrets, creating tokens, and committing files.

## Features

- **Multi AI Provider** — OpenAI, DeepSeek, Groq, or Custom (OpenAI-compatible API only)
- **Multi-language** — Indonesian (`id`) or English (`en`)
- **Section templates** — choose which sections to include during init:

  | Section | Description | Filled by |
  |---------|-------------|-----------|
  | `summary` | Brief description of MR/PR | AI |
  | `changes` | Changes with emoji prefix (Add/Change/Remove) | AI |
  | `review` | AI code analysis with risk/warn/suggestion/good labels | AI |
  | `testing` | Testing checklist | AI |
  | `notes` | Developer notes | Human |
  | `references` | Issue/ticket links | Human |
- **Smart merge** — `autoUpdate` only rewrites AI-generated sections, human-filled sections (notes, references) are preserved on subsequent updates
- **Standalone script** — optional no-dependency script generated during `init` (for environments without npx)
- **Branch filter** — limit CI to specific target branches

## Configuration

Config file `.mergistrc` is auto-generated by `npx mergist init`.

### Config keys

| Key | Type | Description |
|-----|------|-------------|
| `platform` | `gitlab` / `github` | Target platform |
| `aiProvider` | `openai` / `deepseek` / `groq` / `custom` | AI provider |
| `lang` | `id` / `en` | Output language |
| `maxDiffChars` | number | Max diff characters sent to AI |
| `maxTokens` | number | Max output tokens for AI responses (default: 4096) |
| `autoUpdate` | boolean | Auto-update description on new commits |
| `ciTargetBranches` | string[] | Limit CI to specific target branches (optional) |
| `templates` | array | Active sections |
| `providers` | object | Per-provider config with apiKey, model, baseUrl |

### CI templates

Works with both gitlab.com and self-hosted GitLab.

```yaml
stages:
  - mergist

mergist:
  stage: mergist
  image: node:20-alpine
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    GIT_DEPTH: 0
  script:
    - npx mergist generate -p gitlab
  allow_failure: true
```

The CI config is automatically appended or replaced when re-running `init`. If your project already has other CI jobs, only the `mergist` job block is managed.

```yaml
name: Generate PR Description

on:
  pull_request:
    types: [opened, synchronize]
  workflow_dispatch:

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate PR Description
        run: |
          npx mergist generate -p github
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_PR_NUMBER: ${{ github.event.number }}
          AI_API_KEY: ${{ secrets.AI_API_KEY }}
```

### Environment variables

| Variable | Scope | Description |
|----------|-------|-------------|
| `AI_API_KEY` | All | API key for your AI provider |
| `GITLAB_TOKEN` | CI + Local | GitLab project access token (scope: `api`). Used for creating draft MRs locally. |
| `GITHUB_TOKEN` | CI + Local | Automatically provided by GitHub Actions. For local: fine-grained PAT with `Contents: Read` + `Pull requests: Read and write`. |

## Setting up secrets

### GitHub Actions

1. Go to your repository on GitHub
2. Click **Settings** tab
3. In left sidebar, click **Secrets and variables → Actions**
4. Click **New repository secret** button
5. Add the following secrets:

   | Name | Value |
   |------|-------|
   | `AI_API_KEY` | Your AI provider API key (OpenAI / DeepSeek / Groq / Custom) |

6. `GITHUB_TOKEN` is **automatically provided** by GitHub Actions — no setup needed
7. **Ensure workflow has write permission:**
   - Go to **Settings → Actions → General**
   - Scroll to **Workflow permissions**
   - Select **Read and write permissions**
   - Click **Save**

### GitLab CI/CD

1. Go to your project on GitLab
2. Click **Settings → Access Tokens**
3. Click **Add new token**
   - Name: `mergist`
   - Role: `Developer`
   - Scope: check **api**
   - Click **Create project access token**
   - **Copy the token value** — you'll need it in step 6
4. Go to **Settings → CI/CD → Runners → Expand → Instance tab**
   - Ensure **Turn on instance runners for this project** is toggled ON
5. In **Variables** section, click **Expand**
6. Click **Add variable** and add:

   | Name | Value | Type | Protected | Masked |
   |------|-------|------|-----------|--------|
   | `AI_API_KEY` | Your AI provider API key | Variable | No | Yes |
   | `GITLAB_TOKEN` | Token from step 3 | Variable | No | Yes |

7. The following variables are **automatically provided** by GitLab CI (no setup needed):
   - `CI_PROJECT_ID`
   - `CI_MERGE_REQUEST_IID`
   - `CI_API_V4_URL` (works for both gitlab.com and self-hosted)

## Supported Platforms

- GitLab (gitlab.com and self-hosted)
- GitHub (github.com)

## Limitations

- **GitHub fork PRs** — Not yet supported. The `pull_request` event does not expose secrets for fork PRs, so the workflow fails. Workaround: work in the same repository.

- **GitLab note:** Fork MRs are supported — enable "Run pipelines in the parent project" in Settings → CI/CD → Merge requests.

- **GitLab Runner:** GitLab CI requires a runner to execute jobs. If your self-hosted instance has no available runner, the CI pipeline will remain stuck in "pending" state.
  - **Check available runners:** Settings → CI/CD → Runners
  - If none available, register a new runner.

- **GitHub Enterprise** — Not supported. The API base URL is hardcoded to `https://api.github.com`. Self-hosted GitHub Enterprise instances cannot be used as a target platform.

- **Single platform per project** — `mergist` can only target one platform (GitLab or GitHub) per project. Using both simultaneously in a single `.mergistrc` configuration is not supported.

- **Branch must be pushed** — Before creating a draft MR/PR via `mergist diff`, the source branch must already exist on the remote. `mergist` does not push branches for you; use `git push` first.

- **Custom provider** — The custom AI provider option only supports OpenAI-compatible API endpoints. Other formats (e.g., Anthropic, Gemini direct API) are not supported.

- **AI output quality** — The generated description quality depends on the AI provider, model, max diff characters, and max tokens configuration. Different models may produce varying results. Adjust `maxDiffChars` (more diff context) or `maxTokens` (longer output) in `.mergistrc` to improve results.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
