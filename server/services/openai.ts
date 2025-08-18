import OpenAI from "openai";
import { calendarService } from "./calendar";
import { schedulerService } from "./scheduler";
import { storage } from "../storage";

// ---------- Config ----------
const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini"; // your preference
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

// ---------- Time helpers (local, with offset) ----------
function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
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
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}${offsetStr(d)}`;
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

// Normalize an ISO-ish thing into a Date safely
function toDateSafe(v: any) {
  try {
    return new Date(v);
  } catch {
    return new Date(NaN);
  }
}

// Extract safest JSON from LLM output
function parseJsonLoose(s: string | null | undefined): any {
  if (!s) return {};
  // Try direct parse
  try {
    return JSON.parse(s);
  } catch {}
  // Try to find the biggest {...} block
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  // Try fenced code
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {}
  }
  return {};
}

export class OpenAIService {
  async planDay(date: string): Promise<any> {
    if (!process.env.OPENAI_API_KEY) {
      return { error: "OpenAI API key not configured" };
    }

    try {
      // Figure out tomorrow as local date string, not UTC slicing
      const [y, mo, d] = date.split("-").map(Number);
      const base = new Date();
      base.setFullYear(y, mo - 1, d);
      base.setHours(12, 0, 0, 0); // midday avoids DST edges
      const tomorrowDt = new Date(base.getTime());
      tomorrowDt.setDate(base.getDate() + 1);
      const tomorrow = `${tomorrowDt.getFullYear()}-${pad(tomorrowDt.getMonth() + 1)}-${pad(
        tomorrowDt.getDate()
      )}`;

      // Pull data
      const [meetingsToday, freeBlocksToday, meetingsTomorrow, freeBlocksTomorrow, tasks] = await Promise.all([
        calendarService.getEventsForDate(date),
        schedulerService.getFreeTimeSlots(date),
        calendarService.getEventsForDate(tomorrow),
        schedulerService.getFreeTimeSlots(tomorrow),
        storage.getTasks()
      ]);

      const pendingTasks = tasks.filter((t: any) => t.status === "pending");

      // Convert everything to local-ISO strings with offset so the model can’t get confused
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
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Day boundaries given as explicit anchors with offset
      const workStartToday = toLocalISO(localDayStart(date, 9, 0));
      const workEndToday = toLocalISO(localDayStart(date, 17, 0));
      const workStartTomorrow = toLocalISO(localDayStart(tomorrow, 9, 0));
      const workEndTomorrow = toLocalISO(localDayStart(tomorrow, 17, 0));

      // Build prompt
      const prompt = `You are an intelligent day planner. Create an optimal schedule considering working hours, task priorities, due dates, and available time gaps.
All times are LOCAL to the user. Timezone: "${localTz}". All timestamps below include numeric offsets. Do not convert them to Z.

HARD CONSTRAINTS:
- Schedule tasks only during 09:00–17:00 local on business days (no weekends).
- Do not overlap any "Meetings (Fixed)" intervals.
- Use 15-minute increments only (:00, :15, :30, :45).
- Use the provided anchors for day bounds. For ${date}: start=${workStartToday}, end=${workEndToday}. For ${tomorrow}: start=${workStartTomorrow}, end=${workEndTomorrow}.
- Return strictly valid JSON (no markdown, no comments).

TODAY ${date} (${localTz}):
Meetings (Fixed):
${mapMeetings(meetingsToday).map(m => `- ${m.title}: ${m.start} to ${m.end}${m.isAllDay ? " (all-day)" : ""}`).join("\n") || "- None"}
Free time blocks:
${mapBlocks(freeBlocksToday).map(b => `- ${b.start} to ${b.end}`).join("\n") || "- None"}

TOMORROW ${tomorrow} (${localTz}):
Meetings (Fixed):
${mapMeetings(meetingsTomorrow).map(m => `- ${m.title}: ${m.start} to ${m.end}${m.isAllDay ? " (all-day)" : ""}`).join("\n") || "- None"}
Free time blocks:
${mapBlocks(freeBlocksTomorrow).map(b => `- ${b.start} to ${b.end}`).join("\n") || "- None"}

TASKS (pending only):
${pendingTasks
  .map(
    (t: any) =>
      `- ${t.id} | ${t.title} | priority=${t.priority ?? 2} | estimate=${t.estimateMins ?? 30}m${
        t.dueAt ? ` | due=${toLocalISO(new Date(t.dueAt))}` : ""
      }`
  )
  .join("\n") || "- None"}

