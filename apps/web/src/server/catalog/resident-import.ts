import { type Catalog, emptyCatalog } from "@rosie/types";
import { DomainError } from "@rosie/types/context";
import { voiceProfileSchema } from "../voice/profiles";
import { mergeRosieCatalog } from "./rosie-import";

type StoredReference = { id: string; data: unknown };
export function planResidentImport(
  source: Catalog,
  destination: Catalog,
  sourceReferences: StoredReference[],
  destinationReferences: StoredReference[],
) {
  const selected = emptyCatalog();
  selected.homes = source.homes;
  selected.residents = source.residents;
  const catalog = mergeRosieCatalog(selected, destination);
  const references: StoredReference[] = [],
    preserved: string[] = [];
  for (const row of sourceReferences) {
    const parsed = voiceProfileSchema.safeParse(row.data);
    if (!parsed.success || row.id !== `voiceprint:${parsed.data.residentId}`)
      throw new DomainError(`Referência de voz inválida: ${row.id}.`);
    const resident = source.residents.find(
      (value) => value.id === parsed.data.residentId && value.homeId === parsed.data.homeId,
    );
    if (!resident) throw new DomainError(`Referência sem morador correspondente: ${row.id}.`);
    const homeId = catalog.mappings.homes[resident.homeId];
    if (!homeId) throw new DomainError(`Casa de origem ausente para a referência: ${row.id}.`);
    const reference = voiceProfileSchema.parse({ ...parsed.data, homeId });
    const existing = destinationReferences.find((value) => value.id === row.id);
    if (existing) {
      const current = voiceProfileSchema.safeParse(existing.data);
      if (!current.success || JSON.stringify(current.data) !== JSON.stringify(reference))
        throw new DomainError(
          `A voz de ${resident.name} difere no Jarvis; nenhum cadastro será substituído.`,
        );
      preserved.push(row.id);
    } else references.push({ id: row.id, data: reference });
  }
  return { ...catalog, references, preserved };
}
