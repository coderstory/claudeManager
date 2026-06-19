# Signing & Notarization

> **Status (M1.10)**: All secrets in this document are **placeholders** for
> the v1.1 release phase. M1 builds are dev builds (debug) and do NOT
> require signing — they are only iterated locally via
> `scripts/build-and-ship.sh`. The CI matrix
> (`.github/workflows/release.yml`) currently builds unsigned installers
> for fast turnaround on the pipeline itself; signing hooks exist as
> commented-out `env:` entries and will be flipped on at v1.1.
>
> This document is the **single source of truth** for which secrets to
> provision in GitHub Settings → Secrets and variables → Actions, when
> the v1.1 release phase begins.

---

## 1. Why we sign / notarize

| Platform | Mechanism | What breaks without it |
|---|---|---|
| Windows | Authenticode (EV code-sign cert) | SmartScreen "Unknown publisher" warnings on first run, kills UX; MSI fails `Orca` validation in enterprise environments |
| macOS | Developer ID + `xcrun notarytool` | Gatekeeper blocks the app on first launch with "cannot be opened because the developer cannot be verified"; DMG treated as damaged on Apple Silicon |

Tauri 2 generates the necessary hooks for both — we just have to feed
them the right secrets at build time.

---

## 2. Windows EV code signing

### 2.1 What to buy

An **Extended Validation (EV) Code Signing Certificate** from a Microsoft
Trusted Root CA member. Current market options (as of 2026):

- Sectigo (formerly Comodo)
- DigiCert
- GlobalSign
- SSL.com

EV (not standard OV) is required for **immediate** SmartScreen
reputation; OV certs accumulate reputation slowly per download.

### 2.2 Hardware requirement

EV certs MUST be stored on a FIPS 140-2 Level 2+ hardware token
(Sectigo requires this; DigiCert/SSL.com also enforce it). Common form
factors:

- SafeNet eToken 5110 (USB-A)
- YubiKey 5 FIPS (USB-A/C/NFC)

### 2.3 Signtool invocation

Tauri's Windows bundler invokes `signtool.exe` automatically when the
following are set in the workflow `env:` (currently commented out in
`.github/workflows/release.yml`):

```yaml
env:
  WINDOWS_EV_CERT_THUMBPRINT: ${{ secrets.WINDOWS_EV_CERT_THUMBPRINT }}
  WINDOWS_EV_CERT_PASSWORD:  ${{ secrets.WINDOWS_EV_CERT_PASSWORD }}
```

Tauri CLI also accepts `--signtool-path` if the cert token requires a
specific driver path; default `C:\Program Files (x86)\Windows Kits\10\bin\<sdk>\x64\signtool.exe` works on GitHub-hosted `windows-latest`.

### 2.4 Secrets to add to GitHub

| Secret name | Value | Source |
|---|---|---|
| `WINDOWS_EV_CERT_THUMBPRINT` | SHA-1 thumbprint of the EV cert (uppercase, colon-delimited) | `certutil -store My` on the token |
| `WINDOWS_EV_CERT_PASSWORD` | Token unlock password | Issued by CA during enrollment |

### 2.5 Local dev

Dev builds on the local Windows box are **unsigned by design** — we
ship debug builds to the desktop via `scripts/build-and-ship.sh` for
fast iteration. SmartScreen will warn but won't block on a self-signed
exe. v1.1 release work happens ONLY in CI.

---

## 3. macOS Developer ID + notarization

### 3.1 Apple Developer Program enrollment

1. Enroll at <https://developer.apple.com/programs/> ($99/year).
2. Once approved, create a **Developer ID Application** certificate in
   Xcode → Settings → Accounts → Manage Certificates. This is a
   G2-subcategory cert specifically for **distribution outside the
   Mac App Store** — NOT the regular "Apple Development" cert used
   for local builds.
3. Note your **Team ID** (10-char alphanumeric) from
   <https://developer.apple.com/account/#/membership/>.

### 3.2 Two signing flows

**Option A — Sign on a CI-controlled Apple Silicon Mac** (what we do in
`.github/workflows/release.yml` via `tauri-action`):

```yaml
env:
  APPLE_ID:                 ${{ secrets.APPLE_ID }}            # Apple ID email
  APPLE_PASSWORD:           ${{ secrets.APPLE_PASSWORD }}      # App-specific password (see 3.3)
  APPLE_TEAM_ID:            ${{ secrets.APPLE_TEAM_ID }}       # 10-char team id
  APPLE_CERTIFICATE:        ${{ secrets.APPLE_CERTIFICATE }}   # base64 of .p12 export
  APPLE_CERTIFICATE_PWD:    ${{ secrets.APPLE_CERTIFICATE_PWD }}
```

