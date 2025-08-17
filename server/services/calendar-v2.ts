import * as ical from "node-ical";
import { storage } from "../storage";
import { type InsertCalendarEvent } from "@shared/schema";
import cron from "node-cron";
import crypto from "crypto";

interface ParsedEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  isAllDay: boolean;
  recurringId?: string;
  hash: string;
}

interface SyncStats {
  totalParsed: number;
  eventsFound: number;
  eventsStored: number;
  eventsSkipped: number;
  errors: number;
  startTime: Date;
  endTime?: Date;
  errorMessages: string[];
}

export class CalendarServiceV2 {
  private icsUrl: string | null = null;
  private isRunning = false;
  private lastSyncHash: string | null = null;
  private cronJob: any = null; // cron.ScheduledTask
  private syncStatus = {
    lastSync: null as Date | null,
    syncing: false,
    totalEvents: 0,
    storedEvents: 0,
    error: null as string | null
  };

  constructor() {
    this.initializeCalendarUrl();
  }

  private async initializeCalendarUrl() {
    try {
      const storedUrl = await storage.getSetting('calendar_url');
      if (storedUrl) {
        this.icsUrl = storedUrl;
        console.log('[CalendarV2] Loaded calendar URL from database');
        // Start cron job if URL exists
        this.startCronJob();
      }
    } catch (error) {
      console.error('[CalendarV2] Failed to initialize:', error);
    }
  }

  async setIcsUrl(url: string): Promise<void> {
    console.log('[CalendarV2] Setting new calendar URL');
    this.icsUrl = url;
    await storage.setSetting('calendar_url', url);
    
    // Restart cron job with new URL
    this.stopCronJob();
    this.startCronJob();
    
    // Trigger immediate sync
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
    console.log('[CalendarV2] Removing calendar');
    this.icsUrl = null;
    this.stopCronJob();
    
    await storage.setSetting('calendar_url', '');
    await storage.clearCalendarEvents();
    
    console.log('[CalendarV2] Calendar removed and events cleared');
  }

  private startCronJob() {
    if (!this.icsUrl) return;
    
    // Stop existing job if any
    this.stopCronJob();
    
    // Run every 15 minutes
    this.cronJob = cron.schedule("*/15 * * * *", async () => {
      if (this.icsUrl && !this.isRunning) {
        console.log('[CalendarV2] Starting scheduled sync');
        await this.syncCalendar();
      }
    });
    
    console.log('[CalendarV2] Cron job started');
    
    // Initial sync after 2 seconds
    setTimeout(() => {
      if (this.icsUrl) {
        this.syncCalendar();
      }
    }, 2000);
  }

