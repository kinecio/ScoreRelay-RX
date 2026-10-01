# Windows code signing (maintainers)

Windows installers are signed through [SignPath](https://signpath.io) under the
SignPath Foundation's free program for open-source projects. The user-facing
policy is in the README ("Code signing policy"). This file is the maintainer
runbook. Nothing secret belongs in it or anywhere else in this public repository.

## How a release is signed

1. Push a tag `vX.Y.Z` that matches `version` in `package.json`.
2. `.github/workflows/desktop.yml` runs the tests, builds the macOS and Windows
   installers, and uploads the **unsigned** Windows installer as a workflow artifact.
3. The SignPath action submits that artifact. SignPath checks that it really was
   produced by this repository's workflow run, then waits for the **Approver** to
   approve the request in SignPath (release policy).
4. The signed installer is downloaded, its Authenticode signature is verified, and a
   **draft** GitHub release is created with the three installers and `SHA256SUMS.txt`.
5. A maintainer reviews the draft and publishes it.

Manual runs of the workflow use the `test-signing` policy and never create a release.

## One-time setup

1. Apply at <https://signpath.org/apply> (needs: public repo, OSI license, the code
   signing policy published in the README and on the download page, MFA for every
   team member). The signing identity shown to users is "SignPath Foundation".
2. In SignPath, once the project exists:
   - Project slug: `scorerelay-rx` (or set the `SIGNPATH_PROJECT_SLUG` repository variable).
   - Artifact configuration: paste [`signpath/artifact-configuration.xml`](../signpath/artifact-configuration.xml).
   - Signing policies: `test-signing` and `release-signing` (the Foundation creates these).
     Add the maintainers who may approve release signing.
   - Trusted build system: link GitHub.com and install the SignPath GitHub App on this repository.
   - Create an API token for a CI user that has **submitter** permission only.
3. In GitHub -> Settings -> Secrets and variables -> Actions:
   - Secret `SIGNPATH_API_TOKEN`.
   - Variable `SIGNPATH_ORGANIZATION_ID` (shown in SignPath; not a secret).
   - Variable `SIGNPATH_PROJECT_SLUG` only if it is not `scorerelay-rx`.
4. In GitHub -> Settings -> Rules, protect `v*` tags so only maintainers can create them.

## Rules that keep the signing arrangement valid

- Sign only binaries built from this repository's own source, on GitHub-hosted runners.
- Keep the code signing policy, team roles and privacy statement in the README and on the
  download page accurate. Update them when the team changes.
- Do not add telemetry or data collection without disclosing it there and in the installer.
- The release must stay uninstallable by normal means (the NSIS uninstaller).
- Never commit tokens, certificates or keys. `scripts/check-public-tree.sh` runs in CI to catch the obvious cases.

## After the first signed release

Update the "First launch" section of `docs/index.html`: the Windows steps currently say the
app is not signed. Keep the SmartScreen note: a new publisher can still see a warning until
the download count builds reputation.
