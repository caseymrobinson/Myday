import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { AgendaResponse } from "../types";
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  MessageCircle, 
  Video, 
  MapPin,
  Check,
  X,
  Sparkles
} from "lucide-react";

interface CalendarPanelProps {
  agenda: AgendaResponse | undefined;
  isLoading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  onToggleChat: () => void;
}

export default function CalendarPanel({ 
  agenda, 
  isLoading, 
  selectedDate, 
  onDateChange, 
  onToggleChat
}: CalendarPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const getCurrentTime = () => {
    return new Date().toLocaleTimeString([], { 
      hour: 'numeric', 
      minute: '2-digit',
      second: '2-digit',
      hour12: true 
    });
  };

  const [currentTime, setCurrentTime] = useState(() => getCurrentTime());

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getCurrentTime());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const focusBlockMutation = useMutation({
    mutationFn: api.createFocusBlock,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "Focus block created successfully!" });
    }
  });

  const aiScheduleMutation = useMutation({
    mutationFn: () => api.planDay(selectedDate),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      
      // Show rationale from AI response
      const rationale = data.recommendations?.join('\n') || 'AI successfully scheduled your tasks.';
      toast({ 
        title: "AI Scheduling Complete", 
        description: rationale,
        duration: 8000 // Show longer for rationale
      });
    },
    onError: () => {
      toast({ 
        title: "Scheduling Failed", 
        description: "Could not generate AI suggestions. Please try again.",
        variant: "destructive"
      });
    }
  });

  const handleAISchedule = () => {
    aiScheduleMutation.mutate();
  };

  const formatDate = (dateStr: string) => {
    // Parse the date string and create a date in local time
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    
    return {
      full: date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      day: date.toLocaleDateString('en-US', { weekday: 'long' })
    };
  };

  const navigateDate = (direction: 'prev' | 'next') => {
    const currentDate = new Date(selectedDate);
    if (direction === 'prev') {
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      currentDate.setDate(currentDate.getDate() + 1);
    }
    onDateChange(currentDate.toISOString().split('T')[0]);
  };

  const goToToday = () => {
    onDateChange(new Date().toISOString().split('T')[0]);
  };

  const confirmSuggestion = async (suggestion: any) => {
    try {
      // Create a focus block from the AI suggestion
      await api.createFocusBlock({
        taskId: suggestion.taskId,
        start: suggestion.start,
        end: suggestion.end,
        confirmed: true
      });
      
      // Update task status to confirmed
      await api.updateTask(suggestion.taskId, {
        status: 'confirmed'
      });
      
      toast({
        title: "Task Scheduled",
        description: `${suggestion.taskTitle} has been added to your calendar`,
      });
      
      // Refresh the agenda to update the view
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
    } catch (error) {
      toast({
        title: "Scheduling Failed",
        description: "Could not schedule the task. Please try again.",
        variant: "destructive"
      });
    }
  };

  const dismissSuggestion = async (suggestionId: string) => {
    // Remove the suggestion from the current suggestions list
    // We'll need to implement a way to filter out dismissed suggestions
    toast({ 
      title: "Suggestion dismissed",
      description: "Task suggestion has been removed."
    });
    // Refresh to update view
    queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
  };

  const timeSlots = Array.from({ length: 24 }, (_, i) => i); // All 24 hours: 0-23

  const getEventStyle = (start: string, end: string) => {
    const startTime = new Date(start);
    const endTime = new Date(end);
    
    // Convert to Eastern Time for positioning on calendar
    const startHour = startTime.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false
    });
    const startMin = startTime.toLocaleString('en-US', {
      timeZone: 'America/New_York', 
      minute: 'numeric'
    });
    
    const startHourFloat = parseInt(startHour) + parseInt(startMin) / 60;
    const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
    
    const top = startHourFloat * 60; // 60px per hour, starting from hour 0
    const height = duration * 60;
    
    return { top: `${top}px`, height: `${height}px` };
  };

  const formatTime = (dateStr: string) => {
    // Create date and ensure consistent timezone handling
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,  // 12-hour format with AM/PM
      timeZone: 'America/New_York' // Display in Eastern Time
    });
  };

  const formatHour = (hour: number) => {
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  const formatted = formatDate(selectedDate);

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
              <span className="text-lg font-medium text-gray-700" data-testid="text-current-date">
                {formatted.full}
              </span>
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <span>Current Time:</span>
                <span className="font-mono font-medium" data-testid="text-current-time">
                  {currentTime}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigateDate('prev')}
              data-testid="button-previous-day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              onClick={goToToday}
              className="bg-blue-600 text-white hover:bg-blue-700"
              size="sm"
              data-testid="button-today"
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigateDate('next')}
              data-testid="button-next-day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleChat}
              className="ml-4"
              data-testid="button-toggle-chat"
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAISchedule}
              disabled={aiScheduleMutation.isPending}
              className="ml-2"
              data-testid="button-ai-schedule"
            >
              <Sparkles className="h-4 w-4" />
              {aiScheduleMutation.isPending ? 'Scheduling...' : 'AI Schedule'}
            </Button>
          </div>
        </div>
        
        {/* Legend */}
        <div className="mt-3 flex items-center space-x-6 text-xs">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-green-200 border border-green-400 rounded mr-2"></div>
            <span className="text-gray-600">Meetings</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 bg-blue-200 border border-blue-400 rounded mr-2"></div>
            <span className="text-gray-600">Focus Blocks</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 bg-amber-100 border-2 border-dashed border-amber-400 rounded mr-2"></div>
            <span className="text-gray-600">AI Suggestions</span>
          </div>
        </div>
      </div>
      
      {/* Calendar Grid */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Loading calendar...</div>
          </div>
        ) : (
          <div className="grid grid-cols-12 h-full min-h-[1440px]">
            {/* Time Labels Column */}
            <div className="col-span-1 border-r border-gray-200">
              {timeSlots.map(hour => (
                <div 
                  key={hour}
                  className="h-[60px] flex items-center justify-center text-xs text-gray-500 font-medium border-b border-gray-100"
                  data-testid={`time-slot-${hour}`}
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>
            
            {/* Events Column */}
            <div className="col-span-11 relative">
              {/* Hour grid lines */}
              {timeSlots.map(hour => (
                <div 
                  key={hour}
                  className="absolute left-0 right-0 h-[60px] border-b border-gray-100"
                  style={{ top: `${hour * 60}px` }}
                />
              ))}
              
              {/* Meetings */}
              {agenda?.meetings.map(meeting => (
                <div
                  key={meeting.id}
                  className="absolute left-2 right-2 bg-gradient-to-br from-green-200 to-green-300 border border-green-400 rounded-lg p-2 text-sm overflow-hidden"
                  style={getEventStyle(meeting.start, meeting.end)}
                  data-testid={`event-meeting-${meeting.id}`}
                >
                  <div className="font-medium text-gray-800 truncate">{meeting.title}</div>
                  <div className="text-xs text-gray-600">
                    {formatTime(meeting.start)} - {formatTime(meeting.end)}
                  </div>
                  {meeting.location && (
                    <div className="text-xs text-gray-600 flex items-center mt-1 truncate">
                      {meeting.location.includes('Zoom') || meeting.location.includes('zoom') ? (
                        <Video className="h-3 w-3 mr-1 flex-shrink-0" />
                      ) : (
                        <MapPin className="h-3 w-3 mr-1 flex-shrink-0" />
                      )}
                      <span className="truncate">{meeting.location}</span>
                    </div>
                  )}
                  {meeting.description && (
                    <div className="text-xs text-gray-500 mt-1 truncate" title={meeting.description}>
                      {meeting.description}
                    </div>
                  )}
                </div>
              ))}
              
              {/* Focus Blocks */}
              {agenda?.focusBlocks.map(focusBlock => (
                <div
                  key={focusBlock.id}
                  className="absolute left-2 right-2 bg-gradient-to-br from-blue-200 to-blue-300 border border-blue-400 rounded-lg p-2 text-sm overflow-hidden"
                  style={getEventStyle(focusBlock.start, focusBlock.end)}
                  data-testid={`event-focus-block-${focusBlock.id}`}
                >
                  <div className="font-medium text-gray-800 truncate">{focusBlock.taskTitle}</div>
                  <div className="text-xs text-gray-600">
                    {formatTime(focusBlock.start)} - {formatTime(focusBlock.end)}
                  </div>
                  <div className="text-xs text-blue-700 font-medium mt-1">
                    Focus Block {focusBlock.confirmed ? '(Confirmed)' : '(Pending)'}
                  </div>
                </div>
              ))}

              {/* AI Suggestions */}
              {agenda?.suggestions.map((suggestion, index) => (
                <div
                  key={`suggestion-${index}`}
                  className="absolute left-2 right-2 bg-gradient-to-br from-amber-100 to-amber-200 border-2 border-dashed border-amber-400 rounded-lg p-2 text-sm"
                  style={getEventStyle(suggestion.start, suggestion.end)}
                  data-testid={`event-suggestion-${suggestion.taskId}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-gray-800">{suggestion.taskTitle}</div>
                    <Badge className="bg-amber-500 text-white text-xs">AI</Badge>
                  </div>
                  <div className="text-xs text-gray-600 mb-2">
                    {formatTime(suggestion.start)} - {formatTime(suggestion.end)} (Suggested)
                  </div>
                  <div className="flex space-x-1">
                    <Button
                      size="sm"
                      onClick={() => confirmSuggestion(suggestion)}
                      disabled={focusBlockMutation.isPending}
                      className="bg-green-600 text-white hover:bg-green-700 text-xs px-2 py-1 h-auto"
                      data-testid={`button-confirm-suggestion-${suggestion.taskId}`}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => dismissSuggestion(suggestion.taskId)}
                      variant="secondary"
                      className="text-xs px-2 py-1 h-auto"
                      data-testid={`button-dismiss-suggestion-${suggestion.taskId}`}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}