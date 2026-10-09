import type { Scope } from "@rosie/types";
import { type FormProps, homeOptions } from "./types";
export function ScopeFields({ value: v, set, options }: FormProps) {
  const scope = (v.scope ?? {
    assistantIds: [],
    roomIds: [],
    residentIds: [],
    modeIds: [],
  }) as Scope;
  return (
    <fieldset>
      <legend>Disponível para</legend>
      <p className="hint">Sem seleção em um grupo, vale para todos daquele grupo.</p>
      {(
        [
          ["assistantIds", "assistants", "Robôs"],
          ["roomIds", "rooms", "Ambientes"],
          ["residentIds", "residents", "Moradores"],
          ["modeIds", "modes", "Modos"],
        ] as const
      ).map(([key, kind, label]) => (
        <fieldset className="association-group" key={key}>
          <legend>{label}</legend>
          {homeOptions(options, kind, v.homeId).map((option) => (
            <label className="choice" key={option.id}>
              <input
                type="checkbox"
                checked={scope[key]?.includes(option.id) ?? false}
                onChange={(e) =>
                  set("scope", {
                    ...scope,
                    [key]: e.target.checked
                      ? [...(scope[key] ?? []), option.id]
                      : (scope[key] ?? []).filter((id) => id !== option.id),
                  })
                }
              />
              {option.name}
            </label>
          ))}
          {!homeOptions(options, kind, v.homeId).length && (
            <small>Nenhum cadastro neste grupo.</small>
          )}
        </fieldset>
      ))}
    </fieldset>
  );
}
