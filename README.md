# Jarvis

A personal assistant for your computer, phone and home. Talk or type, manage tasks,
consult your calendars, control Home Assistant devices and open desktop applications.
Customize each assistant's name, personality and voice.

Jarvis runs a **central brain** with a web interface and connects to **Windows/Linux**
and **Android/iOS companions**. Accounts, personal integrations and preferences live
on the server. A standalone desktop mode is also available for local AI.

## Prerequisites

| Component                         | Requirements                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Central brain and desktop clients | Git, Node.js **22.23.2**, pnpm **11.25.0**                                    |
| Local speech                      | Python **3.11**, uv; internet for the initial package/model downloads         |
| Local AI                          | Ollama and a downloaded model; currently available in standalone desktop mode |
| Android development               | Android Studio, Android SDK and a compatible JDK                              |
| iOS development                   | macOS, Xcode and device signing                                               |
| Remote microphone access          | HTTPS and a certificate trusted by the client                                 |

Cloud API keys and Home Assistant are optional. CPU, RAM and storage requirements
depend on the local models you select. Native app builds require their platform SDKs;
clients do not need Python, model files or server credentials.

## Run the central brain

From a fresh checkout:

```sh
git clone https://github.com/caiofrota/jarvis.git
cd jarvis
pnpm install --frozen-lockfile
pnpm db:generate
pnpm setup:brain
node --env-file=apps/web/.env packages/db/node_modules/prisma/build/index.js migrate deploy --config=packages/db/prisma.config.ts
node --env-file=apps/web/.env node_modules/tsx/dist/cli.mjs apps/web/tools/initialize.ts
node --env-file=apps/web/.env node_modules/tsx/dist/cli.mjs apps/web/tools/create-first-user.ts
pnpm dev:brain
```

These commands work in a POSIX shell or PowerShell. `setup:brain` creates private
credentials and a SQLite database configuration in `apps/web/.local/`; it refuses
to overwrite an existing installation. Database setup and first-user creation are
one-time steps. The `node --env-file` commands load the configuration explicitly
for those tools.

Open **http://127.0.0.1:18765** and sign in. The assistant workspace is the main
page; administration is under **Settings**. Create additional users there so each
person can connect their own accounts and choose their own assistant. No home,
room or physical robot is required to chat.

For a production build on the same machine:

```sh
pnpm build:brain
pnpm start:brain
```

Keep the server running while companions are connected. The application loads
`apps/web/.env`; restarting never initializes or migrates the database automatically.
Back up your database and private credentials before upgrades.

### Connect from another device

Set `HOST=0.0.0.0` and `ROSIE_ORIGIN` to the exact client-facing address in
`apps/web/.env`. Use a trusted HTTPS reverse proxy, or generate a local certificate
with OpenSSL installed:

```sh
pnpm setup:brain:https
pnpm certificate:brain
```

The local helper moves HTTPS to port **18766** and redirects the previous HTTP port.
Configure the intended hostname/IP before generating the certificate, restart the
server and trust it on your devices. The public certificate is exported to
`apps/web/.local/tls/jarvis-local.cer`; never copy the private key to a client.
Certificates must match the address you use. See [remote clients](docs/engineering/remote-clients.md)
for certificate pinning, reverse proxies and native trust setup.

## Run a companion

### Windows and Linux

