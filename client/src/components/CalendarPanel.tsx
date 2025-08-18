import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import type { CalendarEvent, FocusBlock } from "../types";
import { Bot, ChevronLeft, ChevronRight, Send, Check, X, Calendar } from "lucide-react";
import { useState, useMemo } from "react";
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

// visual constants
const HOUR_HEIGHT_PX = 64;          // each hour row height
const MIN_EVENT_HEIGHT_PX = 32;     // min block size so tiny meetings are clickable
const LEFT_GUTTER_PX = 68;          // space for time labels
const COLUMN_GAP_PX = 4;            // small gap between overlapping columns
const TOP_LABEL_OFFSET_PX = 16;     // offset for hour label positioning

export default function CalendarPanel({
  events,
  focusBlocks,
  onOpenChat,
  selectedDate,
  onDateChange,
  showChat,
}: CalendarPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const currentDate = selectedDate || new Date();
  const dateString = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeString = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: Array<{ role: string; content: string }> }) =>
      api.sendMessage(message, history || []),
    onSuccess: () => {
      setChatInput("");
      toast({ title: "Message sent to AI assistant" });
      onOpenChat();
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
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
      queryClient.invalidateQueries({ queryKey: ["/api/focus-blocks"] });
      toast({ title: "Task confirmed in schedule" });
    },
    onError: () => {
      toast({ title: "Failed to confirm task", variant: "destructive" });
    },
  });

  const dismissFocusBlockMutation = useMutation({
    mutationFn: (blockId: string) => api.deleteFocusBlock(blockId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/focus-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agenda"] });
      toast({ title: "Task removed from schedule" });
    },
    onError: () => {
      toast({ title: "Failed to remove task", variant: "destructive" });
    },
  });

  const handleConfirmFocusBlock = (blockId: string) => {
    confirmFocusBlockMutation.mutate(blockId);
  };

  const handleDismissFocusBlock = (blockId: string) => {
    dismissFocusBlockMutation.mutate(blockId);
  };

  // Generate hour slots for the day
  const hours = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => {
      const hour = i;
      const period = hour < 12 ? "am" : "pm";
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return {
        hour24: hour,
        label: `${displayHour} ${period}`,
      };
    });
  }, []);

  // Calculate positioned events for the entire day with proper overlap handling
  const positionedEvents = useMemo(() => {
    const dayStart = new Date(currentDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(currentDate);
    dayEnd.setHours(23, 59, 59, 999);

    type FlatEvent = {
      id: string;
      title: string;
      start: Date;
      end: Date;
      color: "blue" | "green" | "purple";
      type: "calendar" | "focus";
      focusBlock?: FocusBlock;
    };

    const all: FlatEvent[] = [];

    // Calendar events: include timed events on this day
    events?.forEach((event) => {
      const s = new Date(event.start);
      const e = new Date(event.end);
      if (!event.isAllDay && s >= dayStart && s <= dayEnd) {
        all.push({
          id: event.id,
          title: event.title,
          start: s,
          end: e,
          color: "blue",
          type: "calendar",
        });
      }
    });

    // Focus blocks on this day
    focusBlocks?.forEach((block) => {
      const s = new Date(block.start);
      const e = new Date(block.end);
      if (s >= dayStart && s <= dayEnd) {
        all.push({
          id: block.id,
          title: "Task Block",
          start: s,
          end: e,
          color: block.confirmed ? "green" : "purple",
          type: "focus",
          focusBlock: block,
        });
      }
    });

    // Sort by start time, then by end time
    all.sort((a, b) => {
      const d = a.start.getTime() - b.start.getTime();
      return d !== 0 ? d : a.end.getTime() - b.end.getTime();
    });

    type Positioned = {
      id: string;
      title: string;
      top: number;
      height: number;
      color: "blue" | "green" | "purple";
      type: "calendar" | "focus";
      column: number;
      totalColumns: number;
      focusBlock?: FocusBlock;
      start: Date;
      end: Date;
    };

    const positioned: Positioned[] = [];

    // Sweep-line layout with per-cluster column counts
    const active: Positioned[] = [];
    const freeCols: number[] = []; // pool of reusable column indices
    let nextCol = 0;

    const releaseEnded = (now: Date) => {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].end.getTime() <= now.getTime()) {
          freeCols.push(active[i].column);
          active.splice(i, 1);
        }
      }
      freeCols.sort((a, b) => a - b);
    };

    for (const ev of all) {
      // free columns that ended before this event starts
      releaseEnded(ev.start);

      // assign smallest available column, or a new one
      let col: number;
      if (freeCols.length) {
        col = freeCols.shift()!;
      } else {
        col = nextCol++;
      }

      // compute top and height
      const startHour = ev.start.getHours();
      const startMinutes = ev.start.getMinutes();
      const endHour = ev.end.getHours();
      const endMinutes = ev.end.getMinutes();

      const top =
        startHour * HOUR_HEIGHT_PX + (startMinutes / 60) * HOUR_HEIGHT_PX;
      const durationHours =
        endHour - startHour + (endMinutes - startMinutes) / 60;
      const height = Math.max(durationHours * HOUR_HEIGHT_PX, MIN_EVENT_HEIGHT_PX);

      const p: Positioned = {
        id: ev.id,
        title: ev.title,
        top,
        height,
        color: ev.color,
        type: ev.type,
        column: col,
        totalColumns: 1, // will be updated by cluster size
        focusBlock: ev.focusBlock,
        start: ev.start,
        end: ev.end,
      };

      active.push(p);
      positioned.push(p);

      // update cluster width: every active event should share the same max columns
      const clusterCols = active.length;
      for (const a of active) {
        if (a.totalColumns < clusterCols) a.totalColumns = clusterCols;
      }
    }

    // done; any remaining active doesn't matter for counts anymore

    return positioned;
  }, [events, focusBlocks, currentDate]);

  // All-Day events for this day
  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(currentDate);
  dayEnd.setHours(23, 59, 59, 999);

  const allDayEvents =
    events?.filter((event) => {
      const s = new Date(event.start);
      return event.isAllDay && s >= dayStart && s <= dayEnd;
    }) || [];

  // Current hour line if viewing today
  const now = new Date();
  const isToday = currentDate.toDateString() === now.toDateString();
  const currentHour = isToday ? now.getHours() : -1;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
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

      {/* All-Day Events */}
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
          {/* Hour grid */}
          {hours.map((hour) => {
            const isCurrentHour = hour.hour24 === currentHour;

            return (
              <div
                key={hour.hour24}
                className={`relative h-16 ${isCurrentHour ? "bg-gray-900/50" : "hover:bg-gray-950/50"}`}
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
            // width calc with per-cluster columns and a small gap
            const widthCalc =
              `calc(( (100% - ${LEFT_GUTTER_PX}px) - ${COLUMN_GAP_PX}px * (${event.totalColumns - 1}) ) / ${event.totalColumns})`;

            // left calc: gutter + column index * (colWidth + gap)
            const leftCalc =
              `calc(${LEFT_GUTTER_PX}px + ${event.column} * ( ( (100% - ${LEFT_GUTTER_PX}px) - ${COLUMN_GAP_PX}px * (${event.totalColumns - 1}) ) / ${event.totalColumns} + ${COLUMN_GAP_PX}px ))`;

            return (
              <div
                key={event.id}
                className="absolute z-20 pr-2"
                style={{
                  top: `${event.top + TOP_LABEL_OFFSET_PX}px`,
                  height: `${event.height - 8}px`,
                  left: leftCalc,
                  width: widthCalc,
                }}
              >
                <div
                  className={`
                    ${event.color === "blue" ? "bg-blue-500/20 border-blue-500 text-blue-400" : ""}
                    ${event.color === "green" ? "bg-green-500/20 border-green-500 text-green-400" : ""}
                    ${event.color === "purple" ? "bg-[#5E00E1]/20 border-[#5E00E1] text-[#8C4CFF]" : ""}
                    border-l-2 rounded px-2 py-1 h-full flex flex-col justify-between
                  `}
                >
                  <p className="text-xs truncate">{event.title}</p>

                  {/* Focus block controls */}
                  {event.type === "focus" && event.focusBlock && !event.focusBlock.confirmed && (
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

      {/* Chat bubble */}
      {!showChat && (
        <div className="p-4 bg-gray-950 flex justify-center">
          <div className="rounded-2xl p-4 relative max-w-[620px] w-full bg-[#1e1e1e]">
            <div className="flex items-start justify-between">
              <div className="flex-1">
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