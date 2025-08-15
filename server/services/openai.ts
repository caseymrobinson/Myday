import OpenAI from "openai";
import { calendarService } from "./calendar";
import { schedulerService } from "./scheduler";
import { storage } from "../storage";

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || ""
});

export class OpenAIService {
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
        model: "gpt-5-nano",
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
    } catch (error) {
      console.error("OpenAI API error:", error);
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
        model: "gpt-5-nano",
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
    } catch (error) {
      console.error("Error generating agenda summary:", error);
      return "I couldn't generate your agenda summary right now. Please try again.";
    }
  }

  private async extractTaskFromText(message: string): Promise<string> {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5-nano",
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
