import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CalendarEvent, FocusBlock } from "../types";
import { Bot, MoreVertical } from "lucide-react";
import { useState, useEffect } from "react";

interface CalendarPanelProps {
  events: CalendarEvent[];
  focusBlocks: FocusBlock[];
}

export default function CalendarPanel({ events, focusBlocks }: CalendarPanelProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

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

  // Get current hour for highlighting
  const currentHour = currentTime.getHours();

  return (
    <div className="flex flex-col h-full bg-black border-l border-gray-800">
      {/* Legend */}
      <div className="px-6 py-4 border-b border-gray-800">
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
      <ScrollArea className="flex-1">
        <div className="px-6">
          {hours.map((hour) => {
            const { calendarEvent, focusBlock } = getEventAtHour(hour.hour24);
            const isCurrentHour = hour.hour24 === currentHour;
            
            return (
              <div 
                key={hour.hour24} 
                className={`relative h-16 border-b border-gray-900 ${isCurrentHour ? 'bg-gray-900/50' : ''}`}
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

      {/* Chat Bubble */}
      <div className="p-4 border-t border-gray-800">
        <div className="bg-gray-900 rounded-2xl p-4 relative">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-gray-300 text-sm mb-3">Ask me about my schedule</p>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                >
                  Create task
                </Button>
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                >
                  Next meeting
                </Button>
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                >
                  Book focus time
                </Button>
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs"
                >
                  Prioritize?
                </Button>
              </div>
            </div>
            <div className="ml-4 flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 rounded-full bg-purple-500 hover:bg-purple-600 text-white"
              >
                <Bot className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-gray-400 hover:text-white"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}