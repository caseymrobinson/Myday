import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { calendarService } from "./services/calendar";
import { schedulerService } from "./services/scheduler";
import { openaiService } from "./services/openai";
import { insertTaskSchema, chatMessageSchema, slackIngestSchema, type AgendaResponse } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Tasks endpoints
  app.get("/api/tasks", async (req, res) => {
    try {
      const tasks = await storage.getTasks();
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const validatedData = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(validatedData);
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid task data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create task" });
      }
    }
  });

  app.patch("/api/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Handle task confirmation - create focus block if status changes to confirmed
      if (updates.status === 'confirmed' && updates.aiSuggested === false) {
        const task = await storage.getTask(id);
        if (task && task.estimateMins) {
          // Create a focus block for this task (user will need to specify time in UI)
          const startTime = new Date();
          const endTime = new Date(startTime.getTime() + task.estimateMins * 60 * 1000);
          
          await storage.createFocusBlock({
            taskId: id,
            start: startTime,
            end: endTime,
            confirmed: true
          });
        }
      }
      
      const updatedTask = await storage.updateTask(id, updates);
      if (!updatedTask) {
        res.status(404).json({ message: "Task not found" });
        return;
      }
      
      res.json(updatedTask);
    } catch (error) {
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  // Agenda endpoint
  app.get("/api/agenda", async (req, res) => {
    try {
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      
      // Get meetings for the date
      const meetings = await calendarService.getEventsForDate(date);
      
      // Get free time blocks
      const freeBlocks = await schedulerService.getFreeTimeSlots(date);
      
      // Get top priority tasks
      const allTasks = await storage.getTasks();
      const topTasks = allTasks
        .filter(task => task.status === 'pending')
        .sort((a, b) => {
          if (a.priority !== b.priority) return b.priority - a.priority;
          if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
          if (a.dueAt) return -1;
          if (b.dueAt) return 1;
          return 0;
        })
        .slice(0, 5)
        .map(task => ({
          id: task.id,
          title: task.title,
          priority: task.priority,
          estimateMins: task.estimateMins,
          dueAt: task.dueAt?.toISOString() || null,
          source: task.source,
          aiSuggested: task.aiSuggested
        }));
      
      // Get AI scheduling suggestions
      const suggestions = await schedulerService.generateScheduleSuggestions(date);
      
      const agendaResponse: AgendaResponse = {
        meetings,
        freeBlocks,
        topTasks,
        suggestions
      };
      
      res.json(agendaResponse);
    } catch (error) {
      console.error("Agenda endpoint error:", error);
      res.status(500).json({ message: "Failed to generate agenda" });
    }
  });

  // Chat endpoint
  app.post("/api/chat", async (req, res) => {
    try {
      const { message } = chatMessageSchema.parse(req.body);
      const response = await openaiService.processMessage(message);
      res.json({ response });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid message format", errors: error.errors });
      } else {
        console.error("Chat endpoint error:", error);
        res.status(500).json({ message: "Failed to process message" });
      }
    }
  });

  // Slack ingest endpoint (stub)
  app.post("/api/ingest/slack", async (req, res) => {
    try {
      const { text, url, ts } = slackIngestSchema.parse(req.body);
      
      // Extract task title from text (naive implementation)
      const title = text.length > 50 ? text.substring(0, 50) + "..." : text;
      
      const task = await storage.createTask({
        title,
        source: 'slack',
        status: 'pending',
        priority: 2,
        estimateMins: 30,
        url,
        context: { slackTimestamp: ts, originalText: text },
        aiSuggested: true,
        dueAt: null
      });
      
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid Slack data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to process Slack message" });
      }
    }
  });

  // Focus blocks endpoints
  app.get("/api/focus-blocks", async (req, res) => {
    try {
      const focusBlocks = await storage.getFocusBlocks();
      res.json(focusBlocks);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch focus blocks" });
    }
  });

  app.post("/api/focus-blocks", async (req, res) => {
    try {
      const focusBlock = await storage.createFocusBlock(req.body);
      res.status(201).json(focusBlock);
    } catch (error) {
      res.status(500).json({ message: "Failed to create focus block" });
    }
  });

  app.patch("/api/focus-blocks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updatedFocusBlock = await storage.updateFocusBlock(id, req.body);
      if (!updatedFocusBlock) {
        res.status(404).json({ message: "Focus block not found" });
        return;
      }
      res.json(updatedFocusBlock);
    } catch (error) {
      res.status(500).json({ message: "Failed to update focus block" });
    }
  });

  // Calendar events endpoint
  app.get("/api/calendar-events", async (req, res) => {
    try {
      const events = await storage.getCalendarEvents();
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch calendar events" });
    }
  });

  // Manual calendar sync endpoint
  app.post("/api/sync-calendar", async (req, res) => {
    try {
      await calendarService.syncCalendar();
      res.json({ message: "Calendar sync completed" });
    } catch (error) {
      res.status(500).json({ message: "Calendar sync failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
