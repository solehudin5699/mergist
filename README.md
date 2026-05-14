# mr-describe

AI-powered Merge Request / Pull Request description generator.

## Installation

```bash
npx mr-describe init
```

## Usage

```bash
# Interactive init (scaffold config, CI, templates)
npx mr-describe init

# Generate description in CI
npx mr-describe generate --platform gitlab
npx mr-describe generate --platform github

# Manage config
npx mr-describe config show
npx mr-describe config set <key> <value>
```

## Supported Platforms

- GitLab
- GitHub

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
