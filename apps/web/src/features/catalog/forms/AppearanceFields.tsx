import { displayDefaults, indicatorLightDefaults } from "@rosie/types";
import { Field } from "../../../components/field/Field";
import type { FormProps } from "./types";

export function AppearanceFields({ value, set }: Pick<FormProps, "value" | "set">) {
  const light = { ...indicatorLightDefaults, ...(value.indicatorLight as object) },
    display = { ...displayDefaults, ...(value.display as object) },
    setLight = (key: string, v: unknown) => set("indicatorLight", { ...light, [key]: v }),
    setDisplay = (key: string, v: unknown) => set("display", { ...display, [key]: v });
  return (
    <>
      <fieldset>
        <legend>Luz de escuta e fala</legend>
        <Field
          label="Usar LED indicador"
          type="checkbox"
          value={light.enabled}
          onChange={(v) => setLight("enabled", v)}
        />
        <p className="hint">
          Fixo ao escutar, inclusive sonolenta. Varia com a fala e apaga nos demais estados. Requer
          LED instalado e firmware compatível.
        </p>
        {light.enabled && (
          <>
            <Field
              label="Brilho ao escutar (%)"
              type="number"
              min={0}
              max={100}
              required
              value={light.listeningBrightness}
              onChange={(v) => setLight("listeningBrightness", v)}
            />
            <Field
              label="Brilho mínimo ao falar (%)"
              type="number"
              min={0}
              max={light.speakingMaxBrightness}
              required
              value={light.speakingMinBrightness}
              onChange={(v) => setLight("speakingMinBrightness", v)}
            />
            <Field
              label="Brilho máximo ao falar (%)"
              type="number"
              min={light.speakingMinBrightness}
              max={100}
              required
              value={light.speakingMaxBrightness}
              onChange={(v) => setLight("speakingMaxBrightness", v)}
            />
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>Tela</legend>
        <Field
          label="Estado da tela"
          type="select"
          required
          value={display.mode}
          onChange={(v) => setDisplay("mode", v)}
          options={[
            { id: "auto", name: "Automático" },
            { id: "on", name: "Sempre ligada" },
            { id: "off", name: "Apagada" },
          ]}
        />
        <Field
          label="Apagar por horário"
          type="checkbox"
          value={display.scheduleEnabled}
          onChange={(v) => setDisplay("scheduleEnabled", v)}
        />
        {display.scheduleEnabled && (
          <>
            <Field
              label="Apagar às"
              type="time"
              required
              value={display.offAt}
              onChange={(v) => setDisplay("offAt", v)}
            />
            <Field
              label="Ligar às"
              type="time"
              required
              value={display.onAt}
              onChange={(v) => setDisplay("onAt", v)}
            />
          </>
        )}
        <p className="hint">
          O horário usa o fuso da casa e vale no modo Automático. Apagar a tela mantém voz e LED
          funcionando. Durante a configuração de Wi-Fi, a tela acende para mostrar a senha.
        </p>
      </fieldset>
    </>
  );
}
