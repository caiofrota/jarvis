import type { WeatherLocation } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { z } from "zod";

const locationsSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        admin1: z.string().optional(),
        country: z.string().optional(),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      }),
    )
    .max(10)
    .default([]),
});
const currentSchema = z.object({
  current: z.object({
    temperature_2m: z.number().min(-100).max(70),
    weather_code: z.number().int().min(0).max(99),
    time: z.number().int().positive(),
  }),
});
export type WeatherReading = {
  value: string;
  condition: string;
  source: string;
  measuredAt: number;
};

async function get(url: URL, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
      : AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!response.ok) throw new DomainError("O serviço de clima está indisponível agora.");
  return response.json();
}
export async function searchWeatherLocations(query: string): Promise<WeatherLocation[]> {
  const name = z.string().trim().min(2).max(100).parse(query);
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name,
    count: "10",
    language: "pt",
    format: "json",
  }).toString();
  try {
    const data = locationsSchema.parse(await get(url));
    return data.results.map((v) => ({
      name: [v.name, v.admin1, v.country].filter(Boolean).join(", "),
      latitude: v.latitude,
      longitude: v.longitude,
    }));
  } catch {
    throw new DomainError("Não consegui buscar cidades agora. Tente novamente em instantes.");
  }
}
export function weatherDescription(code: number) {
  if (code === 0) return "céu limpo";
  if (code <= 2) return "céu parcialmente nublado";
  if (code === 3) return "céu nublado";
  if ([45, 48].includes(code)) return "neblina";
  if ([51, 53, 55, 56, 57].includes(code)) return "garoa";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "chuva";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "neve";
  if ([95, 96, 99].includes(code)) return "trovoadas";
  return "condição do céu não informada";
}

export class WeatherSource {
  private cache = new Map<string, { value: WeatherReading; expires: number }>();
  private pending = new Map<string, Promise<WeatherReading>>();
  async read(location: WeatherLocation | null): Promise<WeatherReading> {
    if (!location) throw new DomainError("Selecione a cidade para o clima em Casas no painel.");
    const key = `${location.latitude},${location.longitude}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now() && Date.now() - cached.value.measuredAt < 90 * 60000)
      return cached.value;
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 8)
      throw new DomainError("Aguarde um instante para consultar o clima.");
    const task = this.fetchReading(location)
      .then((value) => {
        if (this.cache.size >= 100) this.cache.clear();
        this.cache.set(key, { value, expires: Date.now() + 10 * 60000 });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  private async fetchReading(location: WeatherLocation): Promise<WeatherReading> {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      current: "temperature_2m,weather_code",
      temperature_unit: "celsius",
      timeformat: "unixtime",
      forecast_days: "1",
    }).toString();
    try {
      const { current } = currentSchema.parse(await get(url));
      const measuredAt = current.time * 1000;
      if (Date.now() - measuredAt > 90 * 60000 || measuredAt - Date.now() > 15 * 60000)
        throw new Error("Outdated weather");
      return {
        value: String(current.temperature_2m),
        condition: weatherDescription(current.weather_code),
        source: `Open-Meteo — condições estimadas para ${location.name}, em graus Celsius`,
        measuredAt,
      };
    } catch {
      throw new DomainError(
        "Não consegui consultar o clima atualizado agora. Tente novamente daqui a pouco.",
      );
    }
  }
}
export const weatherSource = new WeatherSource();
