import { type Task, type InsertTask, type FocusBlock, type InsertFocusBlock, type CalendarEvent, type InsertCalendarEvent } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Tasks
  getTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;

  // Focus Blocks
  getFocusBlocks(): Promise<FocusBlock[]>;
  getFocusBlock(id: string): Promise<FocusBlock | undefined>;
  createFocusBlock(focusBlock: InsertFocusBlock): Promise<FocusBlock>;
  updateFocusBlock(id: string, updates: Partial<InsertFocusBlock>): Promise<FocusBlock | undefined>;
  deleteFocusBlock(id: string): Promise<boolean>;

  // Calendar Events
  getCalendarEvents(): Promise<CalendarEvent[]>;
  getCalendarEvent(id: string): Promise<CalendarEvent | undefined>;
  createCalendarEvent(event: InsertCalendarEvent): Promise<CalendarEvent>;
  updateCalendarEvent(id: string, updates: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined>;
  deleteCalendarEvent(id: string): Promise<boolean>;
  clearCalendarEvents(): Promise<void>;
}

export class MemStorage implements IStorage {
  private tasks: Map<string, Task>;
  private focusBlocks: Map<string, FocusBlock>;
  private calendarEvents: Map<string, CalendarEvent>;

  constructor() {
    this.tasks = new Map();
    this.focusBlocks = new Map();
    this.calendarEvents = new Map();
    this.seedData();
  }

  private seedData() {
    // Seed some sample tasks if no calendar URL is provided
    const sampleTasks: Task[] = [
      {
        id: randomUUID(),
        title: "Update project documentation",
        source: "manual",
        status: "pending",
        priority: 3,
        dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
        estimateMins: 60,
        url: null,
        context: null,
        aiSuggested: false,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: randomUUID(),
        title: "Code review for authentication module",
        source: "slack",
        status: "confirmed",
        priority: 2,
        dueAt: null,
        estimateMins: 60,
        url: null,
        context: null,
        aiSuggested: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    sampleTasks.forEach(task => this.tasks.set(task.id, task));

    // Seed some sample meetings if no calendar URL
    const today = new Date();
    const sampleEvents: CalendarEvent[] = [
      {
        id: "meeting-1",
        title: "Team Standup",
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0),
        end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 30),
        location: "Zoom Meeting",
        description: "Daily team standup",
        isAllDay: false,
        lastSync: new Date()
      },
      {
        id: "meeting-2",
        title: "Client Presentation",
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 0),
        end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0),
        location: "Conference Room A",
        description: "Quarterly review with client",
        isAllDay: false,
        lastSync: new Date()
      }
    ];

    sampleEvents.forEach(event => this.calendarEvents.set(event.id, event));
  }

  // Tasks
  async getTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const id = randomUUID();
    const now = new Date();
    const task: Task = { 
      id, 
      title: insertTask.title,
      source: insertTask.source || 'manual',
      status: insertTask.status || 'pending',
      priority: insertTask.priority || 2,
      dueAt: insertTask.dueAt || null,
      estimateMins: insertTask.estimateMins || null,
      url: insertTask.url || null,
      context: insertTask.context || null,
      aiSuggested: insertTask.aiSuggested || false,
      createdAt: now, 
      updatedAt: now 
    };
    this.tasks.set(id, task);
    return task;
  }

  async updateTask(id: string, updates: Partial<InsertTask>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updatedTask: Task = { 
      ...task, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.tasks.delete(id);
  }

  // Focus Blocks
  async getFocusBlocks(): Promise<FocusBlock[]> {
    return Array.from(this.focusBlocks.values());
  }

  async getFocusBlock(id: string): Promise<FocusBlock | undefined> {
    return this.focusBlocks.get(id);
  }

  async createFocusBlock(insertFocusBlock: InsertFocusBlock): Promise<FocusBlock> {
    const id = randomUUID();
    const focusBlock: FocusBlock = { 
      id,
      taskId: insertFocusBlock.taskId,
      start: insertFocusBlock.start,
      end: insertFocusBlock.end,
      confirmed: insertFocusBlock.confirmed || false,
      createdAt: new Date() 
    };
    this.focusBlocks.set(id, focusBlock);
    return focusBlock;
  }

  async updateFocusBlock(id: string, updates: Partial<InsertFocusBlock>): Promise<FocusBlock | undefined> {
    const focusBlock = this.focusBlocks.get(id);
    if (!focusBlock) return undefined;
    
    const updatedFocusBlock: FocusBlock = { 
      ...focusBlock, 
      ...updates 
    };
    this.focusBlocks.set(id, updatedFocusBlock);
    return updatedFocusBlock;
  }

  async deleteFocusBlock(id: string): Promise<boolean> {
    return this.focusBlocks.delete(id);
  }

  // Calendar Events
  async getCalendarEvents(): Promise<CalendarEvent[]> {
    return Array.from(this.calendarEvents.values());
  }

  async getCalendarEvent(id: string): Promise<CalendarEvent | undefined> {
    return this.calendarEvents.get(id);
  }

  async createCalendarEvent(insertEvent: InsertCalendarEvent): Promise<CalendarEvent> {
    const event: CalendarEvent = { 
      id: insertEvent.id,
      title: insertEvent.title,
      start: insertEvent.start,
      end: insertEvent.end,
      location: insertEvent.location || null,
      description: insertEvent.description || null,
      isAllDay: insertEvent.isAllDay || false,
      lastSync: new Date() 
    };
    this.calendarEvents.set(event.id, event);
    return event;
  }

  async updateCalendarEvent(id: string, updates: Partial<InsertCalendarEvent>): Promise<CalendarEvent | undefined> {
    const event = this.calendarEvents.get(id);
    if (!event) return undefined;
    
    const updatedEvent: CalendarEvent = { 
      ...event, 
      ...updates, 
      lastSync: new Date() 
    };
    this.calendarEvents.set(id, updatedEvent);
    return updatedEvent;
  }

  async deleteCalendarEvent(id: string): Promise<boolean> {
    return this.calendarEvents.delete(id);
  }

  async clearCalendarEvents(): Promise<void> {
    this.calendarEvents.clear();
  }
}

export const storage = new MemStorage();
