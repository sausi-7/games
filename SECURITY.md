# Security Policy

## Supported Versions

This project is a static collection of HTML5 games. The "supported version" is always the **latest commit on the `main` branch**, which is what's deployed to the live site.

## Reporting a Vulnerability

If you discover a security issue — for example:

- A game that exfiltrates data to a third-party server
- An XSS vector in the landing page or the iframe player
- A malicious asset or unsafe `<script>` injection
- A way for an iframe game to break out of its sandbox

**please do not open a public issue.** Instead, email the maintainer privately:

📧 **s9034315119@gmail.com**

Include:
- A description of the issue
- Steps to reproduce
- The affected game (slug) or page
- Impact assessment, if you have one

You can expect a first response within **72 hours**, and a fix or status update within **7 days** for valid reports.

## Scope

In scope:
- The landing page (`index.html`, `site/`)
- The deployment workflow (`.github/workflows/`)
- Anything in `games/` that's listed in `games/registry.json`

Out of scope:
- Third-party CDNs used by individual games (e.g. Phaser, Three.js) — report those upstream
- Browser-specific quirks that are not exploitable
- Issues requiring physical access to a victim's machine

Thanks for helping keep the project safe!