  private stopCronJob() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('[CalendarV2] Cron job stopped');
    }
  }

  private generateEventHash(event: any): string {
    const data = `${event.uid}-${event.summary}-${event.start}-${event.end}-${event.location}-${event.description}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private parseICalEvent(key: string, event: any): ParsedEvent | null {
    try {
      // Only process VEVENT types
      if (event.type !== 'VEVENT') {
        return null;
      }

      // Must have start date
      if (!event.start) {
        return null;
      }

      const start = new Date(event.start);
      const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60 * 1000); // Default 1 hour

      // Validate dates
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return null;
      }

      // Check if all-day event
      const isAllDay = !!(
        event.datetype === 'date' ||
        (start.getHours() === 0 && start.getMinutes() === 0 && 
         end.getHours() === 0 && end.getMinutes() === 0)
      );

      return {
        uid: event.uid || key,
        title: event.summary || "Untitled Event",
        start,
        end,
        location: event.location || undefined,
        description: event.description || undefined,
        isAllDay,
        recurringId: event.recurrenceid || undefined,
        hash: this.generateEventHash(event)
      };
    } catch (error) {
      console.error(`[CalendarV2] Error parsing event ${key}:`, error);
      return null;
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
      stats.errorMessages.push('Sync already running or no URL configured');
      return stats;
    }

    this.isRunning = true;
    
    try {
      console.log(`[CalendarV2] Fetching calendar from: ${this.icsUrl}`);
      console.log(`[CalendarV2] Sync started at: ${stats.startTime.toISOString()}`);
      
      // Fetch and parse iCal data
      const rawData = await ical.fromURL(this.icsUrl);
      stats.totalParsed = Object.keys(rawData).length;
      
      console.log(`[CalendarV2] Total objects in iCal file: ${stats.totalParsed}`);
      
      // Parse all events
      const parsedEvents: ParsedEvent[] = [];
      
      for (const [key, value] of Object.entries(rawData)) {
        const parsed = this.parseICalEvent(key, value);
        if (parsed) {
          parsedEvents.push(parsed);
          stats.eventsFound++;
        }
      }
      
      console.log(`[CalendarV2] Valid events found: ${stats.eventsFound}`);
      
      // Calculate hash of all events to detect changes
      const currentHash = crypto.createHash('md5')
        .update(parsedEvents.map(e => e.hash).sort().join('-'))
        .digest('hex');
      
      // Check if data has changed
      if (this.lastSyncHash === currentHash) {
        console.log('[CalendarV2] No changes detected, skipping database update');
        stats.eventsSkipped = stats.eventsFound;
        stats.endTime = new Date();
        return stats;
      }
      
      console.log('[CalendarV2] Changes detected, updating database');
      
      // Clear existing events and insert new ones in a transaction-like manner
      await storage.clearCalendarEvents();
      console.log('[CalendarV2] Cleared existing events');
      
      // Prepare all events for bulk insert
      const calendarEvents: InsertCalendarEvent[] = parsedEvents.map(event => ({
        id: event.uid,
        title: event.title,
        start: event.start,
        end: event.end,
        location: event.location || null,
        description: event.description || null,
        isAllDay: event.isAllDay
      }));
      
      // Bulk insert in batches to avoid overwhelming the database
      const batchSize = 100;
      for (let i = 0; i < calendarEvents.length; i += batchSize) {
        const batch = calendarEvents.slice(i, i + batchSize);
        try {
          // Insert batch
          for (const event of batch) {
            await storage.createCalendarEvent(event);
            stats.eventsStored++;
          }
          
          // Log progress every 500 events
          if (stats.eventsStored % 500 === 0) {
            console.log(`[CalendarV2] Progress: ${stats.eventsStored}/${calendarEvents.length} events stored`);
          }
        } catch (error) {
          stats.errors++;
          if (stats.errors <= 5) {
            stats.errorMessages.push(`Failed to store batch at index ${i}: ${error}`);
          }
        }
      }
      
      // Update last sync hash
      this.lastSyncHash = currentHash;
      
      // Update sync status
      this.syncStatus.lastSync = new Date();
      this.syncStatus.totalEvents = stats.eventsFound;
      this.syncStatus.storedEvents = stats.eventsStored;
      this.syncStatus.syncing = false;
      this.syncStatus.error = null;
      
      // Log summary
      console.log('[CalendarV2] ============ SYNC SUMMARY ============');
      console.log(`[CalendarV2] Total objects parsed: ${stats.totalParsed}`);
      console.log(`[CalendarV2] Valid events found: ${stats.eventsFound}`);
      console.log(`[CalendarV2] Events stored: ${stats.eventsStored}`);
      console.log(`[CalendarV2] Storage errors: ${stats.errors}`);
      console.log('[CalendarV2] ======================================');
      
    } catch (error) {
      console.error('[CalendarV2] Sync failed:', error);
      stats.errors++;
      stats.errorMessages.push(`Sync failed: ${error}`);
      this.syncStatus.error = `Sync failed: ${error}`;
    } finally {
      this.isRunning = false;
      this.syncStatus.syncing = false;
      stats.endTime = new Date();
      const duration = (stats.endTime.getTime() - stats.startTime.getTime()) / 1000;
      console.log(`[CalendarV2] Sync completed in ${duration.toFixed(2)} seconds`);
    }
    
    return stats;
  }

  async getEventsForDate(date: string): Promise<any[]> {
    const events = await storage.getCalendarEvents();
    const targetDate = new Date(date);
    const targetDateStr = targetDate.toDateString();
    
    return events
      .filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.toDateString() === targetDateStr;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map(event => ({
        id: event.id,
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        location: event.location,
        description: event.description,
        isAllDay: event.isAllDay
      }));
  }

  async getEventsInRange(startDate: Date, endDate: Date): Promise<any[]> {
    const events = await storage.getCalendarEvents();
    
    return events
      .filter(event => {
        const eventStart = new Date(event.start);
        return eventStart >= startDate && eventStart <= endDate;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .map(event => ({
        id: event.id,
        title: event.title,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        location: event.location,
        description: event.description,
        isAllDay: event.isAllDay
      }));
  }

  async getSyncStatus(): Promise<{ 
    isRunning: boolean; 
    lastSyncHash: string | null; 
    eventCount: number;
    url: string | null;
  }> {
    const events = await storage.getCalendarEvents();
    return {
      isRunning: this.isRunning,
      lastSyncHash: this.lastSyncHash,
      eventCount: events.length,
      url: this.icsUrl
    };
  }
}

// Export singleton instance
export const calendarServiceV2 = new CalendarServiceV2();