import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import TasksPanel from "@/components/TasksPanel";
import CalendarPanel from "@/components/CalendarPanel";
import ChatPanel from "@/components/ChatPanel";
import AddTaskModal from "@/components/AddTaskModal";
import CalendarSetupModal from "@/components/CalendarSetupModal";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";

export default function Dashboard() {
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [showChat, setShowChat] = useState(false);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['/api/tasks']
  });

  const { data: agenda } = useQuery({
    queryKey: ['/api/agenda']
  });

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
          />
        </div>

        {/* Calendar Panel - Center/Right */}
        <div className="flex-1">
          <CalendarPanel 
            events={agenda?.meetings || []}
            focusBlocks={[]}
          />
        </div>

        {/* Chat Panel - Slide in from right */}
        {showChat && (
          <div className="w-[400px] flex-shrink-0">
            <ChatPanel onClose={() => setShowChat(false)} />
          </div>
        )}
      </div>

      {/* Floating Chat Button */}
      {!showChat && (
        <Button
          onClick={() => setShowChat(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white border-0"
          size="icon"
          data-testid="button-open-chat"
        >
          <Bot className="h-6 w-6" />
        </Button>
      )}

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