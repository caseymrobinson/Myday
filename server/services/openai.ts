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

CRITICAL BUSINESS HOUR CONSTRAINTS - FOLLOW EXACTLY:
1. **ABSOLUTE REQUIREMENT**: Only schedule between 9:00 AM and 5:00 PM in Eastern Time (EST/EDT)
2. **TIMEZONE CRITICAL**: When generating ISO datetime strings, ensure they represent 9 AM - 5 PM Eastern Time
3. **EXAMPLE**: For ${date}, 9:00 AM ET = "2025-08-16T13:00:00.000Z" (UTC), 5:00 PM ET = "2025-08-16T21:00:00.000Z" (UTC)
4. **QUARTER-HOUR ONLY**: All times MUST be on 15-minute intervals (:00, :15, :30, :45)
5. **VALIDATION**: Every scheduled time must be between 13:00Z and 21:00Z (UTC equivalent of 9 AM - 5 PM ET)
6. **NO EXCEPTIONS**: If you schedule anything outside 13:00Z-21:00Z range, you have failed the constraint
7. Schedule high priority tasks first, respect due dates
8. Never schedule during existing meetings

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
    "This is why I scheduled it this way..."
  ]
}`;

      console.log('Sending prompt to OpenAI:', prompt.substring(0, 500) + '...');
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
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
  async processMessage(message: string, conversationHistory: any[] = []): Promise<string> {
    if (!process.env.OPENAI_API_KEY) {
      return "OpenAI API key not configured. Please set OPENAI_API_KEY environment variable.";
    }

    try {
      // Check if message is asking about today's schedule
      if (this.isScheduleQuery(message)) {
        return await this.generateAgendaSummary();
      }

      // Check if user is asking to create a task or message contains action items
      if (this.isTaskCreationRequest(message) || this.hasActionItems(message)) {
        const result = await this.extractTasksFromText(message);
        return result.summary;
      }

      // Build conversation messages with history
      const messages = [
        {
          role: "system" as const,
          content: "You are a helpful AI assistant for a daily planning application called 'My Day'. You help users manage their schedule, tasks, and productivity. You can create tasks when users ask or when you identify action items in their messages. Be concise and actionable in your responses. Remember context from previous messages in this conversation."
        },
        // Add conversation history
        ...conversationHistory.slice(-6), // Keep last 6 messages for context
        {
          role: "user" as const,
          content: message
        }
      ];

      // Generic conversation
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 500
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
  
  private isEmailContent(message: string): boolean {
    // Check for common email patterns
    const emailPatterns = [
      /^(from:|to:|subject:|date:|sent:|re:|fw:|fwd:)/im,
      /dear\s+\w+/i,
      /sincerely|regards|best|thanks/i,
      /please\s+(review|complete|follow up|respond|prepare|send|schedule)/i,
      /action items?:|next steps?:|to.?do:/i,
      /here is an email/i,
      /here's an email/i,
      /^\d+\.\s+/m, // numbered lists (common in emails)
      /email.*:/i
    ];
    
    // Check if message is long enough to be an email
    const isLongEnough = message.length > 100;
    
    // Check if it contains multiple lines (typical of emails)
    const hasMultipleLines = message.split('\n').length > 2;
    
    // Check for numbered or bulleted lists (common action items)
    const hasListItems = /^\s*[\d\-\*\•]\s+/m.test(message);
    
    return (isLongEnough && hasMultipleLines) || 
           hasListItems ||
           emailPatterns.some(pattern => pattern.test(message));
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
    
    const lowerMessage = message.toLowerCase();
    return taskKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  private hasActionItems(message: string): boolean {
    // Check for action-oriented language and task patterns
    const actionPatterns = [
      /^(i need to|i have to|i should|i must|need to|have to|should|must)\s+/im,
      /please\s+(review|complete|follow up|respond|prepare|send|schedule|call|email)/i,
      /action items?:|next steps?:|to.?do:/i,
      /^\s*[\d\-\*\•]\s+/m, // numbered or bulleted lists
      /(due|deadline|by|before)\s+(today|tomorrow|this week|next week|friday|monday|tuesday|wednesday|thursday|saturday|sunday)/i
    ];
    
    return actionPatterns.some(pattern => pattern.test(message)) || 
           (message.split('\n').length > 1 && /^\s*[\d\-\*\•]/.test(message));
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
        model: "gpt-4o-mini",
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
        max_tokens: 600
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
    return "Please use the new task extraction feature. Simply paste your email or text and I'll extract all action items for you.";
  }
  
  async extractTasksFromText(textContent: string): Promise<{ tasks: any[], summary: string }> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a task extraction expert. Extract ALL actionable tasks from emails or text messages. 
            Return a JSON object with the following structure:
            {
              "tasks": [
                {
                  "title": "concise task title",
                  "priority": 1-3 (1=low, 2=medium, 3=high based on urgency/importance),
                  "estimateMins": estimated minutes to complete,
                  "context": "relevant context from the email",
                  "dueAt": "ISO date string if a deadline is mentioned, otherwise null"
                }
              ],
              "summary": "Brief summary of what was extracted"
            }
            
            Extract ALL action items, to-dos, follow-ups, and commitments mentioned.
            If no tasks found, return {"tasks": [], "summary": "No actionable tasks found"}`
          },
          {
            role: "user",
            content: `Extract all tasks and action items from this text:\n\n${textContent}`
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1000
      });

      const result = JSON.parse(response.choices[0].message.content || "{}");
      
      if (!result.tasks || result.tasks.length === 0) {
        return { 
          tasks: [], 
          summary: "No actionable tasks found in the provided text." 
        };
      }

      // Create all the tasks
      const createdTasks = [];
      for (const task of result.tasks) {
        const createdTask = await storage.createTask({
          title: task.title,
          source: 'ai',
          status: 'pending',
          priority: task.priority || 2,
          estimateMins: task.estimateMins || 30,
          context: task.context ? { note: task.context, source: 'email' } : { source: 'email' },
          aiSuggested: false,
          dueAt: task.dueAt ? new Date(task.dueAt) : null,
          url: null
        });
        createdTasks.push(createdTask);
      }

      const taskSummary = createdTasks.map(t => 
        `• ${t.title} (${t.priority === 3 ? 'High' : t.priority === 2 ? 'Medium' : 'Low'} priority${t.dueAt ? `, due ${new Date(t.dueAt).toLocaleDateString()}` : ''})`
      ).join('\n');

      return {
        tasks: createdTasks,
        summary: `I've successfully extracted and created ${createdTasks.length} task${createdTasks.length !== 1 ? 's' : ''}:\n\n${taskSummary}`
      };
    } catch (error) {
      console.error("Error extracting tasks:", error);
      return {
        tasks: [],
        summary: "I couldn't extract tasks from that text. Please try again or check if the text contains action items."
      };
    }
  }
}

export const openaiService = new OpenAIService();
