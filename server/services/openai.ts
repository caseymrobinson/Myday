// server/services/openai.ts
// -----------------------------------------------------------------------------
// IMPORTANT: This file targets the GPT-5 "Responses API".
// - Use: openai.responses.create(...)
// - Model: "gpt-5" (or another GPT-5-* variant that supports Responses API)
// - JSON output control: text.format = { type: "json_schema", name, schema, strict }
// DO NOT switch to Chat Completions (chat.completions.create) or change the
// model to non-GPT-5 without rewriting parameters accordingly.
// -----------------------------------------------------------------------------

import OpenAI from "openai";
import { calendarService } from "./calendar";
import { schedulerService } from "./scheduler";
import { storage } from "../storage";

// ---------- GPT-5 Responses API config ----------
const MODEL = process.env.OPENAI_MODEL || "gpt-5";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// ---------- Time helpers (local, with offset) ----------
function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function offsetStr(d: Date) {
  const offMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${pad(hh)}:${pad(mm)}`;
}
function toLocalISO(d: Date) {
  // yyyy-mm-ddThh:mm:ss±hh:mm using local wall time + local offset
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offsetStr(d)}`;
}
function localDayStart(dateStr: string, h = 0, m = 0) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date();
  dt.setFullYear(y, mo - 1, d);
  dt.setHours(h, m, 0, 0);
  return dt;
}
function isWeekendLocal(dateStr: string) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date();
  dt.setFullYear(y, mo - 1, d);
  dt.setHours(12, 0, 0, 0);
  const day = dt.getDay(); // 0 Sun, 6 Sat
  return day === 0 || day === 6;
}
function roundToQuarter(date: Date) {
  const ms = date.getTime();
  const q = 15 * 60 * 1000;
  return new Date(Math.round(ms / q) * q);
}
function clampToWorkday(date: Date, dateStr: string) {
  const start = localDayStart(dateStr, 9, 0).getTime();
  const end = localDayStart(dateStr, 17, 0).getTime();
  const t = Math.max(start, Math.min(end, date.getTime()));
  return new Date(t);
}
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
function toDateSafe(v: any) {
  try { return new Date(v); } catch { return new Date(NaN); }
}
function parseJsonLoose(s: string | null | undefined): any {
  if (!s) return {};
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch {}
  }
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) { try { return JSON.parse(m[1]); } catch {} }
  return {};
}
function outputText(resp: any): string {
  // Prefer the SDK helper if present
  if (typeof resp?.output_text === "string" && resp.output_text.length) return resp.output_text;
  // Fallback: walk output array
  const out = resp?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === "string" && c.text) return c.text;
        }
      }
    }
  }
  return "";
}

// ---------- JSON Schemas (for text.format) ----------
const DayPlanSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    scheduledTasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string" },
          taskTitle: { type: "string" },
          start: { type: "string" }, // local ISO without 'Z' preferred
          end: { type: "string" },   // local ISO without 'Z' preferred
          estimatedMinutes: { type: "number" },
          reasoning: { type: "string" }
        },
        required: ["taskId", "taskTitle", "start", "end", "estimatedMinutes", "reasoning"]
      }
    },
    unscheduledTasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string" },
          taskTitle: { type: "string" },
          reason: { type: "string" }
        },
        required: ["taskId", "taskTitle", "reason"]
      }
    },
    recommendations: { type: "array", items: { type: "string" } }
  },
  required: ["scheduledTasks", "unscheduledTasks", "recommendations"]
} as const;

const ExtractTasksSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          priority: { type: "number" },      // 1|2|3
          estimateMins: { type: "number" },
          context: { type: "string" },
          dueAt: { type: ["string", "null"] } // ISO or null
        },
        required: ["title", "priority", "estimateMins", "context", "dueAt"]
      }
    },
    summary: { type: "string" }
  },
  required: ["tasks", "summary"]
} as const;

