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

/** Durable lifecycle record for a transcription request; audio stays in R2. */
export const transcriptionJobs = sqliteTable("transcription_jobs", {
  id: text("id").primaryKey(), ownerEmail: text("owner_email").notNull(), remoteJobId: text("remote_job_id"), status: text("status").notNull(), stage: text("stage").notNull(), filename: text("filename").notNull(), targetInstrument: text("target_instrument").notNull(), sourceType: text("source_type").notNull(), strictRhythm: integer("strict_rhythm").notNull(), sourceObjectKey: text("source_object_key").notNull(), resultObjectKey: text("result_object_key"), error: text("error"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), expiresAt: integer("expires_at").notNull(),
});

/** User corrections are append-only operations against a generated score. */
export const scoreRevisions = sqliteTable("score_revisions", {
  id: text("id").primaryKey(), ownerEmail: text("owner_email").notNull(), jobId: text("job_id").notNull(), revision: integer("revision").notNull(), operations: text("operations").notNull(), consentedForTraining: integer("consented_for_training").notNull(), createdAt: integer("created_at").notNull(),
});

/** Metadata only: assets require explicit rights and are stored in private R2. */
export const datasetAssets = sqliteTable("dataset_assets", {
  id: text("id").primaryKey(), split: text("split").notNull(), instrument: text("instrument").notNull(), sourceType: text("source_type").notNull(), audioObjectKey: text("audio_object_key").notNull(), referenceObjectKey: text("reference_object_key").notNull(), license: text("license").notNull(), consentedForTraining: integer("consented_for_training").notNull(), status: text("status").notNull(), createdAt: integer("created_at").notNull(),
});
