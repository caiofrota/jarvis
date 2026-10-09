CREATE TABLE "Entry" (
  "collection" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL,
  PRIMARY KEY ("collection", "id")
);
CREATE TABLE "Setting" ("id" TEXT NOT NULL PRIMARY KEY, "data" JSONB NOT NULL);
CREATE TABLE "AdminSession" ("id" TEXT NOT NULL PRIMARY KEY, "expiresAt" DATETIME NOT NULL);
CREATE TABLE "Event" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" TEXT NOT NULL,
  "detail" JSONB NOT NULL
);
CREATE INDEX "Entry_collection_name_id_idx" ON "Entry"("collection", "name", "id");
