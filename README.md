# king-myco-runner
MYCO TG GAME 1

## Hostinger VPS one-click deploy (no paste commands)

This repository now includes a GitHub Actions workflow at:

- `.github/workflows/hostinger-vps-deploy.yml`

### What it does

- Deploys to your Hostinger VPS automatically when code is pushed to:
  - `cursor/playable-game-view-ae3a`
- Also supports manual deploys from the Actions tab with custom branch/SHA inputs.
- Runs your existing hardening script:
  - `scripts/ops/finalize-api-deploy.sh`

### Required GitHub repository secrets

Add these secrets in **GitHub -> Settings -> Secrets and variables -> Actions**:

- `VPS_HOST` (server hostname or IP)
- `VPS_USER` (SSH user)
- `VPS_SSH_KEY` (private SSH key for the user above)
- `VPS_PORT` (optional, defaults to `22`)

### Manual deployment from GitHub UI

1. Open **Actions**.
2. Select **Hostinger VPS Deploy**.
3. Click **Run workflow**.
4. Optionally set:
   - `deploy_branch`
   - `expected_sha`
   - `app_name`
   - `public_base_url`
   - `repo_dir`

This removes the need to manually SSH and paste deploy commands on every update.
