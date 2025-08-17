// Memory-safe calendar sync using node-ical with monthly slicing, per-occurrence IDs,
// idempotent upserts, and prune-by-syncMarker. No ical-expander, no giant arrays.

import ical from "node-ical";
import { storage } from "../storage";
import { type InsertCalendarEvent } from "@shared/schema";
import cron from "node-cron";

// ---- Types ----
interface SyncStats {
  totalParsed: number; // occurrences considered
  eventsFound: number; // occurrences discovered in range
  eventsStored: number; // successfully upserted
  eventsSkipped: number; // filtered/excluded
  errors: number; // write failures
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

  // Status snapshot
  private syncStatus = {
    lastSync: null as Date | null,
    syncing: false,
    totalEvents: 0,
    storedEvents: 0,
    error: null as string | null,
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
      cronRunning: !!this.cronJob,
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
      error: null,
    };
    console.info("[CalendarV2] Calendar removed and events cleared");
  }

  // ---- Cron management ----

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
    // Initial sync
    setTimeout(() => void this.syncCalendar(), 1500);
  }

  private stopCronJob() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.info("[CalendarV2] Cron job stopped");
    }
  }

  // ---- Utilities ----

  private makeOccurrenceId(uid: string, start: Date): string {
    // Stable, per-occurrence ID in UTC
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

  private findOverride<T = any>(
    map: Record<string, any> | undefined,
    date: Date,
  ): T | null {
    if (!map) return null;
    const iso = date.toISOString();
    if (map[iso]) return map[iso] as T;
    const icsKey = this.formatICSDateUTC(date);
    if (map[icsKey]) return map[icsKey] as T;
    // Fallback: tolerant compare
    for (const k in map) {
      const kd =
        k.endsWith("Z") && k.includes("T")
          ? this.parseICSKeyUTC(k)
          : new Date(k);
      if (!isNaN(kd?.getTime?.() ?? NaN)) {
        if (Math.abs(kd.getTime() - date.getTime()) < 60000) {
          return map[k] as T;
        }
      }
    }
    return null;
  }

  private parseICSKeyUTC(k: string): Date {
    // Parse YYYYMMDDTHHmmssZ
    const y = Number(k.slice(0, 4));
    const m = Number(k.slice(4, 6)) - 1;
    const d = Number(k.slice(6, 8));
    const hh = Number(k.slice(9, 11));
    const mm = Number(k.slice(11, 13));
    const ss = Number(k.slice(13, 15));
    return new Date(Date.UTC(y, m, d, hh, mm, ss));
    // if parsing fails, Date will be invalid; callers guard with isNaN checks
  }

  private isAllDay(start: Date, end: Date, src: any): boolean {
    if (src?.datetype === "date") return true;
    const ms = end.getTime() - start.getTime();
    const h0 =
      start.getUTCHours() === 0 &&
      start.getUTCMinutes() === 0 &&
      end.getUTCHours() === 0 &&
      end.getUTCMinutes() === 0;
    return h0 && ms % 86400000 === 0;
  }

  private async upsertEvent(ev: InsertCalendarEvent): Promise<void> {
    try {
      await storage.createCalendarEvent(ev); // should be UPSERT in DB impl
    } catch {
      await storage.updateCalendarEvent(ev.id, {
        title: ev.title,
        start: ev.start,
        end: ev.end,
        location: ev.location ?? null,
        description: ev.description ?? null,
        isAllDay: ev.isAllDay,
      } as any);
    }
  }

  // ---- Core sync (node-ical only) ----

  async syncCalendar(): Promise<SyncStats> {
    const stats: SyncStats = {
      totalParsed: 0,
      eventsFound: 0,
      eventsStored: 0,
      eventsSkipped: 0,
      errors: 0,
      startTime: new Date(),
      errorMessages: [],
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
        `[CalendarV2] Sync window ${rangeStart.toISOString()} -> ${rangeEnd.toISOString()}`,
      );

      // Parse ICS directly into objects (node-ical handles fetching + parse)
      const parsed = await ical.fromURL(this.icsUrl, {});
      console.info(
        `[CalendarV2] Parsed ${Object.keys(parsed).length} ICS items`,
      );

      // Mark rows we touch this run so we can prune stale in-range entries
      const touchedIds = new Set<string>();

      // Process one VEVENT at a time, slice-by-slice, then drop references
      const slices = this.monthSlices(rangeStart, rangeEnd);

      for (const key of Object.keys(parsed)) {
        const e: any = parsed[key];
        if (!e || e.type !== "VEVENT") {
          // free ASAP
          delete (parsed as any)[key];
          continue;
        }

        // Base fields
        const baseStart: Date = new Date(e.start);
        const baseEnd: Date = e.end
          ? new Date(e.end)
          : new Date(baseStart.getTime() + 3600000);
        if (isNaN(baseStart.getTime()) || isNaN(baseEnd.getTime())) {
          stats.eventsSkipped++;
          delete (parsed as any)[key];
          continue;
        }
        const durationMs = baseEnd.getTime() - baseStart.getTime();

        // Expand per month slice to bound rrule results
        for (const { start: sliceStart, end: sliceEnd } of slices) {
          // 1) Recurring
          if (e.rrule) {
            // Dates within slice (inclusive). node-ical uses rrule.js under the hood.
            const dates: Date[] = e.rrule.between(sliceStart, sliceEnd, true);
            const exdates = e.exdate || {};
            const recurrences = e.recurrences || {};

            for (const dt of dates) {
              // If there is an overridden instance, use it; if excluded, skip.
              const override = this.findOverride<any>(recurrences, dt);
              if (override) {
                const s = new Date(override.start);
                const en = override.end
                  ? new Date(override.end)
                  : new Date(s.getTime() + durationMs);
                if (s >= sliceStart && s < sliceEnd) {
                  const id = this.makeOccurrenceId(e.uid, s);
                  const record: InsertCalendarEvent = {
                    id,
                    title: override.summary || e.summary || "Untitled Event",
                    start: s,
                    end: en,
                    location: override.location ?? e.location ?? null,
                    description: override.description ?? e.description ?? null,
                    isAllDay: this.isAllDay(s, en, override),
                  };
                  try {
                    await this.upsertEvent(record);
                    touchedIds.add(id);
                    stats.eventsStored++;
                    stats.eventsFound++;
                  } catch (err) {
                    stats.errors++;
                    stats.errorMessages.push(String(err));
                    console.error(
                      "[CalendarV2] Upsert failed (recurrence override):",
                      id,
                      err,
                    );
                  }
                }
                continue;
              }

              // Exdate?
              const excluded = this.findOverride<any>(exdates, dt);
              if (excluded) {
                stats.eventsSkipped++;
                continue;
              }

              // Regular occurrence derived from base
              const s = dt;
              const en = new Date(s.getTime() + durationMs);
              if (s >= sliceStart && s < sliceEnd) {
                const id = this.makeOccurrenceId(e.uid, s);
                const record: InsertCalendarEvent = {
                  id,
                  title: e.summary || "Untitled Event",
                  start: s,
                  end: en,
                  location: e.location ?? null,
                  description: e.description ?? null,
                  isAllDay: this.isAllDay(s, en, e),
                };
                try {
                  await this.upsertEvent(record);
                  touchedIds.add(id);
                  stats.eventsStored++;
                  stats.eventsFound++;
                } catch (err) {
                  stats.errors++;
                  stats.errorMessages.push(String(err));
                  console.error(
                    "[CalendarV2] Upsert failed (rrule occurrence):",
                    id,
                    err,
                  );
                }
              }
            }

            // There may be override instances not returned by rrule.between if moved far.
            // Ensure we pick up any in-slice recurrences explicitly listed.
            for (const k of Object.keys(e.recurrences || {})) {
              const r = e.recurrences[k];
              const s = new Date(r.start);
              const en = r.end
                ? new Date(r.end)
                : new Date(s.getTime() + durationMs);
              if (s >= sliceStart && s < sliceEnd) {
                const id = this.makeOccurrenceId(e.uid, s);
                if (!touchedIds.has(id)) {
                  const record: InsertCalendarEvent = {
                    id,
                    title: r.summary || e.summary || "Untitled Event",
                    start: s,
                    end: en,
                    location: r.location ?? e.location ?? null,
                    description: r.description ?? e.description ?? null,
                    isAllDay: this.isAllDay(s, en, r),
                  };
                  try {
                    await this.upsertEvent(record);
                    touchedIds.add(id);
                    stats.eventsStored++;
                    stats.eventsFound++;
                  } catch (err) {
                    stats.errors++;
                    stats.errorMessages.push(String(err));
                    console.error(
                      "[CalendarV2] Upsert failed (loose override):",
                      id,
                      err,
                    );
                  }
                }
              }
            }
          } else {
            // 2) Non-recurring: write once if in slice
            if (baseStart >= sliceStart && baseStart < sliceEnd) {
              const id = this.makeOccurrenceId(e.uid || key, baseStart);
              const record: InsertCalendarEvent = {
                id,
                title: e.summary || "Untitled Event",
                start: baseStart,
                end: baseEnd,
                location: e.location ?? null,
                description: e.description ?? null,
                isAllDay: this.isAllDay(baseStart, baseEnd, e),
              };
              try {
                await this.upsertEvent(record);
                touchedIds.add(id);
                stats.eventsStored++;
                stats.eventsFound++;
              } catch (err) {
                stats.errors++;
                stats.errorMessages.push(String(err));
                console.error("[CalendarV2] Upsert failed (single):", id, err);
              }
            } else {
              stats.eventsSkipped++;
            }
          }
        } // end slice loop

        // Drop this event from memory ASAP
        delete (parsed as any)[key];
        // @ts-ignore
        if (global.gc) global.gc();
      } // end all events

      // Prune stale rows in-range that we did not touch this run
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
        console.warn("[CalendarV2] Prune failed:", pruneErr);
      }

      this.syncStatus.lastSync = new Date();
      this.syncStatus.totalEvents = stats.eventsFound;
      this.syncStatus.storedEvents = stats.eventsStored;

      console.info(
        `[CalendarV2] Sync done. Stored ${stats.eventsStored}/${stats.eventsFound}. Errors: ${stats.errors}`,
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

  // ---- Query helpers ----

  async getEventsForDate(date: string): Promise<any[]> {
    const events = await storage.getCalendarEvents();
    const target = new Date(date).toDateString();

    return events
      .filter((e) => new Date(e.start).toDateString() === target)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start).toISOString(),
        end: new Date(e.end).toISOString(),
        location: e.location,
        description: e.description,
        isAllDay: e.isAllDay,
      }));
  }

  async getEventsInRange(startDate: Date, endDate: Date): Promise<any[]> {
    const events = await storage.getCalendarEvents();

    return events
      .filter((e) => {
        const s = new Date(e.start);
        return s >= startDate && s <= endDate;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start).toISOString(),
        end: new Date(e.end).toISOString(),
        location: e.location,
        description: e.description,
        isAllDay: e.isAllDay,
      }));
  }
}

// Export singleton instance
export const calendarServiceV2 = new CalendarServiceV2();
