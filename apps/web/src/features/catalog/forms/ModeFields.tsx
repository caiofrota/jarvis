import { Field } from "../../../components/field/Field";
import type { FormProps } from "./types";
export function ModeFields({ value: v, set }: FormProps) {
  return (
    <>
      <Field
        label="Como o robô deve se comportar"
        type="textarea"
        value={v.instructions}
        onChange={(x) => set("instructions", x)}
      />
      <Field
        label="Volume máximo (%)"
        type="number"
        nullable
        min={0}
        max={100}
        value={v.volumeLimit}
        onChange={(x) => set("volumeLimit", x)}
      />
      <Field
        label="Limite de tokens por resposta"
        type="number"
        nullable
        min={64}
        max={1000}
        value={v.maxOutputTokens}
        onChange={(x) => set("maxOutputTokens", x)}
      />
    </>
  );
}
