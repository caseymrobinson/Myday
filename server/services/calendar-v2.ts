// Calendar sync with recurrence expansion, low memory, and idempotent writes.

/// <reference lib="dom" />
// @ts-ignore - No type definitions available
import IcalExpander from "ical-expander";
import { storage } from "../storage";
import { type InsertCalendarEvent } from "@shared/schema";
import * as cron from "node-cron";

interface SyncStats {
  totalParsed: number;        // occurrences considered for write
  eventsFound: number;        // occurrences discovered in range
  eventsStored: number;       // successfully upserted
  eventsSkipped: number;      // filtered or malformed
  errors: number;             // write failures
  startTime: Date;
  endTime?: Date;
  errorMessages: string[];
}

export class CalendarServiceV2 {
  private icsUrl: string | null = null;
  private isRunning = false;
  private cronJob: cron.ScheduledTask | null = null;

  // Range config
  private readonly pastMonths = 9;
  private readonly futureMonths = 3;

  // Status snapshot (for UI/debug)
  private syncStatus = {
    lastSync: null as Date | null,
    syncing: false,
    totalEvents: 0,
    storedEvents: 0,
    error: null as string | null
  };

  constructor() {
    // Ensure URL is loaded before starting a cron or first sync
    void this.initializeCalendarUrl().then(() => this.startCronJob());
  }

  private async initializeCalendarUrl() {
    try {
      const storedUrl = await storage.getSetting("calendar_url");
      if (storedUrl) {
        this.icsUrl = storedUrl;
        console.info("[CalendarV2] Loaded calendar URL from settings");
      }
    } catch (error) {
      console.error("[CalendarV2] Failed to initialize URL:", error);
    }
  }

  async setIcsUrl(url: string): Promise<void> {
    this.icsUrl = url;
    await storage.setSetting("calendar_url", url);
    this.restartCron();
    await this.syncCalendar();
  }

  getIcsUrl(): string | null {
    return this.icsUrl;
  }

  async getSyncStatus() {
    const dbEvents = await storage.getCalendarEvents();
    return {
      ...this.syncStatus,
      dbEvents: dbEvents.length,
      hasUrl: !!this.icsUrl,
      cronRunning: !!this.cronJob
    };
  }

  async removeCalendar(): Promise<void> {
    this.icsUrl = null;
    this.stopCronJob();
    await storage.setSetting("calendar_url", "");
    await storage.clearCalendarEvents();
    this.syncStatus = {
      lastSync: new Date(),
      syncing: false,
      totalEvents: 0,
      storedEvents: 0,
      error: null
    };
    console.info("[CalendarV2] Calendar removed and events cleared");
  }

  // ---------- Cron management ----------

  private restartCron() {
    this.stopCronJob();
    this.startCronJob();
  }

  private startCronJob() {
    if (!this.icsUrl) return;

    // Run every 15 minutes
    this.cronJob = cron.schedule("*/15 * * * *", async () => {
      if (this.icsUrl && !this.isRunning) {
        console.info("[CalendarV2] Starting scheduled sync");
        await this.syncCalendar();
      }
    });

    console.info("[CalendarV2] Cron job started");
    // Initial sync shortly after startup
    setTimeout(() => void this.syncCalendar(), 1500);
  }

