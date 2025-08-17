import ical from "node-ical";
// @ts-ignore - No type definitions available
import IcalExpander from "ical-expander";
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
    // Initialize calendar URL but don't start cron job automatically
    this.initializeCalendarUrl();
  }

  private async initializeCalendarUrl() {
    try {
      const storedUrl = await storage.getSetting('calendar_url');
      if (storedUrl) {
        this.icsUrl = storedUrl;
        console.log('[CalendarV2] Loaded calendar URL from database');
        // Don't auto-start cron job to prevent startup crashes
        // this.startCronJob();
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
      
      // Fetch raw iCal data with size limit
      const response = await fetch(this.icsUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Log content size for monitoring
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        console.log(`[CalendarV2] Calendar file size: ${Math.round(parseInt(contentLength) / 1024 / 1024)}MB`);
      }
      
      const icalString = await response.text();
      console.log(`[CalendarV2] Downloaded ${Math.round(icalString.length / 1024)}KB of iCal data`);
      
      // Use simple node-ical parser instead of ical-expander for memory efficiency
      console.log('[CalendarV2] Parsing iCal data...');
      const parsedCal = ical.parseICS(icalString);
      console.log(`[CalendarV2] Found ${Object.keys(parsedCal).length} calendar items`);
      
      const now = new Date();
      // Past 9 months and future 3 months from today  
      const startDate = new Date(now.getFullYear(), now.getMonth() - 9, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 4, 0);
      
      const calendarEvents: InsertCalendarEvent[] = [];
      let processedCount = 0;
      const maxEvents = 500; // Increased limit for better coverage
      
      // Process events one by one to avoid memory buildup
      for (const [key, event] of Object.entries(parsedCal)) {
        if (processedCount >= maxEvents) {
          console.log(`[CalendarV2] Reached maximum event limit (${maxEvents}), stopping`);
          break;
        }
        
        const parsedEvent = this.parseICalEvent(key, event);
        if (!parsedEvent) continue;
        
        // Only include events that actually occur within our time range
        const isInTimeRange = parsedEvent.start >= startDate && parsedEvent.start <= endDate;
        
        if (isInTimeRange) {
          calendarEvents.push({
            id: parsedEvent.uid,
            title: parsedEvent.title,
            start: parsedEvent.start,
            end: parsedEvent.end,
            location: parsedEvent.location || null,
            description: parsedEvent.description || null,
            isAllDay: parsedEvent.isAllDay
          });
          processedCount++;
        }
        
        // Free memory every 50 events
        if (processedCount % 50 === 0 && global.gc) {
          global.gc();
        }
      }
      
      stats.eventsFound = calendarEvents.length;
      console.log(`[CalendarV2] Processed ${stats.eventsFound} events from calendar`);
      console.log(`[CalendarV2] Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      console.log(`[CalendarV2] Total processed: ${processedCount} events checked`);
      
      // Calculate hash for change detection
      const currentHash = crypto.createHash('md5')
        .update(calendarEvents.map(e => `${e.id}-${e.title}-${e.start.getTime()}`).sort().join('|'))
        .digest('hex');
      
      // Check if data has changed
      if (this.lastSyncHash === currentHash) {
        console.log('[CalendarV2] No changes detected, skipping database update');
        stats.eventsSkipped = stats.eventsFound;
        stats.endTime = new Date();
        return stats;
      }
      
      console.log('[CalendarV2] Changes detected, updating database');
      
      // Clear existing events and insert new ones (simpler approach for fewer events)
      console.log('[CalendarV2] Clearing existing events...');
      await storage.clearCalendarEvents();
      console.log('[CalendarV2] Existing events cleared, inserting new events...');
      
      // Insert events in small batches
      const batchSize = 10;
      let processed = 0;
      
      for (let i = 0; i < calendarEvents.length; i += batchSize) {
        const batch = calendarEvents.slice(i, i + batchSize);
        
        try {
          for (const event of batch) {
            await storage.createCalendarEvent(event);
            processed++;
          }
          
          console.log(`[CalendarV2] Progress: ${processed}/${calendarEvents.length} events stored`);
          
          // Trigger garbage collection every batch
          if (global.gc) {
            global.gc();
          }
        } catch (error) {
          console.error(`[CalendarV2] Failed to store batch:`, error);
          stats.errors++;
          stats.errorMessages.push(`Failed to store batch: ${error}`);
        }
      }
      
      stats.eventsStored = processed;
      
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
      console.log(`[CalendarV2] Events processed: ${stats.eventsFound}`);
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


}

// Export singleton instance
export const calendarServiceV2 = new CalendarServiceV2();