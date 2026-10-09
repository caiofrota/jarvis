import { expect, test } from "./fixtures";

test("voice captures PCM, speaks through the shared pipeline and releases the microphone", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = { stopped: 0, decoded: 0, played: 0 };
    Object.assign(window, { voiceFixture: state });
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args: Parameters<typeof decode>) {
      state.decoded++;
      return decode.apply(this, args);
    };
    const play = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof play>) {
      state.played++;
      return play.apply(this, args);
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const context = new AudioContext(),
          destination = context.createMediaStreamDestination(),
          oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.frequency.value = 220;
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        await context.resume();
        gain.gain.setValueAtTime(0.2, context.currentTime + 1);
        gain.gain.setValueAtTime(0, context.currentTime + 2.2);
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            state.stopped++;
            stop();
            oscillator.stop();
            void context.close();
          };
        }
        return destination.stream;
      },
    });
  });
  await page.route("**/api/v1/companion/message", (route) =>
    route.fulfill({ json: { text: "Olá, vamos conversar.", voice: "kokoro-pf_dora" } }),
  );
  await page.route("**/api/v1/companion/transcribe", (route) =>
    route.fulfill({ json: { text: "Boa tarde" } }),
  );
  await page.goto("/studio");
  await page.getByLabel("Usuário", { exact: true }).fill("admin");
  await page.getByLabel("Senha", { exact: true }).fill("fixture-user-password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Iniciar conversa", exact: true }).click();
  await expect(page.getByText("Estou ouvindo", { exact: true })).toBeVisible();
  await expect(page.getByRole("log", { includeHidden: true })).toContainText(
    "Olá, vamos conversar.",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { voiceFixture: { played: number } }).voiceFixture.played,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByText("Estou ouvindo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Encerrar conversa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iniciar conversa", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { voiceFixture: { stopped: number } }).voiceFixture.stopped,
    ),
  ).toBe(1);
});
