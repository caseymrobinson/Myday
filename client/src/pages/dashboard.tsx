import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import TasksPanel from "@/components/TasksPanel";
import CalendarPanel from "@/components/CalendarPanel";
import ChatPanel from "@/components/ChatPanel";
import AddTaskModal from "@/components/AddTaskModal";
import CalendarSetupModal from "@/components/CalendarSetupModal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Bot } from "lucide-react";

export default function Dashboard() {
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date('2024-12-02'));
  const [tasksPanelWidth, setTasksPanelWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['/api/tasks'],
    queryFn: api.getTasks
  });

  const { data: agenda } = useQuery({
    queryKey: ['/api/agenda', selectedDate.toISOString().split('T')[0]],
    queryFn: () => api.getAgenda(selectedDate.toISOString().split('T')[0])
  });

  const { data: focusBlocks = [] } = useQuery({
    queryKey: ['/api/focus-blocks'],
    queryFn: api.getFocusBlocks
  });

  // Ensure focusBlocks are properly typed
  const typedFocusBlocks = Array.isArray(focusBlocks) ? focusBlocks : [];

  const planDayMutation = useMutation({
    mutationFn: (date: string) => api.planDay(date),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      queryClient.invalidateQueries({ queryKey: ['/api/focus-blocks'] });
      if (result.focusBlocksCreated && result.focusBlocksCreated > 0) {
        toast({ title: `Planned ${result.focusBlocksCreated} tasks into your schedule` });
      } else {
        toast({ title: "Day planning complete - check your calendar" });
      }
    },
    onError: () => {
      toast({ title: "Failed to plan day", variant: "destructive" });
    }
  });

  const handlePlanDay = () => {
    const dateString = selectedDate.toISOString().split('T')[0];
    planDayMutation.mutate(dateString);
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = e.clientX - containerRect.left;
    
    // Constrain width between 280px and 600px
    const clampedWidth = Math.max(280, Math.min(600, newWidth));
    setTasksPanelWidth(clampedWidth);
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add event listeners for mouse move and mouse up
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div className="h-screen bg-black flex">
      {/* Main Content */}
      <div className="flex-1 flex" ref={containerRef}>
        {/* Tasks Panel - Left */}
        <div 
          className="flex-shrink-0 relative"
          style={{ width: `${tasksPanelWidth}px` }}
        >
          <TasksPanel 
            tasks={tasks} 
            isLoading={tasksLoading}
            onAddTask={() => setShowAddTask(true)}
            onSetupCalendar={() => setShowCalendarSetup(true)}
            onPlanDay={handlePlanDay}
          />
          
          {/* Resize Handle */}
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-gray-600/50 transition-colors z-50"
            onMouseDown={handleMouseDown}
            data-testid="resize-handle-tasks-panel"
          />
        </div>

        {/* Calendar Panel - Center/Right */}
        <div className="flex-1">
          <CalendarPanel 
            events={agenda?.meetings ? agenda.meetings.map(meeting => ({
              ...meeting,
              start: new Date(meeting.start),
              end: new Date(meeting.end)
            })) : []}
            focusBlocks={typedFocusBlocks}
            onOpenChat={() => setShowChat(true)}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            showChat={showChat}
          />
        </div>

        {/* Chat Panel - Slide in from right */}
        {showChat && (
          <div className="w-[400px] flex-shrink-0">
            <ChatPanel onClose={() => setShowChat(false)} />
          </div>
        )}
      </div>



      {/* Modals */}
      <AddTaskModal 
        open={showAddTask} 
        onOpenChange={setShowAddTask} 
      />
      <CalendarSetupModal 
        open={showCalendarSetup} 
        onOpenChange={setShowCalendarSetup} 
      />
    </div>
  );
}