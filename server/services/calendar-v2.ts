// Calendar sync with recurrence expansion (RRULE + EXDATE + RECURRENCE-ID + RDATE),
// low memory (per-event, per-month processing), idempotent upserts, and one-time
// cleanup to purge legacy rows so duplicates don't stick around.
//
// Uses only node-ical (no ical-expander).

/// <reference lib="dom" />
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ical = require("node-ical");
import * as cron from "node-cron";
import { storage } from "../storage";
import { type InsertCalendarEvent } from "@shared/schema";

interface SyncStats {
  totalParsed: number;        // occurrences considered for write
  eventsFound: number;        // occurrences discovered in range
  eventsStored: number;       // successfully upserted
  eventsSkipped: number;      // filtered/malformed/excluded
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
  private readonly pastMonths = 18;
  private readonly futureMonths = 3;

  // Padding around month slices to avoid TZ/DST clipping
  private readonly PAD_HOURS = 36;

  // One-time migration flag key
  private readonly MIGRATION_FLAG = "calendar_v2_migrated";

  // Status snapshot (for UI/debug)
  private syncStatus = {
    lastSync: null as Date | null,
    syncing: false,
    totalEvents: 0,
    storedEvents: 0,
    error: null as string | null
  };

  constructor() {
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

  // ---------- Utilities ----------

  private makeOccurrenceId(uid: string, start: Date): string {
    // Stable, per-occurrence ID
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

  private formatICSDateUTC(d: Date): string {
    // YYYYMMDDTHHmmssZ
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return (
      d.getUTCFullYear().toString() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) +
      "Z"
    );
  }

  private formatICSDateOnlyUTC(d: Date): string {
    // YYYYMMDD
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return d.getUTCFullYear().toString() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
  }

  private parseICSKeyUTC(k: string): Date {
    // supports YYYYMMDD or YYYYMMDDTHHmmssZ
    if (k.length === 8) {
      const y = +k.slice(0, 4), m = +k.slice(4, 6) - 1, d = +k.slice(6, 8);
      return new Date(Date.UTC(y, m, d, 0, 0, 0));
    }
    const y = +k.slice(0, 4), m = +k.slice(4, 6) - 1, d = +k.slice(6, 8);
    const hh = +k.slice(9, 11), mm = +k.slice(11, 13), ss = +k.slice(13, 15);
    return new Date(Date.UTC(y, m, d, hh, mm, ss));
  }

  private findOverride<T = any>(map: Record<string, any> | undefined, date: Date): T | null {
    if (!map) return null;
    // Common key encodings in node-ical
    const iso = date.toISOString();
    if (map[iso]) return map[iso] as T;
    const keyZ = this.formatICSDateUTC(date);
    if (map[keyZ]) return map[keyZ] as T;
    const keyD = this.formatICSDateOnlyUTC(date);
    if (map[keyD]) return map[keyD] as T;
    // Tolerant fallback (within 60s)
    for (const k in map) {
      const kd = k.includes("T") || k.endsWith("Z") ? this.parseICSKeyUTC(k) : new Date(k);
      if (!isNaN(kd.getTime()) && Math.abs(kd.getTime() - date.getTime()) < 60_000) {
        return map[k] as T;
      }
    }
    return null;
  }

  private collectRDates(e: any): Date[] {
    const out: Date[] = [];
    if (!e.rdate) return out;
    const r = e.rdate;
    if (Array.isArray(r)) {
      for (const d of r) out.push(new Date(d));
    } else if (typeof r === "object") {
      for (const k of Object.keys(r)) out.push(this.parseICSKeyUTC(k));
    } else if (r instanceof Date) {
      out.push(new Date(r));
    }
    return out.filter(d => !isNaN(d.getTime()));
  }

  private isAllDay(start: Date, end: Date, src: any): boolean {
    if (src?.datetype === "date") return true;
    const fullDays = (end.getTime() - start.getTime()) % 86_400_000 === 0;
    const midnightUTC =
      start.getUTCHours() === 0 && start.getUTCMinutes() === 0 &&
      end.getUTCHours() === 0 && end.getUTCMinutes() === 0;
    return fullDays && midnightUTC;
  }

  private async upsertEvent(ev: InsertCalendarEvent): Promise<void> {
    try {
      await storage.createCalendarEvent(ev); // DB impl should UPSERT on id
    } catch {
      await storage.updateCalendarEvent(ev.id, {
        title: ev.title,
        start: ev.start,
        end: ev.end,
        location: ev.location ?? null,
        description: ev.description ?? null,
        isAllDay: ev.isAllDay
      } as any);
    }
  }

  private async maybeRunOneTimeCleanup(): Promise<void> {
    // If we’ve never migrated to v2 IDs, nuke the table once to purge legacy rows.
    try {
      const migrated = await storage.getSetting(this.MIGRATION_FLAG);
      if (migrated === "1") return;
      console.info("[CalendarV2] First run on v2: clearing existing calendar rows once");
      await storage.clearCalendarEvents();
      await storage.setSetting(this.MIGRATION_FLAG, "1");
    } catch (e) {
      console.warn("[CalendarV2] Migration flag check failed:", e);
    }
  }

  // ---------- Core sync (node-ical only) ----------

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
      await this.maybeRunOneTimeCleanup();

      const now = new Date();
      const rangeStart = new Date(now);
      rangeStart.setMonth(rangeStart.getMonth() - this.pastMonths);
      const rangeEnd = new Date(now);
      rangeEnd.setMonth(rangeEnd.getMonth() + this.futureMonths);

      console.info(`[CalendarV2] Window ${rangeStart.toISOString()} -> ${rangeEnd.toISOString()}`);

      // Download ICS once
      const res = await fetch(this.icsUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const ics = await res.text();
      console.info(`[CalendarV2] Downloaded ${(ics.length / 1024 / 1024).toFixed(2)} MB of ICS`);

      // Parse ICS into objects
      const parsedCal = ical.parseICS(ics);
      console.info(`[CalendarV2] Parsed ${Object.keys(parsedCal).length} ICS items`);

      // Track rows touched to prune stale ones in-range after the run
      const touchedIds = new Set<string>();

      // Build month slices once
      const slices = this.monthSlices(rangeStart, rangeEnd);

      // Process each VEVENT independently, freeing memory ASAP
      for (const [key, raw] of Object.entries(parsedCal)) {
        const e: any = raw;
        if (!e || e.type !== "VEVENT") {
          delete (parsedCal as any)[key];
          continue;
        }

        const uid: string = e.uid || key;
        const baseStart = new Date(e.start);
        const baseEnd = e.end ? new Date(e.end) : new Date(baseStart.getTime() + 3_600_000);
        if (isNaN(baseStart.getTime()) || isNaN(baseEnd.getTime())) {
          stats.eventsSkipped++;
          delete (parsedCal as any)[key];
          continue;
        }
        const duration = baseEnd.getTime() - baseStart.getTime();

        // Keep a per-event set to avoid duplicates across padded slices
        const seenIds = new Set<string>();

        // Non-recurring
        if (!e.rrule) {
          if (baseStart >= rangeStart && baseStart < rangeEnd) {
            const id = this.makeOccurrenceId(uid, baseStart);
            try {
              await this.upsertEvent({
                id,
                title: e.summary || "Untitled Event",
                start: baseStart,
                end: baseEnd,
                location: e.location ?? null,
                description: e.description ?? null,
                isAllDay: this.isAllDay(baseStart, baseEnd, e)
              });
              touchedIds.add(id);
              stats.eventsStored++; stats.eventsFound++; stats.totalParsed++;
            } catch (err) {
              stats.errors++; stats.errorMessages.push(String(err));
              console.error("[CalendarV2] Upsert failed (single):", id, err);
            }
          } else {
            stats.eventsSkipped++;
          }
          delete (parsedCal as any)[key];
          // @ts-ignore
          if (global.gc) global.gc();
          continue;
        }

        // Recurring: RRULE + EXDATE + RECURRENCE-ID + RDATE
        const exdates = e.exdate || {};
        const recurrences = e.recurrences || {};
        const rdates = this.collectRDates(e);

        for (const { start: sliceStart, end: sliceEnd } of slices) {
          const paddedStart = new Date(sliceStart.getTime() - this.PAD_HOURS * 3_600_000);
          const paddedEnd = new Date(sliceEnd.getTime() + this.PAD_HOURS * 3_600_000);

          // RRULE occurrences in padded window
          const dates: Date[] = e.rrule.between(paddedStart, paddedEnd, true);

          for (const dt of dates) {
            // Override (RECURRENCE-ID)
            const ov = this.findOverride<any>(recurrences, dt);
            const s = ov ? new Date(ov.start) : dt;
            const en = ov ? new Date(ov.end ?? new Date(s.getTime() + duration)) : new Date(s.getTime() + duration);

            // Excluded?
            if (!ov && this.findOverride<any>(exdates, dt)) {
              stats.eventsSkipped++;
              continue;
            }

            if (s >= sliceStart && s < sliceEnd) {
              const id = this.makeOccurrenceId(uid, s);
              if (seenIds.has(id)) continue;
              seenIds.add(id);

              try {
                await this.upsertEvent({
                  id,
                  title: (ov?.summary || e.summary) ?? "Untitled Event",
                  start: s,
                  end: en,
                  location: (ov?.location ?? e.location) ?? null,
                  description: (ov?.description ?? e.description) ?? null,
                  isAllDay: this.isAllDay(s, en, ov ?? e)
                });
                touchedIds.add(id);
                stats.eventsStored++; stats.eventsFound++; stats.totalParsed++;
              } catch (err) {
                stats.errors++; stats.errorMessages.push(String(err));
                console.error("[CalendarV2] Upsert failed (rrule/override):", id, err);
              }
            }
          }

          // Overrides that moved off the rrule grid but fall in this slice
          for (const k of Object.keys(recurrences)) {
            const r = recurrences[k];
            const s = new Date(r.start);
            const en = r.end ? new Date(r.end) : new Date(s.getTime() + duration);
            if (isNaN(s.getTime()) || isNaN(en.getTime())) continue;
            if (s >= sliceStart && s < sliceEnd) {
              const id = this.makeOccurrenceId(uid, s);
              if (seenIds.has(id)) continue;
              seenIds.add(id);

              try {
                await this.upsertEvent({
                  id,
                  title: r.summary ?? e.summary ?? "Untitled Event",
                  start: s,
                  end: en,
                  location: r.location ?? e.location ?? null,
                  description: r.description ?? e.description ?? null,
                  isAllDay: this.isAllDay(s, en, r)
                });
                touchedIds.add(id);
                stats.eventsStored++; stats.eventsFound++; stats.totalParsed++;
              } catch (err) {
                stats.errors++; stats.errorMessages.push(String(err));
                console.error("[CalendarV2] Upsert failed (loose override):", id, err);
              }
            }
          }

          // RDATE additions
          for (const rd of rdates) {
            if (rd >= sliceStart && rd < sliceEnd) {
              if (this.findOverride<any>(exdates, rd)) continue; // cancelled
              const s = rd;
              const en = new Date(s.getTime() + duration);
              const id = this.makeOccurrenceId(uid, s);
              if (seenIds.has(id)) continue;
              seenIds.add(id);

              try {
                await this.upsertEvent({
                  id,
                  title: e.summary ?? "Untitled Event",
                  start: s,
                  end: en,
                  location: e.location ?? null,
                  description: e.description ?? null,
                  isAllDay: this.isAllDay(s, en, e)
                });
                touchedIds.add(id);
                stats.eventsStored++; stats.eventsFound++; stats.totalParsed++;
              } catch (err) {
                stats.errors++; stats.errorMessages.push(String(err));
                console.error("[CalendarV2] Upsert failed (rdate):", id, err);
              }
            }
          }
        }

        // Drop parsed event ASAP
        delete (parsedCal as any)[key];
        // @ts-ignore
        if (global.gc) global.gc();
      }

      // Prune stale rows inside our range that were not touched this run
      try {
        const all = await storage.getCalendarEvents();
        const touched = touchedIds;
        for (const row of all) {
          const s = new Date(row.start);
          if (s >= rangeStart && s < rangeEnd) {
            if (!touched.has(row.id)) {
              await storage.deleteCalendarEvent(row.id);
            }
          }
        }
      } catch (pruneErr) {
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
    const targetDate = new Date(date);
    
    return events
      .filter(e => {
        const eventStart = new Date(e.start);
        
        // For all-day events, compare just the date part (YYYY-MM-DD)
        if (e.isAllDay || (e as any).is_all_day) {
          const eventDateStr = eventStart.toISOString().split('T')[0];
          const targetDateStr = targetDate.toISOString().split('T')[0];
          return eventDateStr === targetDateStr;
        }
        
        // For timed events, use the original date string comparison
        return eventStart.toDateString() === targetDate.toDateString();
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map(e => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start).toISOString(),
        end: new Date(e.end).toISOString(),
        location: e.location,
        description: e.description,
        isAllDay: e.isAllDay ?? (e as any).is_all_day ?? false
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