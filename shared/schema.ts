import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  source: text("source", { enum: ['manual', 'slack', 'ai'] }).notNull().default('manual'),
  status: text("status", { enum: ['pending', 'confirmed', 'done'] }).notNull().default('pending'),
  priority: integer("priority").notNull().default(2), // 1=low, 2=medium, 3=high
  dueAt: timestamp("due_at"),
  estimateMins: integer("estimate_mins").default(30),
  url: text("url"),
  context: json("context"),
  aiSuggested: boolean("ai_suggested").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`)
});

export const focusBlocks = pgTable("focus_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taskId: varchar("task_id").references(() => tasks.id).notNull(),
  start: timestamp("start").notNull(),
  end: timestamp("end").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`)
});

export const calendarEvents = pgTable("calendar_events", {
  id: varchar("id").primaryKey(),
  title: text("title").notNull(),
  start: timestamp("start").notNull(),
  end: timestamp("end").notNull(),
  location: text("location"),
  description: text("description"),
  isAllDay: boolean("is_all_day").notNull().default(false),
  lastSync: timestamp("last_sync").notNull().default(sql`now()`)
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertFocusBlockSchema = createInsertSchema(focusBlocks).omit({
  id: true,
  createdAt: true
});

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  lastSync: true
});

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;
export type InsertFocusBlock = z.infer<typeof insertFocusBlockSchema>;
export type FocusBlock = typeof focusBlocks.$inferSelect;
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEvents.$inferSelect;

// API response types
export const agendaResponseSchema = z.object({
  meetings: z.array(z.object({
    id: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    location: z.string().optional(),
    description: z.string().optional(),
    isAllDay: z.boolean()
  })),
  freeBlocks: z.array(z.object({
    start: z.string(),
    end: z.string()
  })),
  focusBlocks: z.array(z.object({
    id: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    start: z.string(),
    end: z.string(),
    confirmed: z.boolean()
  })),
  topTasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    priority: z.number(),
    estimateMins: z.number().nullable(),
    dueAt: z.string().nullable(),
    source: z.string(),
    aiSuggested: z.boolean()
  })),
  suggestions: z.array(z.object({
    taskId: z.string(),
    taskTitle: z.string(),
    start: z.string(),
    end: z.string(),
    estimateMins: z.number()
  }))
});

export type AgendaResponse = z.infer<typeof agendaResponseSchema>;

export const chatMessageSchema = z.object({
  message: z.string().min(1)
});

export const slackIngestSchema = z.object({
  text: z.string().min(1),
  url: z.string().optional(),
  ts: z.string().optional()
});
