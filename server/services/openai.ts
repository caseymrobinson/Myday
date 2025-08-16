import OpenAI from "openai";
import { calendarService } from "./calendar";
import { schedulerService } from "./scheduler";
import { storage } from "../storage";

// Using gpt-5-mini model as requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || ""
});

export class OpenAIService {
  async planDay(date: string): Promise<any> {
    if (!process.env.OPENAI_API_KEY) {
      return { error: "OpenAI API key not configured" };
    }

    try {
      // Get calendar events and tasks for multiple days
      const today = new Date(date);
      const tomorrow = new Date(date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const meetingsToday = await calendarService.getEventsForDate(date);
      const freeBlocksToday = await schedulerService.getFreeTimeSlots(date);
      const meetingsTomorrow = await calendarService.getEventsForDate(tomorrow.toISOString().split('T')[0]);
      const freeBlocksTomorrow = await schedulerService.getFreeTimeSlots(tomorrow.toISOString().split('T')[0]);
      
      const tasks = await storage.getTasks();
      
      // Filter pending tasks
      const pendingTasks = tasks.filter(t => t.status === 'pending');
      
      console.log('DEBUG - OpenAI Planning:', {
        date,
        totalTasks: tasks.length,
        pendingTasks: pendingTasks.length,
        meetingsToday: meetingsToday.length,
        freeBlocksToday: freeBlocksToday.length,
        meetingsTomorrow: meetingsTomorrow.length,
        freeBlocksTomorrow: freeBlocksTomorrow.length
      });
      
      if (pendingTasks.length === 0) {
        console.log('No pending tasks to schedule');
        return {
          suggestions: [],
          unscheduledTasks: [],
          recommendations: ["All tasks are completed! Consider adding new tasks to your list."]
        };
      }
      
      // Build prompt for AI with multi-day support
      const prompt = `You are an intelligent day planner. Given the following calendar events and tasks, create an optimal schedule.

Current Date: ${date}
Current Time: ${new Date().toISOString()}

TODAY'S CALENDAR (${date}):
Meetings (Fixed): ${meetingsToday.length > 0 ? meetingsToday.map((m: any) => `\n  - ${m.title}: ${m.start} to ${m.end}`).join('') : '\n  - No meetings'}
Free Time Blocks: ${freeBlocksToday.length > 0 ? freeBlocksToday.map((b: any) => `\n  - ${b.start} to ${b.end}`).join('') : '\n  - No free time today'}

TOMORROW'S CALENDAR (${tomorrow.toISOString().split('T')[0]}):
Meetings (Fixed): ${meetingsTomorrow.length > 0 ? meetingsTomorrow.map((m: any) => `\n  - ${m.title}: ${m.start} to ${m.end}`).join('') : '\n  - No meetings'}
Free Time Blocks: ${freeBlocksTomorrow.length > 0 ? freeBlocksTomorrow.map((b: any) => `\n  - ${b.start} to ${b.end}`).join('') : '\n  - No free time tomorrow'}

TASKS TO SCHEDULE:
${pendingTasks.map((t: any) => `- ID: ${t.id}, Title: ${t.title}, Priority ${t.priority}, Duration: ${t.estimateMins || 30} mins${t.dueAt ? `, Due: ${t.dueAt}` : ''}`).join('\n')}

CRITICAL INSTRUCTIONS:
1. STRICTLY schedule tasks ONLY between 9:00 AM and 5:00 PM (business hours)
2. All start/end times MUST be within business hours (9 AM - 5 PM)
3. If today's business hours are full, schedule for tomorrow's business hours
4. Schedule high priority (3) tasks first, then medium (2), then low (1)
5. Tasks due today/tomorrow get scheduling priority
6. Never schedule during existing meetings
7. Leave 5-10 minute buffers between tasks
8. If a task cannot fit today, try tomorrow before marking as unscheduled

Return a JSON object with this structure:
{
  "scheduledTasks": [
    {
      "taskId": "task-id",
      "taskTitle": "task title",
      "start": "ISO datetime",
      "end": "ISO datetime",
      "estimatedMinutes": number,
      "reasoning": "brief explanation of why scheduled at this time"
    }
  ],
  "unscheduledTasks": [
    {
      "taskId": "task-id",
      "taskTitle": "task title",
      "reason": "why it couldn't be scheduled"
    }
  ],
  "recommendations": [
    "General productivity tips for the day"
  ]
}`;

      console.log('Sending prompt to OpenAI:', prompt.substring(0, 500) + '...');
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o", // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
        messages: [
          {
            role: "system",
            content: "You are an expert day planner AI. Create optimal schedules considering priority, deadlines, energy levels, and work patterns."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1500
      });
      
      console.log('OpenAI raw response:', response.choices[0].message.content);

      const schedule = JSON.parse(response.choices[0].message.content || "{}");
      
      // Transform to match our suggestion format
      const suggestions = schedule.scheduledTasks?.map((task: any) => ({
        taskId: task.taskId,
        taskTitle: task.taskTitle,
        start: task.start,
        end: task.end,
        estimatedMinutes: task.estimatedMinutes,
        reasoning: task.reasoning,
        confidence: 0.85 // AI confidence score
      })) || [];

      return {
        suggestions,
        unscheduledTasks: schedule.unscheduledTasks || [],
        recommendations: schedule.recommendations || []
      };
    } catch (error: any) {
      console.error("Error planning day:", error);
      return { error: "Failed to generate day plan", details: error.message };
    }
  }
  async processMessage(message: string): Promise<string> {
    if (!process.env.OPENAI_API_KEY) {
      return "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.";
    }

    try {
      // Check if message is asking about today's schedule
      if (this.isScheduleQuery(message)) {
        return await this.generateAgendaSummary();
      }

      // Check if message is about task extraction from Slack-like text
      if (this.isTaskExtractionQuery(message)) {
        return await this.extractTaskFromText(message);
      }

      // Generic conversation
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful AI assistant for a daily planning application. You help users manage their schedule, tasks, and productivity. Be concise and actionable in your responses."
          },
          {
            role: "user",
            content: message
          }
        ],
        max_completion_tokens: 500
      });

      return response.choices[0].message.content || "I couldn't process your request. Please try again.";
    } catch (error: any) {
      console.error("OpenAI API error:", error);
      
      // Check if it's an API key issue
      if (error.code === 'invalid_api_key' || error.status === 401) {
        return "OpenAI API key is invalid or missing. Please check your API key configuration.";
      }
      
      // Check if it's a model issue
      if (error.message && error.message.includes('model')) {
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
    
    const lowerMessage = message.toLowerCase();
    return scheduleKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private isTaskExtractionQuery(message: string): boolean {
    const taskKeywords = [
      "extract task",
      "create task from",
      "parse this message",
      "task from slack"
    ];
    
    const lowerMessage = message.toLowerCase();
    return taskKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private async generateAgendaSummary(): Promise<string> {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Get today's meetings
      const meetings = await calendarService.getEventsForDate(today);
      
      // Get free time blocks
      const freeBlocks = await schedulerService.getFreeTimeSlots(today);
      
      // Get top tasks
      const allTasks = await storage.getTasks();
      const topTasks = allTasks
        .filter(task => task.status === 'pending')
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5);
      
      // Get AI suggestions
      const suggestions = await schedulerService.generateScheduleSuggestions(today);

      const summaryData = {
        meetings: meetings.map(m => ({
          title: m.title,
          time: `${new Date(m.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${new Date(m.end).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`,
          location: m.location
        })),
        freeBlocks: freeBlocks.map(block => ({
          time: `${new Date(block.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${new Date(block.end).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
        })),
        topTasks: topTasks.map(task => ({
          title: task.title,
          priority: task.priority === 3 ? 'High' : task.priority === 2 ? 'Medium' : 'Low',
          due: task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No due date'
        })),
        suggestions: suggestions.slice(0, 3).map(s => ({
          task: s.taskTitle,
          time: `${new Date(s.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${new Date(s.end).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
        }))
      };

      const prompt = `Based on this schedule data, provide a natural language summary for today's agenda:

${JSON.stringify(summaryData, null, 2)}

Format the response as a friendly, conversational summary that includes:
1. Today's meetings with times and locations
2. Available free time blocks
3. Top priority tasks to focus on
4. AI-suggested focus blocks

Keep it concise but comprehensive.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful daily planning assistant. Provide clear, well-organized summaries of daily schedules."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_completion_tokens: 600
      });

      return response.choices[0].message.content || "I couldn't generate your agenda summary.";
    } catch (error: any) {
      console.error("Error generating agenda summary:", error);
      
      // Check if it's an API key issue
      if (error.code === 'invalid_api_key' || error.status === 401) {
        return "OpenAI API key is invalid or missing. Please check your API key configuration.";
      }
      
      return "I'm having trouble generating your agenda summary. Please try again later.";
    }
  }

  private async extractTaskFromText(message: string): Promise<string> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a task extraction expert. Extract actionable tasks from text messages. 
            Return a JSON object with the following structure:
            {
              "title": "concise task title",
              "priority": 1-3 (1=low, 2=medium, 3=high),
              "estimateMins": estimated minutes to complete,
              "context": "additional context or notes"
            }
            
            If no clear task can be extracted, return {"error": "No actionable task found"}`
          },
          {
            role: "user",
            content: `Extract a task from this message: ${message}`
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 300
      });

      const result = JSON.parse(response.choices[0].message.content || "{}");
      
      if (result.error) {
        return result.error;
      }

      // Create the task
      await storage.createTask({
        title: result.title,
        source: 'ai',
        status: 'pending',
        priority: result.priority || 2,
        estimateMins: result.estimateMins || 30,
        context: result.context ? { note: result.context } : null,
        aiSuggested: true,
        dueAt: null,
        url: null
      });

      return `I've extracted and created a new task: "${result.title}" with ${result.priority === 3 ? 'high' : result.priority === 2 ? 'medium' : 'low'} priority.`;
    } catch (error) {
      console.error("Error extracting task:", error);
      return "I couldn't extract a task from that message. Please try rephrasing it.";
    }
  }
}

export const openaiService = new OpenAIService();
