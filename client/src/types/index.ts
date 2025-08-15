export interface Task {
  id: string;
  title: string;
  source: 'manual' | 'slack' | 'ai';
  status: 'pending' | 'confirmed' | 'done';
  priority: number;
  dueAt?: Date | null;
  estimateMins?: number | null;
  url?: string | null;
  context?: any;
  aiSuggested: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FocusBlock {
  id: string;
  taskId: string;
  start: Date;
  end: Date;
  confirmed: boolean;
  createdAt: Date;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  description?: string | null;
  isAllDay: boolean;
}

export interface AgendaResponse {
  meetings: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
    isAllDay: boolean;
  }>;
  freeBlocks: Array<{
    start: string;
    end: string;
  }>;
  topTasks: Array<{
    id: string;
    title: string;
    priority: number;
    estimateMins: number | null;
    dueAt: string | null;
    source: string;
    aiSuggested: boolean;
  }>;
  suggestions: Array<{
    taskId: string;
    taskTitle: string;
    start: string;
    end: string;
    estimateMins: number;
  }>;
}

export interface ChatMessage {
  id: string;
  message: string;
  response?: string;
  timestamp: Date;
  isUser: boolean;
}