**Option B — Run `xcrun notarytool` locally, upload pre-signed .dmg**:

Less ergonomic; only useful for one-off signed releases outside CI.
Not used here.

### 3.3 App-specific password

1. Go to <https://appleid.apple.com/account/manage>.
2. App-Specific Passwords → Generate.
3. Copy the 16-char password into GitHub secret `APPLE_PASSWORD`.

This password is required for `xcrun notarytool` to submit the binary
to Apple's notary service. Your normal Apple ID password is **not**
accepted.

### 3.4 Cert export

On a Mac that has the Developer ID cert installed:

```bash
# List installed Developer ID certs
security find-identity -p codesigning -v

# Export the one you want as .p12 (replace with cert's "SHA-1" hash)
security export -k <SHA-1-hash> -t identities -o ./developer-id.p12 -P "<export-password>"

# base64-encode for GitHub secret
base64 -i ./developer-id.p12 | tr -d '\n' > ./developer-id.p12.b64
```

The `developer-id.p12.b64` content goes into GitHub secret
`APPLE_CERTIFICATE`; the export password goes into
`APPLE_CERTIFICATE_PWD`.

### 3.5 Secrets to add to GitHub

| Secret name | Value |
|---|---|
| `APPLE_ID` | Apple ID email used to enroll in Developer Program |
| `APPLE_PASSWORD` | App-specific password (not Apple ID password) |
| `APPLE_TEAM_ID` | 10-char Team ID |
| `APPLE_CERTIFICATE` | base64 of .p12 export of Developer ID Application cert |
| `APPLE_CERTIFICATE_PWD` | .p12 export password |

### 3.6 Why macOS builds need `macos-latest` runner, not Windows

Apple code signing and notarization ONLY work on macOS hosts (because
the tools are part of Xcode CLI tools). The CI matrix
(`release.yml`) keeps the macOS leg on `macos-latest` for this reason.

---

## 4. Tauri updater public key (v1.1 / M3)

`tauri-plugin-updater` (already a dependency in `Cargo.toml` at
`=2.10.1`) verifies update payloads against an ed25519 keypair.
Generation:

```bash
# On any host with the `tauri` CLI:
npx @tauri-apps/cli signer generate --writable
# Writes ~/.tauri/claude-config-manager.key (PRIVATE) and
#         ~/.tauri/claude-config-manager.key.pub (PUBLIC)
```

Workflow at v1.1:

1. Generate keypair once; store PRIVATE key in GitHub secret
   `TAURI_SIGNER_PRIVATE_KEY` and password in `TAURI_SIGNER_PRIVATE_KEY_PASSWORD`.
2. Paste PUBLIC key into `src-tauri/tauri.conf.json`:
   ```json
   "plugins": { "updater": { "pubkey": "<PUBLIC_KEY_BASE64>" } }
   ```
3. In `.github/workflows/release.yml`, uncomment the corresponding
   `env:` entries and pass them through `tauri-action` (it wires them
   to `tauri build` automatically).

For M1 (current phase) the updater is registered but NOT enabled in
production builds; the `pubkey` field in `tauri.conf.json` is empty.
This is intentional — we don't ship updates during M1.x because we
have no real users yet.

---

## 5. Summary checklist for v1.1 release phase

- [ ] Buy EV code-signing cert + token (Sectigo / DigiCert / GlobalSign)
- [ ] Add `WINDOWS_EV_CERT_THUMBPRINT` + `WINDOWS_EV_CERT_PASSWORD` to GitHub Secrets
- [ ] Uncomment Windows env block in `.github/workflows/release.yml`
- [ ] Enroll in Apple Developer Program ($99/yr)
- [ ] Generate Developer ID Application cert on a Mac
- [ ] Export .p12 → base64; create app-specific password
- [ ] Add `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` / `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PWD` to GitHub Secrets
- [ ] Uncomment macOS env block in `.github/workflows/release.yml`
- [ ] Generate ed25519 keypair for tauri-plugin-updater
- [ ] Add `TAURI_SIGNER_PRIVATE_KEY` + `TAURI_SIGNER_PRIVATE_KEY_PASSWORD` to GitHub Secrets
- [ ] Paste PUBLIC key into `src-tauri/tauri.conf.json` plugins.updater.pubkey

When all 10 items are checked off, flip the workflow to **non-draft
releases** (`releaseDraft: false` in `.github/workflows/release.yml`)
and tag `v0.1.0` to ship v1.1.