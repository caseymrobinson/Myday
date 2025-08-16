import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import type { CalendarEvent, FocusBlock } from "../types";
import { Bot, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface CalendarPanelProps {
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  onOpenChat: () => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  showChat: boolean;
}

export default function CalendarPanel({ events, focusBlocks, onOpenChat, selectedDate, onDateChange, showChat }: CalendarPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const { toast } = useToast();

  // Get current date and time for header
  const currentDate = selectedDate || new Date();
  const dateString = currentDate.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const timeString = new Date().toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: Array<{role: string, content: string}> }) => 
      api.sendMessage(message, history || []),
    onSuccess: () => {
      setChatInput("");
      toast({ title: "Message sent to AI assistant" });
      // Optionally open chat panel to show response
      onOpenChat();
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    }
  });

  const handleQuickMessage = (message: string) => {
    sendMessageMutation.mutate({ message, history: [] });
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    handleQuickMessage(chatInput);
  };

  // Generate hour slots for the day
  const hours = Array.from({ length: 24 }, (_, i) => {
    const hour = i;
    const period = hour < 12 ? 'am' : 'pm';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return {
      hour24: hour,
      label: `${displayHour} ${period}`,
      time: new Date().setHours(hour, 0, 0, 0)
    };
  });

  // Check if there's an event at a specific hour
  const getEventAtHour = (hour: number) => {
    const hourStart = new Date();
    hourStart.setHours(hour, 0, 0, 0);
    const hourEnd = new Date();
    hourEnd.setHours(hour + 1, 0, 0, 0);

    // Check calendar events
    const calendarEvent = events?.find(event => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventStart < hourEnd && eventEnd > hourStart;
    });

    // Check focus blocks
    const focusBlock = focusBlocks?.find(block => {
      const blockStart = new Date(block.start);
      const blockEnd = new Date(block.end);
      return blockStart < hourEnd && blockEnd > hourStart;
    });

    return { calendarEvent, focusBlock };
  };

  // Get current hour for highlighting (only if viewing today)
  const now = new Date();
  const isToday = currentDate.toDateString() === now.toDateString();
  const currentHour = isToday ? now.getHours() : -1;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header with Date/Time */}
      <div className="flex items-center justify-between px-6 py-4 bg-gray-900">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <span className="text-white text-xl font-semibold">{dateString}</span>
          <span className="text-gray-600">•</span>
          <span>{timeString}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => {
              const newDate = new Date(currentDate);
              newDate.setDate(newDate.getDate() - 1);
              onDateChange(newDate);
            }}
            className="text-gray-400 hover:text-white hover:bg-gray-700"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button 
            onClick={() => onDateChange(new Date())}
            className="bg-primary hover:bg-primary/90 text-white"
          >
            Today
          </Button>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => {
              const newDate = new Date(currentDate);
              newDate.setDate(newDate.getDate() + 1);
              onDateChange(newDate);
            }}
            className="text-gray-400 hover:text-white hover:bg-gray-700"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {/* Legend */}
      <div className="px-6 py-4 bg-gray-950">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span className="text-gray-400">Meetings</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-gray-400">Confirmed tasks</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span>
              <span className="text-gray-400">AI suggested tasks</span>
            </div>
          </div>
        </div>
      </div>
      {/* Calendar Grid */}
      <ScrollArea className="flex-1 bg-black">
        <div className="px-6">
          {hours.map((hour) => {
            const { calendarEvent, focusBlock } = getEventAtHour(hour.hour24);
            const isCurrentHour = hour.hour24 === currentHour;
            
            return (
              <div 
                key={hour.hour24} 
                className={`relative h-16 ${isCurrentHour ? 'bg-gray-900/50' : 'hover:bg-gray-950/50'}`}
              >
                {/* Hour label */}
                <span className="absolute -top-2 left-0 text-xs text-gray-600">
                  {hour.label}
                </span>

                {/* Events */}
                {calendarEvent && (
                  <div className="absolute inset-x-0 top-4 mx-2">
                    <div className="bg-blue-500/20 border-l-2 border-blue-500 rounded px-2 py-1">
                      <p className="text-xs text-blue-400 truncate">{calendarEvent.title}</p>
                    </div>
                  </div>
                )}

                {focusBlock && (
                  <div className="absolute inset-x-0 top-4 mx-2">
                    <div className={`${focusBlock.confirmed ? 'bg-green-500/20 border-green-500' : 'bg-purple-500/20 border-purple-500'} border-l-2 rounded px-2 py-1`}>
                      <p className={`text-xs ${focusBlock.confirmed ? 'text-green-400' : 'text-purple-400'} truncate`}>
                        Task Block
                      </p>
                    </div>
                  </div>
                )}

                {/* Current time indicator */}
                {isCurrentHour && (
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-red-500/50"></div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      
      {/* Interactive Chat Bubble - Only show when chat panel is closed */}
      {!showChat && (
        <div className="p-4 bg-gray-950 flex justify-center">
          <div className="bg-gray-900 rounded-2xl p-4 relative max-w-[620px] w-full">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {/* Interactive Input */}
                <form onSubmit={handleChatSubmit} className="relative mb-3">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask me about my schedule"
                    className="bg-gray-800 border-gray-700 text-white placeholder-gray-500 pr-10 rounded-lg"
                    disabled={sendMessageMutation.isPending}
                    data-testid="schedule-chat-input"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!chatInput.trim() || sendMessageMutation.isPending}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-purple-500 hover:bg-purple-600 text-white rounded h-7 w-7"
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </form>
                
                {/* Quick Action Buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("I need to create a task")}
                    disabled={sendMessageMutation.isPending}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                    data-testid="quick-create-task"
                  >
                    Create task
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("When is my next meeting?")}
                    disabled={sendMessageMutation.isPending}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                    data-testid="quick-next-meeting"
                  >
                    Next meeting
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("Book focus time for me")}
                    disabled={sendMessageMutation.isPending}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                    data-testid="quick-book-focus"
                  >
                    Book focus time
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("Help me prioritize my tasks")}
                    disabled={sendMessageMutation.isPending}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                    data-testid="quick-prioritize"
                  >
                    Prioritize?
                  </Button>
                </div>
              </div>
              <div className="ml-4 flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onOpenChat}
                  className="h-10 w-10 rounded-full bg-purple-500 hover:bg-purple-600 text-white"
                  data-testid="button-open-chat-panel"
                >
                  <Bot className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}