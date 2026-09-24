import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  bio: text("bio").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
  ownerEmail: text("owner_email"),
  arrangement: text("arrangement").notNull().default("Solo arrangement"),
  tags: text("tags").notNull().default("[]"),
  description: text("description").notNull().default(""),
  rightsDeclaration: text("rights_declaration").notNull().default("Personal / Educational Use"),
  visibility: text("visibility").notNull().default("public"),
  downloads: integer("downloads").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull().default(0),
  deletedAt: integer("deleted_at"),
});

export const favorites = sqliteTable("favorites", {
  userEmail: text("user_email").notNull(),
  sheetId: integer("sheet_id").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [primaryKey({ columns: [table.userEmail, table.sheetId] })]);

export const recentItems = sqliteTable("recent_items", {
  userEmail: text("user_email").notNull(),
  itemType: text("item_type").notNull(),
  itemId: text("item_id").notNull(),
  viewedAt: integer("viewed_at").notNull(),
}, table => [primaryKey({ columns: [table.userEmail, table.itemType, table.itemId] })]);

export const contentReports = sqliteTable("content_reports", {
  id: text("id").primaryKey(),
  reporterEmail: text("reporter_email").notNull(),
  sheetId: integer("sheet_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("open"),
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
