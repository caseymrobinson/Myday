import * as ical from "node-ical";
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
      
      // Fetch raw iCal data  
      const response = await fetch(this.icsUrl);
      const icalString = await response.text();
      
      // Use ical-expander with limited iterations for memory efficiency
      const icalExpander = new IcalExpander({ ics: icalString, maxIterations: 100 });
      
      // Expand events for a more focused time range to avoid memory issues
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); // 1 month back
      const endDate = new Date(now.getFullYear(), now.getMonth() + 3, 0); // 3 months forward
      
      const expandedEvents = icalExpander.between(startDate, endDate);
      
      // Process both events and occurrences (recurring instances)
      const allExpandedEvents = [
        ...expandedEvents.events,
        ...expandedEvents.occurrences
      ];
      
      stats.eventsFound = allExpandedEvents.length;
      console.log(`[CalendarV2] Expanded events found: ${stats.eventsFound}`);
      
      // Limit events to prevent memory overflow
      const maxEvents = 1000;
      if (stats.eventsFound > maxEvents) {
        console.log(`[CalendarV2] Too many events (${stats.eventsFound}), limiting to ${maxEvents} most recent`);
        allExpandedEvents.sort((a, b) => new Date(a.startDate.toJSDate()).getTime() - new Date(b.startDate.toJSDate()).getTime());
        allExpandedEvents.splice(maxEvents);
        stats.eventsFound = maxEvents;
      }
      
      // Convert to our calendar event format with unique IDs
      const calendarEvents: InsertCalendarEvent[] = allExpandedEvents.map((event, index) => {
        const startDate = new Date(event.startDate.toJSDate());
        const endDate = new Date(event.endDate.toJSDate());
        
        // Create unique ID for each occurrence: original_uid + start_timestamp
        const uniqueId = `${event.uid}_${startDate.getTime()}`;
        
        return {
          id: uniqueId,
          title: event.summary || "Untitled Event", 
          start: startDate,
          end: endDate,
          location: event.location || null,
          description: event.description || null,
          isAllDay: event.isFullDay || false
        };
      });
      
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
      
      // Use upsert approach instead of clear+insert
      const syncTimestamp = new Date();
      
      // Upsert events in smaller batches for memory efficiency
      const batchSize = 20;
      const processedIds = new Set<string>();
      
      for (let i = 0; i < calendarEvents.length; i += batchSize) {
        const batch = calendarEvents.slice(i, i + batchSize);
        
        try {
          for (const event of batch) {
            // Try to update existing event, create if not exists
            const existing = await storage.getCalendarEvent(event.id);
            
            if (existing) {
              await storage.updateCalendarEvent(event.id, event);
            } else {
              await storage.createCalendarEvent(event);
            }
            
            processedIds.add(event.id);
            stats.eventsStored++;
          }
          
          // Log progress every 100 events and trigger garbage collection
          if (stats.eventsStored % 100 === 0) {
            console.log(`[CalendarV2] Progress: ${stats.eventsStored}/${calendarEvents.length} events processed`);
            // Force garbage collection to prevent memory buildup
            if (global.gc) {
              global.gc();
            }
          }
        } catch (error) {
          console.error(`[CalendarV2] Failed to process batch at index ${i}:`, error);
          stats.errors++;
          if (stats.errors <= 5) {
            stats.errorMessages.push(`Failed to process batch at index ${i}: ${error}`);
          }
        }
      }
      
      // Remove events that weren't updated in this sync (stale events)
      const existingEvents = await storage.getCalendarEvents();
      let removedCount = 0;
      for (const existing of existingEvents) {
        if (!processedIds.has(existing.id)) {
          await storage.deleteCalendarEvent(existing.id);
          removedCount++;
        }
      }
      
      console.log(`[CalendarV2] Removed ${removedCount} stale events`);
      
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
      console.log(`[CalendarV2] Expanded events processed: ${stats.eventsFound}`);
      console.log(`[CalendarV2] Events stored/updated: ${stats.eventsStored}`);
      console.log(`[CalendarV2] Stale events removed: ${removedCount}`);
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