export class OpenAIService {
  // ---------- Day planning with GPT-5 (Responses API + JSON schema) ----------
  async planDay(date: string): Promise<any> {
    if (!process.env.OPENAI_API_KEY) {
      return { error: "OpenAI API key not configured" };
    }

    try {
      // Compute tomorrow as local date string (avoid UTC slicing)
      const [y, mo, d] = date.split("-").map(Number);
      const base = new Date();
      base.setFullYear(y, mo - 1, d);
      base.setHours(12, 0, 0, 0); // midday avoids DST edges
      const tomorrowDt = new Date(base.getTime());
      tomorrowDt.setDate(base.getDate() + 1);
      const tomorrow = `${tomorrowDt.getFullYear()}-${pad(tomorrowDt.getMonth() + 1)}-${pad(tomorrowDt.getDate())}`;

      // Pull data concurrently
      const [meetingsToday, freeBlocksToday, meetingsTomorrow, freeBlocksTomorrow, tasks] = await Promise.all([
        calendarService.getEventsForDate(date),
        schedulerService.getFreeTimeSlots(date),
        calendarService.getEventsForDate(tomorrow),
        schedulerService.getFreeTimeSlots(tomorrow),
        storage.getTasks()
      ]);

      const pendingTasks = tasks.filter((t: any) => t.status === "pending");

      const mapMeetings = (arr: any[]) =>
        arr.map((m: any) => ({
          id: m.id,
          title: m.title,
          start: toLocalISO(toDateSafe(m.start)),
          end: toLocalISO(toDateSafe(m.end)),
          location: m.location || null,
          isAllDay: !!m.isAllDay
        }));
      const mapBlocks = (arr: any[]) =>
        arr.map((b: any) => ({
          start: toLocalISO(toDateSafe(b.start)),
          end: toLocalISO(toDateSafe(b.end))
        }));

      const workStartToday = toLocalISO(localDayStart(date, 9, 0));
      const workEndToday = toLocalISO(localDayStart(date, 17, 0));
      const workStartTomorrow = toLocalISO(localDayStart(tomorrow, 9, 0));
      const workEndTomorrow = toLocalISO(localDayStart(tomorrow, 17, 0));

      const prompt =
`Schedule pending tasks for ${date}. Business hours: 9:00–17:00 LOCAL.

Rules:
- Use only 15-minute intervals (:00, :15, :30, :45)
- Do not schedule outside ${workStartToday} .. ${workEndToday}
- Avoid overlapping meetings
- Prioritize higher priority and sooner due dates
- Prefer local ISO without 'Z' (e.g. "${date}T09:00:00.000${offsetStr(new Date())}")

TODAY MEETINGS:
${mapMeetings(meetingsToday).map(m => `- ${m.title}: ${m.start} → ${m.end}`).join('\n') || "- none"}

TODAY FREE BLOCKS:
${mapBlocks(freeBlocksToday).map(b => `- ${b.start} → ${b.end}`).join('\n') || "- none"}

TOMORROW MEETINGS:
${mapMeetings(meetingsTomorrow).map(m => `- ${m.title}: ${m.start} → ${m.end}`).join('\n') || "- none"}

TOMORROW FREE BLOCKS:
${mapBlocks(freeBlocksTomorrow).map(b => `- ${b.start} → ${b.end}`).join('\n') || "- none"}

PENDING TASKS:
${pendingTasks.map((t: any) => `- ${t.id} :: "${t.title}" :: priority ${t.priority ?? 2} :: est ${t.estimateMins ?? 30}m${t.dueAt ? ` :: due ${toLocalISO(new Date(t.dueAt))}` : ''}`).join('\n') || "- none"}

Return STRICT JSON that matches the provided schema (no commentary).`;

      // GPT-5 Responses API call with JSON schema (NOTE: name must be at text.format level)
      const resp = await openai.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "You are an expert day planner AI. Obsess over timezones, constraints, and JSON validity." }]
          },
          { role: "user", content: [{ type: "input_text", text: prompt }] }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "DayPlan",
            schema: DayPlanSchemaObject,
            strict: true
          }
        },
        temperature: 0.2,
        max_output_tokens: 1500
      });

      const raw = outputText(resp);
      const schedule = parseJsonLoose(raw);

      // Validate/normalize plan locally
      const meetingsAll = [...mapMeetings(meetingsToday), ...mapMeetings(meetingsTomorrow)].map(m => ({
        start: toDateSafe(m.start), end: toDateSafe(m.end)
      }));

      const scheduled: any[] = Array.isArray(schedule.scheduledTasks) ? schedule.scheduledTasks : [];
      const validScheduled: any[] = [];
      const unscheduled: any[] = Array.isArray(schedule.unscheduledTasks) ? [...schedule.unscheduledTasks] : [];

      for (const s of scheduled) {
        try {
          const start = toDateSafe(s.start);
          const end = toDateSafe(s.end);
          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Invalid timestamps" });
            continue;
          }
          const dStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
          if (isWeekendLocal(dStr)) {
            unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Weekend" });
            continue;
          }
          let sAdj = roundToQuarter(start);
          let eAdj = roundToQuarter(end);
          sAdj = clampToWorkday(sAdj, dStr);
          eAdj = clampToWorkday(eAdj, dStr);
          if (eAdj <= sAdj) {
            unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Outside business hours" });
            continue;
          }
          let conflict = false;
          for (const m of meetingsAll) {
            if (overlaps(sAdj, eAdj, m.start, m.end)) { conflict = true; break; }
          }
          if (conflict) {
            unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Overlaps a meeting" });
            continue;
          }
          validScheduled.push({
            taskId: s.taskId,
            taskTitle: s.taskTitle,
            start: toLocalISO(sAdj),
            end: toLocalISO(eAdj),
            estimatedMinutes: s.estimatedMinutes ?? Math.round((eAdj.getTime() - sAdj.getTime()) / 60000),
            reasoning: s.reasoning ?? "Fits constraints and free time"
          });
        } catch {
          unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Validation error" });
        }
      }

      return {
        suggestions: validScheduled.map(s => ({ ...s, confidence: 0.85 })),
        unscheduledTasks: unscheduled,
        recommendations: Array.isArray(schedule.recommendations) ? schedule.recommendations : []
      };
    } catch (error: any) {
      console.error("Error planning day:", error?.response?.data || error);
      return { error: "Failed to generate day plan", details: String(error?.message || error) };
    }
  }

  // ---------- Generic chat / fallback assistant (Responses API, plain text) ----------
  async processMessage(message: string, conversationHistory: any[] = []): Promise<string> {
    if (!process.env.OPENAI_API_KEY) {
      return "OpenAI API key not configured. Please set OPENAI_API_KEY.";
    }

    try {
      if (this.isScheduleQuery(message)) return await this.generateAgendaSummary();
      if (this.isTaskCreationRequest(message) || this.hasActionItems(message)) {
        const result = await this.extractTasksFromText(message);
        return result.summary;
      }

      const input = [
        {
          role: "system" as const,
          content: [{ type: "input_text", text: "You are a helpful AI assistant for a daily planning app called 'My Day'. Be concise and actionable." }]
        },
        ...conversationHistory.slice(-6).map((m: any) => ({
          role: m.role, content: [{ type: "input_text", text: String(m.content ?? "") }]
        })),
        { role: "user" as const, content: [{ type: "input_text", text: message }] }
      ];

      const resp = await openai.responses.create({
        model: MODEL,
        input: input as any,
        max_output_tokens: 1000,
        temperature: 1
      });

      return outputText(resp) || "I couldn't process your request.";
    } catch (error: any) {
      console.error("OpenAI API error:", error?.response?.data || error);
      if (error?.code === "invalid_api_key" || error?.status === 401) {
        return "OpenAI API key is invalid or missing. Please check your API key configuration.";
      }
      if (error?.message && /model/i.test(error.message)) {
        return "There's an issue with the AI model configuration. Please try again later.";
      }
      return "I'm having trouble processing your request right now. Please try again later.";
    }
  }

  // ---------- Agenda summary (Responses API, plain text) ----------
  private async generateAgendaSummary(): Promise<string> {
    try {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

      let meetings: any[] = [], freeBlocks: any[] = [], allTasks: any[] = [], suggestions: any[] = [];
      try { meetings = await calendarService.getEventsForDate(dateStr); } catch (e) { console.error("meetings err", e); }
      try { freeBlocks = await schedulerService.getFreeTimeSlots(dateStr); } catch (e) { console.error("free err", e); }
      try { allTasks = await storage.getTasks(); } catch (e) { console.error("tasks err", e); }
      try { suggestions = await schedulerService.generateScheduleSuggestions(dateStr); } catch (e) { console.error("sugg err", e); }

      const topTasks = allTasks
        .filter((t: any) => t.status === "pending")
        .sort((a: any, b: any) => (b.priority ?? 2) - (a.priority ?? 2))
        .slice(0, 5);

      const summaryData = {
        date: dateStr,
        meetings: meetings.map((m: any) => ({
          title: m.title,
          time: `${new Date(m.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(m.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          location: m.location
        })),
        freeBlocks: freeBlocks.map((b: any) => ({
          time: `${new Date(b.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(b.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        })),
        topTasks: topTasks.map((t: any) => ({
          title: t.title,
          priority: t.priority === 3 ? "High" : t.priority === 2 ? "Medium" : "Low",
          due: t.dueAt ? new Date(t.dueAt).toLocaleDateString() : "No due date"
        })),
        suggestions: (suggestions || []).slice(0, 3).map((s: any) => ({
          task: s.taskTitle,
          time: `${new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(s.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        }))
      };

      const resp = await openai.responses.create({
        model: MODEL,
        input: [
          { role: "system", content: [{ type: "input_text", text: "You are a helpful daily planning assistant. Provide clear, well-organized summaries." }] },
          { role: "user", content: [{ type: "input_text", text: "Based on this schedule data, provide a concise, conversational summary for today's agenda:\n\n" + JSON.stringify(summaryData, null, 2) }] }
        ],
        max_output_tokens: 800,
        temperature: 1
      });

      return outputText(resp) || "I couldn't generate your agenda summary.";
    } catch (error: any) {
      console.error("Error generating agenda summary:", error?.response?.data || error);
      if (error?.code === "invalid_api_key" || error?.status === 401) {
        return "OpenAI API key is invalid or missing. Please check your API key configuration.";
      }
      return "I'm having trouble generating your agenda summary. Please try again later.";
    }
  }

  // ---------- Task extraction (Responses API + JSON schema) ----------
  private async extractTaskFromText(_: string): Promise<string> {
    return "Please use the new task extraction feature. Paste your text and I’ll pull out action items.";
  }

  async extractTasksFromText(textContent: string): Promise<{ tasks: any[]; summary: string }> {
    try {
      const resp = await openai.responses.create({
        model: MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: "You are a task extraction expert. Return STRICT JSON matching the schema. Extract ALL actionable tasks from the text." }]
          },
          { role: "user", content: [{ type: "input_text", text: `Extract all tasks and action items from this text:\n\n${textContent}` }] }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "TaskExtraction",
            schema: ExtractTasksSchemaObject,
            strict: true
          }
        },
        temperature: 0.3,
        max_output_tokens: 1000
      });

      const result = parseJsonLoose(outputText(resp));
      if (!result?.tasks || !Array.isArray(result.tasks) || result.tasks.length === 0) {
        return { tasks: [], summary: "No actionable tasks found in the provided text." };
      }

      const createdTasks = [];
      for (const task of result.tasks) {
        const createdTask = await storage.createTask({
          title: task.title,
          source: "ai",
          status: "pending",
          priority: task.priority || 2,
          estimateMins: task.estimateMins || 30,
          context: task.context ? { note: task.context, source: "text" } : { source: "text" },
          aiSuggested: false,
          dueAt: task.dueAt ? new Date(task.dueAt) : null,
          url: null
        });
        createdTasks.push(createdTask);
      }

      const taskSummary = createdTasks
        .map(
          (t: any) =>
            `• ${t.title} (${t.priority === 3 ? "High" : t.priority === 2 ? "Medium" : "Low"} priority${t.dueAt ? `, due ${new Date(t.dueAt).toLocaleDateString()}` : ""})`
        )
        .join("\n");

      return {
        tasks: createdTasks,
        summary: `I've created ${createdTasks.length} task${createdTasks.length !== 1 ? "s" : ""}:\n\n${taskSummary}`
      };
    } catch (error: any) {
      console.error("Error extracting tasks:", error?.response?.data || error);
      return {
        tasks: [],
        summary: "I couldn't extract tasks from that text. Please try again or check if the text contains action items."
      };
    }
  }

  // ---------- Simple intent helpers ----------
  private isScheduleQuery(message: string): boolean {
    const keywords = ["what am i doing today","today's schedule","my day","agenda","schedule","meetings today","what's next"];
    const lower = message.toLowerCase();
    return keywords.some(k => lower.includes(k));
  }
  private isTaskCreationRequest(message: string): boolean {
    const keywords = ["create task","add task","new task","i need to","remind me to","todo","to do","task:","action item","follow up","schedule to"];
    const lower = message.toLowerCase();
    return keywords.some(k => lower.includes(k));
  }
  private hasActionItems(message: string): boolean {
    const patterns = [
      /^(i need to|i have to|i should|i must|need to|have to|should|must)\s+/im,
      /please\s+(review|complete|follow up|respond|prepare|send|schedule|call|email)/i,
      /action items?:|next steps?:|to.?do:/i,
      /^\s*[\d\-\*\•]\s+/m,
      /(due|deadline|by|before)\s+(today|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
    ];
    return patterns.some(p => p.test(message)) || (message.split("\n").length > 1 && /^\s*[\d\-\*\•]/.test(message));
  }
}

export const openaiService = new OpenAIService();