  private stopCronJob() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.info("[CalendarV2] Cron job stopped");
    }
  }

  // ---------- Core sync ----------

  private makeOccurrenceId(uid: string, start: Date): string {
    // Stable, per-occurrence ID; normalize with ISO-UTC
    return `${uid}::${start.toISOString()}`;
  }

  private monthSlices(from: Date, to: Date): Array<{ start: Date; end: Date }> {
    const slices: Array<{ start: Date; end: Date }> = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const endCap = new Date(to.getFullYear(), to.getMonth(), 1);

    while (cursor <= endCap) {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      slices.push({ start, end });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return slices;
  }

  private isAllDayFromExpander(obj: any): boolean {
    // ical-expander exposes ICAL.Time via startDate; all-day events have isDate === true
    return !!(obj?.startDate?.isDate === true);
  }

  private async upsertEvent(ev: InsertCalendarEvent): Promise<void> {
    try {
      await storage.createCalendarEvent(ev); // should be an UPSERT in DB storage
    } catch (e) {
      // Fallback: if storage lacks UPSERT, try update
      try {
        await storage.updateCalendarEvent(ev.id, {
          title: ev.title,
          start: ev.start,
          end: ev.end,
          location: ev.location ?? null,
          description: ev.description ?? null,
          isAllDay: ev.isAllDay
        } as any);
      } catch (e2) {
        throw e2;
      }
    }
  }

  async syncCalendar(): Promise<SyncStats> {
    const stats: SyncStats = {
      totalParsed: 0,
      eventsFound: 0,
      eventsStored: 0,
      eventsSkipped: 0,
      errors: 0,
      startTime: new Date(),
      errorMessages: []
    };

    if (!this.icsUrl || this.isRunning) {
      stats.errorMessages.push("Sync already running or no URL configured");
      return stats;
    }

    this.isRunning = true;
    this.syncStatus.syncing = true;
    this.syncStatus.error = null;

    try {
      const now = new Date();
      const rangeStart = new Date(now);
      rangeStart.setMonth(rangeStart.getMonth() - this.pastMonths);
      const rangeEnd = new Date(now);
      rangeEnd.setMonth(rangeEnd.getMonth() + this.futureMonths);

      console.info(
        `[CalendarV2] Sync window ${rangeStart.toISOString()} -> ${rangeEnd.toISOString()}`
      );

      // Download ICS once
      const res = await fetch(this.icsUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const ics = await res.text();
      console.info(`[CalendarV2] Downloaded ${(ics.length / 1024 / 1024).toFixed(2)} MB of ICS`);

      // Prepare expander once; expand in month slices to keep memory flat
      const expander = new IcalExpander({ ics, maxIterations: 1000000 });

      // We track what we touched so we can prune stale rows in-range
      const touchedIds = new Set<string>();

      // Expand and write per slice
      for (const slice of this.monthSlices(rangeStart, rangeEnd)) {
        const { events, occurrences } = expander.between(slice.start, slice.end);

        // Non-recurring events that fall in this window
        for (const e of events) {
          const start = e.startDate.toJSDate();
          const end = e.endDate.toJSDate();
          const id = this.makeOccurrenceId(e.uid, start);

          const record: InsertCalendarEvent = {
            id,
            title: e.summary || "Untitled Event",
            start,
            end,
            location: e.location ?? null,
            description: e.description ?? null,
            isAllDay: this.isAllDayFromExpander(e)
          };

          try {
            await this.upsertEvent(record);
            touchedIds.add(id);
            stats.eventsStored++;
            stats.eventsFound++;
            stats.totalParsed++;
          } catch (err) {
            stats.errors++;
            stats.errorMessages.push(String(err));
            console.error("[CalendarV2] Upsert failed (single):", id, err);
          }
        }

        // Recurring occurrences in this window (exceptions folded in)
        for (const o of occurrences) {
          const start = o.startDate.toJSDate();
          const end = o.endDate.toJSDate();
          const id = this.makeOccurrenceId(o.item.uid, start);

          const record: InsertCalendarEvent = {
            id,
            title: o.item.summary || "Untitled Event",
            start,
            end,
            location: o.item.location ?? null,
            description: o.item.description ?? null,
            isAllDay: this.isAllDayFromExpander(o)
          };

          try {
            await this.upsertEvent(record);
            touchedIds.add(id);
            stats.eventsStored++;
            stats.eventsFound++;
            stats.totalParsed++;
          } catch (err) {
            stats.errors++;
            stats.errorMessages.push(String(err));
            console.error("[CalendarV2] Upsert failed (occurrence):", id, err);
          }
        }

        // Release slice arrays and nudge GC if available
        (events as any).length = 0;
        (occurrences as any).length = 0;
        // @ts-ignore
        if (global.gc) global.gc();
      }

      // Prune stale rows that are inside our range but were not touched this run
      try {
        const all = await storage.getCalendarEvents();
        for (const row of all) {
          const s = new Date(row.start);
          if (s >= rangeStart && s < rangeEnd) {
            if (!touchedIds.has(row.id)) {
              await storage.deleteCalendarEvent(row.id);
            }
          }
        }
      } catch (pruneErr) {
        // Non-fatal; log and continue
        console.warn("[CalendarV2] Prune failed:", pruneErr);
      }

      this.syncStatus.lastSync = new Date();
      this.syncStatus.totalEvents = stats.eventsFound;
      this.syncStatus.storedEvents = stats.eventsStored;

      console.info(
        `[CalendarV2] Sync done. Stored ${stats.eventsStored}/${stats.eventsFound}. Errors: ${stats.errors}`
      );
    } catch (error) {
      stats.errors++;
      stats.errorMessages.push(String(error));
      this.syncStatus.error = String(error);
      console.error("[CalendarV2] Sync failed:", error);
    } finally {
      this.isRunning = false;
      this.syncStatus.syncing = false;
      stats.endTime = new Date();
      const sec = (stats.endTime.getTime() - stats.startTime.getTime()) / 1000;
      console.info(`[CalendarV2] Sync completed in ${sec.toFixed(2)}s`);
    }

    return stats;
  }

  // ---------- Query helpers for the UI ----------

  async getEventsForDate(date: string): Promise<any[]> {
    const events = await storage.getCalendarEvents();
    const target = new Date(date).toDateString();

    return events
      .filter(e => new Date(e.start).toDateString() === target)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map(e => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start).toISOString(),
        end: new Date(e.end).toISOString(),
        location: e.location,
        description: e.description,
        isAllDay: e.isAllDay
      }));
  }

  async getEventsInRange(startDate: Date, endDate: Date): Promise<any[]> {
    const events = await storage.getCalendarEvents();

    return events
      .filter(e => {
        const s = new Date(e.start);
        return s >= startDate && s <= endDate;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map(e => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start).toISOString(),
        end: new Date(e.end).toISOString(),
        location: e.location,
        description: e.description,
        isAllDay: e.isAllDay
      }));
  }
}

// Export singleton instance
export const calendarServiceV2 = new CalendarServiceV2();