import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import type { CalendarEvent, FocusBlock } from "../types";
import { Bot, ChevronLeft, ChevronRight, Send, Check, X, Calendar } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
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
  onConfirmFocusBlock?: (blockId: string) => void; // optional external hooks, not required
  onDismissFocusBlock?: (blockId: string) => void;
}

// Visual constants
const HOUR_HEIGHT_PX = 64;
const MIN_EVENT_HEIGHT_PX = 32;
const LEFT_GUTTER_PX = 70;     // space for hour labels
const COLUMN_GAP_PX = 4;
const TOP_LABEL_OFFSET_PX = 8;

// ---------- date helpers ----------
function startOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDayLocal(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart; // half-open style
}
function asDate(x: any): Date | null {
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

export default function CalendarPanel({
  events,
  focusBlocks,
  onOpenChat,
  selectedDate,
  onDateChange,
  showChat,
}: CalendarPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(timer);
  }, []);

  const currentDate = selectedDate || new Date();
  const dateString = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeString = currentTime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // ---------- mutations ----------
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
    onError: (error) => {
      console.error("Failed to dismiss focus block:", error);
      toast({ title: "Failed to remove task", variant: "destructive" });
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

  // ---------- hours ----------
  const hours = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => {
        const hour = i;
        const period = hour < 12 ? "am" : "pm";
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return { hour24: hour, label: `${displayHour} ${period}` };
      }),
    []
  );

  // ---------- day window ----------
  const dayStart = useMemo(() => startOfDayLocal(currentDate), [currentDate]);
  const dayEnd = useMemo(() => endOfDayLocal(currentDate), [currentDate]);

  // ---------- all-day events (use LOCAL overlap, not ISO/UTC string comparisons) ----------
  const allDayEvents = useMemo(() => {
    return (
      events?.filter((ev) => {
        if (!ev.isAllDay) return false;
        const s = asDate(ev.start);
        const e = asDate(ev.end) ?? (s ? new Date(s.getTime() + 24 * 60 * 60 * 1000) : null);
        if (!s || !e) return false;
        // Treat all-day as [start, end) and include if it overlaps the local day range
        return rangesOverlap(s, e, dayStart, dayEnd);
      }) || []
    );
  }, [events, dayStart, dayEnd]);

  // ---------- timed events + focus blocks: overlap + clamping + proper columns ----------
  const positionedEvents = useMemo(() => {
    type FlatEvent = {
      id: string;
      title: string;
      start: Date;
      end: Date;
      color: "blue" | "green" | "purple";
      type: "calendar" | "focus";
      focusBlock?: FocusBlock;
    };

    const list: FlatEvent[] = [];

    // Timed calendar events
    events?.forEach((ev) => {
      if (ev.isAllDay) return;
      const s = asDate(ev.start);
      const e = asDate(ev.end);
      if (!s || !e) return;
      if (rangesOverlap(s, e, dayStart, dayEnd)) {
        list.push({
          id: ev.id,
          title: ev.title,
          start: s,
          end: e,
          color: "blue",
          type: "calendar",
        });
      }
    });

    // Focus blocks
    focusBlocks?.forEach((b) => {
      const s = asDate(b.start);
      const e = asDate(b.end);
      if (!s || !e) return;
      if (rangesOverlap(s, e, dayStart, dayEnd)) {
        // Use the task title if available in the focus block data
        const taskTitle = (b as any).taskTitle || "Task Block";
        
        list.push({
          id: b.id,
          title: taskTitle,
          start: s,
          end: e,
          color: b.confirmed ? "green" : "purple",
          type: "focus",
          focusBlock: b,
        });
      }
    });

    // Sort by start then end
    list.sort((a, b) => {
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

    // Sweep-line for columns with per-cluster widths
    const active: Positioned[] = [];
    const freeCols: number[] = [];
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

    for (const ev of list) {
      // free finished columns
      releaseEnded(ev.start);

      // assign smallest free column or new one
      const col = freeCols.length ? freeCols.shift()! : nextCol++;

      // Clamp to visible day for geometry
      const vs = new Date(Math.max(ev.start.getTime(), dayStart.getTime()));
      const ve = new Date(Math.min(ev.end.getTime(), dayEnd.getTime()));

      const startHour = vs.getHours();
      const startMinutes = vs.getMinutes();
      const top = startHour * HOUR_HEIGHT_PX + (startMinutes / 60) * HOUR_HEIGHT_PX;

      const durationMs = Math.max(ve.getTime() - vs.getTime(), 0);
      const durationHours = durationMs / (60 * 60 * 1000);
      const height = Math.max(durationHours * HOUR_HEIGHT_PX, MIN_EVENT_HEIGHT_PX);

      const p: Positioned = {
        id: ev.id,
        title: ev.title,
        top,
        height,
        color: ev.color,
        type: ev.type,
        column: col,
        totalColumns: 1,
        focusBlock: ev.focusBlock,
        start: ev.start,
        end: ev.end,
      };

      active.push(p);
      positioned.push(p);

      // Update per-cluster max
      const clusterCols = active.length;
      for (const a of active) {
        if (a.totalColumns < clusterCols) a.totalColumns = clusterCols;
      }
    }

    return positioned;
  }, [events, focusBlocks, dayStart, dayEnd]);

  // Current hour line
  const isToday = currentDate.toDateString() === currentTime.toDateString();
  const currentHour = isToday ? currentTime.getHours() : -1;

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
              const d = new Date(currentDate);
              d.setDate(d.getDate() - 1);
              onDateChange(d);
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
              const d = new Date(currentDate);
              d.setDate(d.getDate() + 1);
              onDateChange(d);
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
                <span className="absolute -top-2 left-0 text-xs text-gray-600 z-10">{hour.label}</span>
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gray-800/50" />
                {isCurrentHour && (
                  <div className="absolute left-0 right-0 top-1/2 h-px bg-red-500/50 z-30" />
                )}
              </div>
            );
          })}

          {/* Positioned events overlay */}
          {positionedEvents.map((ev) => {
            // width: ((100% - gutter) - gap*(cols-1)) / cols
            const widthCalc = `calc(( (100% - ${LEFT_GUTTER_PX}px) - ${COLUMN_GAP_PX}px * (${ev.totalColumns - 1}) ) / ${ev.totalColumns})`;
            // left: gutter + colIndex * (colWidth + gap)
            const leftCalc = `calc(${LEFT_GUTTER_PX}px + ${ev.column} * ( ( (100% - ${LEFT_GUTTER_PX}px) - ${COLUMN_GAP_PX}px * (${ev.totalColumns - 1}) ) / ${ev.totalColumns} + ${COLUMN_GAP_PX}px ))`;

            return (
              <div
                key={ev.id}
                className="absolute z-20 pr-2"
                style={{
                  top: `${ev.top + TOP_LABEL_OFFSET_PX}px`,
                  height: `${ev.height - 8}px`,
                  left: leftCalc,
                  width: widthCalc,
                }}
              >
                <div
                  className={`
                    ${ev.color === "blue" ? "bg-blue-500/20 border-blue-500 text-blue-400" : ""}
                    ${ev.color === "green" ? "bg-green-500/20 border-green-500 text-green-400" : ""}
                    ${ev.color === "purple" ? "bg-[#5E00E1]/20 border-[#5E00E1] text-[#8C4CFF]" : ""}
                    border-l-2 rounded px-2 py-1 h-full flex items-center justify-between
                  `}
                >
                  <p className="text-xs truncate flex-1 pr-2">{ev.title}</p>

                  {ev.type === "focus" && ev.focusBlock && !ev.focusBlock.confirmed && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmFocusBlockMutation.mutate(ev.focusBlock!.id);
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
                          dismissFocusBlockMutation.mutate(ev.focusBlock!.id);
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