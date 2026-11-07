# Security

**Versions 1.4.0 and 1.5.0 are vulnerable** to a path-traversal flaw in `audio_plugin_lint` (`fix=true` could rewrite C/C++ files outside the project root). The fix is in **2.0.0**, which is not yet tagged or published to npm — install it with `npx -y github:sgm-audio/apc-mcp` and verify with `--version`.

The full threat model, defence layers, residual risk, dependency policy and vulnerability-reporting instructions live in **[docs/security.md](docs/security.md)**.

For sensitive disclosures, use GitHub's private vulnerability reporting on the repository rather than a public issue.
