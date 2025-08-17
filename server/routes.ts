import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { calendarServiceV2 } from "./services/calendar-v2";
import { schedulerService } from "./services/scheduler";
import { openaiService } from "./services/openai";
import { insertTaskSchema, insertFocusBlockSchema, chatMessageSchema, slackIngestSchema, type AgendaResponse } from "@shared/schema";
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
      // Convert date string to Date object if present
      const taskData = {
        ...req.body,
        dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null
      };
      
      const validatedData = insertTaskSchema.parse(taskData);
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
      const updates = {
        ...req.body,
        dueAt: req.body.dueAt ? new Date(req.body.dueAt) : undefined
      };
      
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

  app.delete("/api/tasks/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteTask(id);
      if (!success) {
        res.status(404).json({ message: "Task not found" });
        return;
      }
      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Agenda endpoint
  app.get("/api/agenda", async (req, res) => {
    try {
      const date = req.query.date as string || new Date().toISOString().split('T')[0];
      
      // Get meetings for the date
      const meetings = await calendarServiceV2.getEventsForDate(date);
      
      // Get free time blocks
      const freeBlocks = await schedulerService.getFreeTimeSlots(date);
      
      // Get focus blocks for this date
      const allFocusBlocks = await storage.getFocusBlocks();
      const focusBlocks = allFocusBlocks.filter(block => {
        const blockDate = new Date(block.start).toISOString().split('T')[0];
        return blockDate === date;
      });
      
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
      
      // Remove duplicate suggestions (same taskId)
      const uniqueSuggestions = suggestions.reduce((acc: any[], curr: any) => {
        if (!acc.find(s => s.taskId === curr.taskId)) {
          acc.push(curr);
        }
        return acc;
      }, []);
      
      // Map focus blocks to include task details
      const focusBlocksWithTasks = await Promise.all(
        focusBlocks.map(async (block) => {
          const task = await storage.getTask(block.taskId);
          return {
            id: block.id,
            taskId: block.taskId,
            taskTitle: task?.title || 'Unknown Task',
            start: typeof block.start === 'string' ? block.start : block.start.toISOString(),
            end: typeof block.end === 'string' ? block.end : block.end.toISOString(),
            confirmed: block.confirmed
          };
        })
      );

      const agendaResponse: AgendaResponse = {
        meetings,
        freeBlocks,
        focusBlocks: focusBlocksWithTasks,
        topTasks,
        suggestions: uniqueSuggestions
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
      const { message, history } = z.object({ 
        message: z.string(), 
        history: z.array(z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string()
        })).optional().default([])
      }).parse(req.body);
      
      const response = await openaiService.processMessage(message, history);
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

  // Calendar setup endpoints
  app.get("/api/calendar/url", async (req, res) => {
    try {
      const url = calendarServiceV2.getIcsUrl();
      res.json({ url: url || null });
    } catch (error) {
      res.status(500).json({ message: "Failed to get calendar URL" });
    }
  });
  
  app.post("/api/calendar/url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        res.status(400).json({ message: "Invalid URL provided" });
        return;
      }
      
      await calendarServiceV2.setIcsUrl(url);
      res.json({ success: true, message: "Calendar URL saved successfully" });
    } catch (error) {
      console.error("Failed to save calendar URL:", error);
      res.status(500).json({ message: "Failed to save calendar URL" });
    }
  });

  app.delete("/api/calendar/url", async (req, res) => {
    try {
      await calendarServiceV2.removeCalendar();
      res.json({ success: true, message: "Calendar removed successfully" });
    } catch (error) {
      console.error("Failed to remove calendar:", error);
      res.status(500).json({ message: "Failed to remove calendar" });
    }
  });

  app.delete("/api/calendar/events", async (req, res) => {
    try {
      await storage.clearCalendarEvents();
      res.json({ success: true, message: "Calendar events cleared successfully" });
    } catch (error) {
      console.error("Failed to clear calendar events:", error);
      res.status(500).json({ message: "Failed to clear calendar events" });
    }
  });

  app.post("/api/sync-calendar", async (req, res) => {
    try {
      const stats = await calendarServiceV2.syncCalendar();
      res.json({ success: true, message: "Calendar synced successfully", stats });
    } catch (error) {
      console.error("Failed to sync calendar:", error);
      res.status(500).json({ message: "Failed to sync calendar" });
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
      console.log("Creating focus block with data:", req.body);
      
      // Convert date strings to Date objects
      const focusBlockData = {
        ...req.body,
        start: new Date(req.body.start),
        end: new Date(req.body.end)
      };
      
      const validatedData = insertFocusBlockSchema.parse(focusBlockData);
      const focusBlock = await storage.createFocusBlock(validatedData);
      res.status(201).json(focusBlock);
    } catch (error) {
      console.error("Focus block creation error:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid focus block data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create focus block" });
      }
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

  // Delete focus blocks by task ID
  app.delete("/api/focus-blocks/task/:taskId", async (req, res) => {
    try {
      const { taskId } = req.params;
      const focusBlocks = await storage.getFocusBlocks();
      const blocksToDelete = focusBlocks.filter(block => block.taskId === taskId);
      
      for (const block of blocksToDelete) {
        await storage.deleteFocusBlock(block.id);
      }
      
      res.json({ message: `Deleted ${blocksToDelete.length} focus blocks for task ${taskId}` });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete focus blocks" });
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

  // Get calendar sync status
  app.get("/api/calendar/status", async (req, res) => {
    try {
      const status = await calendarServiceV2.getSyncStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sync status" });
    }
  });

  // Manual calendar sync endpoint (duplicate - to be removed)
  app.post("/api/calendar/sync", async (req, res) => {
    try {
      const stats = await calendarServiceV2.syncCalendar();
      res.json({ message: "Calendar sync completed", stats });
    } catch (error) {
      res.status(500).json({ message: "Calendar sync failed" });
    }
  });

  // Calendar setup endpoint - save ICS URL
  app.post("/api/calendar/setup", async (req, res) => {
    try {
      const { icsUrl } = req.body;
      if (!icsUrl || !icsUrl.includes('ical')) {
        res.status(400).json({ message: "Invalid iCal URL" });
        return;
      }
      
      // Update the calendar service with the new URL
      calendarServiceV2.setIcsUrl(icsUrl);
      
      // Trigger immediate sync
      await calendarServiceV2.syncCalendar();
      
      res.json({ message: "Calendar setup successful" });
    } catch (error) {
      console.error("Calendar setup error:", error);
      res.status(500).json({ message: "Failed to setup calendar" });
    }
  });

  // AI Day Planning endpoint
  app.post("/api/ai/plan-day", async (req, res) => {
    try {
      const { date } = req.body;
      const targetDate = date || new Date().toISOString().split('T')[0];
      
      const plan = await openaiService.planDay(targetDate);
      
      if (plan.error) {
        return res.status(400).json(plan);
      }

      // Create focus blocks for each suggestion
      const createdBlocks = [];
      if (plan.suggestions && Array.isArray(plan.suggestions)) {
        for (const suggestion of plan.suggestions) {
          try {
            const focusBlock = await storage.createFocusBlock({
              taskId: suggestion.taskId,
              start: new Date(suggestion.start),
              end: new Date(suggestion.end),
              confirmed: false // AI suggestions start as unconfirmed
            });
            createdBlocks.push(focusBlock);
          } catch (error) {
            console.error(`Failed to create focus block for task ${suggestion.taskId}:`, error);
          }
        }
      }

      res.json({
        ...plan,
        focusBlocksCreated: createdBlocks.length
      });
    } catch (error) {
      console.error("Day planning error:", error);
      res.status(500).json({ error: "Failed to generate day plan" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
