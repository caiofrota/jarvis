import { emptyCatalog, schemas } from "@rosie/types";
import { expect, it } from "vitest";
import { planResidentImport } from "../src/server/catalog/resident-import";
import { catalogFixture } from "./fixture";

function fixture() {
  const source = catalogFixture();
  source.residents = [
    schemas.residents.parse({
      id: "person",
      name: "Resident",
      homeId: "home",
      facts: "Personal context",
      preferences: "Prefers quiet",
    }),
  ];
  const reference = {
    id: "voiceprint:person",
    data: {
      residentId: "person",
      homeId: "home",
      model: "fixture-encoder",
      samples: Array.from({ length: 3 }, () => Array.from({ length: 256 }, (_, i) => (i ? 0 : 1))),
      enrollmentId: "fixture-enrollment",
      enrolledAt: "2026-10-08T00:00:00Z",
    },
  };
  return { source, reference };
}
it("imports resident context and enrolled references without copying endpoint or account settings", () => {
  const { source, reference } = fixture();
  const destination = emptyCatalog();
  destination.homes = source.homes;
  const plan = planResidentImport(source, destination, [reference], []);
  expect(plan.added.map(({ collection }) => collection)).toEqual(["residents"]);
  expect(plan.catalog.residents[0]).toMatchObject({
    facts: "Personal context",
    preferences: "Prefers quiet",
  });
  expect(plan.references).toEqual([reference]);
  expect(planResidentImport(source, plan.catalog, [reference], plan.references).references).toEqual(
    [],
  );
});
it("preserves existing registrations and rejects replacement or foreign references", () => {
  const { source, reference } = fixture();
  expect(planResidentImport(source, source, [reference], [reference]).preserved).toEqual([
    reference.id,
  ]);
  expect(() =>
    planResidentImport(
      source,
      source,
      [reference],
      [{ ...reference, data: { ...reference.data, enrollmentId: "newer" } }],
    ),
  ).toThrow("difere");
  expect(() =>
    planResidentImport(
      source,
      source,
      [{ ...reference, data: { ...reference.data, homeId: "other" } }],
      [],
    ),
  ).toThrow("sem morador");
  expect(() =>
    planResidentImport(source, source, [{ ...reference, id: "voiceprint:other" }], []),
  ).toThrow("inválida");
  expect(() =>
    planResidentImport(
      source,
      source,
      [{ ...reference, data: { ...reference.data, samples: [[1]] } }],
      [],
    ),
  ).toThrow("inválida");
  const missingHome = { ...source, homes: [] };
  expect(() => planResidentImport(missingHome, source, [reference], [])).toThrow(
    "Casa de origem ausente",
  );
});
