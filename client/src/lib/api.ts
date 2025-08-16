import { apiRequest } from "./queryClient";
import type { Task, AgendaResponse } from "../types";

export { apiRequest };

export const api = {
  // Tasks
  getTasks: async (): Promise<Task[]> => {
    const response = await apiRequest("GET", "/api/tasks");
    return response.json();
  },

  createTask: async (task: Partial<Task>): Promise<Task> => {
    const response = await apiRequest("POST", "/api/tasks", task);
    return response.json();
  },

  updateTask: async (id: string, updates: Partial<Task>): Promise<Task> => {
    const response = await apiRequest("PATCH", `/api/tasks/${id}`, updates);
    return response.json();
  },

  // Agenda
  getAgenda: async (date?: string): Promise<AgendaResponse> => {
    const dateParam = date ? `?date=${date}` : '';
    const response = await apiRequest("GET", `/api/agenda${dateParam}`);
    return response.json();
  },

  // Chat
  sendMessage: async (message: string): Promise<{ response: string }> => {
    const response = await apiRequest("POST", "/api/chat", { message });
    return response.json();
  },

  // Focus blocks
  createFocusBlock: async (focusBlock: any): Promise<any> => {
    const response = await apiRequest("POST", "/api/focus-blocks", focusBlock);
    return response.json();
  },

  updateFocusBlock: async (id: string, updates: any): Promise<any> => {
    const response = await apiRequest("PATCH", `/api/focus-blocks/${id}`, updates);
    return response.json();
  },

  // Calendar
  syncCalendar: async (): Promise<{ message: string }> => {
    const response = await apiRequest("POST", "/api/sync-calendar");
    return response.json();
  },

  setupCalendar: async (icsUrl: string): Promise<{ message: string }> => {
    const response = await apiRequest("POST", "/api/calendar/setup", { icsUrl });
    return response.json();
  }
};
