# VickiEarn — Frontend Deployment

VickiEarn is a tasks and referral rewards frontend prepared for GitHub Pages deployment.

## Deployment

The repository includes `.github/workflows/pages.yml`. Pushes to `main` trigger the GitHub Pages deployment workflow.

After GitHub Pages is enabled for the repository using **GitHub Actions** as the Pages source, the workflow publishes the site automatically.

## Site pages

- `/` — public landing page
- `/dashboard.html` — dashboard demo
- `/admin.html` — safe static admin placeholder

## Important production note

The current deployment is a **static frontend/demo**. It does not process real accounts, balances, withdrawals, or payments. A production launch needs a secured backend, database, authentication, server-side payment integration, HTTPS, webhook handling, monitoring, backups, and applicable compliance review.
