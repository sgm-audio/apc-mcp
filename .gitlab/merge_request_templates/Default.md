# Merge Request

## Description

<!-- What does this MR change? -->

## Type of change

- [ ] Bug fix
- [ ] New tool / feature
- [ ] Refactor / code quality
- [ ] Security fix
- [ ] Documentation

## Checklist

- [ ] `npm test` passes
- [ ] `node --check index.js` passes
- [ ] No new SAST/secret/dependency warnings introduced
- [ ] All user-facing string parameters have Zod regex validation
- [ ] New commands use `spawnSync()` with argument arrays (never `execSync`)

## Code Quality Gate

<!-- GitLab Ultimate will block merge if code quality degrades or vulnerabilities are introduced -->
