// Calendar sync with recurrence expansion, low memory, and idempotent writes.

/// <reference lib="dom" />
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ical = require("node-ical");
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

  private expandRecurringEvent(event: any, rangeStart: Date, rangeEnd: Date): InsertCalendarEvent[] {
    try {
      if (!event.start) return [];

      const eventStart = new Date(event.start);
      const eventEnd = event.end ? new Date(event.end) : new Date(eventStart.getTime() + 60 * 60 * 1000);
      
      // Validate dates
      if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
        return [];
      }

      const baseUid = event.uid || 'unknown';
      const isAllDay = !!(
        event.datetype === 'date' ||
        (eventStart.getHours() === 0 && eventStart.getMinutes() === 0 && 
         eventEnd.getHours() === 0 && eventEnd.getMinutes() === 0)
      );

      // If no recurrence, just add single event if in range
      if (!event.rrule) {
        if (eventStart >= rangeStart && eventStart <= rangeEnd) {
          return [{
            id: this.makeOccurrenceId(baseUid, eventStart),
            title: event.summary || "Untitled Event",
            start: eventStart,
            end: eventEnd,
            location: event.location || null,
            description: event.description || null,
            isAllDay
          }];
        }
        return [];
      }

      // Simple recurring event expansion (weekly meetings only)
      const instances: InsertCalendarEvent[] = [];
      if (event.rrule.freq === 'WEEKLY') {
        let currentDate = new Date(eventStart);
        const duration = eventEnd.getTime() - eventStart.getTime();
        let instanceCount = 0;
        const maxInstances = 100; // Limit instances per event

        while (currentDate <= rangeEnd && instanceCount < maxInstances) {
          if (currentDate >= rangeStart) {
            const instanceEnd = new Date(currentDate.getTime() + duration);
            instances.push({
              id: this.makeOccurrenceId(baseUid, currentDate),
              title: event.summary || "Untitled Event",
              start: new Date(currentDate),
              end: instanceEnd,
              location: event.location || null,
              description: event.description || null,
              isAllDay
            });
            instanceCount++;
          }
          // Move to next week
          currentDate.setDate(currentDate.getDate() + 7);
        }
      } else if (eventStart >= rangeStart && eventStart <= rangeEnd) {
        // For other recurrence types, just add the base event
        instances.push({
          id: this.makeOccurrenceId(baseUid, eventStart),
          title: event.summary || "Untitled Event",
          start: eventStart,
          end: eventEnd,
          location: event.location || null,
          description: event.description || null,
          isAllDay
        });
      }

      return instances;
    } catch (error) {
      console.error(`[CalendarV2] Error expanding event:`, error);
      return [];
    }
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

      // Parse with memory-efficient node-ical
      const parsedCal = ical.parseICS(ics);
      console.info(`[CalendarV2] Parsed ${Object.keys(parsedCal).length} calendar objects`);

      // We track what we touched so we can prune stale rows in-range
      const touchedIds = new Set<string>();

      // Process each calendar object
      let processedCount = 0;
      const maxEvents = 1000; // Conservative limit for memory

      for (const [key, event] of Object.entries(parsedCal)) {
        if (processedCount >= maxEvents) {
          console.info(`[CalendarV2] Reached maximum event limit (${maxEvents}), stopping`);
          break;
        }

        if (event.type !== 'VEVENT') continue;

        // Expand recurring events using custom logic
        const expandedEvents = this.expandRecurringEvent(event, rangeStart, rangeEnd);
        
        for (const expandedEvent of expandedEvents) {
          if (processedCount >= maxEvents) break;
          
          try {
            await this.upsertEvent(expandedEvent);
            touchedIds.add(expandedEvent.id);
            stats.eventsStored++;
            stats.eventsFound++;
            stats.totalParsed++;
            processedCount++;
          } catch (err) {
            stats.errors++;
            stats.errorMessages.push(String(err));
            console.error("[CalendarV2] Upsert failed:", expandedEvent.id, err);
          }
        }

        // Memory management
        if (processedCount % 50 === 0 && global.gc) {
          global.gc();
        }
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