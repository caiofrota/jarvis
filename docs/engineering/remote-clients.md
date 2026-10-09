# Connect native companions to the central server

Windows/Linux use the `companion` Electron entry. Android/iPhone use `apps/mobile`,
a native React Native application containing the central `/studio` interface.
Each person signs in with their own Jarvis account. Recognition, voices, assistants,
HA and personal accounts belong to the central server. No endpoint, house, provider
key, database or Python voice runtime is needed on the client.

These are thin native clients of the shared interface. Buttons and conversational
requests can open registered programs on the companion's own computer after native
confirmation. Update and reopen the companion to enable the catalog/receipt bridge.
Cross-computer dispatch is not implemented.
Phone system control and a background wake word are not implied by this client.

## Windows and Linux

Use Node 22.23.2 and pnpm 11.25.0 in an authenticated checkout. From its root:

```powershell
git fetch origin
git switch feat/unified-assistant-platform
git pull --ff-only
pnpm install --frozen-lockfile
pnpm companion --server https://192.168.0.226:18766
```

This is the current local development server. Connect through the same LAN or the
installation's VPN. Another installation must use its own configured HTTPS origin.
`pnpm desktop` still starts the legacy local application; `pnpm companion` starts
the remote client. Neither command provisions a central server on the client PC.

The current server uses a local self-signed certificate. Export its public part
on the server with `pnpm certificate:brain`, then copy only the generated
`apps/web/.local/tls/jarvis-local.cer` to the client. Windows example:

```powershell
pnpm companion --server https://192.168.0.226:18766 --certificate "$env:USERPROFILE\Downloads\jarvis-local.cer"
```

Linux equivalent:

```sh
pnpm companion --server https://192.168.0.226:18766 --certificate ~/Downloads/jarvis-local.cer
```

The desktop accepts only that exact certificate with valid dates and a matching
subject alternative name. It does not disable TLS checks globally. System-trusted
HTTPS needs no `--certificate`. The server and a copy of the public certificate are saved in
private user data; later `pnpm companion` launches reuse them. Changing the server
clears the previous pin unless another certificate is explicitly supplied.

Sign in and enable voice. The application asks for microphone permission; Windows
must also permit microphone access for desktop apps in its privacy settings. The
remote renderer has no Node access. Its narrow preload manages windows and registered
local actions, checks the selected server/main frame, and requires native consent
before execution.
The current entry runs from source, not a separately published Windows installer.
The launcher compiles through Node, starts an Electron application directory, and
passes connection options through a one-use environment payload rather than Chromium
command-line flags. This avoids the observed Windows exit before application loading.

## Android development on a computer with Android Studio

Install Android Studio/SDK and a compatible JDK, enable device USB debugging and
connect the phone. Install repository dependencies. In PowerShell at the root:

```powershell
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

For the current local certificate, edit that file to contain:

```dotenv
JARVIS_LOCAL_TLS_HOST=192.168.0.226
```

Install `jarvis-local.cer` as a CA certificate in Android's security settings.
Then run at the repository root:

```sh
pnpm mobile:android
```

This generates the native project, installs a development build and starts Metro.
Subsequent development sessions can use `pnpm mobile:start`. Both require the
project's installed development build; store versions of Expo Go are not assumed
compatible with the pinned SDK. `pnpm mobile:ios` is the Mac/Xcode equivalent.

The Android build trusts user-installed CAs only for `JARVIS_LOCAL_TLS_HOST`; other
hosts use system trust. Leave it empty for publicly trusted HTTPS. Changing this
value requires a native rebuild. Cleartext traffic and TLS bypasses are disabled.

## Standalone Android/iPhone builds from Windows or Linux

A `preview` build includes the JavaScript bundle and runs without Metro. It still
requires the central Jarvis server to be reachable. Use your own Expo account:

```sh
cd apps/mobile
pnpm dlx eas-cli login
pnpm dlx eas-cli init
```

For a self-signed Android server, configure the cloud build environment:

```sh
pnpm dlx eas-cli env:create --name JARVIS_LOCAL_TLS_HOST --value 192.168.0.226 --environment preview --visibility plaintext
```

The ignored local `.env` is not uploaded; configure EAS explicitly. Skip the variable
for publicly trusted HTTPS. Build the Android APK:

```sh
pnpm dlx eas-cli build --platform android --profile preview
```

Install the APK through the build's download link and install the local CA if used.
A physical iPhone's internal distribution requires a paid Apple Developer membership
and device registration before building:

```sh
pnpm dlx eas-cli device:create
pnpm dlx eas-cli build --platform ios --profile preview
```

Follow the registration and installation links on the phone. EAS prompts for Apple
team/signing credentials. This cloud build does not require a Mac and does not
publish to an app store. A Mac with Xcode can alternatively build locally, following
Apple's device-signing requirements.

For a local certificate on iPhone, open `jarvis-local.cer`, install its profile under
**Settings → General → VPN & Device Management**, then enable its trust under
**Settings → General → About → Certificate Trust Settings**.

Open **Jarvis Companion**, enter `https://192.168.0.226:18766`, connect and sign in
with your existing account. Grant microphone/local-network access when requested.
Server selection uses SecureStore. Login cookies remain HttpOnly inside the WebView.
Leaving the app releases its WebView and microphone; returning starts a new
conversation while retaining the account login.

This change includes sources, build profiles and validated JavaScript bundles.
Signed APK/IPA artifacts, SDK compilation and real phone audio are separate steps;
no owner's phone was used for native acceptance during source validation.

## Google/Microsoft and shared connection boundaries

Connecting an account opens **Minhas contas** in the system browser. Sign in there
with the same Jarvis account and initiate provider authorization there, then return
to the companion. This avoids starting OAuth in one cookie store and completing it
in another. A local certificate must also be trusted by that browser. Provider
applications/callback origins must already be configured on the central server.

External navigation permits HTTPS links only; file, executable and JavaScript URLs
are blocked. No server provider credential is sent to the native shell. Public
connection policy lives in `packages/api-client` with no database/server/UI imports.

See [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/),
[EAS environment configuration](https://docs.expo.dev/eas/environment-variables/manage/),
and [Android network security configuration](https://developer.android.com/privacy-and-security/security-config)
for platform-specific signing and trust requirements.
