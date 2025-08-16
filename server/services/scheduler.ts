import { storage } from "../storage";
import { type Task, type FocusBlock } from "@shared/schema";

interface TimeSlot {
  start: Date;
  end: Date;
}

interface ScheduleSuggestion {
  taskId: string;
  taskTitle: string;
  start: string;
  end: string;
  estimateMins: number;
}

export class SchedulerService {
  async generateScheduleSuggestions(date: string): Promise<ScheduleSuggestion[]> {
    const targetDate = new Date(date);
    
    // Get existing meetings and confirmed focus blocks
    const meetings = await this.getMeetingsForDate(date);
    const confirmedBlocks = await this.getConfirmedFocusBlocksForDate(date);
    
    // Get top priority pending tasks
    const topTasks = await this.getTopPriorityTasks();
    
    // Find free time slots
    const freeSlots = this.findFreeTimeSlots(targetDate, meetings, confirmedBlocks);
    
    // Generate suggestions by fitting tasks into free slots
    return this.fitTasksIntoSlots(topTasks, freeSlots);
  }

  private async getMeetingsForDate(date: string): Promise<TimeSlot[]> {
    const events = await storage.getCalendarEvents();
    const targetDate = new Date(date);
    
    return events
      .filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.toDateString() === targetDate.toDateString();
      })
      .map(event => ({
        start: new Date(event.start),
        end: new Date(event.end)
      }));
  }

  private async getConfirmedFocusBlocksForDate(date: string): Promise<TimeSlot[]> {
    const focusBlocks = await storage.getFocusBlocks();
    const targetDate = new Date(date);
    
    return focusBlocks
      .filter(block => {
        const blockDate = new Date(block.start);
        return block.confirmed && blockDate.toDateString() === targetDate.toDateString();
      })
      .map(block => ({
        start: new Date(block.start),
        end: new Date(block.end)
      }));
  }

  private async getTopPriorityTasks(): Promise<Task[]> {
    const tasks = await storage.getTasks();
    
    return tasks
      .filter(task => task.status === 'pending')
      .sort((a, b) => {
        // Sort by priority (3=high, 2=medium, 1=low), then by due date
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        
        if (a.dueAt && b.dueAt) {
          return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
        }
        
        if (a.dueAt) return -1;
        if (b.dueAt) return 1;
        
        return 0;
      })
      .slice(0, 5); // Top 5 tasks
  }

  private findFreeTimeSlots(date: Date, meetings: TimeSlot[], confirmedBlocks: TimeSlot[]): TimeSlot[] {
    // Create business hours in Eastern Time (9 AM - 5 PM ET)
    const workDayStart = new Date(date);
    workDayStart.setUTCHours(13, 0, 0, 0); // 9 AM ET = 13:00 UTC
    
    const workDayEnd = new Date(date);
    workDayEnd.setUTCHours(21, 0, 0, 0); // 5 PM ET = 21:00 UTC
    
    // Combine all busy slots
    const busySlots = [...meetings, ...confirmedBlocks]
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    
    const freeSlots: TimeSlot[] = [];
    let currentTime = workDayStart;
    
    for (const busySlot of busySlots) {
      // If there's a gap before this busy slot
      if (currentTime < busySlot.start) {
        freeSlots.push({
          start: new Date(currentTime),
          end: new Date(busySlot.start)
        });
      }
      
      // Move current time to end of busy slot
      currentTime = new Date(Math.max(currentTime.getTime(), busySlot.end.getTime()));
    }
    
    // Add remaining time after last busy slot
    if (currentTime < workDayEnd) {
      freeSlots.push({
        start: new Date(currentTime),
        end: new Date(workDayEnd)
      });
    }
    
    // Filter out slots that are too short (less than 15 minutes)
    return freeSlots.filter(slot => {
      const duration = slot.end.getTime() - slot.start.getTime();
      return duration >= 15 * 60 * 1000; // 15 minutes
    });
  }

  private fitTasksIntoSlots(tasks: Task[], freeSlots: TimeSlot[]): ScheduleSuggestion[] {
    const suggestions: ScheduleSuggestion[] = [];
    const availableSlots = [...freeSlots];
    
    for (const task of tasks) {
      const estimateMins = task.estimateMins || 30;
      const durationMs = estimateMins * 60 * 1000;
      
      // Find a slot that can fit this task
      for (let i = 0; i < availableSlots.length; i++) {
        const slot = availableSlots[i];
        const slotDuration = slot.end.getTime() - slot.start.getTime();
        
        if (slotDuration >= durationMs) {
          // Create suggestion
          const suggestionEnd = new Date(slot.start.getTime() + durationMs);
          
          suggestions.push({
            taskId: task.id,
            taskTitle: task.title,
            start: slot.start.toISOString(),
            end: suggestionEnd.toISOString(),
            estimateMins
          });
          
          // Update the available slot
          if (slotDuration > durationMs) {
            // Slot has remaining time
            availableSlots[i] = {
              start: new Date(suggestionEnd),
              end: slot.end
            };
          } else {
            // Slot is fully used
            availableSlots.splice(i, 1);
          }
          
          break;
        }
      }
    }
    
    return suggestions;
  }

  async getFreeTimeSlots(date: string): Promise<{ start: string; end: string }[]> {
    const targetDate = new Date(date);
    const meetings = await this.getMeetingsForDate(date);
    const confirmedBlocks = await this.getConfirmedFocusBlocksForDate(date);
    
    const freeSlots = this.findFreeTimeSlots(targetDate, meetings, confirmedBlocks);
    
    return freeSlots.map(slot => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString()
    }));
  }
}

export const schedulerService = new SchedulerService();
