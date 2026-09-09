import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sheets = sqliteTable("sheets", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  instrument: text("instrument").notNull(),
  genre: text("genre").notNull(),
  difficulty: text("difficulty").notNull(),
  musicalKey: text("musical_key").notNull(),
  bpm: integer("bpm").notNull(),
  uploader: text("uploader").notNull(),
  avatar: text("avatar").notNull(),
  accent: text("accent").notNull(),
  musicXml: text("music_xml").notNull(),
  processingMode: text("processing_mode").notNull(),
  processingProvider: text("processing_provider").notNull(),
  processingWarnings: text("processing_warnings").notNull(),
  sourceObjectKey: text("source_object_key"),
  createdAt: integer("created_at").notNull(),
});