Install the Node/pnpm prerequisites and repository dependencies on the client,
then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm companion --server https://jarvis.example.com
```

Replace the example address with your central server. For a local certificate,
copy the public `.cer` from the server and provide its path:

```powershell
# Windows
pnpm companion --server https://jarvis.example.com --certificate "$env:USERPROFILE\Downloads\jarvis-local.cer"
```

```sh
# Linux
pnpm companion --server https://jarvis.example.com --certificate ~/Downloads/jarvis-local.cer
```

System-trusted HTTPS needs no certificate argument. After the first connection,
`pnpm companion` reuses the saved server. Sign in in the main window; secondary
panels unlock with that session. Grant microphone permission to use voice.
Desktop app launching requires confirmation on that computer.

### Android and iOS

Install dependencies, connect a development device and run:

```sh
pnpm mobile:android
# Or, on macOS with Xcode:
pnpm mobile:ios
```

Open **Jarvis Companion**, enter your HTTPS server address and sign in. Grant
microphone and local-network permissions when requested. These commands create
native development builds; later sessions use `pnpm mobile:start`. Use the
[Expo development setup](https://docs.expo.dev/guides/local-app-development/) for
SDK installation and [remote client instructions](docs/engineering/remote-clients.md)
for local CA trust and standalone APK/iOS builds without Metro. Phone-wide system
control and a background wake word are not currently implemented.

## AI and voice

The conversation model, speech recognition and response voice are independent.
Configure server credentials in [Settings](http://127.0.0.1:18765/settings), then
choose the model and voice in your assistant's profile. Cloud voices are AI-generated;
cloud providers receive the text or audio needed for the selected service and may
charge for API usage. Failed providers do not silently switch to another service.

| Option                         | Enable it                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI AI**                  | Add an API key under Settings → Conversation, then select OpenAI and a model in the assistant profile. A ChatGPT subscription does not configure this API connection. |
| **DeepSeek AI**                | Add its API key under Settings → Conversation and select the provider/model in the assistant profile.                                                                 |
| **Local speech**               | Start the Python speech worker below, then select a local voice. Recognition uses Whisper; downloaded local voices run on the server.                                 |
| **OpenAI voice**               | Use the saved OpenAI API key and select an OpenAI voice in the assistant profile. Speech recognition remains local in central mode.                                   |
| **ElevenLabs voice**           | Add an ElevenLabs API key under Settings → Voice, then select an account voice in the assistant profile. Central speech recognition remains local.                    |
| **Home Assistant Cloud voice** | Connect Home Assistant, enable its cloud speech option and select an available HA Cloud voice.                                                                        |
| **Ollama / fully local AI**    | Run standalone desktop mode below. The central brain does not yet expose an Ollama conversation provider.                                                             |

### Local speech worker

On the server, in another terminal:

```sh
cd native
uv sync --locked
uv run --locked python tools/download_kokoro.py
```

Then set the worker's credential path and start it:

```sh
# Linux/macOS, still in native/
export ROSIE_VOICE_TOKEN_FILE="$(pwd)/../apps/web/.local/voice.token"
uv run --locked uvicorn voice.app:create_app --factory --host 127.0.0.1 --port 8766
```

```powershell
# Windows PowerShell, still in native/
$env:ROSIE_VOICE_TOKEN_FILE = (Resolve-Path "..\apps\web\.local\voice.token").Path
uv run --locked uvicorn voice.app:create_app --factory --host 127.0.0.1 --port 8766
```

Keep this terminal running. The default model directory is `native/models`.
Whisper downloads its recognition model on first use; Kokoro is downloaded by the
command above. Local speech needs the initial downloads, then processes audio
locally. Start with text chat if you do not need voice. A cloud response voice does
not remove the central worker requirement for microphone transcription.

### Standalone desktop with local AI

On a Windows/Linux computer, install [Ollama](https://docs.ollama.com/quickstart)
and download a model with `ollama pull <model-name>`. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

Choose the local provider and installed model in **Settings → Intelligence**.
Choose local recognition/output in **Settings → Voice**; Python 3.11 and uv are
needed for its local speech setup. `pnpm dev` runs this mode in the browser at
**http://127.0.0.1:4318**. This mode has its own local data and does not connect to
the central brain. A fully local model and voice do not need cloud API keys.

## Optional integrations

- **Home Assistant:** configure its URL and home in Settings → Home Assistant,
  authorize the connection and enable the automatic catalog. Expose devices to
  Assist and assign their areas in HA. The structured HA API is used directly;
  an MCP server is not required. See [Home Assistant setup](docs/engineering/home-assistant.md).
- **Google / Microsoft:** an administrator configures the OAuth application once
  for the installation. Each user then connects their own accounts in **My accounts**
  and selects which calendars Jarvis may consult or prioritize. See
  [personal accounts and OAuth](docs/engineering/personal-assistants.md).
- **Physical voice endpoints:** see [firmware and hardware](native/docs/architecture.md).
  A board is optional for web, desktop and phone companions.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, pull request expectations,
our code of conduct and guidance on AI-assisted contributions.
Report private community concerns to [contato@caiofrota.com](mailto:contato@caiofrota.com).

## License

Jarvis application code is licensed under [MIT](LICENSE). Components declaring
another license retain it, including the GPL-3.0 native component. See
[license boundaries](THIRD_PARTY.md). Credentials, recordings, databases and
model weights are private runtime artifacts and are not distributed as source.
