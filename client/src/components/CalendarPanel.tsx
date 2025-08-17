import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import type { CalendarEvent, FocusBlock } from "../types";
import { Bot, ChevronLeft, ChevronRight, Send, Check, X, Calendar } from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface CalendarPanelProps {
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
  onOpenChat: () => void;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  showChat: boolean;
  onConfirmFocusBlock?: (blockId: string) => void;
  onDismissFocusBlock?: (blockId: string) => void;
}

export default function CalendarPanel({ events, focusBlocks, onOpenChat, selectedDate, onDateChange, showChat, onConfirmFocusBlock, onDismissFocusBlock }: CalendarPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();



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

  // Focus block mutations
  const confirmFocusBlockMutation = useMutation({
    mutationFn: (blockId: string) => api.updateFocusBlock(blockId, { confirmed: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/focus-blocks'] });
      toast({ title: "Task confirmed in schedule" });
    },
    onError: () => {
      toast({ title: "Failed to confirm task", variant: "destructive" });
    }
  });

  const dismissFocusBlockMutation = useMutation({
    mutationFn: (blockId: string) => api.deleteFocusBlock(blockId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/focus-blocks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "Task removed from schedule" });
    },
    onError: () => {
      toast({ title: "Failed to remove task", variant: "destructive" });
    }
  });

  const handleConfirmFocusBlock = (blockId: string) => {
    confirmFocusBlockMutation.mutate(blockId);
  };

  const handleDismissFocusBlock = (blockId: string) => {
    dismissFocusBlockMutation.mutate(blockId);
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

  // Calculate positioned events for the entire day
  const calculateEventPositions = () => {
    const dayStart = new Date(currentDate);
    dayStart.setHours(0, 0, 0, 0); // Use local time, not UTC
    const dayEnd = new Date(currentDate);
    dayEnd.setHours(23, 59, 59, 999);

    const allEvents: Array<{
      id: string;
      title: string;
      start: Date;
      end: Date;
      color: string;
      type: 'calendar' | 'focus';
      focusBlock?: FocusBlock;
    }> = [];

    // Process calendar events (exclude all-day events from timeline)
    events?.forEach(event => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      
      // Only include timed events that occur on this day (all-day events handled separately)
      if (!event.isAllDay && eventStart >= dayStart && eventStart <= dayEnd) {
        allEvents.push({
          id: event.id,
          title: event.title,
          start: eventStart,
          end: eventEnd,
          color: 'blue',
          type: 'calendar'
        });
      }
    });

    // Process focus blocks
    focusBlocks?.forEach(block => {
      const blockStart = new Date(block.start);
      const blockEnd = new Date(block.end);
      
      // Only include blocks that occur on this day (using local time)
      if (blockStart >= dayStart && blockStart <= dayEnd) {
        allEvents.push({
          id: block.id,
          title: 'Task Block',
          start: blockStart,
          end: blockEnd,
          color: block.confirmed ? 'green' : 'purple',
          type: 'focus',
          focusBlock: block // Add full block data for actions
        });
      }
    });

    // Sort events by start time
    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Detect overlapping events and assign columns
    const positionedEvents: Array<{
      id: string;
      title: string;
      top: number;
      height: number;
      color: string;
      type: 'calendar' | 'focus';
      column: number;
      totalColumns: number;
      focusBlock?: FocusBlock;
    }> = [];

    const columns: Array<{ endTime: Date; events: any[] }> = [];

    allEvents.forEach(event => {
      // Find a column where this event doesn't overlap
      let assignedColumn = -1;
      for (let i = 0; i < columns.length; i++) {
        if (event.start >= columns[i].endTime) {
          assignedColumn = i;
          break;
        }
      }

      // If no column available, create a new one
      if (assignedColumn === -1) {
        assignedColumn = columns.length;
        columns.push({ endTime: event.end, events: [] });
      } else {
        columns[assignedColumn].endTime = new Date(Math.max(columns[assignedColumn].endTime.getTime(), event.end.getTime()));
      }

      columns[assignedColumn].events.push(event);

      // Calculate position and height using local time
      const startHour = event.start.getHours();
      const startMinutes = event.start.getMinutes();
      const endHour = event.end.getHours();
      const endMinutes = event.end.getMinutes();
      
      // Calculate position and height
      const top = (startHour * 64) + (startMinutes / 60 * 64); // 64px per hour
      const durationHours = (endHour - startHour) + (endMinutes - startMinutes) / 60;
      const height = Math.max(durationHours * 64, 32); // Minimum 32px height

      positionedEvents.push({
        id: event.id,
        title: event.title,
        top,
        height,
        color: event.color,
        type: event.type,
        column: assignedColumn,
        totalColumns: 0, // Will be set below
        focusBlock: event.focusBlock
      });
    });

    // Update totalColumns for all events
    const maxColumns = columns.length;
    positionedEvents.forEach(event => {
      event.totalColumns = maxColumns;
    });

    return positionedEvents;
  };

  const positionedEvents = calculateEventPositions();

  // Get all-day events for this day
  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(currentDate);
  dayEnd.setHours(23, 59, 59, 999);
  
  const allDayEvents = events?.filter(event => {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    return event.isAllDay && eventStart >= dayStart && eventStart <= dayEnd;
  }) || [];

  // Get current hour for highlighting (only if viewing today)
  const now = new Date();
  const isToday = currentDate.toDateString() === now.toDateString();
  const currentHour = isToday ? now.getHours() : -1;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header with Date/Time */}
      <div className="flex items-center justify-between px-6 pt-4 pb-0 bg-[#1e1e1e]">
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
            className="hover:bg-primary/90 text-white bg-[#5E00E1]"
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
      <div className="px-6 py-4 bg-[#1e1e1e] pt-[4px] pb-[16px]">
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
              <span className="w-2 h-2 rounded-full bg-[#5E00E1]"></span>
              <span className="text-gray-400">AI suggested tasks</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* All-Day Events Sticky Header */}
      {allDayEvents.length > 0 && (
        <div className="sticky top-0 z-40 bg-gray-950 border-b border-gray-800">
          <div className="px-6 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-400 font-medium">All Day</span>
            </div>
            <div className="space-y-2">
              {allDayEvents.map((event) => (
                <div
                  key={event.id}
                  className="bg-indigo-500/20 border-l-2 border-indigo-500 rounded px-3 py-2 text-sm"
                >
                  <div className="text-indigo-300 font-medium">{event.title}</div>
                  {event.location && (
                    <div className="text-gray-400 text-xs mt-1">{event.location}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Calendar Grid */}
      <ScrollArea className="flex-1 bg-black">
        <div className="px-6 relative">
          {/* Hour grid background */}
          {hours.map((hour) => {
            const isCurrentHour = hour.hour24 === currentHour;
            
            return (
              <div 
                key={hour.hour24} 
                className={`relative h-16 ${isCurrentHour ? 'bg-gray-900/50' : 'hover:bg-gray-950/50'}`}
              >
                {/* Hour label */}
                <span className="absolute -top-2 left-0 text-xs text-gray-600 z-10">
                  {hour.label}
                </span>

                {/* Hour divider */}
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-800/50"></div>

                {/* Current time indicator */}
                {isCurrentHour && (
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-red-500/50 z-30"></div>
                )}
              </div>
            );
          })}

          {/* Positioned events overlay */}
          {positionedEvents.map((event) => {
            const leftOffset = 32; // Space for time labels
            const eventWidth = event.totalColumns > 1 ? 
              `calc((100% - ${leftOffset}px) / ${event.totalColumns})` : 
              `calc(100% - ${leftOffset}px)`;
            const leftPosition = event.totalColumns > 1 ? 
              `${leftOffset + (event.column * ((100 - leftOffset) / event.totalColumns))}%` : 
              `${leftOffset}px`;

            return (
              <div
                key={event.id}
                className="absolute z-20 pr-2"
                style={{
                  top: `${event.top + 16}px`, // +16px to account for hour label space
                  height: `${event.height - 8}px`, // -8px for padding
                  left: leftPosition,
                  width: eventWidth
                }}
              >
                <div 
                  className={`
                    ${event.color === 'blue' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : ''}
                    ${event.color === 'green' ? 'bg-green-500/20 border-green-500 text-green-400' : ''}
                    ${event.color === 'purple' ? 'bg-[#5E00E1]/20 border-[#5E00E1] text-[#8C4CFF]' : ''}
                    border-l-2 rounded px-2 py-1 h-full flex flex-col justify-between
                  `}
                >
                  <p className="text-xs truncate">{event.title}</p>
                  
                  {/* Focus block controls */}
                  {event.type === 'focus' && event.focusBlock && !event.focusBlock.confirmed && (
                    <div className="flex items-center gap-1 mt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmFocusBlock(event.focusBlock!.id);
                        }}
                        className="h-5 w-5 p-0 hover:bg-green-500/30 text-green-400"
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDismissFocusBlock(event.focusBlock!.id);
                        }}
                        className="h-5 w-5 p-0 hover:bg-red-500/30 text-red-400"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      {/* Interactive Chat Bubble - Only show when chat panel is closed */}
      {!showChat && (
        <div className="p-4 bg-gray-950 flex justify-center">
          <div className="rounded-2xl p-4 relative max-w-[620px] w-full bg-[#1e1e1e]">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {/* Interactive Input */}
                <form onSubmit={handleChatSubmit} className="relative mb-3">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask me about my schedule"
                    className="border-gray-700 text-white placeholder-gray-500 pr-10 rounded-lg bg-[#1e1e1e]"
                    disabled={sendMessageMutation.isPending}
                    data-testid="schedule-chat-input"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!chatInput.trim() || sendMessageMutation.isPending}
                    className="absolute right-1 top-1/2 -translate-y-1/2 hover:bg-[#4A00B5] text-white rounded h-7 w-7 bg-[#5E00E1]"
                  >
                    <Send className="h-3 w-3" />
                  </Button>
                </form>
                
                {/* Quick Action Buttons */}
                <div className="flex gap-2 overflow-hidden">
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("I need to create a task")}
                    disabled={sendMessageMutation.isPending}
                    className="hover:bg-gray-700 text-gray-300 text-xs bg-[#383838]"
                    data-testid="quick-create-task"
                  >
                    Create task
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("When is my next meeting?")}
                    disabled={sendMessageMutation.isPending}
                    className="hover:bg-gray-700 text-gray-300 text-xs bg-[#383838]"
                    data-testid="quick-next-meeting"
                  >
                    Next meeting
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("Book focus time for me")}
                    disabled={sendMessageMutation.isPending}
                    className="hover:bg-gray-700 text-gray-300 text-xs bg-[#383838]"
                    data-testid="quick-book-focus"
                  >
                    Book focus time
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleQuickMessage("Help me prioritize my tasks")}
                    disabled={sendMessageMutation.isPending}
                    className="hover:bg-gray-700 text-gray-300 text-xs bg-[#383838]"
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
                  className="h-10 w-10 rounded-full hover:bg-[#4A00B5] text-white bg-[#5E00E1]"
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