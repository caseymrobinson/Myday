import { useState } from "react";
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
  const [selectedDate, setSelectedDate] = useState(new Date());
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['/api/tasks'],
    queryFn: api.getTasks
  });

  const { data: agenda } = useQuery({
    queryKey: ['/api/agenda', selectedDate.toISOString().split('T')[0]],
    queryFn: () => api.getAgenda(selectedDate.toISOString().split('T')[0])
  });

  const planDayMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: Array<{role: string, content: string}> }) => 
      api.sendMessage(message, history || []),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agenda'] });
      toast({ title: "AI is planning your day..." });
      setShowChat(true); // Open chat to show the response
    },
    onError: () => {
      toast({ title: "Failed to plan day", variant: "destructive" });
    }
  });

  const handlePlanDay = () => {
    const message = "Help me plan my day by scheduling my tasks into my calendar based on my meetings and available time blocks";
    planDayMutation.mutate({ message, history: [] });
  };

  return (
    <div className="h-screen bg-black flex">
      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Tasks Panel - Left */}
        <div className="w-[400px] flex-shrink-0">
          <TasksPanel 
            tasks={tasks} 
            isLoading={tasksLoading}
            onAddTask={() => setShowAddTask(true)}
            onSetupCalendar={() => setShowCalendarSetup(true)}
            onPlanDay={handlePlanDay}
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
            focusBlocks={[]}
            onOpenChat={() => setShowChat(true)}
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
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