import { z } from "zod";

export const weatherLocationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type WeatherLocation = z.infer<typeof weatherLocationSchema>;
