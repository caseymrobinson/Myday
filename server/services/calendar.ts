import * as ical from "node-ical";
import { storage } from "../storage";
import { type InsertCalendarEvent } from "@shared/schema";
import cron from "node-cron";

interface ICalEvent {
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  description?: string;
  type: string;
}

export class CalendarService {
  private icsUrl: string | null;
  private isRunning = false;

  constructor() {
    this.icsUrl = null;
    this.initializeCalendarUrl();
    this.startCronJob();
  }

  private async initializeCalendarUrl() {
    // Try to load URL from database settings first, then fall back to env
    try {
      const storedUrl = await storage.getSetting('calendar_url');
      if (storedUrl) {
        this.icsUrl = storedUrl;
        console.log('Loaded calendar URL from database');
      } else if (process.env.ICS_URL) {
        this.icsUrl = process.env.ICS_URL;
        // Save it to the database for persistence
        await storage.setSetting('calendar_url', this.icsUrl);
        console.log('Loaded calendar URL from environment and saved to database');
      }
    } catch (error) {
      console.error('Failed to initialize calendar URL:', error);
      this.icsUrl = process.env.ICS_URL || null;
    }
  }

  async setIcsUrl(url: string) {
    this.icsUrl = url;
    // Save to database for persistence
    await storage.setSetting('calendar_url', url);
    // Trigger immediate sync after setting URL
    this.syncCalendar();
  }
  
  getIcsUrl(): string | null {
    return this.icsUrl;
  }

  async removeCalendar(): Promise<void> {
    this.icsUrl = null;
    // Clear URL from database
    await storage.setSetting('calendar_url', '');
    // Clear all calendar events
    await storage.clearCalendarEvents();
    console.log('Calendar removed and events cleared');
  }

  private startCronJob() {
    // Run every 15 minutes
    cron.schedule("*/15 * * * *", async () => {
      if (this.icsUrl && !this.isRunning) {
        console.log("Starting calendar sync...");
        await this.syncCalendar();
      }
    });

    // Initial sync on startup
    if (this.icsUrl) {
      setTimeout(() => this.syncCalendar(), 1000);
    }
  }

  async syncCalendar(): Promise<void> {
    if (!this.icsUrl || this.isRunning) return;

    this.isRunning = true;
    
    try {
      console.log(`Fetching calendar from: ${this.icsUrl}`);
      const events = await ical.fromURL(this.icsUrl);
      
      console.log(`Total calendar objects parsed: ${Object.keys(events).length}`);
      
      // Clear existing events
      await storage.clearCalendarEvents();
      console.log("Cleared existing calendar events");
      
      let processedCount = 0;
      let skippedCount = 0;
      
      // Process each event
      for (const [key, event] of Object.entries(events)) {
        if (event.type === 'VEVENT') {
          const icalEvent = event as ICalEvent;
          
          // Only process events that have valid dates
          if (icalEvent.start && icalEvent.end) {
            const eventStart = new Date(icalEvent.start);
            const eventEnd = new Date(icalEvent.end);
            
            // Only sync events from the last 30 days to next 365 days to avoid too much old data
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
            
            if (eventStart >= thirtyDaysAgo && eventStart <= oneYearFromNow) {
              const normalizedEvent: InsertCalendarEvent = {
                id: icalEvent.uid || key,
                title: icalEvent.summary || "Untitled Event",
                start: eventStart,
                end: eventEnd,
                location: icalEvent.location || null,
                description: icalEvent.description || null,
                isAllDay: this.isAllDayEvent(icalEvent.start, icalEvent.end)
              };

              await storage.createCalendarEvent(normalizedEvent);
              processedCount++;
              
              if (processedCount <= 5) {
                console.log(`Processed event: ${normalizedEvent.title} (${eventStart.toISOString()})`);
              }
            } else {
              skippedCount++;
            }
          } else {
            skippedCount++;
          }
        }
      }
      
      console.log(`Calendar sync completed: ${processedCount} events processed, ${skippedCount} skipped`);
    } catch (error) {
      console.error("Calendar sync failed:", error);
    } finally {
      this.isRunning = false;
    }
  }

  private isAllDayEvent(start: Date, end: Date): boolean {
    // Check if event spans entire day(s) with no specific times
    const startHours = start.getHours();
    const startMinutes = start.getMinutes();
    const endHours = end.getHours();
    const endMinutes = end.getMinutes();
    
    return (startHours === 0 && startMinutes === 0 && endHours === 0 && endMinutes === 0);
  }

  async getEventsForDate(date: string): Promise<any[]> {
    const events = await storage.getCalendarEvents();
    const targetDate = new Date(date);
    
    return events.filter(event => {
      const eventDate = new Date(event.start);
      return eventDate.toDateString() === targetDate.toDateString();
    }).map(event => ({
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

export const calendarService = new CalendarService();
