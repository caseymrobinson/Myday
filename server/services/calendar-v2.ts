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

  private expandEventInstances(event: any, startDate: Date, endDate: Date): InsertCalendarEvent[] {
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
        if (eventStart >= startDate && eventStart <= endDate) {
          return [{
            id: `${baseUid}_${eventStart.getTime()}`,
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
      
      // Simple recurring event expansion (weekly meetings only to avoid complexity)
      const instances: InsertCalendarEvent[] = [];
      if (event.rrule.freq === 'WEEKLY') {
        let currentDate = new Date(eventStart);
        const duration = eventEnd.getTime() - eventStart.getTime();
        let instanceCount = 0;
        const maxInstances = 50; // Limit instances per event
        
        while (currentDate <= endDate && instanceCount < maxInstances) {
          if (currentDate >= startDate) {
            const instanceEnd = new Date(currentDate.getTime() + duration);
            instances.push({
              id: `${baseUid}_${currentDate.getTime()}`,
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
      } else if (eventStart >= startDate && eventStart <= endDate) {
        // For other recurrence types, just add the base event
        instances.push({
          id: `${baseUid}_${eventStart.getTime()}`,
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
      
      // Use hybrid approach: node-ical parsing + selective recurrence expansion
      console.log('[CalendarV2] Parsing iCal data with selective expansion...');
      const parsedCal = ical.parseICS(icalString);
      console.log(`[CalendarV2] Found ${Object.keys(parsedCal).length} calendar items`);
      
      const now = new Date();
      // Past 3 months and future 6 months for reasonable coverage
      const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 7, 0);
      
      const calendarEvents: InsertCalendarEvent[] = [];
      let processedCount = 0;
      const maxEvents = 1500; // Higher limit since we're managing memory better
      
      // Process events with selective recurrence expansion
      for (const [key, event] of Object.entries(parsedCal)) {
        if (processedCount >= maxEvents) {
          console.log(`[CalendarV2] Reached maximum event limit (${maxEvents}), stopping`);
          break;
        }
        
        if (event.type !== 'VEVENT') continue;
        
        const expandedEvents = this.expandEventInstances(event, startDate, endDate);
        for (const expandedEvent of expandedEvents) {
          if (processedCount >= maxEvents) break;
          calendarEvents.push(expandedEvent);
          processedCount++;
        }
        
        // Memory management
        if (processedCount % 100 === 0 && global.gc) {
          global.gc();
        }
      }
      
      console.log(`[CalendarV2] Processed ${processedCount} events with selective expansion`);
      
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
      const batchSize = 100;
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