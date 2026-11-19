import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const labPresets = pgTable("lab_presets_v2", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  fingerprint: text("fingerprint").notNull(),
  content: jsonb("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const labExtensions = pgTable("lab_extensions_v2", {
  id: integer("id").primaryKey(),
  dynamic: boolean("dynamic").notNull().default(false),
  depth: real("depth").notNull().default(0.55),
  ms: boolean("ms").notNull().default(false),
});

export const labState = pgTable("lab_state_v2", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default("Synthetic Session 01"),
  take: text("take").notNull().default("reference"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export const labHistory = pgTable("lab_history_v2", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  take: text("take").notNull(),
  score: real("score").notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Synthetic Mix Session"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  mixReadinessScore: real("mix_readiness_score").default(0),
  iterations: integer("iterations").default(0),
});

export const tracks = pgTable("tracks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#00e5ff"),
  description: text("description").default(""),
  isMuted: boolean("is_muted").default(false),
  isSolo: boolean("is_solo").default(false),
  volumeDb: real("volume_db").default(0),
  phaseShiftDeg: real("phase_shift_deg").default(0),
});

export const eqBands = pgTable("eq_bands", {
  id: serial("id").primaryKey(),
  trackId: integer("track_id")
    .notNull()
    .references(() => tracks.id),
  freq: real("freq").notNull(),
  gainDb: real("gain_db").notNull(),
  q: real("q").notNull().default(1),
  type: text("type").notNull().default("peaking"),
});

export const analysisRuns = pgTable("analysis_runs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id),
  label: text("label").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentLogs = pgTable("agent_logs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessions.id),
  iteration: integer("iteration").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  scoreBefore: real("score_before"),
  scoreAfter: real("score_after"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Listener tonal anchors per channel: analysis targets, never rendered as processing.
export const labAnchors = pgTable("lab_anchors_v2", {
  channelId: text("channel_id").primaryKey(),
  anchors: jsonb("anchors").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