Return JSON:
{
  "scheduledTasks": [
    { "taskId": "...", "taskTitle": "...", "start": "<local ISO with offset>", "end": "<local ISO with offset>", "estimatedMinutes": 30, "reasoning": "..." }
  ],
  "unscheduledTasks": [
    { "taskId": "...", "taskTitle": "...", "reason": "..." }
  ],
  "recommendations": ["..."]
}`;

      // Fire the request
      const resp = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: "You are an expert day planner AI. Obsess over timezones, constraints, and JSON validity." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 1500
      });

      const raw = resp.choices?.[0]?.message?.content ?? "";
      
      // === COMPREHENSIVE DEBUG LOGGING ===
      console.log('=== OPENAI FULL RESPONSE DEBUG ===');
      console.log('Full OpenAI Response Object:', JSON.stringify(resp, null, 2));
      console.log('Raw Content from OpenAI:', raw);
      console.log('Raw Content Length:', raw.length);
      console.log('Raw Content Type:', typeof raw);
      console.log('=== PARSING ATTEMPT ===');
      
      const schedule = parseJsonLoose(raw);
      
      console.log('Parsed Schedule Object:', JSON.stringify(schedule, null, 2));
      console.log('Schedule Keys:', Object.keys(schedule));
      console.log('Scheduled Tasks Array:', schedule.scheduledTasks);
      console.log('=== END OPENAI DEBUG ===');

      // Post-validate the plan: local times, business hours, quarters, no weekend, no overlap with meetings
      const meetingsAll = [...mapMeetings(meetingsToday), ...mapMeetings(meetingsTomorrow)].map(m => ({
        start: toDateSafe(m.start),
        end: toDateSafe(m.end)
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

          // Determine which local date it’s scheduled on (use start)
          const dStr = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
          if (isWeekendLocal(dStr)) {
            unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Scheduled on weekend" });
            continue;
          }

          // Clamp to workday, round to quarter
          let sAdj = roundToQuarter(start);
          let eAdj = roundToQuarter(end);
          sAdj = clampToWorkday(sAdj, dStr);
          eAdj = clampToWorkday(eAdj, dStr);
          if (eAdj <= sAdj) {
            unscheduled.push({ taskId: s.taskId, taskTitle: s.taskTitle, reason: "Outside business hours" });
            continue;
          }

          // Check overlap with meetings
          let conflict = false;
          for (const m of meetingsAll) {
            if (overlaps(sAdj, eAdj, m.start, m.end)) {
              conflict = true;
              break;
            }
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

      // Finish result
      return {
        suggestions: validScheduled.map(s => ({ ...s, confidence: 0.85 })),
        unscheduledTasks: unscheduled,
        recommendations: Array.isArray(schedule.recommendations) ? schedule.recommendations : []
      };
    } catch (error: any) {
      // Be verbose in logs, polite in return
      console.error("Error planning day:", error?.response?.data || error);
      return { error: "Failed to generate day plan", details: String(error?.message || error) };
    }
  }

  async processMessage(message: string, conversationHistory: any[] = []): Promise<string> {
    if (!process.env.OPENAI_API_KEY) {
      return "OpenAI API key not configured. Please set OPENAI_API_KEY.";
    }

    try {
      if (this.isScheduleQuery(message)) {
        return await this.generateAgendaSummary();
      }

      if (this.isTaskCreationRequest(message) || this.hasActionItems(message)) {
        const result = await this.extractTasksFromText(message);
        return result.summary;
      }

      const messages = [
        {
          role: "system" as const,
          content:
            "You are a helpful AI assistant for a daily planning application called 'My Day'. Be concise and actionable."
        },
        ...conversationHistory.slice(-6),
        { role: "user" as const, content: message }
      ];

      const response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 500
      });

      return response.choices?.[0]?.message?.content || "I couldn't process your request.";
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

  private isScheduleQuery(message: string): boolean {
    const scheduleKeywords = [
      "what am i doing today",
      "today's schedule",
      "my day",
      "agenda",
      "schedule",
      "meetings today",
      "what's next"
    ];
    const lower = message.toLowerCase();
    return scheduleKeywords.some((k) => lower.includes(k));
  }

  private isTaskCreationRequest(message: string): boolean {
    const taskKeywords = [
      "create task",
      "add task",
      "new task",
      "i need to",
      "remind me to",
      "todo",
      "to do",
      "task:",
      "action item",
      "follow up",
      "schedule to"
    ];
    const lower = message.toLowerCase();
    return taskKeywords.some((k) => lower.includes(k));
  }

  private hasActionItems(message: string): boolean {
    const patterns = [
      /^(i need to|i have to|i should|i must|need to|have to|should|must)\s+/im,
      /please\s+(review|complete|follow up|respond|prepare|send|schedule|call|email)/i,
      /action items?:|next steps?:|to.?do:/i,
      /^\s*[\d\-\*\•]\s+/m,
      /(due|deadline|by|before)\s+(today|tomorrow|this week|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
    ];
    return patterns.some((p) => p.test(message)) || (message.split("\n").length > 1 && /^\s*[\d\-\*\•]/.test(message));
  }

  private async generateAgendaSummary(): Promise<string> {
    try {
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

      console.log('=== AGENDA SUMMARY DEBUG ===');
      console.log('Date string:', dateStr);

      // Call each service individually with error handling
      let meetings = [];
      let freeBlocks = [];
      let allTasks = [];
      let suggestions = [];

      try {
        meetings = await calendarService.getEventsForDate(dateStr);
        console.log('Meetings loaded successfully:', meetings.length);
      } catch (error) {
        console.error('Error loading meetings:', error);
      }

      try {
        freeBlocks = await schedulerService.getFreeTimeSlots(dateStr);
        console.log('Free blocks loaded successfully:', freeBlocks.length);
      } catch (error) {
        console.error('Error loading free blocks:', error);
      }

      try {
        allTasks = await storage.getTasks();
        console.log('Tasks loaded successfully:', allTasks.length);
      } catch (error) {
        console.error('Error loading tasks:', error);
      }

      try {
        suggestions = await schedulerService.generateScheduleSuggestions(dateStr);
        console.log('Suggestions loaded successfully:', suggestions.length);
      } catch (error) {
        console.error('Error loading suggestions:', error);
      }

      console.log('=== END AGENDA DEBUG ===');

      const topTasks = allTasks
        .filter((t: any) => t.status === "pending")
        .sort((a: any, b: any) => (b.priority ?? 2) - (a.priority ?? 2))
        .slice(0, 5);

      const summaryData = {
        meetings: meetings.map((m: any) => ({
          title: m.title,
          time: `${new Date(m.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(
            m.end
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          location: m.location
        })),
        freeBlocks: freeBlocks.map((b: any) => ({
          time: `${new Date(b.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(
            b.end
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        })),
        topTasks: topTasks.map((t: any) => ({
          title: t.title,
          priority: t.priority === 3 ? "High" : t.priority === 2 ? "Medium" : "Low",
          due: t.dueAt ? new Date(t.dueAt).toLocaleDateString() : "No due date"
        })),
        suggestions: (suggestions || []).slice(0, 3).map((s: any) => ({
          task: s.taskTitle,
          time: `${new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${new Date(
            s.end
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        }))
      };

      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: "You are a helpful daily planning assistant. Provide clear, well-organized summaries." },
          {
            role: "user",
            content:
              "Based on this schedule data, provide a concise, conversational summary for today's agenda:\n\n" +
              JSON.stringify(summaryData, null, 2)
          }
        ],
        temperature: 0.3,
        max_tokens: 600
      });

      return response.choices?.[0]?.message?.content || "I couldn't generate your agenda summary.";
    } catch (error: any) {
      console.error("Error generating agenda summary:", error?.response?.data || error);
      if (error?.code === "invalid_api_key" || error?.status === 401) {
        return "OpenAI API key is invalid or missing. Please check your API key configuration.";
      }
      return "I'm having trouble generating your agenda summary. Please try again later.";
    }
  }

  private async extractTaskFromText(_: string): Promise<string> {
    return "Please use the new task extraction feature. Paste your text and I’ll pull out action items.";
  }

  async extractTasksFromText(textContent: string): Promise<{ tasks: any[]; summary: string }> {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              `You are a task extraction expert. Return STRICT JSON with keys {"tasks":[...],"summary":"..."}.\n` +
              `Each task: { "title": string, "priority": 1|2|3, "estimateMins": number, "context": string, "dueAt": ISO|null }`
          },
          { role: "user", content: `Extract all tasks and action items from this text:\n\n${textContent}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 1000
      });

      const result = parseJsonLoose(response.choices?.[0]?.message?.content);
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
            `• ${t.title} (${t.priority === 3 ? "High" : t.priority === 2 ? "Medium" : "Low"} priority${
              t.dueAt ? `, due ${new Date(t.dueAt).toLocaleDateString()}` : ""
            })`
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
}

export const openaiService = new OpenAIService();